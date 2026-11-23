self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (typeof data?.title !== 'string' || typeof data.body !== 'string') return;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: new URL('app-icon-192.png', self.registration.scope).href,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('?courses=1', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const active = windows.find(client => client.url === url);
    if (active) await active.focus();
    else await self.clients.openWindow(url);
  })());
});
