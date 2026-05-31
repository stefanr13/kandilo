export const FIREBASE_EMULATORS_ENABLED = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

export const FIREBASE_EMULATOR_HOST = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';

export const FIREBASE_EMULATOR_PORTS = {
  auth: Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9098),
  firestore: Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8088),
  functions: Number(import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5008),
  storage: Number(import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9198),
};

const globalFirebaseEmulatorState = globalThis as typeof globalThis & {
  __kandiloFirebaseEmulators?: Set<string>;
};
const connected = globalFirebaseEmulatorState.__kandiloFirebaseEmulators ?? new Set<string>();
globalFirebaseEmulatorState.__kandiloFirebaseEmulators = connected;

export function shouldConnectFirebaseEmulator(service: keyof typeof FIREBASE_EMULATOR_PORTS): boolean {
  if (!FIREBASE_EMULATORS_ENABLED) {
    return false;
  }
  if (connected.has(service)) {
    return false;
  }
  connected.add(service);
  return true;
}
