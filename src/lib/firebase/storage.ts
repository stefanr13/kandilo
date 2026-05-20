import { getStorage } from 'firebase/storage';
import { ensureAppCheckInitialized } from './app-check';
import app from './app';

ensureAppCheckInitialized();

export const storage = getStorage(app);
