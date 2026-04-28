import { normalizeSettingsTab } from './api.js?v=4.3.1';

export function createNavigation({ applyRouteState, getCurrentRouteState }) {
    let appHistoryIndex = 0;
    let suppressHistorySync = false;

    function normalizeRouteState(route = {}) {
        const screen = ['list', 'settings', 'search', 'note', 'scanner'].includes(route?.screen)
            ? route.screen
            : 'list';

        if (screen === 'settings') {
            return {
                screen,
                tab: normalizeSettingsTab(route?.tab),
            };
        }

        if (screen === 'search') {
            return {
                screen,
                query: typeof route?.query === 'string' ? route.query : '',
            };
        }

        if (screen === 'note') {
            const noteId = Number(route?.noteId);
            return {
                screen,
                noteId: Number.isInteger(noteId) && noteId > 0 ? noteId : null,
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }

        if (screen === 'scanner') {
            return {
                screen,
                action: route?.action === 'toggle' ? 'toggle' : 'add',
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }

        return { screen: 'list' };
    }

    function buildUrlForRoute(route) {
        const normalized = normalizeRouteState(route);
        const url = new URL(window.location.href);

        url.searchParams.delete('view');
        url.searchParams.delete('tab');
        url.searchParams.delete('note');
        url.searchParams.delete('scanner_action');
        url.searchParams.delete('q');
        url.searchParams.delete('category_id');

        if (normalized.screen === 'settings') {
            url.searchParams.set('view', 'settings');
            url.searchParams.set('tab', normalized.tab);
        } else if (normalized.screen === 'search') {
            url.searchParams.set('view', 'search');
            if (normalized.query.trim() !== '') {
                url.searchParams.set('q', normalized.query);
            }
        } else if (normalized.screen === 'note' && normalized.noteId) {
            url.searchParams.set('view', 'note');
            url.searchParams.set('note', String(normalized.noteId));
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
        } else if (normalized.screen === 'scanner') {
            url.searchParams.set('view', 'scanner');
            url.searchParams.set('scanner_action', normalized.action);
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
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
        const view = params.get('view');
        const categoryId = Number(params.get('category_id'));

        if (view === 'settings') {
            return normalizeRouteState({ screen: 'settings', tab: params.get('tab') });
        }

        if (view === 'search') {
            return normalizeRouteState({ screen: 'search', query: params.get('q') || '' });
        }

        if (view === 'note') {
            return normalizeRouteState({
                screen: 'note',
                noteId: Number(params.get('note')),
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }

        if (view === 'scanner') {
            return normalizeRouteState({
                screen: 'scanner',
                action: params.get('scanner_action'),
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }

        return normalizeRouteState({ screen: 'list' });
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
