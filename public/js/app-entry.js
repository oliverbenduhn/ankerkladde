import { registerAppEventHandlers } from './app-events.js';
import { initApp, registerServiceWorker, initWebSocketServer } from './app-init.js';
import { createAppRuntime } from './app-runtime.js';
import { readInitialPreferences, state } from './state.js';
import { applyThemePreferences } from './theme.js';
import { modeToggleBtns, modeChip, layoutToggleBtn } from './ui.js';
import { initConflictUI } from './offline-conflicts.js';

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
        closeItemEditor,
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
        openJournalWithNavigation,
        openItemCreate,
        prefetchAdjacentCategories,
        refreshVisibleCategory,
        renderCategoryTabs,
        renderItems,
        reorderController,
        restorePersistedDraft,
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
        closeItemEditor,
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
        openItemCreate,
        refreshVisibleCategory,
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
            renderItems,
            reorderController,
            restorePersistedDraft,
            router,
            setNetworkStatus,
            swipeController,
            updateHeaders,
            applyTabsVisibility,
        });

        // Eine bereits vor dem Reload persistierte Mutation gehoert zur
        // Start-Synchronisation. Erst danach darf der WebSocket weitere
        // Server-Snapshots einspielen, sonst kann ein geloeschter Eintrag bis
        // zum naechsten "online"-Event wieder sichtbar bleiben.
        try {
            await flushOfflineQueue();
        } catch {
            // Die Queue bleibt fuer den naechsten Online-Versuch erhalten.
            setNetworkStatus();
        }

        initWebSocketServer(async (action) => {
            console.log('[WS] update received:', action);

            try {
                if (action === 'settings_update') {
                    console.log('[WS] reloading settings-dependent state...');
                    await loadCategories();
                    await loadItems(undefined, { useCache: false });
                    return;
                }

                // Generic update: reload both categories and items.
                // In the journal view, only the agenda is refreshed — the editor text must not be overwritten.
                console.log('[WS] reloading items...');
                await loadCategories();
                if (state.screen === 'journal') {
                    await router.openJournal(state.journalDate || state.serverToday || 'today');
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
