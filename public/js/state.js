const csrfMeta = document.querySelector('meta[name="csrf-token"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing');
const appBasePathMeta = document.querySelector('meta[name="app-base-path"]');
const userPreferencesScript = document.getElementById('userPreferences');

export const basePath = appBasePathMeta?.content || '/';
export const csrfToken = csrfMeta.content;

export const TYPE_CONFIG = {
    list_quantity: { icon: 'einkauf', title: name => name, shoppingTitle: name => name, placeholder: 'Artikel...', quantityMode: 'text' },
    list_due_date: { icon: 'erledigt', title: name => name, shoppingTitle: name => name, placeholder: 'Aufgabe...', quantityMode: 'date' },
    notes: { icon: 'notizen', title: name => name, shoppingTitle: name => name, placeholder: 'Titel...', quantityMode: 'hidden' },
    images: { icon: 'bilder', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    files: { icon: 'dateien', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    links: { icon: 'links', title: name => name, shoppingTitle: name => name, placeholder: 'https://...', quantityMode: 'hidden' },
};

export const DEFAULT_PREFERENCES = {
    mode: 'liste',
    tabs_hidden: false,
    category_swipe_enabled: true,
    product_scanner_enabled: true,
    shopping_list_scanner_enabled: true,
    magic_button_enabled: true,
    last_category_id: null,
    install_banner_dismissed: false,
    theme_mode: 'auto',
    light_theme: 'hafenblau',
    dark_theme: 'nachtwache',
};

// Preferences, die gerätespezifisch in localStorage gespeichert werden
// und nicht zwischen Geräten/Tabs synchronisiert werden sollen.
export const LOCAL_PREF_KEYS = [
    'mode',
    'last_category_id',
    'tabs_hidden',
    'category_swipe_enabled',
    'install_banner_dismissed',
    'theme_mode',
    'light_theme',
    'dark_theme',
];
const LOCAL_PREFS_STORAGE_KEY = 'ankerkladde_local_prefs';

export function readLocalPrefs() {
    try {
        const raw = localStorage.getItem(LOCAL_PREFS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

export function saveLocalPrefs(patch) {
    try {
        const current = readLocalPrefs();
        const localPatch = Object.fromEntries(
            Object.entries(patch).filter(([key]) => LOCAL_PREF_KEYS.includes(key))
        );
        localStorage.setItem(LOCAL_PREFS_STORAGE_KEY, JSON.stringify({ ...current, ...localPatch }));
    } catch {}
}

export const THEME_MODE_ORDER = ['light', 'dark', 'auto'];
export const THEME_COLORS = (() => {
    const globalData = window.__ANKERKLADDE_THEME_DATA__;
    if (globalData && globalData.theme_colors) {
        return globalData.theme_colors;
    }
    return {
        parchment: '#f5f0eb',
        hafenblau: '#cfe0ec',
        nachtwache: '#162338',
        pier: '#0f1419',
    };
})();

export const themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const state = {
    categories: [],
    categoryId: null,
    items: [],
    itemsByCategoryId: new Map(),
    view: 'list',
    settingsTab: 'app',
    mode: 'liste',
    editingId: null,
    editDraft: { name: '', barcode: '', quantity: '', due_date: '', content: '' },
    search: { open: false, query: '', results: [] },
    noteEditorId: null,
    diskFreeBytes: null,
};

export const NOTE_SAVE_DEBOUNCE_MS = 800;
export const TAB_REORDER_LONG_PRESS_MS = 400;
export const CATEGORY_SWIPE_THRESHOLD_PX = 72;
export const SCANNER_COOLDOWN_MS = 1800;
export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export const scannerState = {
    open: false,
    action: 'add',
    stream: null,
    detector: null,
    controls: null,
    mode: 'native',
    rafId: 0,
    watchdogId: 0,
    processing: false,
    lastValue: '',
    lastHandledAt: 0,
};

export function readInitialPreferences() {
    let serverPrefs = {};
    if (userPreferencesScript) {
        try {
            serverPrefs = JSON.parse(userPreferencesScript.textContent || '{}');
        } catch {}
    }
    // Gerätespezifische Prefs aus localStorage haben Vorrang vor Server-Werten
    const localPrefs = readLocalPrefs();
    const merged = normalizePreferences({ ...serverPrefs, ...localPrefs });
    // Migration: beim ersten Aufruf Server-Werte einmalig in localStorage schreiben
    const toMigrate = {};
    for (const key of LOCAL_PREF_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(localPrefs, key)) {
            toMigrate[key] = merged[key];
        }
    }
    if (Object.keys(toMigrate).length > 0) saveLocalPrefs(toMigrate);
    return merged;
}

export function normalizePreferences(preferences) {
    const validThemes = getValidThemes();
    const rawLight = preferences?.light_theme === 'grauton' ? 'regenbogen' : preferences?.light_theme;

    return {
        mode: preferences?.mode === 'einkaufen' ? 'einkaufen' : 'liste',
        tabs_hidden: Boolean(preferences?.tabs_hidden),
        category_swipe_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'category_swipe_enabled') || Boolean(preferences?.category_swipe_enabled),
        product_scanner_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'product_scanner_enabled') || Boolean(preferences?.product_scanner_enabled),
        shopping_list_scanner_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'shopping_list_scanner_enabled') || Boolean(preferences?.shopping_list_scanner_enabled),
        magic_button_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'magic_button_enabled') || Boolean(preferences?.magic_button_enabled),
        last_category_id: Number.isInteger(Number(preferences?.last_category_id)) ? Number(preferences.last_category_id) : null,
        install_banner_dismissed: Boolean(preferences?.install_banner_dismissed),
        theme_mode: THEME_MODE_ORDER.includes(preferences?.theme_mode) ? preferences.theme_mode : 'auto',
        light_theme: validThemes.light.includes(rawLight) ? rawLight : 'hafenblau',
        dark_theme: validThemes.dark.includes(preferences?.dark_theme) ? preferences.dark_theme : 'nachtwache',
    };
}

function getValidThemes() {
    const globalData = window.__ANKERKLADDE_THEME_DATA__;
    if (globalData && globalData.valid_themes) {
        return globalData.valid_themes;
    }
    return { light: ['parchment', 'hafenblau'], dark: ['nachtwache', 'pier'] };
}

export function getCurrentCategory() {
    return state.categories.find(category => category.id === Number(state.categoryId)) || null;
}

export function getCurrentType() {
    return getCurrentCategory()?.type || 'list_quantity';
}

export function getTypeConfig(type = getCurrentType()) {
    return TYPE_CONFIG[type] || TYPE_CONFIG.list_quantity;
}

export function isAttachmentCategory(type = getCurrentType()) {
    return type === 'images' || type === 'files';
}

export function isNotesCategory(type = getCurrentType()) {
    return type === 'notes';
}

export function isBarcodeCategory(category = getCurrentCategory()) {
    return category?.type === 'list_quantity';
}

export function isScannerSupported() {
    return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

export function isIosWebKit() {
    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touchMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(userAgent) || touchMac;
}
