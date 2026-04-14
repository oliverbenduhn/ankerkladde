'use strict';

const VERSION = 'v2.0.48';
const STATIC_CACHE = `ankerkladde-static-${VERSION}`;
const RUNTIME_CACHE = `ankerkladde-runtime-${VERSION}`;
const SHARE_CACHE = 'ankerkladde-share-target';
const APP_SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_PAGE_URL = new URL('offline.html', APP_SCOPE_URL);
const API_URL = new URL('api.php', APP_SCOPE_URL);

const APP_SHELL_ASSET_URLS = [
    'offline.html',
    'style.css?v=2.0.48',
    'js/main.js?v=2.0.48',
    'js/api.js?v=2.0.48',
    'js/state.js?v=2.0.48',
    'js/ui.js?v=2.0.48',
    'js/utils.js?v=2.0.48',
    'js/shared.js?v=2.0.48',
    'js/theme.js?v=2.0.48',
    'js/navigation.js?v=2.0.48',
    'js/router.js?v=2.0.48',
    'js/items.js?v=2.0.48',
    'js/scanner.js?v=2.0.48',
    'js/editor.js?v=2.0.48',
    'js/swipe.js?v=2.0.48',
    'js/reorder.js?v=2.0.48',
    'js/app-ui.js?v=2.0.48',
    'js/app-events.js?v=2.0.48',
    'js/app-init.js?v=2.0.48',
    'js/app-runtime.js?v=2.0.48',
    'js/app-entry.js?v=2.0.48',
    'js/items-view.js?v=2.0.48',
    'js/items-actions.js?v=2.0.48',
    'js/tabs-view.js?v=2.0.48',
    'js/helpers.js?v=2.0.48',
    'manifest.php?v=2.0.48',
    'icon.php?size=192&theme=hafenblau&v=2.0.48',
    'icon.php?size=512&theme=hafenblau&v=2.0.48',
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
                .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE && key !== SHARE_CACHE)
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

    if (request.method === 'POST' && url.pathname === APP_SCOPE_URL.pathname) {
        event.respondWith(handleShareTargetPost(request));
        return;
    }

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

async function handleShareTargetPost(request) {
    const formData   = await request.formData();
    const file       = formData.get('file');
    const title      = formData.get('title') || '';
    const text       = formData.get('text')  || '';
    const sharedUrl  = formData.get('url')   || '';

    const redirectUrl = new URL(APP_SCOPE_URL);

    if (file instanceof File && file.size > 0) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('pending-file', new Response(file, {
            headers: {
                'Content-Type':     file.type || 'application/octet-stream',
                'X-Share-Filename': encodeURIComponent(file.name || 'shared'),
            },
        }));
        redirectUrl.searchParams.set('share', 'file');
    } else {
        if (title)     redirectUrl.searchParams.set('title', title);
        if (text)      redirectUrl.searchParams.set('text', text);
        if (sharedUrl) redirectUrl.searchParams.set('url', sharedUrl);
    }

    return Response.redirect(redirectUrl.toString(), 303);
}

async function handleNavigationRequest(request) {
    try {
        const response = await fetch(request);

        if (response.ok && request.method === 'GET') {
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
