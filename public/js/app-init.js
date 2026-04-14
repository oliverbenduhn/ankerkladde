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
        const reg = await navigator.serviceWorker.register(`${basePath}sw.js?v=${encodeURIComponent(version)}`);
        reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    if (updateBannerEl) {
                        updateBannerEl.hidden = false;
                    }
                }
            });
        });
    } catch {
        // SW registration failure is non-fatal
    }
}

export function registerUpdateReloadHandler() {
    document.getElementById('updateReloadBtn')?.addEventListener('click', async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
    });
}
