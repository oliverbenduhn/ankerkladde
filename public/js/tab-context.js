const TAB_ID_KEY = 'ankerkladde-tab-id';
const WINDOW_NAME_PREFIX = 'ankerkladde-tab:';

function createTabId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getTabId() {
    try {
        let tabId = sessionStorage.getItem(TAB_ID_KEY);
        const windowTabId = window.name.startsWith(WINDOW_NAME_PREFIX)
            ? window.name.slice(WINDOW_NAME_PREFIX.length)
            : '';
        // sessionStorage can be cloned by window.open(). window.name is tied
        // to the browsing context, so a missing/mismatching marker identifies
        // the copied tab and gives it its own namespace.
        if (!tabId || windowTabId !== tabId) {
            tabId = createTabId();
            sessionStorage.setItem(TAB_ID_KEY, tabId);
            window.name = `${WINDOW_NAME_PREFIX}${tabId}`;
        }
        return tabId;
    } catch {
        // Storage can be unavailable in hardened/private browser contexts.
        // The in-memory fallback still isolates this page for its lifetime.
        if (!getTabId.fallback) getTabId.fallback = createTabId();
        return getTabId.fallback;
    }
}
