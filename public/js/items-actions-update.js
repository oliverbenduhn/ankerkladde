import { t } from './i18n.js';
import { api, buildIdempotencyKey } from './api.js';
import { getCurrentCategory, state } from './state.js';
import { addConflict, enqueueAction, getConflicts, removeQueuedAction, setConflicts } from './offline-queue.js';
import { isItemSaving, markItemSaving, clearItemSaving } from './item-sync-state.js';
import { clearDraftSnapshot, markDraftServerDeleted } from './draft-persistence.js';
import {
    itemContentSnapshot,
    rebaseItemDraft,
    serverContentMatchesDraft,
    serverContentMatchesDraftBase,
} from './item-content-conflict.js';

export function createUpdateActions(deps) {
    const {
        cacheCurrentCategoryItems,
        closeNoteEditor,
        getItemById,
        getVisibleCategories,
        loadItems,
        renderItems,
        setMessage,
        setNetworkStatus,
        invalidateCategoryCache,
        removeItemById,
        shouldQueueOffline,
        itemParams,
        handleStaleCategory,
        offerUndo = async () => false,
        applyServerItem,
        replaceAttachment,
        restoreDeletedAttachment,
        clearAttachmentReplacement,
    } = deps;

    function sameStatusValue(left, right) {
        return String(left ?? '') === String(right ?? '');
    }

    function mergeCategoryItems(items, categoryId) {
        invalidateCategoryCache(categoryId);
        if (Number(state.categoryId) !== Number(categoryId)) return;
        const restoredById = new Map(items.map(item => [Number(item.id), item]));
        state.items = state.items
            .filter(item => !restoredById.has(Number(item.id)))
            .concat(items);
        cacheCurrentCategoryItems();
        renderItems();
    }

    function removeCategoryItems(itemIds, categoryId) {
        invalidateCategoryCache(categoryId);
        if (Number(state.categoryId) !== Number(categoryId)) return;
        const ids = new Set(itemIds.map(Number));
        state.items = state.items.filter(item => !ids.has(Number(item.id)));
        cacheCurrentCategoryItems();
        renderItems();
    }

    async function reloadCategory(categoryId) {
        invalidateCategoryCache(categoryId);
        if (Number(state.categoryId) !== Number(categoryId)) return;
        await loadItems(categoryId, { useCache: false });
    }

    async function queueOrRunUndo(deletionId, removedItems, { queueOnly = false } = {}) {
        const body = new URLSearchParams({
            deletion_id: deletionId,
            item_ids: JSON.stringify(removedItems.map(item => Number(item.id))),
        });
        const requestId = await buildIdempotencyKey();
        enqueueAction('undo_delete', Object.fromEntries(body.entries()), requestId);
        if (queueOnly) {
            setNetworkStatus();
            return null;
        }
        try {
            const payload = await api('undo_delete', { method: 'POST', body, idempotencyKey: requestId });
            removeQueuedAction(requestId);
            setNetworkStatus();
            return payload;
        } catch (error) {
            if (!shouldQueueOffline(error)) {
                removeQueuedAction(requestId);
                throw error;
            }
            setNetworkStatus();
            return null;
        }
    }

    async function queueOrRunFinalize(deletionId, { queueOnly = false } = {}) {
        const body = new URLSearchParams({ deletion_id: deletionId });
        const requestId = await buildIdempotencyKey();
        enqueueAction('finalize_delete', Object.fromEntries(body.entries()), requestId);
        if (queueOnly) {
            setNetworkStatus();
            return;
        }
        try {
            await api('finalize_delete', { method: 'POST', body, idempotencyKey: requestId });
            removeQueuedAction(requestId);
            setNetworkStatus();
        } catch (error) {
            if (!shouldQueueOffline(error)) {
                removeQueuedAction(requestId);
                return;
            }
            setNetworkStatus();
        }
    }

    async function mutateStatus(action, item, field, payload, base = item?.[field] ?? '', applyToState = true) {
        const expectedRevision = Number(item?.revision);
        if (expectedRevision < 1) {
            setMessage(t('error.revision_required'), true);
            return null;
        }

        payload.expected_revision = String(expectedRevision);
        payload[`base_${field}`] = String(base);
        const body = new URLSearchParams(payload);
        const acceptCanonical = canonical => {
            if (applyToState) applyServerItem(canonical);
            else if (canonical) Object.assign(item, canonical);
        };

        try {
            const result = await api(action, { method: 'POST', body });
            acceptCanonical(result?.item);
            return result;
        } catch (error) {
            const current = error?.payload?.item;
            if (Number(error?.status) !== 409 || !current) throw error;

            if (sameStatusValue(current[field], base)) {
                body.set('expected_revision', String(current.revision));
                try {
                    const result = await api(action, {
                        method: 'POST',
                        body,
                        idempotencyKey: error.idempotencyKey,
                    });
                    acceptCanonical(result?.item);
                    return result;
                } catch (retryError) {
                    retryError.queuePayload = Object.fromEntries(body.entries());
                    if (Number(retryError?.status) !== 409 || !retryError.payload?.item) throw retryError;
                    acceptCanonical(retryError.payload.item);
                }
            } else {
                acceptCanonical(current);
            }

            if (applyToState) renderItems();
            setMessage(t('msg.status_conflict_retry'), true);
            return null;
        }
    }

    async function handleToggle(id, done, sourceItem = null) {
        // ponytail: coerce to 0/1 — callers from the journal pass a boolean which
        // would stringify to "true"/"false" and fail PHP FILTER_VALIDATE_INT with 422.
        const doneFlag = done ? 1 : 0;
        const stateItem = getItemById(id);
        const item = stateItem || sourceItem;
        if (!item) return;
        const previousDone = item?.done;
        item.done = doneFlag;
        if (stateItem) {
            cacheCurrentCategoryItems();
            renderItems();
        }
        try {
            const result = await mutateStatus('toggle', item, 'done', {
                id: String(id),
                done: String(doneFlag),
            }, previousDone, Boolean(stateItem));
            if (result) renderItems();
        } catch (error) {
            if (shouldQueueOffline(error)) {
                enqueueAction('toggle', error.queuePayload || {
                    id: String(id),
                    done: String(doneFlag),
                    expected_revision: String(item.revision),
                    base_done: String(previousDone),
                }, error.idempotencyKey);
                setNetworkStatus();
                // AC #63: Offline-Zustand muss sofort am Item sichtbar sein,
                // nicht erst beim naechsten unabhaengigen Re-Render.
                renderItems();
                return;
            }
            // 4xx or unexpected error: revert the optimistic state so UI and server agree.
            item.done = previousDone;
            if (stateItem) {
                cacheCurrentCategoryItems();
                renderItems();
            }
            throw error;
        }
    }

    async function handleDelete(id) {
        const item = getItemById(id);
        const expectedRevision = Number(item?.revision);
        if (!item || expectedRevision < 1) {
            setMessage(t('error.revision_required'), true);
            return;
        }

        const removedItem = { ...item };
        const sourceCategoryId = Number(item.category_id || state.categoryId);
        const deletionId = await buildIdempotencyKey();
        const body = new URLSearchParams({
            id: String(id),
            expected_revision: String(expectedRevision),
            deletion_id: deletionId,
        });
        try {
            enqueueAction('delete', Object.fromEntries(body.entries()), deletionId);
            removeItemById(id);
            if (state.noteEditorId === id) {
                try {
                    await closeNoteEditor();
                } catch {
                    // Ignore errors from closing editor
                }
            }
            renderItems();

            const stagePromise = api('delete', {
                method: 'POST',
                body,
                idempotencyKey: deletionId,
            }).then(payload => ({ payload, error: null })).catch(error => {
                if (shouldQueueOffline(error)) {
                    setNetworkStatus();
                    return { payload: null, error: null, queued: true };
                }
                removeQueuedAction(deletionId);
                if (Number(error?.status) === 409 && error.payload?.item) {
                    addConflict('delete', {
                        id: String(id),
                        expected_revision: String(error.payload.item.revision),
                    }, error);
                    // Das Badge wird aus der Conflict-Queue abgeleitet. Daher
                    // erst markieren und danach den kanonischen Serverstand
                    // rendern.
                    mergeCategoryItems([error.payload.item], sourceCategoryId);
                    setMessage(t('msg.delete_conflict'), true);
                    return { payload: null, error };
                }
                if (Number(error?.status) === 404) {
                    setConflicts(getConflicts().filter(conflict => conflict.type !== 'delete' || Number(conflict?.payload?.id) !== Number(id)));
                    return { payload: null, error: null };
                }
                mergeCategoryItems([removedItem], sourceCategoryId);
                setMessage(error instanceof Error ? error.message : t('msg.delete_failed'), true);
                return { payload: null, error };
            });
            stagePromise.then(result => {
                if (!result.queued) {
                    removeQueuedAction(deletionId);
                    setNetworkStatus();
                }
            });

            const undone = await offerUndo(t('msg.item_deleted'));
            if (undone) {
                mergeCategoryItems([removedItem], sourceCategoryId);
                const staged = await stagePromise;
                if (staged.error) return;
                try {
                    const undoPayload = await queueOrRunUndo(deletionId, [removedItem], {
                        queueOnly: Boolean(staged.queued),
                    });
                    const restoredItems = Array.isArray(undoPayload?.restored_items)
                        ? undoPayload.restored_items
                        : [];
                    if (restoredItems.length > 0) mergeCategoryItems(restoredItems, sourceCategoryId);
                } catch (error) {
                    removeCategoryItems([id], sourceCategoryId);
                    setMessage(error instanceof Error ? error.message : t('msg.delete_failed'), true);
                    return;
                }
                setMessage(t('msg.item_delete_undone'));
                return;
            }

            const staged = await stagePromise;
            if (!staged.error) {
                setConflicts(getConflicts().filter(conflict => conflict.type !== 'delete' || Number(conflict?.payload?.id) !== Number(id)));
                removeCategoryItems([id], sourceCategoryId);
                void queueOrRunFinalize(deletionId, { queueOnly: Boolean(staged.queued) });
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : t('msg.delete_failed'), true);
        }
    }

    async function restoreDeletedDraft(id) {
        if (await restoreDeletedAttachment?.(id)) return;
        const draft = state.editDraft || {};
        if (Number(state.editingId) !== Number(id) || Number(draft.itemId) !== Number(id)) return;

        const body = itemParams({
            category_id: String(draft.categoryId),
            name: (draft.name || '').trim(),
            barcode: (draft.barcode || '').trim(),
            quantity: (draft.quantity || '').trim(),
            due_date: (draft.due_date || '').trim(),
            due_time: (draft.due_time || '').trim(),
            priority: (draft.priority || '').trim(),
            content: (draft.content || '').trim(),
        });
        await api('add', { method: 'POST', body });
        state.editingId = null;
        state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
        clearDraftSnapshot();
        invalidateCategoryCache(draft.categoryId);
        await loadItems(undefined, { useCache: false });
        setMessage(t('msg.deleted_draft_restored'));
    }

    function discardDeletedDraft(id) {
        clearAttachmentReplacement?.(id);
        if (Number(state.editingId) !== Number(id)) return;
        state.editingId = null;
        state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
        clearDraftSnapshot();
        removeItemById(id);
        renderItems();
        setMessage(t('msg.deleted_draft_discarded'));
    }

    async function handleStatus(id, currentStatus, targetStatus) {
        const next = targetStatus !== undefined ? targetStatus : (currentStatus === '' ? 'in_progress' : currentStatus === 'in_progress' ? 'waiting' : '');
        const item = getItemById(id);
        if (!item) return;
        try {
            const result = await mutateStatus('status', item, 'status', { id: String(id), status: next });
            if (result) renderItems();
            return result;
        } catch (error) {
            if (shouldQueueOffline(error)) {
                enqueueAction('status', error.queuePayload || {
                    id: String(id),
                    status: next,
                    expected_revision: String(item.revision),
                    base_status: String(item.status ?? ''),
                }, error.idempotencyKey);
                // Apply optimistically for offline
                item.status = next;
                cacheCurrentCategoryItems();
                renderItems();
                setNetworkStatus();
            } else {
                setMessage(error instanceof Error ? error.message : t('error.server_error'), true);
            }
            return null;
        }
    }

    async function handlePin(id, isPinned) {
        const item = getItemById(id);
        if (!item) return;
        try {
            const result = await mutateStatus('pin', item, 'is_pinned', {
                id: String(id),
                is_pinned: String(isPinned),
            });
            if (result) renderItems();
        } catch (error) {
            if (shouldQueueOffline(error)) {
                enqueueAction('pin', error.queuePayload || {
                    id: String(id),
                    is_pinned: String(isPinned),
                    expected_revision: String(item.revision),
                    base_is_pinned: String(item.is_pinned ?? 0),
                }, error.idempotencyKey);
                // Apply optimistically for offline
                item.is_pinned = isPinned;
                cacheCurrentCategoryItems();
                renderItems();
                setNetworkStatus();
            } else {
                setMessage(error instanceof Error ? error.message : t('error.server_error'), true);
            }
        }
    }

    async function handleMove(item, targetCategoryId) {
        const sourceCategoryId = Number(item.category_id);
        const targetId = Number(targetCategoryId);

        if (!Number.isInteger(sourceCategoryId) || !Number.isInteger(targetId) || sourceCategoryId === targetId) {
            return;
        }

        try {
            const result = await mutateStatus('move', item, 'category_id', {
                id: String(item.id),
                target_category_id: String(targetId),
            });
            if (!result) {
                const serverCategoryId = Number(item.category_id);
                if (serverCategoryId !== sourceCategoryId) {
                    invalidateCategoryCache(sourceCategoryId);
                    invalidateCategoryCache(serverCategoryId);
                    if (Number(state.categoryId) === sourceCategoryId) {
                        state.items = state.items.filter(entry => entry.id !== item.id);
                        cacheCurrentCategoryItems();
                        renderItems();
                    }
                }
                return;
            }
        } catch (error) {
            if (shouldQueueOffline(error)) {
                enqueueAction('move', error.queuePayload || {
                    id: String(item.id),
                    target_category_id: String(targetId),
                    expected_revision: String(item.revision),
                    base_category_id: String(sourceCategoryId),
                }, error.idempotencyKey);
                setNetworkStatus();
                return;
            }
            setMessage(error instanceof Error ? error.message : 'Verschieben fehlgeschlagen.', true);
            return;
        }

        invalidateCategoryCache(sourceCategoryId);
        invalidateCategoryCache(targetId);

        if (Number(state.categoryId) === sourceCategoryId) {
            state.items = state.items.filter(entry => entry.id !== item.id);
            cacheCurrentCategoryItems();
            renderItems();
        } else {
            await loadItems();
        }

        const targetCategory = getVisibleCategories().find(category => Number(category.id) === targetId);
        setMessage(targetCategory ? t('msg.item_moved', { name: targetCategory.name }) : t('msg.item_moved_generic'));
    }

    async function handleEditSave(id) {
        if (await replaceAttachment?.(id)) return;
        const draft = state.editDraft || {};
        if (state.editingId !== id || Number(draft.itemId) !== Number(id)) {
            state.editingId = null;
            state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
            clearDraftSnapshot();
            renderItems();
            setMessage(t('msg.edit_draft_stale'), true);
            return;
        }

        // AC #63: hoechstens ein Schreibversuch pro Item gleichzeitig.
        if (isItemSaving(id)) return;

        const item = getItemById(id);
        const expectedRevision = Number(draft.baseRevision) || (item ? Number(item.revision) : 0);
        if (expectedRevision < 1) {
            setMessage(t('error.revision_required'), true);
            return;
        }

        markItemSaving(id);
        renderItems();
        try {
            const body = itemParams({
                id: String(id),
                expected_revision: String(expectedRevision),
                name: (draft.name || '').trim(),
                barcode: (draft.barcode || '').trim(),
                quantity: (draft.quantity || '').trim(),
                due_date: (draft.due_date || '').trim(),
                due_time: (draft.due_time || '').trim(),
                priority: (draft.priority || '').trim(),
                content: (draft.content || '').trim(),
                // Nur der Vollbild-Editor fuehrt den Status im Draft. Inline-Edits
                // lassen den Schluessel weg, damit der Server seinen Wert behaelt.
                ...(draft.status === undefined ? {} : { status: String(draft.status ?? '') }),
            });
            const result = await api('update', {
                method: 'POST',
                body,
                ...(draft.requestId ? { idempotencyKey: draft.requestId } : {}),
            });
            state.editingId = null;
            state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
            clearDraftSnapshot();
            applyServerItem(result?.item);
            renderItems();
            setMessage(t('msg.item_saved'));
        } catch (error) {
            draft.requestId = error?.idempotencyKey || draft.requestId || '';
            if (Number(error?.status) === 409 && error.payload?.item) {
                const serverItem = error.payload.item;
                applyServerItem(serverItem);
                if (serverContentMatchesDraft(serverItem, draft)) {
                    state.editingId = null;
                    state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
                    clearDraftSnapshot();
                    renderItems();
                    setMessage(t('msg.item_saved'));
                    return;
                }
                if (serverContentMatchesDraftBase(serverItem, draft)) {
                    rebaseItemDraft(draft, serverItem);
                    renderItems();
                    window.setTimeout(() => void handleEditSave(id), 0);
                    return;
                }
                draft.conflict = {
                    local: itemContentSnapshot(draft),
                    server: {
                        ...itemContentSnapshot(serverItem),
                        revision: Number(serverItem.revision),
                        updatedAt: serverItem.updated_at || '',
                        item: serverItem,
                    },
                };
                renderItems();
                setMessage(t('msg.item_conflict_remote_update'), true);
                return;
            }
            if (Number(error?.status) === 404) {
                item.server_deleted = 1;
                markDraftServerDeleted();
                renderItems();
                setMessage(t('msg.server_delete_detected'), true);
                return;
            }
            renderItems();
            setMessage(error instanceof Error ? error.message : t('error.server_error'), true);
        } finally {
            clearItemSaving(id);
            renderItems();
        }
    }

    async function keepLocalItemContent(id) {
        const draft = state.editDraft;
        const conflict = draft?.conflict;
        if (Number(state.editingId) !== Number(id) || !conflict?.server?.item) return;
        applyServerItem(conflict.server.item);
        rebaseItemDraft(draft, conflict.server.item);
        draft.conflict = null;
        renderItems();
        await handleEditSave(id);
    }

    function acceptServerItemContent(id) {
        const draft = state.editDraft;
        const conflict = draft?.conflict;
        if (Number(state.editingId) !== Number(id) || !conflict?.server?.item) return;
        applyServerItem(conflict.server.item);
        state.editingId = null;
        state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', due_time: '', priority: '', content: '' };
        clearDraftSnapshot();
        renderItems();
        setMessage('Server-Version übernommen.');
    }

    async function clearDone() {
        const category = getCurrentCategory();
        if (!category) return;

        const removedItems = state.items.filter(item => item.done === 1).map(item => ({ ...item }));
        const removedItemIds = removedItems.map(item => item.id);

        if (removedItemIds.length === 0) return;
        if (removedItems.some(item => !Number.isInteger(Number(item.revision)) || Number(item.revision) < 1)) {
            setMessage(t('error.revision_required'), true);
            return;
        }
        const deletionId = await buildIdempotencyKey();
        const body = new URLSearchParams({
            category_id: String(category.id),
            deletion_id: deletionId,
            items: JSON.stringify(removedItems.map(item => ({
                id: Number(item.id),
                expected_revision: Number(item.revision),
            }))),
        });

        enqueueAction('clear', Object.fromEntries(body.entries()), deletionId);

        state.items = state.items.filter(item => item.done !== 1);
        cacheCurrentCategoryItems();

        if (removedItemIds.includes(state.noteEditorId)) {
            try {
                await closeNoteEditor();
            } catch {
                // Ignore errors from closing editor
            }
        }

        renderItems();

        const stagePromise = api('clear', {
            method: 'POST',
            body,
            idempotencyKey: deletionId,
        }).then(payload => ({ payload, error: null })).catch(async error => {
            if (await handleStaleCategory(error, category.id)) {
                return { payload: null, error };
            }
            if (shouldQueueOffline(error)) {
                setNetworkStatus();
                return { payload: null, error: null, queued: true };
            }
            removeQueuedAction(deletionId);
            if (Number(error?.status) === 409) {
                await reloadCategory(category.id);
            } else {
                mergeCategoryItems(removedItems, category.id);
            }
            setMessage(error instanceof Error ? error.message : t('error.server_error'), true);
            return { payload: null, error };
        });
        stagePromise.then(result => {
            if (!result.queued) {
                removeQueuedAction(deletionId);
                setNetworkStatus();
            }
        });

        const undone = await offerUndo(t('msg.done_cleared'));
        if (undone) {
            mergeCategoryItems(removedItems, category.id);
            const staged = await stagePromise;
            if (staged.error) return;
            try {
                const undoPayload = await queueOrRunUndo(deletionId, removedItems, {
                    queueOnly: Boolean(staged.queued),
                });
                const restoredItems = Array.isArray(undoPayload?.restored_items)
                    ? undoPayload.restored_items
                    : [];
                if (restoredItems.length > 0) mergeCategoryItems(restoredItems, category.id);
            } catch (error) {
                removeCategoryItems(removedItemIds, category.id);
                setMessage(error instanceof Error ? error.message : t('error.server_error'), true);
                return;
            }
            setMessage(t('msg.done_clear_undone'));
            return;
        }

        const staged = await stagePromise;
        if (!staged.error) {
            removeCategoryItems(removedItemIds, category.id);
            void queueOrRunFinalize(deletionId, { queueOnly: Boolean(staged.queued) });
        }
    }

    return {
        handleToggle,
        handleDelete,
        restoreDeletedDraft,
        discardDeletedDraft,
        handleStatus,
        handlePin,
        handleMove,
        handleEditSave,
        keepLocalItemContent,
        acceptServerItemContent,
        clearDone,
    };
}
