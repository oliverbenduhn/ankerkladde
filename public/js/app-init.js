import { basePath, state } from './state.js';
import { applyViewState } from './router.js';
import { appEl, updateBannerEl, updateViewportHeight } from './ui.js';
import { loadAgenda, updateAppBadge } from './today-view.js';

export async function initApp(deps) {
    const {
        applyThemePreferences,
        getUserPreferences,
        handleIncomingShare,
        loadCategories,
        loadItems,
        navigation,
        prefetchAdjacentCategories,
        renderInitialError,
        renderItems,
        reorderController,
        restorePersistedDraft,
        router,
        setNetworkStatus,
        swipeController,
    } = deps;

    try {
        const userPreferences = getUserPreferences();
        applyThemePreferences(userPreferences);
        updateViewportHeight();
        setNetworkStatus();
        state.mode = userPreferences.mode;
        state.layout = userPreferences.layout;
        if (appEl) {
            appEl.dataset.mode = state.mode;
            appEl.dataset.layout = state.layout;
        }
        deps.applyTabsVisibility(userPreferences.tabs_hidden);
        // ponytail: state.screen VOR dem ersten applyViewState setzen, sonst
        // flackert kurz die Default-Liste bevor JS den Tagesansicht-State zieht.
        const initialRoute = navigation.readInitialRouteFromUrl();
        if (initialRoute.screen === 'journal') {
            state.screen = 'journal';
            state.journalDate = initialRoute.date || state.serverToday;
        } else if (initialRoute.screen === 'settings') {
            state.screen = 'settings';
            state.settingsTab = initialRoute.tab || 'app';
        } else if (initialRoute.screen === 'search') {
            state.search.open = true;
            state.search.query = initialRoute.query || '';
        } else if (initialRoute.screen === 'note' || initialRoute.screen === 'scanner') {
            // bleiben bis zum vollständigen applyRouteState unsichtbar
        }
        applyViewState();
        reorderController.initItemDragReorder();
        swipeController.initCategorySwipe();
        await loadCategories();
        deps.updateHeaders();
        await loadItems();
        // AC #63: einen ueber Reload/Navigation hinweg persistierten,
        // unbestaetigten Entwurf desselben Tabs wieder aufnehmen.
        if (restorePersistedDraft()) {
            renderItems();
        }
        // Pre-load today agenda so the app-badge stays current and the
        // journal view never blocks on its first request after navigation.
        try {
            const agenda = await loadAgenda();
            await updateAppBadge(agenda.items.length);
        } catch {
            // Badging is optional; failing silently here matches the journal
            // agenda fetch behaviour (which also swallows network errors).
        }
        const initialRouteForRouting = navigation.readInitialRouteFromUrl();
        if (initialRouteForRouting.screen !== 'list') {
            await router.applyRouteState(initialRouteForRouting, route => route);
        }
        navigation.replaceCurrentHistoryState();
        prefetchAdjacentCategories();
        await handleIncomingShare();
        navigation.replaceCurrentHistoryState();
    } catch (error) {
        renderInitialError(error);
    }
}

export async function registerServiceWorker(version) {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        await navigator.serviceWorker.register(`${basePath}sw.js?v=${encodeURIComponent(version)}`);

        // Wenn ein neuer SW die Kontrolle übernimmt (skipWaiting läuft automatisch
        // beim Install), die Seite sofort neu laden — kein manueller Banner nötig.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    } catch {
        // SW registration failure is non-fatal
    }
}

export function initWebSocketServer(onUpdate) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const configuredWsUrl = document.querySelector('meta[name="websocket-url"]')?.content?.replace(/\/+$/, '');
    const wsBaseUrl = configuredWsUrl || `${protocol}//${window.location.host}/ws`;
    let debounceTimer;
    let stopped = false;

    async function ticketUrl() {
        const response = await fetch(`${basePath}ws-ticket.php`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`WebSocket ticket unavailable (${response.status})`);
        const payload = await response.json();
        if (!payload?.ticket) throw new Error('WebSocket ticket missing');
        return `${wsBaseUrl}/?ticket=${encodeURIComponent(payload.ticket)}`;
    }

    async function connect() {
        // Only connect if we're not offline to avoid console spam
        if (!navigator.onLine) {
            setTimeout(connect, 5000);
            return;
        }

        let wsUrl;
        try {
            wsUrl = await ticketUrl();
        } catch (error) {
            console.warn('[WS] live synchronization disabled:', error.message);
            stopped = true;
            return;
        }
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[WS] connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('[WS] message received:', data.action);

                if (data.action === 'version_update') {
                    console.log('[WS] new version available:', data.version);
                    window.location.reload();
                } else if (data.action === 'update' || data.action === 'settings_update') {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        onUpdate(data.action);
                    }, 600);
                }
            } catch (e) {
                console.error('[WS] parse error:', e);
            }
        };

        ws.onerror = (err) => {
            console.warn('[WS] error', err);
            ws.close();
        };

        ws.onclose = () => {
            console.log('[WS] disconnected, reconnecting in 5s...');
            if (!stopped) setTimeout(connect, 5000); // Reconnect with a fresh ticket
        };
    }

    window.addEventListener('online', () => {
        // Optional immediate reconnect hint
    });

    // Start initial connection
    connect();
}
