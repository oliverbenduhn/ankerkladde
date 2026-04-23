import { LOCAL_PREF_KEYS, basePath, csrfToken, normalizePreferences, readLocalPrefs, saveLocalPrefs } from './state.js?v=4.2.52';

export function appUrl(path) {
    return new URL(path, `${window.location.origin}${basePath}`).toString();
}

export function settingsUrl(tab = 'app') {
    const resolvedTab = tab === 'extension' ? 'extension' : 'app';
    return appUrl(`settings.php?embed=1&tab=${encodeURIComponent(resolvedTab)}`);
}

export async function api(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const fetchOptions = { ...options };

    if (method !== 'GET') {
        fetchOptions.headers = {
            'X-CSRF-Token': csrfToken,
            ...(fetchOptions.headers || {}),
        };
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
        throw new Error('Offline oder Netzwerkfehler');
    }

    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = appUrl('login.php');
        throw new Error('Sitzung abgelaufen. Bitte neu anmelden.');
    }

    if (!response.ok) {
        throw new Error(payload.error || 'Unbekannter Fehler');
    }

    return payload;
}

export function apiUpload(action, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', appUrl(`api.php?action=${encodeURIComponent(action)}`));
        xhr.setRequestHeader('X-CSRF-Token', csrfToken);

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

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
                return;
            }

            reject(new Error(payload.error || 'Unbekannter Fehler'));
        });

        xhr.addEventListener('error', () => reject(new Error('Failed to fetch')));
        xhr.send(formData);
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

export async function persistPreferences(patch, setUserPreferences, applyThemePreferences) {
    // Gerätespezifische Prefs sofort in localStorage sichern
    const localPatch = Object.fromEntries(
        Object.entries(patch).filter(([k]) => LOCAL_PREF_KEYS.includes(k))
    );
    if (Object.keys(localPatch).length > 0) saveLocalPrefs(localPatch);

    const body = new URLSearchParams();
    Object.entries(patch).forEach(([key, value]) => {
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
