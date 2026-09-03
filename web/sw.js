// Stamped at boot from the contents of web/, by server/serve-sw.js. A
// version nobody has to remember to bump cannot be forgotten.
const CACHE_NAME = 'pocket-omaha-__BUILD_VERSION__';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.css',
  // The palette, generated from design/tokens.json. app.css consumes these
  // custom properties, so without it every themed colour resolves to nothing.
  '/tokens.css',
  '/app.js',
  // app.js imports this as an ES module. A module whose import fails does not
  // run at all, so leaving it out of the precache would not degrade the app
  // offline — it would stop it starting.
  '/dcf.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Precached: a push can arrive while offline, and a badge that 404s leaves
  // Android drawing the Chrome logo instead.
  '/icons/badge-96.png'
];

importScripts('/sw-update.js');

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Announce rather than navigate: forcing a reload discards whatever the
    // person had on screen and not yet saved.
    await announceUpdate();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API Requests: Network ONLY (no caching auth/financial APIs in SW)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML, JS, CSS: ALWAYS Network-First so code updates apply immediately
  if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static Assets (Icons/Images): Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
        }
        return networkResponse;
      }).catch(() => {});

      return cachedResponse || fetchPromise;
    })
  );
});

// Push notification listener
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Pocket Omaha 🎩', body: event.data ? event.data.text() : 'Stock health update' };
  }

  const title = data.title || 'Pocket Omaha 🎩';
  const d = data.data || {};
  const options = {
    body: data.body || 'Financial statement analysis ready.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // Tagged per ticker and alert type so a repeat replaces the previous
    // bubble instead of stacking another one on the lock screen. renotify
    // keeps it alerting, so a genuine second event is not delivered silently.
    tag: data.tag || (d.type ? `${d.type}:${d.ticker || ''}` : 'omaha'),
    renotify: true,
    vibrate: d.severity === 'critical' ? [140, 70, 140] : [100, 50, 100],
    data: d.url ? d : { url: '/' },
    actions: [
      { action: 'open', title: 'View Scorecard' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
