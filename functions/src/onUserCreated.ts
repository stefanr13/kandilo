import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import * as functionsV1 from 'firebase-functions/v1';
import { db } from './shared/firebase';
import { AUTH_TRIGGER_REGION } from './shared/regions';

export type BootstrapUserProfileInput = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
};

export type BootstrapUserProfileResult =
  | 'created'
  | 'skipped_existing'
  | 'skipped_no_email';

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

export async function bootstrapUserProfileDocument(
  user: BootstrapUserProfileInput
): Promise<BootstrapUserProfileResult> {
  if (!user.email) {
    logger.info(`Skipped Firestore profile bootstrap for user without email ${user.uid}`);
    return 'skipped_no_email';
  }

  const userRef = db.collection('users').doc(user.uid);
  try {
    await userRef.create({
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? null,
      preferredLanguage: 'English',
      phone: '',
      ministries: [],
      description: '',
      showInDirectory: false,
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
      fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.info(`Created Firestore profile for user ${user.uid}`);
    return 'created';
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      logger.info(`Skipped Firestore profile bootstrap for existing user profile ${user.uid}`);
      return 'skipped_existing';
    }
    throw error;
  }
}

/**
 * Automatically create a Firestore user profile document whenever a new user
 * registers via Firebase Auth. Uses the v1 auth trigger which works on the
 * standard Firebase Auth free tier (no Identity Platform required).
 */
export const bootstrapUserProfileOnCreate = functionsV1.region(AUTH_TRIGGER_REGION).auth.user().onCreate(async (user) => {
  await bootstrapUserProfileDocument(user);
});
