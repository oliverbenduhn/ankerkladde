const settingsDataEl = document.getElementById('settings-data');
export const settingsData = settingsDataEl ? JSON.parse(settingsDataEl.textContent) : {};

export const allThemeColors = settingsData.allThemeColors || {};
export const themePreferences = settingsData.themePreferences || {};
export const settingsStorageScope = settingsData.settingsStorageScope || '';

export const localPrefsStorageKey = 'ankerkladde_local_prefs';
export const scrollKey = 'einkauf-settings-scroll-y:' + settingsStorageScope;
export const panelsKey = 'einkauf-settings-open-panels:' + settingsStorageScope;
export const categoriesKey = 'einkauf-settings-open-categories:' + settingsStorageScope;
export const flashStorageKey = 'einkauf-settings-flash:' + settingsStorageScope;
export const openCategoryKey = 'einkauf-settings-open-category:' + scrollKey;

export function readLocalPrefs() {
    try {
        const raw = window.localStorage.getItem(localPrefsStorageKey);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        return {};
    }
}

export function saveLocalPrefs(patch) {
    try {
        window.localStorage.setItem(localPrefsStorageKey, JSON.stringify({ ...readLocalPrefs(), ...patch }));
    } catch (error) {}
}

export function postPreferencesUpdate(preferences) {
    if (!preferences || typeof preferences !== 'object' || !window.parent || window.parent === window) {
        return;
    }

    window.parent.postMessage({
        type: 'ankerkladde-settings-preferences-update',
        preferences,
    }, window.location.origin);
}
