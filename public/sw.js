'use strict';

const VERSION = 'v4.3.0';
const ASSET_VERSION = '4.3.0';
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

// Windows-1252 codepoints that differ from Latin-1 (0x80-0x9F range)
const W1252_TO_BYTE = new Map([
    [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
    [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
    [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
    [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

/**
 * Fix text that was mojibake'd by formData() interpreting UTF-8 bytes
 * as Latin-1/Windows-1252. Maps each char back to its byte value, then
 * decodes the byte sequence as UTF-8. If the roundtrip fails (not mojibake),
 * the original string is returned unchanged.
 */
function fixFormDataEncoding(value) {
    if (typeof value !== 'string' || value === '') return value;

    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
        const cp = value.charCodeAt(i);
        if (cp <= 0xFF) {
            bytes[i] = cp;
        } else {
            const mapped = W1252_TO_BYTE.get(cp);
            if (mapped !== undefined) {
                bytes[i] = mapped;
            } else {
                return value; // Char outside Latin-1/W1252 = not mojibake
            }
        }
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return value; // Bytes are not valid UTF-8 = not mojibake
    }
}

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
    const redirectUrl = new URL(APP_SCOPE_URL);
    const formData = await request.formData();

    const file = formData.get('file');
    if (file instanceof File && file.size > 0) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put('pending-file', new Response(file, {
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Share-Filename': encodeURIComponent(file.name || 'shared'),
            },
        }));
        redirectUrl.searchParams.set('share', 'file');
        return Response.redirect(redirectUrl.toString(), 303);
    }

    // formData() may decode UTF-8 bytes as Latin-1/W1252 on Android Chrome,
    // producing mojibake (e.g. "ü" → "Ã¼"). fixFormDataEncoding reverses this.
    const title = fixFormDataEncoding(formData.get('title') || '');
    const text = fixFormDataEncoding(formData.get('text') || '');
    const sharedUrl = fixFormDataEncoding(formData.get('url') || '');

    console.log('[SW] Share text fields:', { title, text, sharedUrl });

    const cache = await caches.open(SHARE_CACHE);
    await cache.put('pending-share', new Response(JSON.stringify({
        title, text, url: sharedUrl,
    }), {
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    }));
    redirectUrl.searchParams.set('share', 'data');

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
