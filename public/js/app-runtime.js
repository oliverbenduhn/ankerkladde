import { createAppUiController } from './app-ui.js';
import { createHelpersController } from './helpers.js';
import { createItemsActionsController } from './items-actions.js';
import { createItemsController } from './items.js';
import { createItemsViewController } from './items-view.js';
import { createNavigation } from './navigation.js';
import { createEditorController } from './editor.js';
import { createReorderController } from './reorder.js';
import { createRouter } from './router.js';
import { createScannerController } from './scanner.js';
import { createSwipeController } from './swipe.js';
import { createTabsViewController } from './tabs-view.js';
import { createMagicController } from './magic.js';
import { flushQueue, getPendingCount } from './offline-queue.js';
import { api } from './api.js';
import {
    BARCODE_FORMATS,
    SCANNER_COOLDOWN_MS,
    getCurrentCategory,
    getTypeConfig,
    normalizePreferences,
    scannerState,
    state,
} from './state.js';
import { applyThemePreferences } from './theme.js';
import { settingsFrameEl } from './ui.js';

export function createAppRuntime(deps) {
    const {
        getNoteSaveTimer,
        getUserPreferences,
        getTiptapEditor,
        setNoteSaveTimer,
        setTiptapEditor,
        setUserPreferences,
    } = deps;

    const onSyncClick = async () => {
        await flushOfflineQueue();
        setNetworkStatus();
        await loadItems();
    };

    const appUiController = createAppUiController({ getUserPreferences, getPendingCount, onSyncClick });

    const updateFilePickerLabel = () => appUiController.updateFilePickerLabel();
    const helpersController = createHelpersController({
        getUserPreferences,
        updateFilePickerLabel,
    });

    let navigation = null;
    let router = null;
    let itemsController = null;
    let itemsViewController = null;
    let itemsActionsController = null;
    let scannerController = null;
    let editorController = null;
    let reorderController = null;
    let swipeController = null;
    let tabsViewController = null;
    let magicController = null;

    const getItemById = id => itemsController.getItemById(id);
    const getVisibleCategories = () => itemsController.getVisibleCategories();
    const cacheCurrentCategoryItems = () => itemsController.cacheCurrentCategoryItems();
    const invalidateCategoryCache = categoryId => itemsController.invalidateCategoryCache(categoryId);
    const loadCategories = async () => { await itemsController.loadCategories(); };
    const savePreferences = async patch => { await itemsController.savePreferences(patch); };
    const renderCategoryTabs = () => tabsViewController.renderCategoryTabs();
    const closeScanner = () => scannerController.closeScanner();
    const handleScannedBarcode = async rawValue => { await scannerController.handleScannedBarcode(rawValue); };
    const openScanner = async (action = state.mode === 'einkaufen' ? 'toggle' : 'add') => { await scannerController.openScanner(action); };
    const setCategory = async categoryId => { await itemsController.setCategory(categoryId); };
    const loadItems = async (categoryId = state.categoryId, options = {}) => { await itemsController.loadItems(categoryId, options); };
    const prefetchAdjacentCategories = () => itemsController.prefetchAdjacentCategories();
    const getVisibleItems = () => itemsController.getVisibleItems();
    const openSearch = () => itemsController.openSearch();
    const closeSearch = () => itemsController.closeSearch();
    const doSearch = async query => { await itemsController.doSearch(query); };
    const renderItems = () => itemsViewController.renderItems();
    const openNoteEditor = async item => { await editorController.openNoteEditor(item); };
    const openNoteEditorWithNavigation = async item => { await editorController.openNoteEditorWithNavigation(item); };
    const closeNoteEditor = async () => { await editorController.closeNoteEditor(); };
    const scheduleNoteSave = () => editorController.scheduleNoteSave();
    const resetItemForm = () => helpersController.resetItemForm();
    const syncSettingsFrameTheme = () => helpersController.syncSettingsFrameTheme(settingsFrameEl);
    const triggerHapticFeedback = () => helpersController.triggerHapticFeedback();
    const isOverdueItem = item => helpersController.isOverdueItem(item);
    const formatDate = value => helpersController.formatDate(value);
    const setMessage = (text, isError = false) => appUiController.setMessage(text, isError);
    const setUploadProgress = fraction => appUiController.setUploadProgress(fraction);
    const makeUploadProgressCallback = () => appUiController.makeUploadProgressCallback();
    const updateHeaders = () => appUiController.updateHeaders();
    const updateUploadUi = () => appUiController.updateUploadUi();
    const applyUserPreferences = preferences => appUiController.updateFeatureVisibility(preferences, {
        closeMagic: () => magicController?.closeMagic(),
        closeScanner: () => scannerController?.closeScanner(),
    });
    const setScannerStatus = (text, isError = false) => appUiController.setScannerStatus(text, isError);
    const setNetworkStatus = () => appUiController.setNetworkStatus();
    const applyTabsVisibility = hidden => appUiController.applyTabsVisibility(hidden);
    const formatBytes = sizeBytes => appUiController.formatBytes(sizeBytes);

    const flushOfflineQueue = async () => {
        const hadItems = await flushQueue(api);
        if (hadItems) {
            invalidateCategoryCache(state.categoryId);
            await loadItems();
        }
        return hadItems;
    };

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
        setNetworkStatus,
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
        handleDelete: async id => { await itemsActionsController.handleDelete(id); },
        handleEditSave: async id => { await itemsActionsController.handleEditSave(id); },
        handlePin: async (id, isPinned) => { await itemsActionsController.handlePin(id, isPinned); },
        handleToggle: async (id, done) => { await itemsActionsController.handleToggle(id, done); },
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
        getUserPreferences,
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
        getUserPreferences,
        handleToggle: async (id, done) => { await itemsActionsController.handleToggle(id, done); },
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
        getNoteSaveTimer,
        navigation,
        setNoteSaveTimer,
        setTiptapEditor,
        getTiptapEditor,
    });

    reorderController = createReorderController({
        applyTabsVisibility,
        cacheCurrentCategoryItems,
        getItemById,
        getUserPreferences,
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
        getUserPreferences,
        getVisibleCategories,
        setCategory,
    });

    magicController = createMagicController({
        getUserPreferences,
        loadCategories,
        loadItems,
        setCategory,
        setMessage,
        updateHeaders,
    });

    return {
        addItem: async event => { await itemsActionsController.addItem(event); },
        applyTabsVisibility,
        clearDone: async () => { await itemsActionsController.clearDone(); },
        closeScanner,
        closeSearch,
        doSearch,
        editorController,
        flushOfflineQueue,
        handleIncomingShare: async () => { await itemsActionsController.handleIncomingShare(); },
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
        applyUserPreferences,
        setMessage,
        setNetworkStatus,
        setScannerStatus,
        setUploadProgress,
        setUserPreferences,
        swipeController,
        syncSettingsFrameTheme,
        tabsViewController,
        triggerUploadSelectedAttachment: async () => { await itemsActionsController.uploadSelectedAttachment(); },
        updateFilePickerLabel,
        updateHeaders,
        magicController,
    };
}
