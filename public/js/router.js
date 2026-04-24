import { settingsUrl } from './api.js?v=4.2.64';
import { state } from './state.js?v=4.2.64';
import { appEl, searchInput, settingsBtns, settingsEmbedEl, settingsFrameEl } from './ui.js?v=4.2.64';

export function applyViewState() {
    const inSettings = state.view === 'settings';
    appEl?.classList.toggle('settings-view', inSettings);
    settingsBtns.forEach(button => button.classList.toggle('is-active', inSettings));
    if (settingsEmbedEl) {
        settingsEmbedEl.hidden = !inSettings;
    }
}

export function createRouter(deps) {
    const {
        closeNoteEditor,
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

        state.view = 'settings';
        state.settingsTab = tab === 'extension' ? 'extension' : 'app';
        applyViewState();
        updateHeaders();

        const nextSrc = settingsUrl(state.settingsTab);
        if (settingsFrameEl && settingsFrameEl.getAttribute('src') !== nextSrc) {
            settingsFrameEl.setAttribute('src', nextSrc);
        }
    }

    function closeSettings() {
        if (state.view !== 'settings') return;
        state.view = 'list';
        applyViewState();
        updateHeaders();
    }

    function getCurrentRouteState() {
        if (deps.scannerState.open) {
            return {
                screen: 'scanner',
                action: deps.scannerState.action,
                categoryId: state.categoryId,
            };
        }
        if (state.noteEditorId !== null) {
            return {
                screen: 'note',
                noteId: state.noteEditorId,
                categoryId: state.categoryId,
            };
        }
        if (state.view === 'settings') {
            return {
                screen: 'settings',
                tab: state.settingsTab,
            };
        }
        if (state.search.open) {
            return {
                screen: 'search',
                query: state.search.query,
            };
        }
        return { screen: 'list' };
    }

    async function applyRouteState(route, normalizeRouteState) {
        const target = normalizeRouteState(route);

        if (deps.scannerState.open && target.screen !== 'scanner') {
            closeScanner();
        }
        if (state.noteEditorId !== null && target.screen !== 'note') {
            await closeNoteEditor();
        }
        if (state.search.open && target.screen !== 'search') {
            closeSearch();
        }
        if (state.view === 'settings' && target.screen !== 'settings') {
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
