import { basePath, state } from './state.js';
import { applyViewState } from './router.js';
import { appEl, updateBannerEl, updateViewportHeight } from './ui.js';

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
        if (appEl) {
            appEl.dataset.mode = state.mode;
        }
        reorderController.initCategoryTabReorder();
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
    const wsUrl = `${protocol}//${window.location.host}/ws/`;
    let debounceTimer;

    function connect() {
        // Only connect if we're not offline to avoid console spam
        if (!navigator.onLine) {
            setTimeout(connect, 5000);
            return;
        }

        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === 'update') {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        onUpdate();
                    }, 600);
                }
            } catch (e) {}
        };

        ws.onerror = () => {
            // Silent error handling for WebSocket connection failures
            ws.close();
        };

        ws.onclose = () => {
            setTimeout(connect, 5000); // Reconnect
        };
    }

    window.addEventListener('online', () => {
        // Optional immediate reconnect hint
    });

    // Start initial connection
    connect();
}
