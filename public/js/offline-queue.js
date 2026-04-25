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
                // 4xx error - drop it and continue with the next
                console.warn('Dropping offline queue item due to client error:', error);
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
