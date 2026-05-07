import { t } from './i18n.js';
import { OFFLINE_QUEUE_ITEM_MAX_BYTES, OFFLINE_QUEUE_MAX_BYTES, sanitizeItemPayload } from './utils.js?v=4.3.11';

const QUEUE_KEY = 'ankerkladde-offline-queue';
const CONFLICTS_KEY = 'ankerkladde-offline-conflicts';
const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

function storageBytes(value) {
    return textEncoder ? textEncoder.encode(value).byteLength : value.length;
}

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

    const queue = getQueue();
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
