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
        const prefs = raw ? JSON.parse(raw) : {};
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new SyntaxError('Invalid preferences');
        return prefs;
    } catch (error) {
        console.warn('Local preferences unavailable:', error.name);
        if (error instanceof SyntaxError) {
            try { window.localStorage.removeItem(localPrefsStorageKey); }
            catch (storageError) { console.warn('Local preferences recovery unavailable:', storageError.name); }
        }
        return {};
    }
}

export function saveLocalPrefs(patch) {
    try {
        window.localStorage.setItem(localPrefsStorageKey, JSON.stringify({ ...readLocalPrefs(), ...patch }));
    } catch (error) {
        console.warn('Local preferences could not be saved:', error.name);
    }
}

export function postPreferencesUpdate(preferences) {
    if (!preferences || typeof preferences !== 'object') return;

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({
            type: 'ankerkladde-settings-preferences-update',
            preferences,
        }, window.location.origin);
        return;
    }

    window.dispatchEvent(new CustomEvent('ankerkladde-settings-preferences-update', { detail: preferences }));
}
