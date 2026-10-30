// OPERIX service worker: offline shell + runtime caching.
//
// Rules:
//   * Never cache /api/* — balances, tickets and deposits must always come from the network.
//   * Navigations are network-first, so a deploy is visible immediately; the cached offline page is
//     only used when the network is unreachable.
//   * Static assets use stale-while-revalidate: an instant cached response plus a background update.
const CACHE_VERSION = 'operix-v20261031-1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/operix-icon.svg', '/dist/tailwind.css', '/styles/operix-premium.css'];
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'font', 'image']);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(CACHE_VERSION);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('لا يوجد اتصال بالإنترنت.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (CACHEABLE_DESTINATIONS.has(request.destination) || /\.(css|js|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
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
