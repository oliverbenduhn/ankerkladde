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

    let flushedAny = false;
    for (let index = 0; index < queue.length; index += 1) {
        const { type, payload } = queue[index];
        try {
            await apiFn(type, { method: 'POST', body: new URLSearchParams(payload) });
            flushedAny = true;
        } catch {
            const remaining = queue.slice(index);
            localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
            return false;
        }
    }

    localStorage.removeItem(QUEUE_KEY);
    return flushedAny;
}
