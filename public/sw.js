'use strict';

const CACHE_NAME = 'einkauf-v1';

const STATIC_ASSETS = [
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// INSTALL: pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ACTIVATE: delete stale caches, claim clients immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys =>
                Promise.all(
                    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

// FETCH: per-resource strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    // Static assets: cache-first
    if (STATIC_ASSETS.some(asset => url.pathname === asset)) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // index.php: network-first (CSRF token must always be fresh from session)
    if (url.pathname === '/' || url.pathname === '/index.php') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // api.php GET (action=list): network-first, fallback to cached list
    if (url.pathname === '/api.php' && event.request.method === 'GET') {
        event.respondWith(apiGetStrategy(event.request));
        return;
    }

    // api.php POST (toggle, add, delete, clear):
    // Pass through unmodified. Fetch failures propagate to app.js,
    // which reverts the optimistic UI update and shows the offline message.
    // Never cache POST requests.
});

// STRATEGY HELPERS

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            (await caches.open(CACHE_NAME)).put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            (await caches.open(CACHE_NAME)).put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Offline</title></head><body>Offline</body></html>', {
            headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        });
    }
}

// api.php GET: network-first with JSON fallback for offline.
// (api.php sets Cache-Control: no-store — we clone before caching
//  so the original response body stream is not consumed by the put() call.)
async function apiGetStrategy(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            (await caches.open(CACHE_NAME)).put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Offline with no cache: return empty list so app renders gracefully
        return new Response(JSON.stringify({ items: [] }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
