import { LOCAL_PREF_KEYS, basePath, csrfToken, normalizePreferences, readLocalPrefs, saveLocalPrefs } from './state.js';

export const SETTINGS_TABS = ['app', 'appearance', 'features', 'categories', 'new-category', 'ai', 'extension', 'password', 'system'];

export function normalizeSettingsTab(tab = 'app') {
    return SETTINGS_TABS.includes(tab) ? tab : 'app';
}

export function appUrl(path) {
    return new URL(path, `${window.location.origin}${basePath}`).toString();
}

export function settingsUrl(tab = 'app') {
    const resolvedTab = normalizeSettingsTab(tab);
    return appUrl(`settings.php?fragment=1&tab=${encodeURIComponent(resolvedTab)}`);
}

// Eine Request-ID bezeichnet eine lokale Aktion, nicht deren Payload: zwei
// Tabs duerfen fuer denselben Zielzustand nie versehentlich dieselbe ID teilen.
export async function buildIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function api(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const fetchOptions = { ...options };
    if (method === 'GET' && !fetchOptions.cache) {
        fetchOptions.cache = 'no-store';
    }

    const headers = { ...(fetchOptions.headers || {}) };
    if (method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
        if (csrfToken) {
            const explicit = typeof options.idempotencyKey === 'string' ? options.idempotencyKey : '';
            if (explicit !== '') {
                headers['X-Idempotency-Key'] = explicit;
            } else if (!('idempotencyKey' in options) || options.idempotencyKey !== null) {
                const derived = await buildIdempotencyKey(action, requestPayloadForHash(fetchOptions.body));
                headers['X-Idempotency-Key'] = derived;
            }
        }
    }
    if (Object.keys(headers).length > 0) {
        fetchOptions.headers = headers;
    }

    const [actionName, ...queryParts] = action.split('&');
    const url = method === 'GET'
        ? appUrl(`api.php?action=${encodeURIComponent(actionName)}${queryParts.length > 0 ? `&${queryParts.join('&')}` : ''}`)
        : appUrl(`api.php?action=${encodeURIComponent(actionName)}`);

    let response;
    try {
        response = await fetch(url, fetchOptions);
    } catch (error) {
        // Network error - could be offline or actual network failure
        const networkError = new Error('Offline oder Netzwerkfehler');
        networkError.isNetworkError = true;
        networkError.idempotencyKey = headers['X-Idempotency-Key'] || '';
        throw networkError;
    }

    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = appUrl('login.php');
        throw new Error('Sitzung abgelaufen. Bitte neu anmelden.');
    }

    if (!response.ok) {
        const error = new Error(payload.error || 'Unbekannter Fehler');
        error.status = response.status;
        error.payload = payload;
        error.errorKey = payload.error_key || '';
        error.idempotencyKey = headers['X-Idempotency-Key'] || '';
        throw error;
    }

    return payload;
}

function requestPayloadForHash(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch {
            const params = new URLSearchParams(body);
            const data = {};
            for (const [key, value] of params.entries()) data[key] = value;
            return data;
        }
    }
    if (body instanceof URLSearchParams) {
        const data = {};
        for (const [key, value] of body.entries()) data[key] = value;
        return data;
    }
    if (body instanceof FormData) {
        const data = {};
        for (const [key, value] of body.entries()) {
            if (value && typeof value === 'object' && 'name' in value) continue;
            data[key] = value;
        }
        return data;
    }
    if (typeof body === 'object') return body;
    return {};
}

export function apiUpload(action, formData, onProgress, options = {}) {
    return new Promise((resolve, reject) => {
        const run = (idempotencyKey) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', appUrl(`api.php?action=${encodeURIComponent(action)}`));
            xhr.setRequestHeader('X-CSRF-Token', csrfToken);
            if (idempotencyKey) {
                xhr.setRequestHeader('X-Idempotency-Key', idempotencyKey);
            }

            if (typeof onProgress === 'function') {
                xhr.upload.addEventListener('progress', event => {
                    if (event.lengthComputable) {
                        onProgress(event.loaded / event.total);
                    }
                });
            }

            xhr.addEventListener('load', () => {
                let payload = {};
                try {
                    payload = JSON.parse(xhr.responseText);
                } catch {}

                if (xhr.status === 401) {
                    window.location.href = appUrl('login.php');
                    reject(new Error('Sitzung abgelaufen. Bitte neu anmelden.'));
                    return;
                }

                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(payload);
                    return;
                }

                const error = new Error(payload.error || 'Unbekannter Fehler');
                error.status = xhr.status;
                error.payload = payload;
                error.errorKey = payload.error_key || '';
                error.idempotencyKey = idempotencyKey || '';
                reject(error);
            });

            xhr.addEventListener('error', () => {
                const error = new Error('Offline oder Netzwerkfehler');
                error.isNetworkError = true;
                error.idempotencyKey = idempotencyKey || '';
                reject(error);
            });
            xhr.send(formData);
        };

        if (!csrfToken) {
            run('');
            return;
        }

        const explicit = typeof options.idempotencyKey === 'string' ? options.idempotencyKey : '';
        if (explicit !== '') {
            run(explicit);
            return;
        }
        buildIdempotencyKey()
            .then(run)
            .catch(() => run(''));
    });
}

export function normalizeItem(item) {
    return {
        ...item,
        id: Number(item.id),
        category_id: Number(item.category_id),
        barcode: item.barcode || '',
        done: Number(item.done),
        sort_order: Number(item.sort_order),
        is_pinned: Number(item.is_pinned || 0),
        has_attachment: Number(item.has_attachment || 0),
        attachmentSizeBytes: Number(item.attachment_size_bytes || 0),
        attachmentOriginalName: item.attachment_original_name || '',
        attachmentMediaType: item.attachment_media_type || '',
        attachmentUrl: item.attachment_url || '',
        attachmentPreviewUrl: item.attachment_preview_url || '',
        attachmentOriginalUrl: item.attachment_original_url || '',
        attachmentDownloadUrl: item.attachment_download_url || '',
    };
}

export async function fetchLinkMetadata(url) {
    try {
        const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

export async function persistPreferences(patch, setUserPreferences, applyThemePreferences, getUserPreferences = () => ({})) {
    // Gerätespezifische Prefs sofort in localStorage sichern
    const localPatch = Object.fromEntries(
        Object.entries(patch).filter(([k]) => LOCAL_PREF_KEYS.includes(k))
    );
    if (Object.keys(localPatch).length > 0) saveLocalPrefs(localPatch);

    const serverPatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !LOCAL_PREF_KEYS.includes(key))
    );
    if (Object.keys(serverPatch).length === 0) {
        const normalized = normalizePreferences({ ...getUserPreferences(), ...readLocalPrefs() });
        setUserPreferences(normalized);
        applyThemePreferences(normalized);
        return;
    }

    const body = new URLSearchParams();
    Object.entries(serverPatch).forEach(([key, value]) => {
        body.set(key, String(value));
    });

    const payload = await api('preferences', { method: 'POST', body });
    if (payload.preferences) {
        // Server-Antwort mit localStorage-Werten mergen: lokale Prefs nie vom Server überschreiben
        const normalized = normalizePreferences({ ...payload.preferences, ...readLocalPrefs() });
        setUserPreferences(normalized);
        applyThemePreferences(normalized);
    }
}
