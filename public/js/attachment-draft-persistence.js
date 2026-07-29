import { userId } from './state.js';
import { getTabId } from './tab-context.js';

const DB_NAME = 'ankerkladde-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'attachment-replacements';
const tabPrefix = `${userId}:${getTabId()}:`;

function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function recordKey(itemId) {
    return `${tabPrefix}${Number(itemId)}`;
}

async function withStore(mode, operation) {
    const database = await openDatabase();
    if (!database) return null;
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
    });
}

export async function loadAttachmentReplacementDrafts() {
    try {
        const records = await withStore('readonly', store => store.getAll());
        return (Array.isArray(records) ? records : [])
            .filter(record => typeof record?.key === 'string' && record.key.startsWith(tabPrefix));
    } catch {
        return [];
    }
}

export async function saveAttachmentReplacementDraft(itemId, draft) {
    if (!(draft?.file instanceof File)) return;
    try {
        await withStore('readwrite', store => store.put({
            key: recordKey(itemId),
            itemId: Number(itemId),
            file: draft.file,
            requestId: draft.requestId || '',
            conflictItem: draft.conflictItem || null,
            baseRevision: Number(draft.baseRevision) || 0,
            baseAttachment: draft.baseAttachment || null,
        }));
    } catch {
        // The in-memory draft remains usable when IndexedDB is unavailable/full.
    }
}

export async function clearAttachmentReplacementDraft(itemId) {
    try {
        await withStore('readwrite', store => store.delete(recordKey(itemId)));
    } catch {
        // Best effort cleanup only.
    }
}
