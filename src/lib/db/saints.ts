import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  documentId,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import type { Language } from '../../types';

export interface SaintName {
  sr_cyr: string;
  sr_lat: string;
  en: string;
  ru: string;
  uk: string;
  ro?: string;
}

export interface SaintDetail {
  name: SaintName;
  description: SaintName;
}

export interface SaintIndexDay {
  date: string;
  names: SaintName[];
}

export interface SaintIndexMonth {
  month: string;
  days: Record<string, SaintIndexDay>;
}

export interface SaintFullDay {
  date: string;
  saints: SaintDetail[];
}

/** Maps app Language to the key in the SaintName map. */
export function saintLangKey(language: Language): keyof SaintName {
  switch (language) {
    case 'Srpski (Ćirilica)': return 'sr_cyr';
    case 'Srpski (Latinica)': return 'sr_lat';
    case 'Русский': return 'ru';
    case 'Українська': return 'uk';
    case 'Română': return 'ro';
    default: return 'en';
  }
}

export function getSaintLocalizedText(
  values: SaintName | undefined,
  language: Language,
  fallback = true
): string {
  if (!values) return '';

  const key = saintLangKey(language);
  const value = values[key];
  if (value) return value;

  // Preserve explicit empty strings from sparse scraped language data. An empty
  // value means this source language did not have a matching saint entry.
  if (value === '') return '';

  if (!fallback) return '';
  return values.en || values.sr_lat || values.sr_cyr || '';
}

/** Returns today's date as YYYY-MM-DD in local time. */
export function todayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fetches the lean index document for a single date (names only).
 * Used for: home screen "saint of the day" name display.
 */
export async function getSaintIndexForDate(date: string): Promise<SaintIndexDay | null> {
  const snap = await getDoc(doc(db, 'saints_index', date));
  if (!snap.exists()) return null;
  return snap.data() as SaintIndexDay;
}

/**
 * Fetches the full detail document for a single date (names + descriptions).
 * Used for: day-detail modal when a user taps to read the full hagiography.
 */
export async function getSaintDetailForDate(date: string): Promise<SaintFullDay | null> {
  const snap = await getDoc(doc(db, 'saints', date));
  if (!snap.exists()) return null;
  return snap.data() as SaintFullDay;
}

// In-memory cache keyed by "YYYY-MM". Avoids re-querying months the user
// has already browsed in the same session. The Firestore persistent cache
// handles cross-session deduplication via IndexedDB.
const monthIndexCache = new Map<string, Record<string, SaintIndexDay>>();

async function getSaintIndexForMonthFromDailyDocs(
  year: number,
  month: number
): Promise<Record<string, SaintIndexDay>> {
  const mm = String(month + 1).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const q = query(
    collection(db, 'saints_index'),
    where(documentId(), '>=', from),
    where(documentId(), '<=', to)
  );

  const snap = await getDocs(q);
  const result: Record<string, SaintIndexDay> = {};
  snap.forEach((d) => {
    result[d.id] = d.data() as SaintIndexDay;
  });
  return result;
}

/**
 * Fetches all saint index data for a given month.
 * Calendar views read saints_index_months/{YYYY-MM}: one Firestore read per
 * month instead of 28-31 daily index reads. Daily docs remain as a fallback.
 */
export async function getSaintIndexForMonth(
  year: number,
  month: number
): Promise<Record<string, SaintIndexDay>> {
  const mm = String(month + 1).padStart(2, '0');
  const cacheKey = `${year}-${mm}`;

  const cached = monthIndexCache.get(cacheKey);
  if (cached) return cached;

  const monthSnap = await getDoc(doc(db, 'saints_index_months', cacheKey));
  const result = monthSnap.exists()
    ? (monthSnap.data() as SaintIndexMonth).days ?? {}
    : await getSaintIndexForMonthFromDailyDocs(year, month);

  monthIndexCache.set(cacheKey, result);
  return result;
}
