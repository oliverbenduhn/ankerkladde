import { normalizeSettingsTab } from './api.js?v=5.1.34';
import { state } from './state.js?v=5.1.34';

export function createNavigation({ applyRouteState, getCurrentRouteState }) {
    let appHistoryIndex = 0;
    let suppressHistorySync = false;

    function normalizeRouteState(route = {}) {
        const screen = ['list', 'settings', 'search', 'note', 'scanner', 'journal'].includes(route?.screen)
            ? route.screen
            : 'list';

        const base = {
            mode: route?.mode === 'view' ? 'view' : 'edit',
            layout: ['list', 'grid', 'kanban'].includes(route?.layout) ? route.layout : 'list',
        };

        if (screen === 'settings') {
            return { ...base, screen, tab: normalizeSettingsTab(route?.tab) };
        }
        if (screen === 'search') {
            return { ...base, screen, query: typeof route?.query === 'string' ? route.query : '' };
        }
        if (screen === 'journal') {
            const date = typeof route?.date === 'string' && (route.date === 'today' || /^\d{4}-\d{2}-\d{2}$/.test(route.date))
                ? route.date
                : null;
            const focus = route?.focus === 'editor' ? 'editor' : null;
            return { ...base, screen, date, focus };
        }
        if (screen === 'note') {
            const noteId = Number(route?.noteId);
            return {
                ...base, screen,
                noteId: Number.isInteger(noteId) && noteId > 0 ? noteId : null,
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }
        if (screen === 'scanner') {
            return {
                ...base, screen,
                action: route?.action === 'toggle' ? 'toggle' : 'add',
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }
        if (screen === 'list') {
            const categoryId = Number(route?.categoryId);
            const itemId = Number(route?.itemId);
            return {
                ...base,
                screen: 'list',
                categoryId: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null,
                itemId: Number.isInteger(itemId) && itemId > 0 ? itemId : null,
            };
        }
        return { ...base, screen };
    }

    function buildUrlForRoute(route) {
        const normalized = normalizeRouteState(route);
        const url = new URL(window.location.href);

        // Clear all route params (old and new)
        for (const key of ['view', 'screen', 'mode', 'layout', 'tab', 'note', 'item', 'scanner_action', 'q', 'category_id', 'date', 'focus']) {
            url.searchParams.delete(key);
        }

        // Only write non-default values
        if (normalized.screen !== 'list') {
            url.searchParams.set('screen', normalized.screen);
        }
        if (normalized.mode !== 'edit') {
            url.searchParams.set('mode', normalized.mode);
        }
        if (normalized.layout !== 'list') {
            url.searchParams.set('layout', normalized.layout);
        }

        // Screen-specific params
        if (normalized.screen === 'settings') {
            url.searchParams.set('tab', normalized.tab);
        } else if (normalized.screen === 'search') {
            if (normalized.query.trim() !== '') {
                url.searchParams.set('q', normalized.query);
            }
        } else if (normalized.screen === 'journal') {
            if (normalized.date) url.searchParams.set('date', normalized.date);
            if (normalized.focus) url.searchParams.set('focus', normalized.focus);
        } else if (normalized.screen === 'note' && normalized.noteId) {
            url.searchParams.set('note', String(normalized.noteId));
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
        } else if (normalized.screen === 'scanner') {
            url.searchParams.set('scanner_action', normalized.action);
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
        } else if (normalized.screen === 'list' && normalized.categoryId !== null) {
            url.searchParams.set('category_id', String(normalized.categoryId));
            if (normalized.itemId !== null) url.searchParams.set('item', String(normalized.itemId));
        }

        return `${url.pathname}${url.search}${url.hash}`;
    }

    function writeHistoryState(mode, route, index = appHistoryIndex) {
        const normalized = normalizeRouteState(route);
        const statePayload = {
            appManaged: true,
            appIndex: index,
            appRoute: normalized,
        };
        const url = buildUrlForRoute(normalized);

        if (mode === 'push') {
            history.pushState(statePayload, '', url);
        } else {
            history.replaceState(statePayload, '', url);
        }
    }

    function replaceCurrentHistoryState(route = getCurrentRouteState()) {
        if (suppressHistorySync) return;
        writeHistoryState('replace', route, appHistoryIndex);
    }

    function pushHistoryState(route) {
        if (suppressHistorySync) return;
        appHistoryIndex += 1;
        writeHistoryState('push', route, appHistoryIndex);
    }

    async function applyManagedRouteState(route) {
        const previousSuppression = suppressHistorySync;
        suppressHistorySync = true;
        try {
            await applyRouteState(route, normalizeRouteState);
        } finally {
            suppressHistorySync = previousSuppression;
        }
    }

    function navigateBackOrReplace(fallbackRoute = { screen: 'list' }) {
        if (appHistoryIndex > 0) {
            history.back();
            return;
        }

        void applyManagedRouteState(fallbackRoute).then(() => {
            replaceCurrentHistoryState(fallbackRoute);
        }).catch(() => {});
    }

    function readInitialRouteFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const categoryId = Number(params.get('category_id'));

        // ponytail: wenn history.state gesetzt ist (vom pushState), daraus den
        // Initial-Screen lesen — sonst springt die View beim Reload kurz auf
        // die Default-Liste, bevor JS die history.state nachzieht.
        let screen = params.get('screen') || params.get('view');
        let dateParam = params.get('date');
        let focusParam = params.get('focus');
        let tabParam = params.get('tab');
        let noteParam = Number(params.get('note'));
        let itemParam = Number(params.get('item'));
        let queryParam = params.get('q');
        let scannerActionParam = params.get('scanner_action');
        if (!screen && window.history.state && typeof window.history.state === 'object') {
            const stateful = window.history.state;
            if (typeof stateful.screen === 'string') screen = stateful.screen;
            if (typeof stateful.date === 'string') dateParam = stateful.date;
            if (typeof stateful.focus === 'string') focusParam = stateful.focus;
            if (typeof stateful.tab === 'string') tabParam = stateful.tab;
            if (Number.isInteger(stateful.noteId)) noteParam = stateful.noteId;
            if (Number.isInteger(stateful.itemId)) itemParam = stateful.itemId;
            if (typeof stateful.query === 'string') queryParam = stateful.query;
            if (typeof stateful.action === 'string') scannerActionParam = stateful.action;
            if (Number.isInteger(stateful.categoryId)) {
                params.set('category_id', String(stateful.categoryId));
            }
        }

        // Read mode and layout from URL
        const urlMode = params.get('mode');
        const urlLayout = params.get('layout');
        const mode = urlMode === 'view' ? 'view' : undefined;
        const layout = ['list', 'grid', 'kanban'].includes(urlLayout) ? urlLayout : undefined;

        const base = { mode, layout };

        // Legacy alias: old today URLs land in the journal today view.
        if (screen === 'today') {
            screen = 'journal';
        }

        if (screen === 'settings') {
            return normalizeRouteState({ ...base, screen: 'settings', tab: tabParam });
        }
        if (screen === 'search') {
            return normalizeRouteState({ ...base, screen: 'search', query: queryParam || '' });
        }
        if (screen === 'journal') {
            return normalizeRouteState({ ...base, screen: 'journal', date: dateParam, focus: focusParam });
        }
        if (screen === 'note') {
            return normalizeRouteState({
                ...base, screen: 'note',
                noteId: noteParam,
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }
        if (screen === 'scanner') {
            return normalizeRouteState({
                ...base, screen: 'scanner',
                action: scannerActionParam,
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }
        return normalizeRouteState({
            ...base,
            screen: 'list',
            categoryId: Number.isInteger(categoryId) ? categoryId : null,
            itemId: itemParam,
        });
    }

    async function handlePopState(event, setMessage) {
        const isManagedState = Boolean(event.state?.appManaged);
        appHistoryIndex = isManagedState && Number.isInteger(Number(event.state.appIndex))
            ? Number(event.state.appIndex)
            : 0;
        try {
            const route = isManagedState ? event.state.appRoute : { screen: 'list' };
            await applyManagedRouteState(route);
            if (!isManagedState) {
                replaceCurrentHistoryState(route);
            }
        } catch (error) {
            replaceCurrentHistoryState(getCurrentRouteState());
            setMessage(error instanceof Error ? error.message : 'Navigation konnte nicht wiederhergestellt werden.', true);
        }
    }

    return {
        handlePopState,
        navigateBackOrReplace,
        pushHistoryState,
        readInitialRouteFromUrl,
        replaceCurrentHistoryState,
    };
}