// CACHE_NAME is updated automatically by build.js (node build.js) on each release.
// Changing this value forces the activate handler to delete the old cache bucket,
// so users always receive fresh HTML/JS after a deployment.
const CACHE_NAME = 'kara-pos-v1.0.92';
const BASE_PATH = '/builder-1/kara2';

// Install event — skip waiting so the new SW activates immediately
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

// Activate event — delete ALL old cache buckets, then claim clients
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Never intercept non-GET requests
    if (event.request.method !== 'GET') return;

    // 2. Never cache API requests — always network
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(`${BASE_PATH}/offline.html`);
            })
        );
        return;
    }

    // 3. HTML files — network first so a new deployment is visible immediately.
    //    Falls back to cache only when offline.
    if (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || !url.pathname.includes('.')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache the fresh HTML for offline fallback
                    if (response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => {
                    // Offline — serve cached HTML or offline page
                    return caches.match(event.request)
                        .then(r => r || caches.match(`${BASE_PATH}/offline.html`));
                })
        );
        return;
    }

    // 4. Versioned assets (URL contains ?v= or hash) — cache first forever.
    //    The version in the URL guarantees a new URL when content changes.
    if (url.search.includes('v=') || url.pathname.match(/\.[0-9a-f]{8,}\./)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // 5. Other static assets (CSS, images, fonts) — cache first, fallback network
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => caches.match(`${BASE_PATH}/offline.html`));
        })
    );
});

// Background sync for offline orders
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-orders') {
        event.waitUntil(syncOrders());
    }
});

// Push notification — nhận message từ server và hiện notification
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Thông báo mới', body: event.data ? event.data.text() : '' };
    }

    const title = data.title || 'Kara POS';
    const options = {
        body: data.body || data.message || '',
        icon: data.icon || `${BASE_PATH}/assets/icons/icon-192.png`,
        badge: `${BASE_PATH}/assets/icons/icon-72.png`,
        data: { url: data.url || BASE_PATH + '/' },
        tag: data.tag || 'kara-notification',
        renotify: !!data.tag,
        vibrate: [200, 100, 200]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — mở/focus tab app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || BASE_PATH + '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes(BASE_PATH) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

async function syncOrders() {
    // Sync pending orders from IndexedDB to server
    console.log('Syncing offline orders...');
}
