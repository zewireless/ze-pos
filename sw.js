/**
 * Service Worker for ZE-POS
 *
 * Strategy summary:
 *   - HTML pages ............ network-first (updates ship immediately; cache = offline fallback)
 *   - Same-origin JS/CSS/img  cache-first (versioned by CACHE_NAME, bumped every deploy)
 *   - CDN (Chart.js, fonts) .. stale-while-revalidate (big, rarely change, want freshness w/o blocking)
 *   - Supabase API (auth/data) network-only — NEVER cached (POS freshness + no cross-user data leakage)
 *
 * BUMP CACHE_NAME on every deploy. Static assets are served cache-first, so without a
 * bump clients keep running the previous release.
 */
const CACHE_NAME = 'ze-pos-v13';
const STATIC_ASSETS = [
    './',
    './index.html',
    './register.html',
    './join.html',
    './admin.html',
    './app.html',
    './reset-password.html',
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

// Install — cache static assets, then activate immediately.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Take control of open pages without waiting for a reload.
    self.skipWaiting();
});

// Activate — clean up old caches, then claim all clients.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    // Start controlling already-open pages right away so updates apply instantly.
    self.clients.claim();
});

// ── Strategy helpers ─────────────────────────────────────────────

// Network-first: try the network, fall back to cache. Best for HTML — we want
// the newest page, but still work offline.
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.status === 200 && request.url.startsWith(self.location.origin)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        // Last resort: the app shell so a deep link still opens something.
        return cached || (await caches.match('./app.html'));
    }
}

// Cache-first: serve from cache, never hit network if present. For versioned
// same-origin static files.
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.status === 200 && request.url.startsWith(self.location.origin)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
    }
    return response;
}

// Stale-while-revalidate: return cached immediately (if any) and refresh it in
// the background. Good for large, rarely-changing cross-origin resources.
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    const fetchPromise = fetch(request)
        .then((response) => {
            if (response && response.status === 200) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => cachedResponse);
    // Serve cached now; if nothing cached, wait for the network.
    return cachedResponse || fetchPromise;
}

// Network-only: do not cache. Used for authenticated API traffic.
function networkOnly(request) {
    return fetch(request);
}

// ── Request classification ───────────────────────────────────────

const HTML_RE = /\/(index|register|join|app|admin|reset-password)\.html$/;

function isHtmlRequest(url, mode) {
    if (mode === 'navigate') return true;
    // Also catch direct fetches of a known page (e.g. loaded as a subresource).
    try {
        return HTML_RE.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

function isSupabaseApi(url) {
    return url.includes('supabase.co');
}

function isCdn(url) {
    return (
        url.includes('cdn.jsdelivr.net') ||
        url.includes('fonts.googleapis.com') ||
        url.includes('fonts.gstatic.com')
    );
}

// ── Fetch ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only GETs are cacheable/safe to replay. POST/PUT/PATCH/DELETE pass through.
    if (request.method !== 'GET') return;

    const url = request.url;

    // 1. Authenticated Supabase API (auth, profiles, orders, prices).
    //    Network-only on purpose: caching by URL would key responses without their
    //    auth headers, risking stale or cross-user data — unacceptable for a POS.
    if (isSupabaseApi(url)) {
        event.respondWith(networkOnly(request));
        return;
    }

    // 2. HTML pages — network-first so deploys show up without a manual refresh.
    if (isHtmlRequest(url, request.mode)) {
        event.respondWith(networkFirst(request));
        return;
    }

    // 3. CDN libraries/fonts — stale-while-revalidate.
    if (isCdn(url)) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // 4. Same-origin static assets — cache-first.
    if (url.startsWith(self.location.origin)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // 5. Anything else (other cross-origin GETs) — best-effort SWR.
    event.respondWith(staleWhileRevalidate(request));
});
