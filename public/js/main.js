import { appUrl, api, apiUpload } from './api.js';
import { createAppUiController } from './app-ui.js';
import { registerAppEventHandlers } from './app-events.js';
import { createHelpersController } from './helpers.js';
import { createItemsActionsController } from './items-actions.js';
import { createItemsController } from './items.js';
import { createItemsViewController } from './items-view.js';
import { createNavigation } from './navigation.js';
import { createEditorController } from './editor.js';
import { createReorderController } from './reorder.js';
import { applyViewState, createRouter } from './router.js';
import { createScannerController } from './scanner.js';
import { createSwipeController } from './swipe.js';
import { createTabsViewController } from './tabs-view.js';
import {
    BARCODE_FORMATS,
    NOTE_SAVE_DEBOUNCE_MS,
    SCANNER_COOLDOWN_MS,
    getCurrentCategory,
    getCurrentType,
    getTypeConfig,
    isBarcodeCategory,
    isIosWebKit,
    isNotesCategory,
    isScannerSupported,
    normalizePreferences,
    readInitialPreferences,
    scannerState,
    state,
} from './state.js';
import { applyThemePreferences } from './theme.js';
import {
    appEl,
    modeToggleBtns,
    settingsFrameEl,
    updateBannerEl,
    updateViewportHeight,
} from './ui.js';

let userPreferences = readInitialPreferences();
let noteSaveTimer = null;
let tiptapEditor = null;
let navigation = null;
let router = null;
let appUiController = null;
let helpersController = null;
let itemsActionsController = null;
let itemsController = null;
let itemsViewController = null;
let scannerController = null;
let editorController = null;
let reorderController = null;
let swipeController = null;
let tabsViewController = null;

function setUserPreferences(nextPreferences) {
    userPreferences = nextPreferences;
}

function getItemById(id) { return itemsController.getItemById(id); }
function getVisibleCategories() { return itemsController.getVisibleCategories(); }
function cacheCurrentCategoryItems() { return itemsController.cacheCurrentCategoryItems(); }
function invalidateCategoryCache(categoryId) { return itemsController.invalidateCategoryCache(categoryId); }
async function loadCategories() { await itemsController.loadCategories(); }
async function savePreferences(patch) { await itemsController.savePreferences(patch); }

function renderCategoryTabs() { tabsViewController.renderCategoryTabs(); }

function closeScanner() { scannerController.closeScanner(); }
async function handleScannedBarcode(rawValue) { await scannerController.handleScannedBarcode(rawValue); }
async function openScanner(action = state.mode === 'einkaufen' ? 'toggle' : 'add') { await scannerController.openScanner(action); }

async function setCategory(categoryId) { await itemsController.setCategory(categoryId); }
async function loadItems(categoryId = state.categoryId, options = {}) { await itemsController.loadItems(categoryId, options); }
function prefetchAdjacentCategories() { itemsController.prefetchAdjacentCategories(); }
function getVisibleItems() { return itemsController.getVisibleItems(); }
function openSearch() { itemsController.openSearch(); }
function closeSearch() { itemsController.closeSearch(); }
async function doSearch(query) { await itemsController.doSearch(query); }

function renderItems() { itemsViewController.renderItems(); }

async function openNoteEditor(item) { await editorController.openNoteEditor(item); }
async function openNoteEditorWithNavigation(item) { await editorController.openNoteEditorWithNavigation(item); }
async function closeNoteEditor() { await editorController.closeNoteEditor(); }
function scheduleNoteSave() { editorController.scheduleNoteSave(); }
function resetItemForm() { helpersController.resetItemForm(); }
function syncSettingsFrameTheme() { helpersController.syncSettingsFrameTheme(settingsFrameEl); }
function triggerHapticFeedback() { helpersController.triggerHapticFeedback(); }
function isOverdueItem(item) { return helpersController.isOverdueItem(item); }
function formatDate(value) { return helpersController.formatDate(value); }
function setMessage(text, isError = false) { appUiController.setMessage(text, isError); }
function setUploadProgress(fraction) { appUiController.setUploadProgress(fraction); }
function makeUploadProgressCallback() { return appUiController.makeUploadProgressCallback(); }
function updateHeaders() { appUiController.updateHeaders(); }
function updateUploadUi() { appUiController.updateUploadUi(); }
function updateFilePickerLabel() { appUiController.updateFilePickerLabel(); }
function setScannerStatus(text, isError = false) { appUiController.setScannerStatus(text, isError); }
function setNetworkStatus() { appUiController.setNetworkStatus(); }
function applyTabsVisibility(hidden) { appUiController.applyTabsVisibility(hidden); }
function formatBytes(sizeBytes) { return appUiController.formatBytes(sizeBytes); }
async function handleIncomingShare() { await itemsActionsController.handleIncomingShare(); }
async function uploadSelectedAttachment() { await itemsActionsController.uploadSelectedAttachment(); }
async function addItem(event) { await itemsActionsController.addItem(event); }
async function handleToggle(id, done) { await itemsActionsController.handleToggle(id, done); }
async function handleDelete(id) { await itemsActionsController.handleDelete(id); }
async function handlePin(id, isPinned) { await itemsActionsController.handlePin(id, isPinned); }
async function handleEditSave(id) { await itemsActionsController.handleEditSave(id); }
async function clearDone() { await itemsActionsController.clearDone(); }

router = createRouter({
    closeNoteEditor,
    closeScanner,
    closeSearch,
    doSearch,
    getItemById,
    openNoteEditor,
    openScanner,
    openSearch,
    scannerState,
    setCategory,
    updateHeaders,
});

navigation = createNavigation({
    applyRouteState: router.applyRouteState,
    getCurrentRouteState: router.getCurrentRouteState,
});

appUiController = createAppUiController();

helpersController = createHelpersController({
    getUserPreferences: () => userPreferences,
    updateFilePickerLabel,
});

itemsActionsController = createItemsActionsController({
    cacheCurrentCategoryItems,
    closeNoteEditor,
    getItemById,
    getVisibleCategories,
    invalidateCategoryCache,
    loadItems,
    makeUploadProgressCallback,
    openNoteEditorWithNavigation,
    renderItems,
    resetItemForm,
    setCategory,
    setMessage,
});

tabsViewController = createTabsViewController({
    getTypeConfig,
    getVisibleCategories,
    isTabDragJustFinished: () => reorderController?.wasTabDragJustFinished() ?? false,
    onCategorySelect: setCategory,
});

itemsViewController = createItemsViewController({
    closeSearch,
    formatBytes,
    formatDate,
    getItemById,
    getVisibleItems,
    handleDelete,
    handleEditSave,
    handlePin,
    handleToggle,
    isOverdueItem,
    openNoteEditorWithNavigation,
    setCategory,
});

itemsController = createItemsController({
    applyTabsVisibility,
    applyThemePreferences,
    closeNoteEditor,
    closeScanner,
    closeSettings: () => router.closeSettings(),
    getUserPreferences: () => userPreferences,
    navigation,
    normalizePreferences,
    renderCategoryTabs,
    renderItems,
    scannerState,
    setMessage,
    setUserPreferences,
    updateHeaders,
    updateUploadUi,
});

scannerController = createScannerController({
    getCurrentCategory,
    getItemById,
    getScannerCooldownMs: () => SCANNER_COOLDOWN_MS,
    getScannerSupportedFormats: () => BARCODE_FORMATS,
    handleToggle,
    invalidateCategoryCache,
    loadItems,
    navigation,
    setMessage,
    setScannerStatus,
    triggerHapticFeedback,
    updateFilePickerLabel,
});

editorController = createEditorController({
    cacheCurrentCategoryItems,
    getItemById,
    getNoteSaveTimer: () => noteSaveTimer,
    navigation,
    setNoteSaveTimer: value => { noteSaveTimer = value; },
    setTiptapEditor: value => { tiptapEditor = value; },
    getTiptapEditor: () => tiptapEditor,
});

reorderController = createReorderController({
    applyTabsVisibility,
    cacheCurrentCategoryItems,
    getItemById,
    getUserPreferences: () => userPreferences,
    getVisibleCategories,
    invalidateCategoryCache,
    loadCategories,
    loadItems,
    renderCategoryTabs,
    setMessage,
    triggerHapticFeedback,
    updateHeaders,
});

swipeController = createSwipeController({
    getUserPreferences: () => userPreferences,
    getVisibleCategories,
    setCategory,
});

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
    triggerUploadSelectedAttachment: uploadSelectedAttachment,
    updateFilePickerLabel,
    updateHeaders,
    userPreferencesRef: () => userPreferences,
});

(async function init() {
    try {
        applyThemePreferences(userPreferences);
        updateViewportHeight();
        setNetworkStatus();
        applyViewState();
        state.mode = userPreferences.mode;
        appEl.dataset.mode = state.mode;
        reorderController.initCategoryTabReorder();
        reorderController.initItemDragReorder();
        swipeController.initCategorySwipe();
        await loadCategories();
        updateHeaders();
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
        setMessage(error instanceof Error ? error.message : 'App konnte nicht geladen werden.', true);
    }

    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register(appBasePath + 'sw.js?v=2.0.40');
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                w?.addEventListener('statechange', () => {
                    if (w.state === 'installed' && navigator.serviceWorker.controller) {
                        if (updateBannerEl) updateBannerEl.hidden = false;
                    }
                });
            });
        } catch {
            // SW registration failure is non-fatal
        }
    }

    document.getElementById('updateReloadBtn')?.addEventListener('click', async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
    });
})();
