// Cudic service worker: renders Web Push notifications and routes clicks.
// Deliberately has no fetch handler — nothing is cached, so a deploy can never
// serve a stale page from here.
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* plain-text payload */ }
  var title = d.title || 'Cudic';
  var body = d.body || (e.data ? e.data.text() : '');
  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    tag: d.tag || 'cudic',
    data: { url: d.url || '/notifications' },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/notifications';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(url) !== -1) return list[i].focus();
    }
    return clients.openWindow(url);
  }));
});
