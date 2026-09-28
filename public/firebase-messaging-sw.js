// Firebase Cloud Messaging Service Worker
// ─────────────────────────────────────────────────────────────────────────────
// Firebase web app identifiers are generated at dev/build time from env vars.
// Do not hardcode the config here; GitHub secret scanning flags Google API keys.
// ─────────────────────────────────────────────────────────────────────────────

// Only route to a validated local public-event path.
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const data = event.notification.data?.FCM_MSG?.data ?? event.notification.data;
  const slug = data?.eventSlug;
  const path = typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug) ? `/e/${slug}` : '/';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return clients.openWindow(url);
  }));
});

importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js');
importScripts('/firebase-messaging-sw-config.js');

const firebaseConfig = self.KANDILO_FIREBASE_MESSAGING_CONFIG;

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  // Handle background push notifications (app not in focus)
  messaging.onBackgroundMessage((payload) => {
    // Firebase already displays notification payloads in the background.
    if (payload.notification) return;
    const { title, body, icon } = payload.data ?? {};

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
