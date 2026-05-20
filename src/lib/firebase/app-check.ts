import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import app from './app';

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN;

let appCheckInitialized = false;

export function ensureAppCheckInitialized(): void {
  if (appCheckInitialized || typeof window === 'undefined') {
    return;
  }

  if (!appCheckSiteKey) {
    if (import.meta.env.PROD) {
      throw new Error('VITE_FIREBASE_APP_CHECK_SITE_KEY is required for production builds.');
    }
    console.warn('Firebase App Check is not configured. Callable functions will reject requests when enforcement is enabled.');
    return;
  }

  if (import.meta.env.DEV) {
    (
      self as typeof self & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken || true;
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });

  appCheckInitialized = true;
}
