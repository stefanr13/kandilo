import { browserLocalPersistence, connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import app from './app';
import {
  FIREBASE_EMULATOR_HOST,
  FIREBASE_EMULATOR_PORTS,
  shouldConnectFirebaseEmulator,
} from './emulators';

// Capacitor WebViews on iOS can deadlock waiting for IndexedDB (the default
// persistence layer). Use localStorage-backed persistence when running natively
// so onAuthStateChanged fires immediately from cache.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app);

if (shouldConnectFirebaseEmulator('auth')) {
  connectAuthEmulator(
    auth,
    `http://${FIREBASE_EMULATOR_HOST}:${FIREBASE_EMULATOR_PORTS.auth}`,
    { disableWarnings: true }
  );
}
