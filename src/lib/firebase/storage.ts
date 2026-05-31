import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { ensureAppCheckInitialized } from './app-check';
import app from './app';
import {
  FIREBASE_EMULATOR_HOST,
  FIREBASE_EMULATOR_PORTS,
  shouldConnectFirebaseEmulator,
} from './emulators';

ensureAppCheckInitialized();

export const storage = getStorage(app);

if (shouldConnectFirebaseEmulator('storage')) {
  connectStorageEmulator(storage, FIREBASE_EMULATOR_HOST, FIREBASE_EMULATOR_PORTS.storage);
}
