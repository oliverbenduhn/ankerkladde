import { registerAppEventHandlers } from './app-events.js?v=5.1.13';
import { initApp, registerServiceWorker, initWebSocketServer } from './app-init.js?v=5.1.12';
import { createAppRuntime } from './app-runtime.js?v=5.1.13';
import { readInitialPreferences, state } from './state.js?v=4.3.4';
import { applyThemePreferences } from './theme.js?v=4.3.4';
import { modeToggleBtns, modeChip, layoutToggleBtn } from './ui.js?v=4.3.4';
import { initConflictUI } from './offline-conflicts.js?v=4.3.11';

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
        closeTodoEditor,
        doSearch,
        editorController,
        flushOfflineQueue,
        handleIncomingShare,
        handleScannedBarcode,
        getUploadMode,
        loadCategories,
        loadItems,
        loadToday,
        navigation,
        openScanner,
        openSearch,
        openJournalWithNavigation,
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
        updateLayoutSwitcher,
        updateModeChip,
        updateUploadUi,
    } = runtime;

    applyUserPreferences = runtimeApplyUserPreferences;
    applyUserPreferences(userPreferences);

    initConflictUI({
        loadItems,
        invalidateCategoryCache: runtime.invalidateCategoryCache,
        setMessage
    });

    registerAppEventHandlers({
        addItem,
        applyTabsVisibility,
        clearDone,
        closeScanner,
        closeSearch,
        closeTodoEditor,
        doSearch,
        editorController,
        flushOfflineQueue,
        handleScannedBarcode,
        loadCategories,
        loadItems,
        modeToggleBtns,
        modeChip,
        layoutToggleBtn,
        updateModeChip,
        updateLayoutSwitcher,
        navigation,
        openScanner,
        openSearch,
        openJournalWithNavigation,
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
            loadToday,
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
                if (state.screen === 'today') {
                    await loadToday();
                    return;
                }
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
