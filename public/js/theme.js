import { api, persistPreferences } from './api.js';
import { THEME_COLORS, THEME_MODE_ORDER, themeMediaQuery } from './state.js';
import { brandMarkEls, svgIcon, themeModeBtns } from './ui.js';

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
    updateThemeModeButtons(userPreferences);
}

export async function cycleThemeMode(userPreferences, setUserPreferences, setMessage) {
    const currentMode = userPreferences.theme_mode || 'auto';
    const nextMode = THEME_MODE_ORDER[(THEME_MODE_ORDER.indexOf(currentMode) + 1) % THEME_MODE_ORDER.length];

    const nextPreferences = { ...userPreferences, theme_mode: nextMode };
    setUserPreferences(nextPreferences);
    applyThemePreferences(nextPreferences);

    try {
        await persistPreferences({ theme_mode: nextMode }, setUserPreferences, applyThemePreferences);
    } catch (error) {
        setUserPreferences(userPreferences);
        applyThemePreferences(userPreferences);
        setMessage(error instanceof Error ? error.message : 'Farbschema konnte nicht gespeichert werden.', true);
    }
}

export function getEffectiveTheme(preferences) {
    const themeMode = preferences.theme_mode || 'auto';
    const prefersDark = Boolean(themeMediaQuery?.matches);

    if (themeMode === 'light') return preferences.light_theme || 'hafenblau';
    if (themeMode === 'dark') return preferences.dark_theme || 'nachtwache';
    return prefersDark ? (preferences.dark_theme || 'nachtwache') : (preferences.light_theme || 'hafenblau');
}

export function updateThemeModeButtons(userPreferences) {
    const themeMode = userPreferences.theme_mode || 'auto';
    const iconName = themeMode === 'dark' ? 'theme-dark' : themeMode === 'light' ? 'theme-light' : 'theme-auto';
    const label = getThemeModeLabel(themeMode);

    themeModeBtns.forEach(button => {
        button.replaceChildren(svgIcon(iconName));
        button.setAttribute('aria-label', `Farbschema: ${label}. Umschalten`);
        button.title = `Farbschema: ${label}`;
    });
}
