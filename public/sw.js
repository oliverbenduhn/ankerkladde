'use strict';

const VERSION = 'v4.2.95';
const ASSET_VERSION = '4.2.95';
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

const WINDOWS_1252_REVERSE_MAP = new Map([
    ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85],
    ['†', 0x86], ['‡', 0x87], ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8A],
    ['‹', 0x8B], ['Œ', 0x8C], ['Ž', 0x8E], ['‘', 0x91], ['’', 0x92],
    ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
    ['˜', 0x98], ['™', 0x99], ['š', 0x9A], ['›', 0x9B], ['œ', 0x9C],
    ['ž', 0x9E], ['Ÿ', 0x9F],
]);

const UTF8_MOJIBAKE_LEAD_BYTES = /[Â-ô]/u;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function windows1252ByteForChar(char) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return null;
    if (codePoint <= 0xFF) return codePoint;
    return WINDOWS_1252_REVERSE_MAP.get(char) ?? null;
}

function repairUtf8Mojibake(value) {
    if (typeof value !== 'string' || value === '' || !UTF8_MOJIBAKE_LEAD_BYTES.test(value)) {
        return value;
    }

    const chars = Array.from(value);
    let repaired = '';
    let changed = false;

    for (let index = 0; index < chars.length; index += 1) {
        const firstByte = windows1252ByteForChar(chars[index]);
        const expectedLength = firstByte >= 0xC2 && firstByte <= 0xDF ? 2
            : firstByte >= 0xE0 && firstByte <= 0xEF ? 3
            : firstByte >= 0xF0 && firstByte <= 0xF4 ? 4
            : 0;

        if (expectedLength === 0 || index + expectedLength > chars.length) {
            repaired += chars[index];
            continue;
        }

        const bytes = [firstByte];
        let isUtf8Sequence = true;
        for (let offset = 1; offset < expectedLength; offset += 1) {
            const continuationByte = windows1252ByteForChar(chars[index + offset]);
            if (continuationByte === null || continuationByte < 0x80 || continuationByte > 0xBF) {
                isUtf8Sequence = false;
                break;
            }
            bytes.push(continuationByte);
        }

        if (!isUtf8Sequence) {
            repaired += chars[index];
            continue;
        }

        try {
            repaired += UTF8_DECODER.decode(new Uint8Array(bytes));
            index += expectedLength - 1;
            changed = true;
        } catch {
            repaired += chars[index];
        }
    }

    return changed ? repaired : value;
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
    const formData   = await request.formData();
    const file       = formData.get('file');
    const title      = formData.get('title') || '';
    const text       = formData.get('text')  || '';
    const sharedUrl  = formData.get('url')   || '';

    // DEBUG: Log raw data
    console.log('[SW] Raw formData:', { title, text, sharedUrl });
    console.log('[SW] Text bytes:', Array.from(text).map(c => c.charCodeAt(0).toString(16)).join(' '));

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
            title: repairUtf8Mojibake(String(title)),
            text: repairUtf8Mojibake(String(text)),
            url: repairUtf8Mojibake(String(sharedUrl)),
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
