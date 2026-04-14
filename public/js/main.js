import { appUrl, api, apiUpload } from './api.js';
import { createAppUiController } from './app-ui.js';
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
    isAttachmentCategory,
    isBarcodeCategory,
    isIosWebKit,
    isNotesCategory,
    isScannerSupported,
    normalizePreferences,
    readInitialPreferences,
    scannerState,
    state,
    themeMediaQuery,
} from './state.js';
import { applyThemePreferences, cycleThemeMode } from './theme.js';
import {
    appEl,
    cameraInput,
    clearDoneBtn,
    dropZoneEl,
    fileInput,
    itemForm,
    itemInput,
    listAreaEl,
    modeToggleBtns,
    mehrMenuEl,
    noteEditorBack,
    noteEditorBody,
    noteEditorEl,
    noteSaveStatus,
    noteTitleInput,
    noteToolbar,
    quantityInput,
    scanAddBtn,
    scanShoppingBtn,
    scannerCloseBtn,
    scannerManualForm,
    scannerManualInput,
    scannerOverlay,
    scannerSubtitle,
    scannerVideo,
    searchBar,
    searchBtn,
    searchClose,
    searchInput,
    sectionTabsEl,
    settingsBtns,
    settingsFrameEl,
    tabsToggleBtns,
    themeModeBtns,
    updateBannerEl,
    updateViewportHeight,
} from './ui.js';
import { normalizeBarcodeValue, syncAutoHeight } from './utils.js';

function resetItemForm() {
    itemForm?.reset();
    syncAutoHeight(itemInput);
    syncAutoHeight(linkDescriptionInput);
    updateFilePickerLabel();
}

let userPreferences = readInitialPreferences();
let noteSaveTimer = null;
let tiptapEditor = null;
let navigation = null;
let router = null;
let appUiController = null;
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

function syncSettingsFrameTheme() {
    if (!settingsFrameEl?.contentWindow || state.view !== 'settings') return;
    settingsFrameEl.contentWindow.postMessage({
        type: 'ankerkladde-theme-update',
        preferences: {
            theme_mode: userPreferences.theme_mode,
            light_theme: userPreferences.light_theme,
            dark_theme: userPreferences.dark_theme,
        },
    }, window.location.origin);
}

function triggerHapticFeedback() {
    if ('vibrate' in navigator) {
        navigator.vibrate(12);
    }
}

function getItemById(id) { return itemsController.getItemById(id); }
function getVisibleCategories() { return itemsController.getVisibleCategories(); }
function cacheCurrentCategoryItems() { return itemsController.cacheCurrentCategoryItems(); }
function invalidateCategoryCache(categoryId) { return itemsController.invalidateCategoryCache(categoryId); }
async function loadCategories() { await itemsController.loadCategories(); }
async function savePreferences(patch) { await itemsController.savePreferences(patch); }

function renderCategoryTabs() { tabsViewController.renderCategoryTabs(); }

function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isOverdueItem(item) {
    return item.category_type === 'list_due_date'
        && item.done !== 1
        && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date || '')
        && item.due_date < getTodayDateString();
}

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

function formatDate(value) {
    try {
        return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
    } catch {
        return value;
    }
}

async function openNoteEditor(item) { await editorController.openNoteEditor(item); }
async function openNoteEditorWithNavigation(item) { await editorController.openNoteEditorWithNavigation(item); }
async function closeNoteEditor() { await editorController.closeNoteEditor(); }
function scheduleNoteSave() { editorController.scheduleNoteSave(); }
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

itemForm?.addEventListener('submit', event => {
    void addItem(event).catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', true);
    });
});

fileInput?.addEventListener('change', () => {
    updateFilePickerLabel();

    if (!isAttachmentCategory()) return;
    if (!fileInput.files?.[0]) return;

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

itemInput?.addEventListener('input', () => {
    syncAutoHeight(itemInput);
});
syncAutoHeight(itemInput);

cameraBtn?.addEventListener('click', () => cameraInput?.click());
cameraInput?.addEventListener('change', () => {
    if (!cameraInput?.files?.[0] || !fileInput) return;
    fileInput.files = cameraInput.files;
    updateFilePickerLabel();

    if (!isAttachmentCategory()) return;

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

clearDoneBtn?.addEventListener('click', () => {
    void clearDone().catch(error => {
        setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
    });
});

scanAddBtn?.addEventListener('click', () => {
    void openScanner('add').then(() => {
        if (scannerState.open) {
            navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
        }
    }).catch(error => {
        setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
    });
});

scanShoppingBtn?.addEventListener('click', () => {
    void openScanner('toggle').then(() => {
        if (scannerState.open) {
            navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
        }
    }).catch(error => {
        setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
    });
});

scannerCloseBtn?.addEventListener('click', () => navigation.navigateBackOrReplace({ screen: 'list' }));
scannerOverlay?.addEventListener('click', event => {
    if (event.target === scannerOverlay) {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

scannerManualForm?.addEventListener('submit', event => {
    event.preventDefault();
    const barcode = normalizeBarcodeValue(scannerManualInput?.value || '');
    if (barcode === '') {
        setScannerStatus('Bitte Barcode eingeben.', true);
        return;
    }

    void handleScannedBarcode(barcode);
});

modeToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        if (scannerState.open) {
            closeScanner();
        }
        state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
        appEl.dataset.mode = state.mode;
        void savePreferences({ mode: state.mode });
        renderItems();
    });
});

themeModeBtns.forEach(button => {
    button.addEventListener('click', () => {
        void cycleThemeMode(userPreferences, setUserPreferences, setMessage).then(() => {
            syncSettingsFrameTheme();
        });
    });
});

settingsBtns.forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        const targetTab = button.dataset.settingsTab || 'app';
        if (state.view === 'settings' && state.settingsTab === targetTab) {
            router.closeSettings();
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        void router.openSettings(targetTab).then(() => {
            navigation.pushHistoryState({ screen: 'settings', tab: state.settingsTab });
        }).catch(() => {});
    });
});

settingsFrameEl?.addEventListener('load', () => {
    try {
        const frameUrl = new URL(settingsFrameEl.contentWindow?.location.href || settingsFrameEl.src, window.location.href);
        if (frameUrl.protocol === 'about:') {
            return;
        }
        state.settingsTab = frameUrl.searchParams.get('tab') === 'extension' ? 'extension' : 'app';
        if (state.view === 'settings') {
            navigation.replaceCurrentHistoryState({ screen: 'settings', tab: state.settingsTab });
            void loadCategories()
                .then(() => {
                    updateHeaders();
                    syncSettingsFrameTheme();
                })
                .catch(() => {});
        }
    } catch {
        // same-origin expected; ignore if unavailable
    }
});

window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'ankerkladde-settings-close') {
        router.closeSettings();
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

window.addEventListener('popstate', event => {
    void navigation.handlePopState(event, setMessage);
});

tabsToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
        applyTabsVisibility(hidden);
        void savePreferences({ tabs_hidden: hidden });
    });
});

document.addEventListener('click', (e) => {
    tabsViewController.handleDocumentClick(e.target);
});

window.addEventListener('resize', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.addEventListener('orientationchange', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.addEventListener('pageshow', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.visualViewport?.addEventListener('resize', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.visualViewport?.addEventListener('scroll', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

linkDescriptionInput?.addEventListener('input', () => {
    syncAutoHeight(linkDescriptionInput);
});

[itemInput, quantityInput, linkDescriptionInput].forEach(field => {
    field?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        if (event.isComposing) return;
        if (field instanceof HTMLTextAreaElement && event.shiftKey) return;
        event.preventDefault();
        itemForm?.requestSubmit();
    });
});

searchBtn?.addEventListener('click', () => {
    if (state.view === 'settings' || state.noteEditorId !== null) return;
    if (state.search.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (scannerState.open) closeScanner();
    openSearch();
    navigation.pushHistoryState({ screen: 'search', query: state.search.query });
});
searchClose?.addEventListener('click', () => {
    navigation.navigateBackOrReplace({ screen: 'list' });
});
searchInput?.addEventListener('input', () => {
    void doSearch(searchInput.value);
});
searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeSearch();
    }
});

noteEditorBack?.addEventListener('click', () => {
    navigation.navigateBackOrReplace({ screen: 'list' });
});

noteTitleInput?.addEventListener('input', scheduleNoteSave);

noteToolbar?.addEventListener('click', event => {
    editorController.handleToolbarClick(event);
});

dropZoneEl?.addEventListener('dragover', event => {
    if (!isAttachmentCategory()) return;
    event.preventDefault();
    dropZoneEl.classList.add('drop-active');
});

dropZoneEl?.addEventListener('dragleave', () => {
    dropZoneEl.classList.remove('drop-active');
});

dropZoneEl?.addEventListener('drop', event => {
    if (!isAttachmentCategory()) return;
    event.preventDefault();
    dropZoneEl.classList.remove('drop-active');
    const file = event.dataTransfer?.files?.[0] || null;
    if (!file || !fileInput) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    updateFilePickerLabel();

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

document.addEventListener('paste', event => {
    if (!isAttachmentCategory()) return;
    if (state.noteEditorId !== null) return; // let TipTap handle paste in note editor
    const file = Array.from(event.clipboardData?.items || [])
        .find(item => item.kind === 'file')
        ?.getAsFile() || null;
    if (!file || !fileInput) return;
    event.preventDefault();
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    updateFilePickerLabel();
    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

window.addEventListener('online', setNetworkStatus);
if (themeMediaQuery) {
    const onThemeMediaChange = () => {
        if (userPreferences.theme_mode === 'auto') applyThemePreferences(userPreferences);
    };
    if (typeof themeMediaQuery.addEventListener === 'function') {
        themeMediaQuery.addEventListener('change', onThemeMediaChange);
    } else if (typeof themeMediaQuery.addListener === 'function') {
        themeMediaQuery.addListener(onThemeMediaChange);
    }
}
window.addEventListener('offline', setNetworkStatus);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && scannerState.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.search.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.noteEditorId !== null) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.view === 'settings') {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && scannerState.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

{
    let deferredInstallPrompt = null;
    const installBannerEl = document.getElementById('installBanner');
    const installBtn = document.getElementById('installBtn');
    const installDismiss = document.getElementById('installDismiss');

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        if (userPreferences.install_banner_dismissed) return;
        deferredInstallPrompt = e;
        if (installBannerEl) installBannerEl.hidden = false;
    });
    installBtn?.addEventListener('click', async () => {
        if (installBannerEl) installBannerEl.hidden = true;
        await deferredInstallPrompt?.prompt();
        deferredInstallPrompt = null;
    });
    installDismiss?.addEventListener('click', () => {
        if (installBannerEl) installBannerEl.hidden = true;
        deferredInstallPrompt = null;
        void savePreferences({ install_banner_dismissed: true });
    });
}

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
            const reg = await navigator.serviceWorker.register(appBasePath + 'sw.js?v=2.0.37');
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
