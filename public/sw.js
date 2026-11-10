// Minimal service worker: makes the app installable and opens the app from a
// notification. It deliberately caches nothing, so balances, quotes and receipts
// are always read live from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/#payments';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const open = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (open) { open.focus(); return open.navigate(target).catch(() => {}); }
    return self.clients.openWindow(target);
  }));
});
