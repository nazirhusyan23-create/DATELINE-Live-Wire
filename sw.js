/* =========================================================
   DATELINE — Live Wire — minimal Service Worker
   Purpose: enable registration.showNotification(), which is the ONLY
   way to fire notifications on mobile Chrome/Android (the direct
   `new Notification()` constructor throws there — desktop-only API).
   This worker does no caching/offline work — it exists purely to give
   the page a registration to call showNotification() through.
   ========================================================= */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Clicking a shown notification focuses the app tab (or opens one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
