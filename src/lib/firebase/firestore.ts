import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
} from 'firebase/firestore';
import { ensureAppCheckInitialized } from './app-check';
import app from './app';
import {
  FIREBASE_EMULATOR_HOST,
  FIREBASE_EMULATOR_PORTS,
  shouldConnectFirebaseEmulator,
} from './emulators';

ensureAppCheckInitialized();

// Keep parishioner data out of durable IndexedDB storage. Static public data
// can be re-fetched; membership, giving, and directory data should clear with
// the browser session and sign-out flow.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});

if (shouldConnectFirebaseEmulator('firestore')) {
  connectFirestoreEmulator(db, FIREBASE_EMULATOR_HOST, FIREBASE_EMULATOR_PORTS.firestore);
}
