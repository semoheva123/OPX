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
