import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import * as functionsV1 from 'firebase-functions/v1';
import { FIRESTORE_REGION } from './shared/regions';

const db = getFirestore();

/**
 * Automatically create a Firestore user profile document whenever a new user
 * registers via Firebase Auth. Uses the v1 auth trigger which works on the
 * standard Firebase Auth free tier (no Identity Platform required).
 */
export const bootstrapUserProfileOnCreate = functionsV1.region(FIRESTORE_REGION).auth.user().onCreate(async (user) => {
  if (!user.email) {
    logger.info(`Skipped Firestore profile bootstrap for user without email ${user.uid}`);
    return;
  }

  const userRef = db.collection('users').doc(user.uid);
  const existing = await userRef.get();
  if (!existing.exists) {
    await userRef.set({
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? null,
      preferredLanguage: 'English',
      phone: '',
      ministries: [],
      description: '',
      showInDirectory: false,
      fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.info(`Created Firestore profile for user ${user.uid}`);
  }
});
