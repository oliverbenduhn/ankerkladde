import { t } from './i18n.js';
import { userId } from './state.js';
import { OFFLINE_QUEUE_ITEM_MAX_BYTES, OFFLINE_QUEUE_MAX_BYTES, sanitizeItemPayload } from './utils.js';

// ponytail: Namespace nach unveraenderlicher Benutzer-ID, damit ein geteilter
// Browser (mehrere Konten) Offline-Queue/Konflikte nicht zwischen Konten
// mischt oder sichtbar macht (Spec AC #63).
const QUEUE_KEY = `ankerkladde-offline-queue:${userId}`;
const CONFLICTS_KEY = `ankerkladde-offline-conflicts:${userId}`;
const LEGACY_QUEUE_KEY = 'ankerkladde-offline-queue';
const LEGACY_CONFLICTS_KEY = 'ankerkladde-offline-conflicts';
const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

function storageBytes(value) {
    return textEncoder ? textEncoder.encode(value).byteLength : value.length;
}

// ponytail: einmalige Migration der alten, nicht namespaced Keys in den
// namespaced Key des aktuell eingeloggten Nutzers, damit bereits vorgemerkte
// Offline-Aenderungen beim Umstellen auf Nutzer-Namespacing nicht verloren
// gehen. Laeuft nur, solange der neue Key noch leer ist.
function migrateLegacyKey(legacyKey, namespacedKey) {
    if (localStorage.getItem(namespacedKey) !== null) return;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue === null) return;
    localStorage.setItem(namespacedKey, legacyValue);
    localStorage.removeItem(legacyKey);
}
migrateLegacyKey(LEGACY_QUEUE_KEY, QUEUE_KEY);
migrateLegacyKey(LEGACY_CONFLICTS_KEY, CONFLICTS_KEY);

export function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
        return [];
    }
}

export function enqueueAction(type, payload) {
    const sanitizedPayload = sanitizeItemPayload(payload);
    const item = { type, payload: sanitizedPayload };
    const itemJson = JSON.stringify(item);
    if (storageBytes(itemJson) > OFFLINE_QUEUE_ITEM_MAX_BYTES) {
        throw new Error(t('error.offline_too_large'));
    }

    let queue = getQueue();
    // AC #63: mehrere ungesendete Aenderungen derselben Konflikteinheit
    // (gleicher type + id) werden zum letzten Zielzustand zusammengefasst,
    // statt eine unnoetige Aktionshistorie zu wiederholen. "delete" bleibt
    // bewusst eine eigene Aktion und wird nie mit anderen Typen verschmolzen.
    if (type !== 'delete' && sanitizedPayload.id !== undefined) {
        queue = queue.filter(entry => !(entry.type === type && entry?.payload?.id === sanitizedPayload.id));
    }
    queue.push(item);
    const queueJson = JSON.stringify(queue);
    if (storageBytes(queueJson) > OFFLINE_QUEUE_MAX_BYTES) {
        throw new Error(t('error.offline_storage_full'));
    }
    localStorage.setItem(QUEUE_KEY, queueJson);
}

export function getPendingCount() {
    return getQueue().length;
}

export function getConflicts() {
    try {
        return JSON.parse(localStorage.getItem(CONFLICTS_KEY) || '[]');
    } catch {
        return [];
    }
}

export function getConflictCount() {
    return getConflicts().length;
}

function addConflict(type, payload, error) {
    const conflicts = getConflicts().slice(-49);
    conflicts.push({
        type,
        payload: sanitizeItemPayload(payload),
        status: Number(error?.status) || null,
        message: error instanceof Error ? error.message : 'Unbekannter Fehler',
        failedAt: new Date().toISOString(),
    });
    const conflictsJson = JSON.stringify(conflicts);
    if (storageBytes(conflictsJson) <= OFFLINE_QUEUE_MAX_BYTES) {
        localStorage.setItem(CONFLICTS_KEY, conflictsJson);
        window.dispatchEvent(new Event('ankerkladde-conflicts-updated'));
    }
}

export function setConflicts(conflicts) {
    localStorage.setItem(CONFLICTS_KEY, JSON.stringify(conflicts));
    window.dispatchEvent(new Event('ankerkladde-conflicts-updated'));
}

export function clearConflicts() {
    localStorage.removeItem(CONFLICTS_KEY);
    window.dispatchEvent(new Event('ankerkladde-conflicts-updated'));
}

export async function flushQueue(apiFn) {
    const queue = getQueue();
    if (queue.length === 0) return false;

    let flushedAny = false;
    const remainingQueue = [];
    let queueHalted = false;

    for (let index = 0; index < queue.length; index += 1) {
        const { type, payload } = queue[index];
        const sanitizedPayload = sanitizeItemPayload(payload);
        
        if (queueHalted) {
            remainingQueue.push({ type, payload: sanitizedPayload });
            continue;
        }

        try {
            await apiFn(type, { method: 'POST', body: new URLSearchParams(sanitizedPayload) });
            flushedAny = true;
        } catch (error) {
            if (error.isNetworkError || (error.status && error.status >= 500)) {
                // Keep this and all subsequent items in the queue
                remainingQueue.push({ type, payload: sanitizedPayload });
                queueHalted = true;
            } else {
                // 4xx/conflict: remove it from the retry queue, but keep the payload recoverable.
                addConflict(type, sanitizedPayload, error);
                console.warn('Offline queue item moved to conflicts due to client error:', error);
                flushedAny = true; // Queue changed
            }
        }
    }

    if (remainingQueue.length > 0) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    } else {
        localStorage.removeItem(QUEUE_KEY);
    }

    return flushedAny;
}
