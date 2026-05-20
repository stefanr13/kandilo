import { getFunctions } from 'firebase/functions';
import { ensureAppCheckInitialized } from './app-check';
import app from './app';

ensureAppCheckInitialized();

export const functions = getFunctions(app);
