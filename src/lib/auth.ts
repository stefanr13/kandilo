import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
  signInAnonymously,
  updateProfile,
  type UserCredential,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import type { Language } from '../types';
import { getLocalizedAuthError } from '../localization/extra';
import { auth } from './firebase/auth';

const googleProvider = new GoogleAuthProvider();

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
  await sendEmailVerification(credential.user);
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
  await firebaseSignOut(auth);
  if (typeof window !== 'undefined') {
    window.location.replace('/');
  }
}

export async function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email);
}

export function getFirebaseAuthError(code: string, language: Language = 'English'): string {
  return getLocalizedAuthError(code, language);
}
