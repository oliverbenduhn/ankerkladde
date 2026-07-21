import { normalizeSettingsTab, settingsUrl } from './api.js?v=5.1.24';
import { isBarcodeCategory, state } from './state.js?v=5.1.24';
import {
    appEl,
    journalViewEl,
    listSwipeStageEl,
    searchInput,
    settingsBtns,
    settingsEmbedEl,
    settingsFrameEl,
} from './ui.js?v=5.1.24';

export function applyViewState() {
    const inSettings = state.screen === 'settings';
    const inJournal = state.screen === 'journal';
    appEl?.classList.toggle('settings-view', inSettings);
    appEl?.classList.toggle('journal-view', inJournal);
    settingsBtns.forEach(button => button.classList.toggle('is-active', inSettings));
    if (settingsEmbedEl) {
        settingsEmbedEl.hidden = !inSettings;
    }
    if (journalViewEl) journalViewEl.hidden = !inJournal;
    if (listSwipeStageEl) listSwipeStageEl.hidden = inSettings || inJournal;
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
        openJournalDay,
        closeJournal,
        openScanner,
        openSearch,
        renderCategoryTabs,
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
        if (state.screen === 'journal') {
            await closeJournalScreen();
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

    function highlightItem(itemId) {
        window.requestAnimationFrame(() => {
            const item = document.querySelector(`.item-card[data-item-id="${Number(itemId)}"]`);
            if (!item) return;
            item.scrollIntoView({ block: 'center', behavior: 'smooth' });
            item.classList.add('is-deep-link-highlight');
            window.setTimeout(() => item.classList.remove('is-deep-link-highlight'), 1500);
        });
    }

    async function openSourceItem(categoryId, itemId) {
        if (state.screen === 'journal') await closeJournalScreen();
        await setCategory(categoryId);
        highlightItem(itemId);
    }

    async function selectCategory(categoryId) {
        const category = state.categories.find(entry => Number(entry.id) === Number(categoryId));
        if (category?.type === 'daily_notes') {
            const date = state.serverToday || 'today';
            await openJournal(date);
            deps.pushHistoryState?.({ screen: 'journal', date, focus: null });
            return;
        }
        const fromJournal = state.screen === 'journal';
        if (fromJournal) await closeJournalScreen();
        await setCategory(categoryId);
        if (fromJournal) {
            deps.pushHistoryState?.({ screen: 'list', categoryId });
        }
    }

    function closeSettings() {
        if (state.screen !== 'settings') return;
        state.screen = 'list';
        applyViewState();
        updateHeaders();
    }

    async function openJournal(date, focus = null) {
        if (deps.scannerState.open) closeScanner();
        if (state.noteEditorId !== null) await closeNoteEditor();
        if (state.search.open) closeSearch();
        if (state.screen === 'settings') closeSettings();
        if (typeof closeMagic === 'function') closeMagic();
        await openJournalDay(date, { focus: focus === 'editor' });
        applyViewState();
        updateHeaders();
    }

    async function closeJournalScreen() {
        if (state.screen !== 'journal') return;
        await closeJournal();
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
        if (state.screen === 'journal') {
            return { ...base, screen: 'journal', date: state.journalDate };
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
        if (state.screen === 'journal' && target.screen !== 'journal') {
            await closeJournalScreen();
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
        if (target.screen === 'journal') {
            await openJournal(target.date, target.focus);
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
            return;
        }
        if (target.screen === 'list' && target.categoryId !== null) {
            await setCategory(target.categoryId);
            if (target.itemId !== null) highlightItem(target.itemId);
        }
    }

    return {
        applyRouteState,
        closeSettings,
        closeJournalScreen,
        getCurrentRouteState,
        openJournal,
        openSettings,
        openSourceItem,
        selectCategory,
    };
}