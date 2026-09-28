import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { auth } from './firebase/auth';
import { getMessagingInstance } from './firebase/messaging';
import { addFcmToken } from './db/profile';
import { callFunction } from './api/client';

const TOKEN_STORAGE_KEY = 'kandilo.pushDevice';
let activeNativePushUid: string | null = null;
let binding: Promise<void> | null = null;
let registrationWork: Promise<unknown> = Promise.resolve();
let nativeResult: { resolve: (value: boolean) => void; reject: (error: Error) => void } | null = null;
let nativeRegistration: Promise<boolean> | null = null;
let foregroundUnsubscribe: (() => void) | undefined;
let device: { uid: string; token: string } | null = null;

function notificationPath(data: Record<string, unknown> | undefined): string {
  const slug = data?.eventSlug;
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug) ? `/e/${slug}` : '/';
}

function saveToken(uid: string, token: string): Promise<boolean> {
  const work = registrationWork.catch(() => undefined).then(async () => {
    if (auth.currentUser?.uid !== uid) return false;
    await addFcmToken(uid, token);
    device = { uid, token };
    try { localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(device)); } catch { /* Memory remains available. */ }
    return true;
  });
  registrationWork = work;
  return work;
}

async function bindNativeListeners(): Promise<void> {
  if (!binding) binding = (async () => {
    await PushNotifications.addListener('registration', ({ value }) => {
      const uid = activeNativePushUid;
      if (!uid) return;
      void saveToken(uid, value).then((saved) => nativeResult?.resolve(saved))
        .catch((error) => nativeResult?.reject(error));
    });
    await PushNotifications.addListener('registrationError', ({ error }) => nativeResult?.reject(new Error(error)));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      window.location.assign(notificationPath(notification.data));
    });
  })().catch((error) => { binding = null; throw error; });
  return binding;
}

export async function requestNotificationPermission(uid: string, prompt = true): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const permissions = await PushNotifications.checkPermissions();
    const result = permissions.receive === 'prompt' && prompt
      ? await PushNotifications.requestPermissions() : permissions;
    if (result.receive !== 'granted') return false;
    activeNativePushUid = uid;
    await bindNativeListeners();
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({ id: 'general', name: 'Parish notifications', importance: 5, visibility: 1, sound: 'default' });
    }
    if (nativeRegistration) return nativeRegistration;
    nativeRegistration = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => { nativeResult = null; reject(new Error('Notification registration timed out. Please retry.')); }, 20_000);
      nativeResult = {
        resolve: (value) => { clearTimeout(timer); nativeResult = null; resolve(value); },
        reject: (error) => { clearTimeout(timer); nativeResult = null; reject(error); },
      };
      void PushNotifications.register().catch((error) => nativeResult?.reject(error));
    }).finally(() => { nativeRegistration = null; });
    return nativeRegistration;
  }
  if (!('Notification' in window)) return false;
  const permission = Notification.permission === 'default' && prompt
    ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return false;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  const messaging = await getMessagingInstance();
  if (!vapidKey || !messaging) throw new Error('Notifications are not configured for this browser.');
  const { getToken, onMessage } = await import('firebase/messaging');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) return false;
  const saved = await saveToken(uid, token);
  foregroundUnsubscribe?.();
  foregroundUnsubscribe = onMessage(messaging, (payload) => {
    if (auth.currentUser?.uid !== uid || Notification.permission !== 'granted') return;
    void registration.showNotification(payload.notification?.title ?? 'Kandilo', {
      body: payload.notification?.body ?? '', data: payload.data,
      icon: '/kandilo-icon.svg',
    });
  });
  return saved;
}

export async function unregisterNotifications(uid: string): Promise<void> {
  activeNativePushUid = null;
  nativeResult?.resolve(false);
  foregroundUnsubscribe?.();
  foregroundUnsubscribe = undefined;
  await registrationWork.catch(() => undefined);
  if (!device) {
    try { device = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) ?? 'null'); } catch { /* No saved device. */ }
  }
  try {
    if (device?.uid === uid) await callFunction('unregisterPushToken', { token: device.token });
  } finally {
    device = null;
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* Storage is optional. */ }
    if (Capacitor.isNativePlatform()) {
      try {
        await PushNotifications.removeAllDeliveredNotifications();
      } finally {
        await PushNotifications.unregister();
      }
    } else {
      const messaging = await getMessagingInstance();
      if (messaging) {
        const { deleteToken } = await import('firebase/messaging');
        await deleteToken(messaging);
      }
    }
  }
}
