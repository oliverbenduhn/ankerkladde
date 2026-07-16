import { normalizeSettingsTab, settingsUrl } from './api.js?v=5.1.5';
import { isBarcodeCategory, state } from './state.js?v=5.1.5';
import { appEl, searchInput, settingsBtns, settingsEmbedEl, settingsFrameEl } from './ui.js?v=5.1.5';

export function applyViewState() {
    const inSettings = state.screen === 'settings';
    appEl?.classList.toggle('settings-view', inSettings);
    settingsBtns.forEach(button => button.classList.toggle('is-active', inSettings));
    if (settingsEmbedEl) {
        settingsEmbedEl.hidden = !inSettings;
    }
}

export function createRouter(deps) {
    const {
        closeNoteEditor,
        closeMagic,
        closeScanner,
        closeSearch,
        doSearch,
        getItemById,
        openNoteEditor,
        openScanner,
        openSearch,
        setCategory,
        updateHeaders,
    } = deps;

    async function openSettings(tab = 'app') {
        if (deps.scannerState.open) {
            closeScanner();
        }
        if (state.noteEditorId !== null) {
            await closeNoteEditor();
        }
        if (state.search.open) {
            closeSearch();
        }
        if (typeof closeMagic === 'function') {
            closeMagic();
        }

        state.screen = 'settings';
        state.settingsTab = normalizeSettingsTab(tab);
        applyViewState();
        updateHeaders();

        const nextSrc = settingsUrl(state.settingsTab);
        if (settingsFrameEl && settingsFrameEl.getAttribute('src') !== nextSrc) {
            settingsFrameEl.setAttribute('src', nextSrc);
        }
    }

    function closeSettings() {
        if (state.screen !== 'settings') return;
        state.screen = 'list';
        applyViewState();
        updateHeaders();
    }

    function switchToListMode() {
        state.mode = 'edit';
        if (appEl) {
            appEl.dataset.mode = state.mode;
        }
    }

    async function switchToScannerCategory() {
        if (isBarcodeCategory()) {
            return true;
        }

        const category = state.categories.find(entry => Number(entry.is_hidden) === 0 && isBarcodeCategory(entry))
            || state.categories.find(entry => isBarcodeCategory(entry))
            || null;
        if (!category) {
            return false;
        }

        await setCategory(category.id);
        return true;
    }

    function getCurrentRouteState() {
        const base = { mode: state.mode, layout: state.layout };

        if (deps.scannerState.open) {
            return { ...base, screen: 'scanner', action: deps.scannerState.action, categoryId: state.categoryId };
        }
        if (state.noteEditorId !== null) {
            return { ...base, screen: 'note', noteId: state.noteEditorId, categoryId: state.categoryId };
        }
        if (state.screen === 'settings') {
            return { ...base, screen: 'settings', tab: state.settingsTab };
        }
        if (state.search.open) {
            return { ...base, screen: 'search', query: state.search.query };
        }
        return { ...base, screen: 'list' };
    }

    async function applyRouteState(route, normalizeRouteState) {
        const target = normalizeRouteState(route);

        // Apply mode and layout from route
        if (target.mode && target.mode !== state.mode) {
            state.mode = target.mode;
            if (appEl) appEl.dataset.mode = state.mode;
        }
        if (target.layout && target.layout !== state.layout) {
            state.layout = target.layout;
            if (appEl) appEl.dataset.layout = state.layout;
        }

        if (deps.scannerState.open && target.screen !== 'scanner') {
            closeScanner();
        }
        if (state.noteEditorId !== null && target.screen !== 'note') {
            await closeNoteEditor();
        }
        if (state.search.open && target.screen !== 'search') {
            closeSearch();
        }
        if (state.screen === 'settings' && target.screen !== 'settings') {
            closeSettings();
        }

        if (target.screen === 'settings') {
            await openSettings(target.tab);
            return;
        }
        if (target.screen === 'search') {
            openSearch();
            if (searchInput) {
                searchInput.value = target.query;
            }
            await doSearch(target.query);
            return;
        }
        if (target.screen === 'note') {
            if (target.categoryId !== null && Number(target.categoryId) !== Number(state.categoryId)) {
                await setCategory(target.categoryId);
            }
            const item = getItemById(target.noteId);
            if (item) {
                await openNoteEditor(item);
            }
            return;
        }
        if (target.screen === 'scanner') {
            if (target.categoryId !== null && Number(target.categoryId) !== Number(state.categoryId)) {
                await setCategory(target.categoryId);
            }
            await switchToScannerCategory();
            await openScanner(target.action);
        }
    }

    return {
        applyRouteState,
        closeSettings,
        getCurrentRouteState,
        openSettings,
    };
}
