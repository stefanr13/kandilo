import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore';
import type { Language, TaxReceiptAddress, UserProfile } from '../../types';
import { db } from '../firebase/firestore';

const MAX_FCM_TOKENS = 10;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_MINISTRIES = 20;
const MAX_MINISTRY_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH = 160;
const MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH = 160;
const MAX_TAX_RECEIPT_LOCALITY_LENGTH = 100;
const MAX_TAX_RECEIPT_POSTAL_CODE_LENGTH = 30;
const MAX_TAX_RECEIPT_COUNTRY_LENGTH = 80;

export const EMPTY_TAX_RECEIPT_ADDRESS: TaxReceiptAddress = {
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
};

function assertLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw new Error(`${field} must be at most ${max} characters.`);
  }
}

function isValidOptionalHttpsUrl(value: unknown): boolean {
  return value === null
    || value === ''
    || (typeof value === 'string' && value.length <= 2000 && value.startsWith('https://'));
}

function isStringWithin(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isValidMinistries(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= MAX_MINISTRIES
    && value.every((ministry) => isStringWithin(ministry, MAX_MINISTRY_LENGTH));
}

function isValidFcmTokens(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= MAX_FCM_TOKENS
    && value.every((token) => typeof token === 'string');
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sanitizeTaxReceiptAddress(address?: Partial<TaxReceiptAddress> | null): TaxReceiptAddress {
  return {
    line1: (address?.line1 ?? '').trim(),
    line2: (address?.line2 ?? '').trim(),
    city: (address?.city ?? '').trim(),
    region: (address?.region ?? '').trim(),
    postalCode: (address?.postalCode ?? '').trim(),
    country: (address?.country ?? '').trim(),
  };
}

export function hasTaxReceiptAddressDetails(address?: Partial<TaxReceiptAddress> | null): boolean {
  const safeAddress = sanitizeTaxReceiptAddress(address);
  return Boolean(
    safeAddress.line1
    && safeAddress.city
    && safeAddress.region
    && safeAddress.postalCode
    && safeAddress.country
  );
}

export function isTaxReceiptProfileComplete(profile?: {
  taxReceiptLegalName?: string;
  taxReceiptAddress?: Partial<TaxReceiptAddress> | null;
} | null): boolean {
  return Boolean(
    profile?.taxReceiptLegalName?.trim()
    && hasTaxReceiptAddressDetails(profile.taxReceiptAddress)
  );
}

export function sanitizeTaxReceiptProfileInput(data: {
  taxReceiptLegalName?: string;
  taxReceiptAddress?: Partial<TaxReceiptAddress> | null;
}) {
  const taxReceiptLegalName = (data.taxReceiptLegalName ?? '').trim();
  const taxReceiptAddress = sanitizeTaxReceiptAddress(data.taxReceiptAddress);

  assertLength(taxReceiptLegalName, MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH, 'Tax receipt legal name');
  assertLength(taxReceiptAddress.line1, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH, 'Tax receipt address line 1');
  assertLength(taxReceiptAddress.line2, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH, 'Tax receipt address line 2');
  assertLength(taxReceiptAddress.city, MAX_TAX_RECEIPT_LOCALITY_LENGTH, 'Tax receipt city');
  assertLength(taxReceiptAddress.region, MAX_TAX_RECEIPT_LOCALITY_LENGTH, 'Tax receipt region');
  assertLength(taxReceiptAddress.postalCode, MAX_TAX_RECEIPT_POSTAL_CODE_LENGTH, 'Tax receipt postal code');
  assertLength(taxReceiptAddress.country, MAX_TAX_RECEIPT_COUNTRY_LENGTH, 'Tax receipt country');

  return {
    taxReceiptLegalName,
    taxReceiptAddress,
  };
}

function isValidTaxReceiptAddress(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const address = value as Record<string, unknown>;
  const allowedKeys = new Set(['line1', 'line2', 'city', 'region', 'postalCode', 'country']);
  if (Object.keys(address).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  return (address.line1 === undefined || isStringWithin(address.line1, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH))
    && (address.line2 === undefined || isStringWithin(address.line2, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH))
    && (address.city === undefined || isStringWithin(address.city, MAX_TAX_RECEIPT_LOCALITY_LENGTH))
    && (address.region === undefined || isStringWithin(address.region, MAX_TAX_RECEIPT_LOCALITY_LENGTH))
    && (address.postalCode === undefined || isStringWithin(address.postalCode, MAX_TAX_RECEIPT_POSTAL_CODE_LENGTH))
    && (address.country === undefined || isStringWithin(address.country, MAX_TAX_RECEIPT_COUNTRY_LENGTH));
}

function mapTaxReceiptAddress(value: unknown): TaxReceiptAddress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_TAX_RECEIPT_ADDRESS;
  }

  const address = value as Record<string, unknown>;
  return sanitizeTaxReceiptAddress({
    line1: typeof address.line1 === 'string' ? address.line1 : '',
    line2: typeof address.line2 === 'string' ? address.line2 : '',
    city: typeof address.city === 'string' ? address.city : '',
    region: typeof address.region === 'string' ? address.region : '',
    postalCode: typeof address.postalCode === 'string' ? address.postalCode : '',
    country: typeof address.country === 'string' ? address.country : '',
  });
}

export function sanitizeProfileInput(data: {
  displayName: string;
  preferredLanguage: Language;
  phone: string;
  ministries: string[];
  description: string;
  showInDirectory: boolean;
  taxReceiptLegalName?: string;
  taxReceiptAddress?: Partial<TaxReceiptAddress>;
}) {
  const displayName = data.displayName.trim();
  const phone = data.phone.trim();
  const description = data.description.trim();
  const taxReceiptLegalName = (data.taxReceiptLegalName ?? '').trim();
  const taxReceiptAddress = sanitizeTaxReceiptAddress(data.taxReceiptAddress);
  const ministries = data.ministries
    .map((ministry) => ministry.trim())
    .filter(Boolean)
    .slice(0, MAX_MINISTRIES);

  assertLength(displayName, MAX_DISPLAY_NAME_LENGTH, 'Display name');
  assertLength(phone, MAX_PHONE_LENGTH, 'Phone');
  assertLength(description, MAX_DESCRIPTION_LENGTH, 'Description');
  assertLength(taxReceiptLegalName, MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH, 'Tax receipt legal name');
  assertLength(taxReceiptAddress.line1, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH, 'Tax receipt address line 1');
  assertLength(taxReceiptAddress.line2, MAX_TAX_RECEIPT_ADDRESS_LINE_LENGTH, 'Tax receipt address line 2');
  assertLength(taxReceiptAddress.city, MAX_TAX_RECEIPT_LOCALITY_LENGTH, 'Tax receipt city');
  assertLength(taxReceiptAddress.region, MAX_TAX_RECEIPT_LOCALITY_LENGTH, 'Tax receipt region');
  assertLength(taxReceiptAddress.postalCode, MAX_TAX_RECEIPT_POSTAL_CODE_LENGTH, 'Tax receipt postal code');
  assertLength(taxReceiptAddress.country, MAX_TAX_RECEIPT_COUNTRY_LENGTH, 'Tax receipt country');
  for (const ministry of ministries) {
    assertLength(ministry, MAX_MINISTRY_LENGTH, 'Ministry');
  }

  return {
    ...data,
    displayName,
    phone,
    ministries,
    description,
    taxReceiptLegalName,
    taxReceiptAddress,
  };
}

function directoryProfileFieldsChanged(
  current: Record<string, unknown> | null,
  next: ReturnType<typeof sanitizeProfileInput>
): boolean {
  if (!current) {
    return true;
  }

  const currentMinistries = Array.isArray(current.ministries)
    ? current.ministries.filter((value): value is string => typeof value === 'string')
    : [];
  const currentDisplayName = typeof current.displayName === 'string' ? current.displayName : '';
  const currentPhone = typeof current.phone === 'string' ? current.phone : '';
  const currentDescription = typeof current.description === 'string' ? current.description : '';
  const currentShowInDirectory = typeof current.showInDirectory === 'boolean'
    ? current.showInDirectory
    : true;

  return currentDisplayName !== next.displayName
    || currentPhone !== next.phone
    || !stringArraysEqual(currentMinistries, next.ministries)
    || currentDescription !== next.description
    || currentShowInDirectory !== next.showInDirectory;
}

export function buildUserProfileRepairPatch(
  current: Record<string, unknown>,
  data: { displayName: string; photoURL: string | null }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    displayName: data.displayName,
  };

  if (data.photoURL && isValidOptionalHttpsUrl(data.photoURL)) {
    patch.photoURL = data.photoURL;
  } else if (!isValidOptionalHttpsUrl(current.photoURL)) {
    patch.photoURL = null;
  }

  if (!isStringWithin(current.preferredLanguage, 40)) {
    patch.preferredLanguage = 'English';
  }
  if (!isStringWithin(current.phone, MAX_PHONE_LENGTH)) {
    patch.phone = '';
  }
  if (!isValidMinistries(current.ministries)) {
    patch.ministries = [];
  }
  if (!isStringWithin(current.description, MAX_DESCRIPTION_LENGTH)) {
    patch.description = '';
  }
  if (typeof current.showInDirectory !== 'boolean') {
    patch.showInDirectory = false;
  }
  if (!isStringWithin(current.taxReceiptLegalName, MAX_TAX_RECEIPT_LEGAL_NAME_LENGTH)) {
    patch.taxReceiptLegalName = '';
  }
  if (!isValidTaxReceiptAddress(current.taxReceiptAddress)) {
    patch.taxReceiptAddress = EMPTY_TAX_RECEIPT_ADDRESS;
  }
  if (!isValidFcmTokens(current.fcmTokens)) {
    patch.fcmTokens = [];
  }

  return patch;
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
      taxReceiptLegalName: '',
      taxReceiptAddress: EMPTY_TAX_RECEIPT_ADDRESS,
      fcmTokens: [],
      createdAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, buildUserProfileRepairPatch(existing.data(), data), { merge: true });
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, 'users', uid);
  const snapshot = await getDoc(ref);
  return userProfileFromSnapshot(uid, snapshot);
}

function userProfileFromSnapshot(uid: string, snapshot: DocumentSnapshot): UserProfile | null {
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
    taxReceiptLegalName: typeof data.taxReceiptLegalName === 'string' ? data.taxReceiptLegalName : '',
    taxReceiptAddress: mapTaxReceiptAddress(data.taxReceiptAddress),
    fcmTokens: Array.isArray(data.fcmTokens)
      ? data.fcmTokens.filter((value): value is string => typeof value === 'string')
      : [],
    createdAt: data.createdAt,
  };
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => callback(userProfileFromSnapshot(uid, snapshot)),
    onError
  );
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
    taxReceiptLegalName?: string;
    taxReceiptAddress?: Partial<TaxReceiptAddress>;
  }
): Promise<void> {
  const safeData = sanitizeProfileInput(data);
  const batch = writeBatch(db);
  const userRef = doc(db, 'users', uid);
  const existingProfileSnap = await getDoc(userRef);
  const shouldUpdateDirectoryProfile = directoryProfileFieldsChanged(
    existingProfileSnap.exists() ? existingProfileSnap.data() : null,
    safeData
  );

  batch.update(userRef, {
    displayName: safeData.displayName,
    preferredLanguage: safeData.preferredLanguage,
    phone: safeData.phone,
    ministries: safeData.ministries,
    description: safeData.description,
    showInDirectory: safeData.showInDirectory,
    taxReceiptLegalName: safeData.taxReceiptLegalName,
    taxReceiptAddress: safeData.taxReceiptAddress,
  });

  if (shouldUpdateDirectoryProfile) {
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
  }

  await batch.commit();
}

export async function updateUserTaxReceiptProfile(
  uid: string,
  data: {
    taxReceiptLegalName?: string;
    taxReceiptAddress?: Partial<TaxReceiptAddress> | null;
  }
): Promise<void> {
  const safeData = sanitizeTaxReceiptProfileInput(data);
  await updateDoc(doc(db, 'users', uid), safeData);
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
