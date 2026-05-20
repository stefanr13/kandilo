import app from './app';

let messagingPromise: Promise<Awaited<ReturnType<typeof loadMessagingInstance>>> | null = null;

async function loadMessagingInstance() {
  if (typeof window === 'undefined') {
    return null;
  }

  const [{ getMessaging, isSupported }, { ensureAppCheckInitialized }] = await Promise.all([
    import('firebase/messaging'),
    import('./app-check'),
  ]);

  const supported = await isSupported();
  if (!supported) {
    return null;
  }

  ensureAppCheckInitialized();
  return getMessaging(app);
}

export async function getMessagingInstance() {
  if (!messagingPromise) {
    messagingPromise = loadMessagingInstance();
  }

  return messagingPromise;
}
