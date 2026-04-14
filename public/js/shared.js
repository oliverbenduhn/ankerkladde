import { api } from './api.js';
import { normalizePreferences } from './state.js';

export async function persistPreferences(patch, setUserPreferences, applyThemePreferences) {
    const body = new URLSearchParams();
    Object.entries(patch).forEach(([key, value]) => {
        body.set(key, String(value));
    });

    const payload = await api('preferences', { method: 'POST', body });
    if (payload.preferences) {
        const normalized = normalizePreferences(payload.preferences);
        setUserPreferences(normalized);
        applyThemePreferences(normalized);
    }
}
