const QUEUE_KEY = 'ankerkladde-offline-queue';

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

export async function flushQueue(apiFn) {
    const queue = getQueue();
    if (queue.length === 0) return false;
    localStorage.removeItem(QUEUE_KEY);
    for (const { type, payload } of queue) {
        try {
            await apiFn(type, { method: 'POST', body: new URLSearchParams(payload) });
        } catch {
            // Still ignorieren
        }
    }
    return true;
}
