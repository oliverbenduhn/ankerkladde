import { api, normalizeItem, persistPreferences } from './api.js?v=4.2.66';
import { LOCAL_PREF_KEYS, state } from './state.js?v=4.2.66';
import { appEl, searchBar, searchBtn, searchInput } from './ui.js?v=4.2.66';

export function createItemsController(deps) {
    /**
     * @typedef {Object} ItemsControllerDeps
     * @property {function(boolean): void} applyTabsVisibility
     * @property {function(Object): void} applyThemePreferences
     * @property {function(): Promise<void>} closeNoteEditor
     * @property {function(): void} closeScanner
     * @property {function(): void} closeSettings
     * @property {function(): Object} getUserPreferences
     * @property {Object} navigation
     * @property {function(Object): Object} normalizePreferences
     * @property {function(): void} renderCategoryTabs
     * @property {function(): void} renderItems
     * @property {Object} scannerState
     * @property {function(string, boolean=): void} setMessage
     * @property {function(Object): void} setUserPreferences
     * @property {function(): void} updateHeaders
     * @property {function(number): void} updateUploadUi
     */

    /** @type {ItemsControllerDeps} */
    const {
        applyTabsVisibility,
        applyThemePreferences,
        closeNoteEditor,
        closeScanner,
        closeSettings,
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
    } = deps;

    function getItemById(id) {
        return state.items.find(item => item.id === Number(id)) || null;
    }

    function getVisibleCategories() {
        return state.categories.filter(category => Number(category.is_hidden) === 0);
    }

    function cloneItems(items) {
        return items.map(item => ({ ...item }));
    }

    function cacheCurrentCategoryItems() {
        if (!Number.isInteger(Number(state.categoryId))) return;
        state.itemsByCategoryId.set(Number(state.categoryId), {
            items: cloneItems(state.items),
            diskFreeBytes: state.diskFreeBytes,
        });
    }

    function invalidateCategoryCache(categoryId) {
        state.itemsByCategoryId.delete(Number(categoryId));
    }

    function cacheCategoryPayload(categoryId, payload) {
        const normalizedItems = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
        const diskFreeBytes = typeof payload.disk_free_bytes === 'number' ? payload.disk_free_bytes : null;
        state.itemsByCategoryId.set(Number(categoryId), {
            items: cloneItems(normalizedItems),
            diskFreeBytes,
        });
        return { items: normalizedItems, diskFreeBytes };
    }

    function applyCategoryPayload(categoryId, payload) {
        const normalized = cacheCategoryPayload(categoryId, payload);
        state.items = normalized.items;
        state.diskFreeBytes = normalized.diskFreeBytes;
    }

    async function loadCategories() {
        const payload = await api('categories_list');
        state.categories = Array.isArray(payload.categories) ? payload.categories.map(category => ({
            ...category,
            id: Number(category.id),
            sort_order: Number(category.sort_order),
            is_hidden: Number(category.is_hidden),
        })) : [];

        if (payload.preferences) {
            // Gerätespezifische Prefs nicht vom Server überschreiben.
            const currentPrefs = getUserPreferences();
            const serverPrefs = { ...payload.preferences };
            for (const key of LOCAL_PREF_KEYS) {
                serverPrefs[key] = currentPrefs[key];
            }
            const nextPreferences = normalizePreferences(serverPrefs);
            setUserPreferences(nextPreferences);
            applyThemePreferences(nextPreferences);
        }

        const userPreferences = getUserPreferences();
        const visibleCategories = getVisibleCategories();
        const preferredCategoryId = Number(userPreferences.last_category_id);
        const preferredVisible = visibleCategories.find(category => category.id === preferredCategoryId);

        state.categoryId = preferredVisible?.id || visibleCategories[0]?.id || state.categories[0]?.id || null;
        renderCategoryTabs();
        applyTabsVisibility(userPreferences.tabs_hidden);
    }

    async function savePreferences(patch) {
        await persistPreferences(patch, setUserPreferences, applyThemePreferences, getUserPreferences);
    }

    async function setCategory(categoryId) {
        if (scannerState.open) {
            closeScanner();
        }
        if (state.noteEditorId !== null) {
            await closeNoteEditor();
        }
        closeSettings();

        state.categoryId = Number(categoryId);
        renderCategoryTabs();
        updateHeaders();
        const loadPromise = loadItems();
        void savePreferences({ last_category_id: state.categoryId }).catch(() => {});
        await loadPromise;
        prefetchAdjacentCategories();
    }

    async function loadItems(categoryId = state.categoryId, options = {}) {
        const resolvedCategoryId = Number(categoryId);
        const useCache = options.useCache !== false;
        const category = state.categories.find(entry => entry.id === resolvedCategoryId) || null;
        if (!category) {
            state.items = [];
            state.diskFreeBytes = null;
            renderItems();
            return;
        }

        if (useCache) {
            const cached = state.itemsByCategoryId.get(resolvedCategoryId);
            if (cached) {
                state.items = cloneItems(cached.items);
                state.diskFreeBytes = cached.diskFreeBytes ?? null;
                renderItems();
                updateUploadUi();
                return;
            }
        }

        const payload = await api(`list&category_id=${encodeURIComponent(category.id)}`);

        if (resolvedCategoryId !== Number(state.categoryId)) {
            cacheCategoryPayload(resolvedCategoryId, payload);
            return;
        }

        applyCategoryPayload(resolvedCategoryId, payload);
        renderItems();
        updateUploadUi();
    }

    function prefetchAdjacentCategories() {
        const visibleCategories = getVisibleCategories();
        const currentIndex = visibleCategories.findIndex(category => category.id === state.categoryId);
        if (currentIndex === -1) return;

        [currentIndex - 1, currentIndex + 1]
            .map(index => visibleCategories[index]?.id ?? null)
            .filter(categoryId => categoryId !== null && !state.itemsByCategoryId.has(Number(categoryId)))
            .forEach(categoryId => {
                void loadItems(categoryId, { useCache: false }).catch(() => {});
            });
    }

    function getVisibleItems() {
        return [...state.items].sort((a, b) => {
            if (state.mode === 'einkaufen') {
                const doneDiff = a.done - b.done;
                if (doneDiff !== 0) return doneDiff;
            }
            if (b.is_pinned !== a.is_pinned) return b.is_pinned - a.is_pinned;
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
            return a.id - b.id;
        });
    }

    function openSearch() {
        state.search.open = true;
        appEl.classList.add('is-searching');
        searchBar?.removeAttribute('hidden');
        searchBtn?.classList.add('is-active');
        if (searchInput) {
            searchInput.value = state.search.query;
            searchInput.focus();
        }
        renderItems();
    }

    function closeSearch() {
        state.search = { open: false, query: '', results: [] };
        appEl.classList.remove('is-searching');
        searchBar?.setAttribute('hidden', '');
        searchBtn?.classList.remove('is-active');
        renderItems();
    }

    async function doSearch(query) {
        state.search.query = query;
        if (state.search.open) {
            navigation.replaceCurrentHistoryState({ screen: 'search', query: state.search.query });
        }

        if (query.trim().length < 2) {
            state.search.results = [];
            renderItems();
            return;
        }

        try {
            const payload = await api(`search&q=${encodeURIComponent(query.trim())}`);
            state.search.results = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
        } catch (error) {
            state.search.results = [];
            setMessage(error instanceof Error ? error.message : 'Suche fehlgeschlagen.', true);
        }

        renderItems();
    }

    return {
        cacheCurrentCategoryItems,
        doSearch,
        getItemById,
        getVisibleCategories,
        getVisibleItems,
        invalidateCategoryCache,
        loadCategories,
        loadItems,
        openSearch,
        closeSearch,
        prefetchAdjacentCategories,
        savePreferences,
        setCategory,
    };
}
