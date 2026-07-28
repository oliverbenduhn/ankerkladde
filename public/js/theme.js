import { api, persistPreferences } from './api.js';
import { THEME_COLORS, THEME_MODE_ORDER, themeMediaQuery } from './state.js';
import { brandMarkEls, svgIcon } from './ui.js';

function getValidThemes() {
    const globalData = window.__ANKERKLADDE_THEME_DATA__;
    if (globalData && globalData.valid_themes) {
        return globalData.valid_themes;
    }
    return { light: ['parchment', 'hafenblau'], dark: ['nachtwache', 'pier'] };
}

function updateBrandMarks(themeName) {
    brandMarkEls.forEach(image => {
        if (!(image instanceof HTMLImageElement)) return;
        const url = new URL(image.getAttribute('src') || '', window.location.href);
        if (!url.pathname.endsWith('/icon.php') && !url.pathname.endsWith('icon.php')) return;
        url.searchParams.set('theme', themeName);
        image.src = url.toString();
    });
}

function getThemeModeLabel(themeMode) {
    if (themeMode === 'light') return 'Hell';
    if (themeMode === 'dark') return 'Dunkel';
    return 'Auto';
}

export function applyThemePreferences(userPreferences) {
    const effectiveTheme = getEffectiveTheme(userPreferences);
    document.documentElement.dataset.theme = effectiveTheme;
    if (document.body) {
        document.body.dataset.theme = effectiveTheme;
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta && THEME_COLORS[effectiveTheme]) {
        themeColorMeta.setAttribute('content', THEME_COLORS[effectiveTheme]);
    }

    updateBrandMarks(effectiveTheme);
}

export function getEffectiveTheme(preferences) {
    const themeMode = preferences.theme_mode || 'auto';
    const prefersDark = Boolean(themeMediaQuery?.matches);
    const validThemes = getValidThemes();

    if (themeMode === 'light') return preferences.light_theme || validThemes.light[0] || 'hafenblau';
    if (themeMode === 'dark') return preferences.dark_theme || validThemes.dark[0] || 'nachtwache';
    return prefersDark
        ? (preferences.dark_theme || validThemes.dark[0] || 'nachtwache')
        : (preferences.light_theme || validThemes.light[0] || 'hafenblau');
}
