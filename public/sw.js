'use strict';

const VERSION = 'v4';
const STATIC_CACHE = `einkauf-static-${VERSION}`;
const RUNTIME_CACHE = `einkauf-runtime-${VERSION}`;
const APP_SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_PAGE_URL = new URL('offline.html', APP_SCOPE_URL);
const API_URL = new URL('api.php', APP_SCOPE_URL);

const APP_SHELL_ASSET_URLS = [
    'offline.html',
    'style.css',
    'app.js',
    'manifest.php',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
].map(path => new URL(path, APP_SCOPE_URL).toString());

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(APP_SHELL_ASSET_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
                .map(key => caches.delete(key))
        );

        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(request));
        return;
    }

    if (request.method !== 'GET') {
        return;
    }

    if (APP_SHELL_ASSET_URLS.includes(request.url)) {
        event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
        return;
    }

    if (url.pathname === API_URL.pathname) {
        event.respondWith(apiGetStrategy(request));
    }
});

async function handleNavigationRequest(request) {
    try {
        const response = await fetch(request);

        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response.clone());
        }

        return response;
    } catch {
        const cachedPage = await caches.match(request);
        if (cachedPage) return cachedPage;

        const offlinePage = await caches.match(OFFLINE_PAGE_URL.toString());
        if (offlinePage) return offlinePage;

        return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
        });
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then(response => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    if (cached) {
        return cached;
    }

    const networkResponse = await networkPromise;
    if (networkResponse) {
        return networkResponse;
    }

    return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
    });
}

async function apiGetStrategy(request) {
    try {
        const response = await fetch(request);

        if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, response.clone());
        }

        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;

        return new Response(JSON.stringify({
            error: 'Offline: Die Liste konnte nicht geladen werden.',
            offline: true,
        }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        });
    }
}
