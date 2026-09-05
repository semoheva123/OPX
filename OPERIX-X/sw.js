const CACHE_NAME = 'operix-shell-v4';
const APP_SHELL = ['/', '/index.html', '/app.js?v=20260905-1', '/dist/tailwind.css', '/operix-icon.svg', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const isAppAsset = request.mode === 'navigate' || /\.html(?:\?|$)|\.js(?:\?|$)|\.css(?:\?|$)/i.test(new URL(request.url).pathname);
  if (!isAppAsset) return;
  event.respondWith(fetch(request, { cache: 'no-store' }).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then(response => response || caches.match('/index.html'))));
});

self.addEventListener('push', event => {
  let payload = { title: 'OPERIX', body: 'لديك تحديث جديد' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch (error) { }
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title, { body: payload.body, icon: '/operix-icon.svg', badge: '/operix-icon.svg', tag: 'operix-notification', renotify: true, data: { url: '/' } }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => clients.forEach(client => client.postMessage({ type: 'OPERIX_NOTIFICATION' })))
  ]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const client = clients.find(item => 'focus' in item);
    return client ? client.focus() : self.clients.openWindow(event.notification.data?.url || '/');
  }));
});
