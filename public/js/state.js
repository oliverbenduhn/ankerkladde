import { userPreferencesScript } from './ui.js';

export const TYPE_CONFIG = {
    list_quantity: { icon: '🛒', title: name => name, shoppingTitle: name => name, placeholder: 'Artikel...', quantityMode: 'text' },
    list_due_date: { icon: '✅', title: name => name, shoppingTitle: name => name, placeholder: 'Aufgabe...', quantityMode: 'date' },
    notes: { icon: '📝', title: name => name, shoppingTitle: name => name, placeholder: 'Titel...', quantityMode: 'hidden' },
    images: { icon: '🖼️', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    files: { icon: '📁', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    links: { icon: '🔗', title: name => name, shoppingTitle: name => name, placeholder: 'https://...', quantityMode: 'hidden' },
};

export const DEFAULT_PREFERENCES = {
    mode: 'liste',
    tabs_hidden: false,
    category_swipe_enabled: true,
    last_category_id: null,
    install_banner_dismissed: false,
    theme_mode: 'auto',
    light_theme: 'hafenblau',
    dark_theme: 'nachtwache',
};

export const THEME_MODE_ORDER = ['light', 'dark', 'auto'];
export const THEME_COLORS = {
    parchment: '#f5f0eb',
    hafenblau: '#cfe0ec',
    nachtwache: '#162338',
    pier: '#0f1419',
};

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

const csrfMeta = document.querySelector('meta[name="csrf-token"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing');
const appBasePathMeta = document.querySelector('meta[name="app-base-path"]');

export const basePath = appBasePathMeta?.content || '/';

export function readInitialPreferences() {
    if (!userPreferencesScript) {
        return { ...DEFAULT_PREFERENCES };
    }

    try {
        return normalizePreferences(JSON.parse(userPreferencesScript.textContent || '{}'));
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

export function normalizePreferences(preferences) {
    return {
        mode: preferences?.mode === 'einkaufen' ? 'einkaufen' : 'liste',
        tabs_hidden: Boolean(preferences?.tabs_hidden),
        category_swipe_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'category_swipe_enabled') || Boolean(preferences?.category_swipe_enabled),
        last_category_id: Number.isInteger(Number(preferences?.last_category_id)) ? Number(preferences.last_category_id) : null,
        install_banner_dismissed: Boolean(preferences?.install_banner_dismissed),
        theme_mode: THEME_MODE_ORDER.includes(preferences?.theme_mode) ? preferences.theme_mode : 'auto',
        light_theme: ['parchment', 'hafenblau'].includes(preferences?.light_theme) ? preferences.light_theme : 'hafenblau',
        dark_theme: ['nachtwache', 'pier'].includes(preferences?.dark_theme) ? preferences.dark_theme : 'nachtwache',
    };
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
