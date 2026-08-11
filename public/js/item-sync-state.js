import { getQueue, hasConflictFor } from './offline-queue.js';

// ponytail: Sync-Zustand pro Item (Spec AC #63). Kein eigener Datenspeicher
// fuer "offline"/"conflict" - wird direkt aus der bestehenden Offline-Queue
// und Konfliktliste abgeleitet, damit es nur eine Quelle der Wahrheit gibt.
const savingIds = new Set();

export function markItemSaving(id) {
    savingIds.add(String(id));
}

export function clearItemSaving(id) {
    savingIds.delete(String(id));
}

export function isItemSaving(id) {
    return savingIds.has(String(id));
}

function queueHasItem(id, queue) {
    const idStr = String(id);
    return queue.some(entry => String(entry?.payload?.id ?? '') === idStr);
}

// Reihenfolge spiegelt Prioritaet: ein laufender Schreibversuch ueberdeckt
// "offline vorgemerkt", ein Konflikt ist vorrangig vor unbestaetigten
// Aenderungen in der Queue.
export function getItemSyncState(id, { isDirty = false } = {}) {
    if (isItemSaving(id)) return 'saving';
    if (hasConflictFor(id)) return 'conflict';
    if (queueHasItem(id, getQueue())) return 'offline';
    if (isDirty) return 'dirty';
    return 'synced';
}
