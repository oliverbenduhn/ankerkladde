import { registerAppEventHandlers } from './app-events.js?v=4.2.48';
import { initApp, registerServiceWorker, initWebSocketServer } from './app-init.js?v=4.2.48';
import { createAppRuntime } from './app-runtime.js?v=4.2.48';
import { readInitialPreferences, state } from './state.js?v=4.2.48';
import { applyThemePreferences } from './theme.js?v=4.2.48';
import { modeToggleBtns } from './ui.js?v=4.2.48';

export function startApp(version) {
    let userPreferences = readInitialPreferences();
    let noteSaveTimer = null;
    let tiptapEditor = null;
    let applyUserPreferences = () => {};

    function setUserPreferences(nextPreferences) {
        userPreferences = nextPreferences;
        applyUserPreferences(nextPreferences);
    }

    const runtime = createAppRuntime({
        getNoteSaveTimer: () => noteSaveTimer,
        getTiptapEditor: () => tiptapEditor,
        getUserPreferences: () => userPreferences,
        setNoteSaveTimer: value => { noteSaveTimer = value; },
        setTiptapEditor: value => { tiptapEditor = value; },
        setUserPreferences,
    });

    const {
        addItem,
        applyTabsVisibility,
        applyUserPreferences: runtimeApplyUserPreferences,
        clearDone,
        closeScanner,
        closeSearch,
        doSearch,
        editorController,
        flushOfflineQueue,
        handleIncomingShare,
        handleScannedBarcode,
        getUploadMode,
        loadCategories,
        loadItems,
        navigation,
        openScanner,
        openSearch,
        prefetchAdjacentCategories,
        renderCategoryTabs,
        renderItems,
        reorderController,
        router,
        savePreferences,
        scheduleNoteSave,
        magicController,
        setMessage,
        setNetworkStatus,
        setScannerStatus,
        setUploadProgress,
        setUploadMode,
        swipeController,
        syncSettingsFrameTheme,
        tabsViewController,
        triggerUploadSelectedAttachment,
        updateFilePickerLabel,
        updateHeaders,
        updateUploadUi,
    } = runtime;

    applyUserPreferences = runtimeApplyUserPreferences;
    applyUserPreferences(userPreferences);

    registerAppEventHandlers({
        addItem,
        applyTabsVisibility,
        clearDone,
        closeScanner,
        closeSearch,
        doSearch,
        editorController,
        flushOfflineQueue,
        handleScannedBarcode,
        loadCategories,
        loadItems,
        modeToggleBtns,
        navigation,
        openScanner,
        openSearch,
        renderCategoryTabs,
        renderItems,
        router,
        savePreferences,
        scheduleNoteSave,
        magicController,
        setMessage,
        setNetworkStatus,
        setScannerStatus,
        setUploadProgress,
        setUploadMode,
        setUserPreferences,
        syncSettingsFrameTheme,
        tabsViewController,
        triggerUploadSelectedAttachment,
        getUploadMode,
        updateFilePickerLabel,
        updateHeaders,
        updateUploadUi,
        userPreferencesRef: () => userPreferences,
    });

    (async function init() {
        await initApp({
            applyThemePreferences,
            getUserPreferences: () => userPreferences,
            handleIncomingShare,
            loadCategories,
            loadItems,
            navigation,
            prefetchAdjacentCategories,
            renderInitialError: error => {
                setMessage(error instanceof Error ? error.message : 'App konnte nicht geladen werden.', true);
            },
            reorderController,
            router,
            setNetworkStatus,
            swipeController,
            updateHeaders,
            applyTabsVisibility,
        });

        initWebSocketServer(async (action) => {
            console.log('[WS] update received:', action);

            try {
                if (action === 'settings_update') {
                    console.log('[WS] reloading settings-dependent state...');
                    await loadCategories();
                    await loadItems(undefined, { useCache: false });
                    return;
                }

                // Generic update: reload both categories and items
                console.log('[WS] reloading items...');
                await loadCategories();
                console.log('[WS] categories loaded, loading items...');
                await loadItems(undefined, { useCache: false });
                console.log('[WS] items loaded and rendered');
            } catch (err) {
                console.error('[WS] update failed:', err);
            }
        });
        await registerServiceWorker(version);
    })();
}
