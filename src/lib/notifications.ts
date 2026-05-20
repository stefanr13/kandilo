import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { getMessagingInstance } from './firebase/messaging';
import { addFcmToken } from './db/profile';

const DEFAULT_NATIVE_CHANNEL_ID = 'general';
let nativePushListenersBound = false;
let activeNativePushUid: string | null = null;

export async function requestNotificationPermission(uid: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await registerNativePush(uid);
  } else {
    await registerWebPush(uid);
  }
}

async function registerNativePush(uid: string): Promise<void> {
  try {
    activeNativePushUid = uid;

    if (!nativePushListenersBound) {
      nativePushListenersBound = true;

      await PushNotifications.addListener('registration', async ({ value: token }) => {
        if (!activeNativePushUid) {
          return;
        }

        try {
          await addFcmToken(activeNativePushUid, token);
        } catch (err) {
          console.warn('Failed to save native FCM token:', err);
        }
      });

      await PushNotifications.addListener('registrationError', (err) => {
        console.warn('Native push registration error:', err);
      });
    }

    const currentPermissions = await PushNotifications.checkPermissions();
    const result =
      currentPermissions.receive === 'prompt'
        ? await PushNotifications.requestPermissions()
        : currentPermissions;
    if (result.receive !== 'granted') return;

    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: DEFAULT_NATIVE_CHANNEL_ID,
        name: 'General',
        description: 'General parish notifications, reminders, and announcements.',
        importance: 5,
        visibility: 1,
        sound: 'default',
      });
    }

    await PushNotifications.register();
  } catch (err) {
    console.warn('Native push setup failed:', err);
  }
}

async function registerWebPush(uid: string): Promise<void> {
  if (!('Notification' in window)) return;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('Firebase web push VAPID key is not configured. Web push registration is disabled.');
    return;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  try {
    const { getToken } = await import('firebase/messaging');
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (token) {
      await addFcmToken(uid, token);
    }
  } catch (err) {
    console.warn('FCM web token registration failed:', err);
  }
}
