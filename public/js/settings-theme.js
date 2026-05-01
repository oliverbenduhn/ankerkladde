import {
    allThemeColors,
    themePreferences,
    readLocalPrefs,
    saveLocalPrefs,
    postPreferencesUpdate
} from './settings-state.js?v=4.3.11';

const themeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getLocalThemePreferences() {
    const localPrefs = readLocalPrefs();
    return {
        theme_mode: typeof localPrefs.theme_mode === 'string' ? localPrefs.theme_mode : themePreferences.theme_mode,
        light_theme: typeof localPrefs.light_theme === 'string' ? localPrefs.light_theme : themePreferences.light_theme,
        dark_theme: typeof localPrefs.dark_theme === 'string' ? localPrefs.dark_theme : themePreferences.dark_theme,
    };
}

export function applyThemePreferencePatch(patch) {
    themePreferences.theme_mode = patch.theme_mode || themePreferences.theme_mode || 'auto';
    themePreferences.light_theme = patch.light_theme || themePreferences.light_theme || 'hafenblau';
    themePreferences.dark_theme = patch.dark_theme || themePreferences.dark_theme || 'nachtwache';
}

export function syncThemeFormControls() {
    const themeForm = document.querySelector('form[data-theme-form="1"]');
    if (!(themeForm instanceof HTMLFormElement)) return;

    const findInput = (name, value) => Array.from(themeForm.querySelectorAll(`input[name="${name}"]`))
        .find(input => input instanceof HTMLInputElement && input.value === value);
    const themeMode = findInput('theme_mode', themePreferences.theme_mode || 'auto');
    const lightTheme = findInput('light_theme', themePreferences.light_theme || 'hafenblau');
    const darkTheme = findInput('dark_theme', themePreferences.dark_theme || 'nachtwache');

    if (themeMode instanceof HTMLInputElement) themeMode.checked = true;
    if (lightTheme instanceof HTMLInputElement) lightTheme.checked = true;
    if (darkTheme instanceof HTMLInputElement) darkTheme.checked = true;
}

export function getEffectiveTheme() {
    const mode = themePreferences.theme_mode === 'dark'
        ? 'dark'
        : (themePreferences.theme_mode === 'light' ? 'light' : 'auto');
    const prefersDark = Boolean(themeMediaQuery?.matches);

    if (mode === 'dark') {
        return themePreferences.dark_theme || 'nachtwache';
    }

    if (mode === 'light') {
        return themePreferences.light_theme || 'hafenblau';
    }

    return prefersDark
        ? (themePreferences.dark_theme || 'nachtwache')
        : (themePreferences.light_theme || 'hafenblau');
}

export function updateAutoModeDot() {
    const dot = document.querySelector('.theme-mode-dot-auto');
    if (!dot) return;
    const lightColor = allThemeColors[themePreferences.light_theme] || '#cfe0ec';
    const darkColor  = allThemeColors[themePreferences.dark_theme]  || '#162338';
    dot.style.background = `conic-gradient(${lightColor} 0deg 180deg, ${darkColor} 180deg 360deg)`;
}

export function applySettingsTheme() {
    const theme = getEffectiveTheme();
    document.documentElement.dataset.theme = theme;
    if (document.body) {
        document.body.dataset.theme = theme;
    }

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta && themePreferences.theme_colors?.[theme]) {
        themeColorMeta.setAttribute('content', themePreferences.theme_colors[theme]);
    }

    document.querySelectorAll('img.brand-mark').forEach(image => {
        try {
            const url = new URL(image.src, window.location.href);
            url.searchParams.set('theme', theme);
            image.src = url.toString();
        } catch (error) {}
    });

    updateAutoModeDot();
}

export function initThemeHandling() {
    applyThemePreferencePatch(getLocalThemePreferences());
    applySettingsTheme();
    syncThemeFormControls();

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin) return;
        if (window.parent && event.source !== window.parent) return;
        if (event.data?.type !== 'ankerkladde-theme-update') return;

        const nextPreferences = event.data?.preferences;
        if (!nextPreferences || typeof nextPreferences !== 'object') return;

        applyThemePreferencePatch(nextPreferences);
        saveLocalPrefs({
            theme_mode: themePreferences.theme_mode,
            light_theme: themePreferences.light_theme,
            dark_theme: themePreferences.dark_theme,
        });
        syncThemeFormControls();
        applySettingsTheme();
    });

    if (themeMediaQuery) {
        const onThemeChange = () => {
            if (themePreferences.theme_mode === 'auto') {
                applySettingsTheme();
            }
        };

        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', onThemeChange);
        } else if (typeof themeMediaQuery.addListener === 'function') {
            themeMediaQuery.addListener(onThemeChange);
        }
    }
}
