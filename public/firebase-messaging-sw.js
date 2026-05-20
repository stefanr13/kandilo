// Firebase Cloud Messaging Service Worker
// ─────────────────────────────────────────────────────────────────────────────
// Firebase web app identifiers are generated at dev/build time from env vars.
// Do not hardcode the config here; GitHub secret scanning flags Google API keys.
// ─────────────────────────────────────────────────────────────────────────────

importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');
importScripts('/firebase-messaging-sw-config.js');

const firebaseConfig = self.KANDILO_FIREBASE_MESSAGING_CONFIG;

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  // Handle background push notifications (app not in focus)
  messaging.onBackgroundMessage((payload) => {
    const { title, body, icon } = payload.notification ?? {};

    self.registration.showNotification(title ?? 'Kandilo', {
      body: body ?? '',
      icon: icon ?? '/kandilo-icon.svg',
      badge: '/kandilo-badge.svg',
      data: payload.data,
    });
  });
} else {
  console.warn('Firebase Messaging service worker config is not generated. Background web push is disabled.');
}

// Handle notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
