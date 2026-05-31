import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { ensureAppCheckInitialized } from './app-check';
import app from './app';
import {
  FIREBASE_EMULATOR_HOST,
  FIREBASE_EMULATOR_PORTS,
  shouldConnectFirebaseEmulator,
} from './emulators';

ensureAppCheckInitialized();

export const functions = getFunctions(app);

if (shouldConnectFirebaseEmulator('functions')) {
  connectFunctionsEmulator(functions, FIREBASE_EMULATOR_HOST, FIREBASE_EMULATOR_PORTS.functions);
}
