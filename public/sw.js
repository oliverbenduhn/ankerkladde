'use strict';

const VERSION = 'v4.2.76';
const ASSET_VERSION = '4.2.76';
const STATIC_CACHE = `ankerkladde-static-${VERSION}`;
const RUNTIME_CACHE = `ankerkladde-runtime-${VERSION}`;
const SHARE_CACHE = 'ankerkladde-share-target';
const APP_SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_PAGE_URL = new URL('offline.html', APP_SCOPE_URL);
const API_URL = new URL('api.php', APP_SCOPE_URL);

const APP_SHELL_ASSET_URLS = [
    'offline.html',
    'theme-css.php',
    `style.css?v=${ASSET_VERSION}`,
    `js/main.js?v=${ASSET_VERSION}`,
    `js/api.js?v=${ASSET_VERSION}`,
    `js/state.js?v=${ASSET_VERSION}`,
    `js/ui.js?v=${ASSET_VERSION}`,
    `js/utils.js?v=${ASSET_VERSION}`,
    `js/theme.js?v=${ASSET_VERSION}`,
    `js/navigation.js?v=${ASSET_VERSION}`,
    `js/router.js?v=${ASSET_VERSION}`,
    `js/items.js?v=${ASSET_VERSION}`,
    `js/scanner.js?v=${ASSET_VERSION}`,
    `js/editor.js?v=${ASSET_VERSION}`,
    `js/swipe.js?v=${ASSET_VERSION}`,
    `js/reorder.js?v=${ASSET_VERSION}`,
    `js/app-ui.js?v=${ASSET_VERSION}`,
    `js/app-events.js?v=${ASSET_VERSION}`,
    `js/app-init.js?v=${ASSET_VERSION}`,
    `js/app-runtime.js?v=${ASSET_VERSION}`,
    `js/app-entry.js?v=${ASSET_VERSION}`,
    `js/items-view.js?v=${ASSET_VERSION}`,
    `js/items-actions.js?v=${ASSET_VERSION}`,
    `js/item-menu.js?v=${ASSET_VERSION}`,
    `js/tabs-view.js?v=${ASSET_VERSION}`,
    `js/helpers.js?v=${ASSET_VERSION}`,
    `js/lightbox.js?v=${ASSET_VERSION}`,
    `js/magic.js?v=${ASSET_VERSION}`,
    `js/offline-queue.js?v=${ASSET_VERSION}`,
    `js/todo-editor.js?v=${ASSET_VERSION}`,
    `vendor/zxing/browser-0.1.5.js?v=${ASSET_VERSION}`,
    `manifest.php?v=${ASSET_VERSION}`,
    `icon.php?size=72&v=${ASSET_VERSION}`,
    `icon.php?size=96&v=${ASSET_VERSION}`,
    `icon.php?size=128&v=${ASSET_VERSION}`,
    `icon.php?size=144&v=${ASSET_VERSION}`,
    `icon.php?size=152&v=${ASSET_VERSION}`,
    `icon.php?size=180&v=${ASSET_VERSION}`,
    `icon.php?size=192&v=${ASSET_VERSION}`,
    `icon.php?size=384&v=${ASSET_VERSION}`,
    `icon.php?size=512&v=${ASSET_VERSION}`,
].map(path => new URL(path, APP_SCOPE_URL).toString());

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                // Try to cache all assets, but don't fail if some are unreachable
                return Promise.allSettled(
                    APP_SHELL_ASSET_URLS.map(url => cache.add(url))
                ).then(() => {
                    console.log('[SW] Precache complete (some assets may have failed)');
                });
            })
            .then(() => self.skipWaiting())
            .catch(err => {
                console.warn('[SW] Install failed:', err);
                // Still skip waiting even if precache failed - offline page is cached
                return self.skipWaiting();
            })
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
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('pending-share', new Response(JSON.stringify({
            title: String(title),
            text: String(text),
            url: String(sharedUrl),
        }), {
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
            },
        }));
        redirectUrl.searchParams.set('share', 'data');
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
