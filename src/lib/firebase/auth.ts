import { getAuth, initializeAuth, browserLocalPersistence } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import app from './app';

// Capacitor WebViews on iOS can deadlock waiting for IndexedDB (the default
// persistence layer). Use localStorage-backed persistence when running natively
// so onAuthStateChanged fires immediately from cache.
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(app, { persistence: browserLocalPersistence })
  : getAuth(app);
