const QUEUE_KEY = 'ankerkladde-offline-queue';
const CONFLICTS_KEY = 'ankerkladde-offline-conflicts';

export function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
        return [];
    }
}

export function enqueueAction(type, payload) {
    const queue = getQueue();
    queue.push({ type, payload });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
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
    const conflicts = getConflicts();
    conflicts.push({
        type,
        payload,
        status: Number(error?.status) || null,
        message: error instanceof Error ? error.message : 'Unbekannter Fehler',
        failedAt: new Date().toISOString(),
    });
    localStorage.setItem(CONFLICTS_KEY, JSON.stringify(conflicts));
}

export async function flushQueue(apiFn) {
    const queue = getQueue();
    if (queue.length === 0) return false;

    let flushedAny = false;
    const remainingQueue = [];
    let queueHalted = false;

    for (let index = 0; index < queue.length; index += 1) {
        const { type, payload } = queue[index];
        
        if (queueHalted) {
            remainingQueue.push({ type, payload });
            continue;
        }

        try {
            await apiFn(type, { method: 'POST', body: new URLSearchParams(payload) });
            flushedAny = true;
        } catch (error) {
            if (error.isNetworkError || (error.status && error.status >= 500)) {
                // Keep this and all subsequent items in the queue
                remainingQueue.push({ type, payload });
                queueHalted = true;
            } else {
                // 4xx/conflict: remove it from the retry queue, but keep the payload recoverable.
                addConflict(type, payload, error);
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
