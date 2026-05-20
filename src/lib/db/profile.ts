import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Language, UserProfile } from '../../types';
import { db } from '../firebase/firestore';

const MAX_FCM_TOKENS = 10;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_MINISTRIES = 20;
const MAX_MINISTRY_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 1000;

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new Error(`${field} must be at most ${max} characters.`);
  }
}

export function sanitizeProfileInput(data: {
  displayName: string;
  preferredLanguage: Language;
  phone: string;
  ministries: string[];
  description: string;
  showInDirectory: boolean;
}) {
  const displayName = data.displayName.trim();
  const phone = data.phone.trim();
  const description = data.description.trim();
  const ministries = data.ministries
    .map((ministry) => ministry.trim())
    .filter(Boolean)
    .slice(0, MAX_MINISTRIES);

  assertLength(displayName, MAX_DISPLAY_NAME_LENGTH, 'Display name');
  assertLength(phone, MAX_PHONE_LENGTH, 'Phone');
  assertLength(description, MAX_DESCRIPTION_LENGTH, 'Description');
  for (const ministry of ministries) {
    assertLength(ministry, MAX_MINISTRY_LENGTH, 'Ministry');
  }

  return {
    ...data,
    displayName,
    phone,
    ministries,
    description,
  };
}

export async function createOrUpdateUserProfile(
  uid: string,
  data: { email: string; displayName: string; photoURL: string | null }
): Promise<void> {
  const ref = doc(db, 'users', uid);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      ...data,
      preferredLanguage: 'English',
      phone: '',
      ministries: [],
      description: '',
      showInDirectory: false,
      fcmTokens: [],
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      displayName: data.displayName,
      ...(data.photoURL ? { photoURL: data.photoURL } : {}),
    });
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, 'users', uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    uid,
    email: data.email ?? '',
    displayName: data.displayName ?? '',
    photoURL: data.photoURL ?? null,
    preferredLanguage: (data.preferredLanguage ?? 'English') as Language,
    phone: data.phone ?? '',
    ministries: Array.isArray(data.ministries)
      ? data.ministries.filter((value): value is string => typeof value === 'string')
      : [],
    description: data.description ?? '',
    showInDirectory: data.showInDirectory ?? true,
    fcmTokens: Array.isArray(data.fcmTokens)
      ? data.fcmTokens.filter((value): value is string => typeof value === 'string')
      : [],
    createdAt: data.createdAt,
  };
}

export async function updateUserProfile(
  uid: string,
  data: {
    displayName: string;
    preferredLanguage: Language;
    phone: string;
    ministries: string[];
    description: string;
    showInDirectory: boolean;
  }
): Promise<void> {
  const safeData = sanitizeProfileInput(data);
  const batch = writeBatch(db);
  const userRef = doc(db, 'users', uid);
  batch.update(userRef, {
    displayName: safeData.displayName,
    preferredLanguage: safeData.preferredLanguage,
    phone: safeData.phone,
    ministries: safeData.ministries,
    description: safeData.description,
    showInDirectory: safeData.showInDirectory,
  });

  const membershipsSnap = await getDocs(collection(db, 'users', uid, 'churchMemberships'));
  membershipsSnap.docs.forEach((membership) => {
    batch.update(doc(db, 'churches', membership.id, 'members', uid), {
      displayName: safeData.displayName,
      phone: safeData.phone,
      ministry: safeData.ministries.join(', '),
      description: safeData.description,
      showInDirectory: safeData.showInDirectory,
    });
  });

  await batch.commit();
}

export async function updateUserAvatar(uid: string, photoURL: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), { photoURL });

  const membershipsSnap = await getDocs(collection(db, 'users', uid, 'churchMemberships'));
  membershipsSnap.docs.forEach((membership) => {
    batch.update(doc(db, 'churches', membership.id, 'members', uid), { photoURL });
  });

  await batch.commit();
}

export async function updateUserLanguage(uid: string, language: Language): Promise<void> {
  const ref = doc(db, 'users', uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, { preferredLanguage: language });
  }
}

export async function addFcmToken(uid: string, token: string): Promise<void> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing: string[] = snap.data().fcmTokens ?? [];
  if (existing.includes(token)) return;
  // Keep only the most recent tokens to avoid unbounded growth and stale token errors
  const updated = [...existing, token].slice(-MAX_FCM_TOKENS);
  await updateDoc(ref, { fcmTokens: updated });
}
