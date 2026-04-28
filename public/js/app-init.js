import { basePath, state } from './state.js?v=4.2.98';
import { applyViewState } from './router.js?v=4.2.98';
import { appEl, updateBannerEl, updateViewportHeight } from './ui.js?v=4.2.98';

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
        reorderController,
        router,
        setNetworkStatus,
        swipeController,
    } = deps;

    try {
        const userPreferences = getUserPreferences();
        applyThemePreferences(userPreferences);
        updateViewportHeight();
        setNetworkStatus();
        applyViewState();
        state.mode = userPreferences.mode;
        state.desktopLayout = userPreferences.desktop_layout;
        if (appEl) {
            appEl.dataset.mode = state.mode;
            appEl.dataset.desktopLayout = state.desktopLayout;
        }
        deps.applyTabsVisibility(userPreferences.tabs_hidden);
        reorderController.initItemDragReorder();
        swipeController.initCategorySwipe();
        await loadCategories();
        deps.updateHeaders();
        await loadItems();
        const initialRoute = navigation.readInitialRouteFromUrl();
        if (initialRoute.screen !== 'list') {
            await router.applyRouteState(initialRoute, route => route);
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
    const userId = document.querySelector('meta[name="user-id"]')?.content || '';
    const configuredWsUrl = document.querySelector('meta[name="websocket-url"]')?.content?.replace(/\/+$/, '');
    const wsBaseUrl = configuredWsUrl || `${protocol}//${window.location.host}/ws`;
    const wsUrl = `${wsBaseUrl}/?uid=${encodeURIComponent(userId)}`;
    let debounceTimer;

    function connect() {
        // Only connect if we're not offline to avoid console spam
        if (!navigator.onLine) {
            setTimeout(connect, 5000);
            return;
        }

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[WS] connected to', wsUrl);
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
            setTimeout(connect, 5000); // Reconnect
        };
    }

    window.addEventListener('online', () => {
        // Optional immediate reconnect hint
    });

    // Start initial connection
    connect();
}
