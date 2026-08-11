/**
 * Service Worker for FoodZone POS
 * Cache-first for static assets, network-first for navigation
 */
const CACHE_NAME = 'foodzone-pos-v10';
const STATIC_ASSETS = [
    './',
    './index.html',
    './register.html',
    './join.html',
    './admin.html',
    './app.html',
    './config.js',
    './css/style.css',
    './js/db.js',
    './js/auth.js',
    './js/supabase-client.js',
    './js/app.js',
    './js/dashboard.js',
    './js/staff.js',
    './js/categories.js',
    './js/menu.js',
    './js/condiments.js',
    './js/tax.js',
    './js/shifts.js',
    './js/schedules.js',
    './js/pos.js',
    './js/orders.js',
    './js/reports.js',
    './js/payroll.js',
    './js/billing.js',
    './js/receipt.js',
    './js/admin.js',
    './manifest.json',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
];

// Install — cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — cache-first for static, network-first for navigation
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Navigation requests: network-first with cache fallback
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => {
                    return caches.match(request).then((cached) => {
                        return cached || caches.match('./app.html');
                    });
                })
        );
        return;
    }

    // CDN resources (fonts, Chart.js): cache-first
    if (request.url.includes('cdn.jsdelivr.net') || request.url.includes('fonts.googleapis.com') || request.url.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;
                return fetch(request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // Static assets: cache-first with network fallback
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                // Only cache successful responses from same origin
                if (response.ok && request.url.startsWith(self.location.origin)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});
