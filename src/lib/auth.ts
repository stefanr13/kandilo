import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification as firebaseSendEmailVerification,
  signOut as firebaseSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  signInAnonymously,
  updateProfile,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import type { Language } from '../types';
import { getLocalizedAuthError } from '../localization/extra';
import {
  sendEmailVerificationEmail as sendBrandedEmailVerification,
  sendPasswordResetEmail as sendBrandedPasswordReset,
} from './api/auth';
import { markEmailVerificationEmailSent } from './emailVerificationThrottle';
import { auth } from './firebase/auth';

const googleProvider = new GoogleAuthProvider();
const DEFAULT_APP_URL = 'https://app.kandilo.org';

function authActionUrl(mode: 'verify-email' | 'reset-password'): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : DEFAULT_APP_URL;
  return `${origin}/?authAction=${mode}`;
}

export async function sendAccountEmailVerification(user: FirebaseUser): Promise<{
  success: boolean;
  emailSent: boolean;
  alreadyVerified?: boolean;
}> {
  try {
    await firebaseSendEmailVerification(user, {
      url: authActionUrl('verify-email'),
      handleCodeInApp: false,
    });
    return { success: true, emailSent: true };
  } catch (error) {
    if (firebaseAuthErrorCode(error) === 'auth/too-many-requests') {
      throw error;
    }
    console.warn('Firebase Auth email verification unavailable; falling back to branded email:', error);
  }

  return sendBrandedEmailVerification();
}

export function firebaseAuthErrorCode(error: unknown): string {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

export async function signIn(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName });
  await sendAccountEmailVerification(credential.user);
  markEmailVerificationEmailSent(credential.user.uid);
  const { createOrUpdateUserProfile } = await import('./db/profile');
  await createOrUpdateUserProfile(credential.user.uid, {
    email,
    displayName,
    photoURL: null,
  }).catch((error) => {
    // The backend auth trigger also creates this profile. New email/password
    // users may not be able to client-write until their email is verified.
    console.warn('Deferred profile bootstrap until email verification:', error);
  });
  return credential;
}

export async function signInWithGoogle(): Promise<UserCredential> {
  if (Capacitor.isNativePlatform()) {
    const error = new Error('Google sign-in is not yet available in the native app. Use email and password.');
    (error as Error & { code: string }).code = 'auth/native-google-sign-in-unavailable';
    throw error;
  }

  const credential = await signInWithPopup(auth, googleProvider);
  const { createOrUpdateUserProfile } = await import('./db/profile');
  await createOrUpdateUserProfile(credential.user.uid, {
    email: credential.user.email ?? '',
    displayName: credential.user.displayName ?? 'User',
    photoURL: credential.user.photoURL,
  });
  return credential;
}

export async function signInAsGuest(): Promise<UserCredential> {
  return signInAnonymously(auth);
}

export async function signOut(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (uid) {
    const { unregisterNotifications } = await import('./notifications');
    await unregisterNotifications(uid).catch((error) => console.warn('Notification cleanup could not finish:', error));
  }
  await firebaseSignOut(auth);
  if (typeof window !== 'undefined') {
    window.location.replace('/');
  }
}

export async function deleteAccount(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  if (user.providerData.some((provider) => provider.providerId === 'password')) {
    if (!user.email || !password) throw new Error('Enter your current password.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } else if (user.providerData.some((provider) => provider.providerId === 'google.com')) {
    await reauthenticateWithPopup(user, googleProvider);
  }
  const { unregisterNotifications } = await import('./notifications');
  await unregisterNotifications(user.uid).catch((error) => console.warn('Notification cleanup deferred to account deletion:', error));
  // Firebase enforces recent authentication. The deletion trigger owns cleanup;
  // donation and official receipt records are retained under the privacy policy.
  await deleteUser(user);
  if (typeof window !== 'undefined') window.location.replace('/');
}

export async function resetPassword(email: string): Promise<void> {
  await sendBrandedPasswordReset(email);
}

export function getFirebaseAuthError(code: string, language: Language = 'English'): string {
  return getLocalizedAuthError(code, language);
}
