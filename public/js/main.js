import { registerAppEventHandlers } from './app-events.js';
import { initApp, registerServiceWorker, registerUpdateReloadHandler } from './app-init.js';
import { createAppRuntime } from './app-runtime.js';
import { readInitialPreferences } from './state.js';
import { applyThemePreferences } from './theme.js';
import { modeToggleBtns } from './ui.js';

let userPreferences = readInitialPreferences();
let noteSaveTimer = null;
let tiptapEditor = null;

function setUserPreferences(nextPreferences) {
    userPreferences = nextPreferences;
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
    clearDone,
    closeScanner,
    closeSearch,
    doSearch,
    editorController,
    handleIncomingShare,
    handleScannedBarcode,
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
    setMessage,
    setNetworkStatus,
    setScannerStatus,
    setUploadProgress,
    swipeController,
    syncSettingsFrameTheme,
    tabsViewController,
    triggerUploadSelectedAttachment,
    updateFilePickerLabel,
    updateHeaders,
} = runtime;

registerAppEventHandlers({
    addItem,
    applyTabsVisibility,
    clearDone,
    closeScanner,
    closeSearch,
    doSearch,
    editorController,
    handleScannedBarcode,
    loadCategories,
    modeToggleBtns,
    navigation,
    openScanner,
    openSearch,
    renderCategoryTabs,
    renderItems,
    router,
    savePreferences,
    scheduleNoteSave,
    setMessage,
    setNetworkStatus,
    setScannerStatus,
    setUploadProgress,
    setUserPreferences,
    syncSettingsFrameTheme,
    tabsViewController,
    triggerUploadSelectedAttachment,
    updateFilePickerLabel,
    updateHeaders,
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
    });

    await registerServiceWorker('2.0.44');
    registerUpdateReloadHandler();
})();
