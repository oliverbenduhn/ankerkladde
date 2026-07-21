import { createAppUiController } from './app-ui.js?v=5.1.28';
import { createHelpersController } from './helpers.js?v=5.1.28';
import { createItemsActionsController } from './items-actions.js?v=5.1.28';
import { createItemsController } from './items.js?v=5.1.28';
import { createItemsViewController } from './items-view.js?v=5.1.28';
import { createNavigation } from './navigation.js?v=5.1.28';
import { createEditorController } from './editor.js?v=5.1.28';
import { createTodoEditorController } from './todo-editor.js?v=5.1.28';
import { createReorderController } from './reorder.js?v=5.1.28';
import { createRouter } from './router.js?v=5.1.28';
import { createScannerController } from './scanner.js?v=5.1.28';
import { createSwipeController } from './swipe.js?v=5.1.28';
import { createTabsViewController } from './tabs-view.js?v=5.1.28';
import { createKanbanViewController } from './kanban-view.js?v=5.1.28';
import { createMagicController } from './magic.js?v=5.1.28';
import { createJournalController } from './journal.js?v=5.1.28';
import { flushQueue, getConflictCount, getPendingCount } from './offline-queue.js?v=5.1.28';
import { api } from './api.js?v=5.1.28';
import {
    BARCODE_FORMATS,
    SCANNER_COOLDOWN_MS,
    getCurrentCategory,
    getTypeConfig,
    normalizePreferences,
    scannerState,
    state,
} from './state.js?v=5.1.28';
import { applyThemePreferences } from './theme.js?v=5.1.28';
import { settingsFrameEl } from './ui.js?v=5.1.28';

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

    const appUiController = createAppUiController({ getUserPreferences, getConflictCount, getPendingCount, onSyncClick });

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
    let todoEditorController = null;
    let reorderController = null;
    let swipeController = null;
    let tabsViewController = null;
    let kanbanViewController = null;
    let magicController = null;
    let journalController = null;
    // Forward-reference so itemsActionsController can call back into the journal controller
    // before the latter is constructed (depends on cycle between the two).
    const afterJournalQuickAdd = () => journalController?.reloadAgenda?.();

    const getItemById = id => itemsController.getItemById(id);
    const getVisibleCategories = () => itemsController.getVisibleCategories();
    const getMoveTargetCategories = item => getVisibleCategories()
        .filter(category => category.type === item.category_type && Number(category.id) !== Number(item.category_id));
    const cacheCurrentCategoryItems = () => itemsController.cacheCurrentCategoryItems();
    const invalidateCategoryCache = categoryId => itemsController.invalidateCategoryCache(categoryId);
    const loadCategories = async () => { await itemsController.loadCategories(); };
    const savePreferences = async patch => { await itemsController.savePreferences(patch); };
    const renderCategoryTabs = () => tabsViewController.renderCategoryTabs();
    const closeScanner = () => scannerController.closeScanner();
    const handleScannedBarcode = async rawValue => { await scannerController.handleScannedBarcode(rawValue); };
    const openScanner = async (action = state.mode === 'view' ? 'toggle' : 'add') => { await scannerController.openScanner(action); };
    const setCategory = async categoryId => { await itemsController.setCategory(categoryId); };
    const loadItems = async (categoryId = state.categoryId, options = {}) => { await itemsController.loadItems(categoryId, options); };
    const prefetchAdjacentCategories = () => itemsController.prefetchAdjacentCategories();
    const getVisibleItems = () => itemsController.getVisibleItems();
    const openSearch = () => itemsController.openSearch();
    const closeSearch = () => itemsController.closeSearch();
    const doSearch = async query => { await itemsController.doSearch(query); };
    const renderItems = () => {
        if (state.layout === 'kanban' && getCurrentCategory()?.type === 'list_due_date') {
            kanbanViewController.renderKanban();
        } else {
            kanbanViewController?.hideKanban();
            itemsViewController.renderItems();
        }
    };
    const openNoteEditor = async item => { await editorController.openNoteEditor(item); };
    const openNoteEditorWithNavigation = async item => { await editorController.openNoteEditorWithNavigation(item); };
    const closeNoteEditor = async () => { await editorController.closeNoteEditor(); };
    const closeJournal = async () => { await journalController?.closeJournal(); };
    const openJournalDay = async (date, options = {}) => { await journalController.openDay(date || state.serverToday || 'today', options); };
    const openTodoEditor = item => { todoEditorController.openTodoEditor(item); };
    const closeTodoEditor = async () => { await todoEditorController.closeTodoEditor(); };
    const scheduleNoteSave = () => editorController.scheduleNoteSave();
    const resetItemForm = () => helpersController.resetItemForm();
    const syncSettingsFrameTheme = () => helpersController.syncSettingsFrameTheme(settingsFrameEl);
    const triggerHapticFeedback = () => helpersController.triggerHapticFeedback();
    const isOverdueItem = item => helpersController.isOverdueItem(item);
    const formatDate = value => helpersController.formatDate(value);
    const setMessage = (text, isError = false) => appUiController.setMessage(text, isError);
    const setRemoteImportLoading = (active, text) => appUiController.setRemoteImportLoading(active, text);
    const setUploadProgress = fraction => appUiController.setUploadProgress(fraction);
    const makeUploadProgressCallback = () => appUiController.makeUploadProgressCallback();
    const updateHeaders = () => appUiController.updateHeaders();
    const updateUploadUi = () => appUiController.updateUploadUi();
    const getUploadMode = () => appUiController.getUploadMode();
    const setUploadMode = mode => appUiController.setUploadMode(mode);
    const applyUserPreferences = preferences => appUiController.updateFeatureVisibility(preferences, {
        closeMagic: () => magicController?.closeMagic(),
        closeScanner: () => scannerController?.closeScanner(),
    });
    const setScannerStatus = (text, isError = false) => appUiController.setScannerStatus(text, isError);
    const setNetworkStatus = () => appUiController.setNetworkStatus();
    const applyTabsVisibility = hidden => appUiController.applyTabsVisibility(hidden);
    const updateModeChip = () => appUiController.updateModeChip();
    const updateLayoutSwitcher = () => appUiController.updateLayoutSwitcher();
    const formatBytes = sizeBytes => appUiController.formatBytes(sizeBytes);

    const invalidateSwListCache = (categoryId) => {
        if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'INVALIDATE_LIST_CACHE',
                categoryId,
            });
        }
    };

    const flushOfflineQueue = async () => {
        const hadItems = await flushQueue(api);
        if (hadItems) {
            invalidateCategoryCache(state.categoryId);
            invalidateSwListCache(state.categoryId);
            await loadItems();
        }
        return hadItems;
    };

    router = createRouter({
        closeNoteEditor,
        closeMagic: () => magicController?.closeMagic(),
        closeScanner,
        closeSearch,
        doSearch,
        getItemById,
        pushHistoryState: (...args) => navigation?.pushHistoryState(...args),
        openNoteEditor,
        openJournalDay,
        closeJournal,
        openScanner,
        openSearch,
        scannerState,
        renderCategoryTabs,
        setCategory,
        updateHeaders,
    });

    navigation = createNavigation({
        applyRouteState: router.applyRouteState,
        getCurrentRouteState: router.getCurrentRouteState,
    });

    journalController = createJournalController({
        navigation,
        openSourceItem: async (categoryId, itemId) => {
            await router.openSourceItem(categoryId, itemId);
            navigation.pushHistoryState({ screen: 'list', categoryId, itemId });
        },
        renderCategoryTabs,
        setMessage,
        updateHeaders,
    });
    // The toggle handler needs itemsActionsController — wire it after both exist.

    const openJournalWithNavigation = async (date, focus = null) => {
        const resolvedDate = date || state.serverToday || 'today';
        await router.openJournal(resolvedDate, focus);
        navigation.pushHistoryState({ screen: 'journal', date: resolvedDate, focus });
    };

    itemsActionsController = createItemsActionsController({
        cacheCurrentCategoryItems,
        closeNoteEditor,
        getCurrentCategory,
        getItemById,
        getUploadMode,
        getVisibleCategories,
        invalidateCategoryCache,
        loadCategories,
        loadItems,
        makeUploadProgressCallback,
        openNoteEditorWithNavigation,
        openMagic: input => magicController?.openMagic(input),
        renderItems,
        resetItemForm,
        setCategory,
        setMessage,
        setNetworkStatus,
        setRemoteImportLoading,
        afterJournalQuickAdd,
    });

    tabsViewController = createTabsViewController({
        getTypeConfig,
        getVisibleCategories,
        onCategorySelect: category => router.selectCategory(category.id),
    });

    itemsViewController = createItemsViewController({
        closeSearch,
        formatBytes,
        formatDate,
        getItemById,
        getMoveTargetCategories,
        getVisibleItems,
        handleDelete: async id => { await itemsActionsController.handleDelete(id); },
        handleEditSave: async id => { await itemsActionsController.handleEditSave(id); },
        handleMove: async (item, targetCategoryId) => { await itemsActionsController.handleMove(item, targetCategoryId); },
        handlePin: async (id, isPinned) => { await itemsActionsController.handlePin(id, isPinned); },
        handleStatus: async (id, status) => { await itemsActionsController.handleStatus(id, status); },
        handleToggle: async (id, done) => { await itemsActionsController.handleToggle(id, done); },
        isOverdueItem,
        openNoteEditorWithNavigation,
        openJournalWithNavigation,
        openTodoEditor,
        setCategory,
        setMessage,
    });

    kanbanViewController = createKanbanViewController({
        buildItemNode: item => itemsViewController.buildItemNode(item),
        getVisibleItems,
        handleKanbanDrop: async (itemId, columnKey) => {
            const item = getItemById(itemId);
            if (!item) return;
            if (columnKey === 'erledigt') {
                if (!item.done) await itemsActionsController.handleToggle(itemId, 1);
            } else {
                if (item.done) await itemsActionsController.handleToggle(itemId, 0);
                const statusMap = { offen: '', in_arbeit: 'in_progress', wartet_auf: 'waiting' };
                const newStatus = statusMap[columnKey] ?? '';
                if (item.status !== newStatus) {
                    await itemsActionsController.handleStatus(itemId, item.status, newStatus);
                }
            }
            renderItems();
        },
    });

    itemsController = createItemsController({
        applyTabsVisibility,
        applyThemePreferences,
        closeNoteEditor,
        closeJournalScreen: () => router.closeJournalScreen(),
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

    todoEditorController = createTodoEditorController({
        invalidateCategoryCache,
        loadItems,
        handleToggle: async (id, done) => { await itemsActionsController.handleToggle(id, done); },
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
        setCategory: async categoryId => router.selectCategory(categoryId),
    });

    magicController = createMagicController({
        getUserPreferences,
        invalidateCategoryCache,
        loadCategories,
        loadItems,
        setCategory,
        setMessage,
        updateHeaders,
    });

    journalController.setToggleHandler(async (id, done) => {
        await itemsActionsController.handleToggle(id, done);
    });

    return {
        addItem: async event => { await itemsActionsController.addItem(event); },
        applyTabsVisibility,
        clearDone: async () => { await itemsActionsController.clearDone(); },
        closeScanner,
        closeSearch,
        doSearch,
        closeTodoEditor,
        editorController,
        flushOfflineQueue,
        handleIncomingShare: async () => { await itemsActionsController.handleIncomingShare(); },
        handleScannedBarcode,
        invalidateCategoryCache,
        loadCategories,
        loadItems,
        navigation,
        openScanner,
        openSearch,
        openJournalWithNavigation,
        prefetchAdjacentCategories,
        quickAdd: async (input, activeCategoryId) => { await itemsActionsController.quickAdd(input, activeCategoryId); },
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
        setUploadMode,
        setUserPreferences,
        swipeController,
        syncSettingsFrameTheme,
        tabsViewController,
        triggerUploadSelectedAttachment: async () => { await itemsActionsController.uploadSelectedAttachment(); },
        updateFilePickerLabel,
        updateHeaders,
        updateLayoutSwitcher,
        updateModeChip,
        updateUploadUi,
        getUploadMode,
        magicController,
    };
}