import { t } from './i18n.js';
import { api } from './api.js?v=4.3.4';
import { getCurrentCategory, state } from './state.js?v=4.3.4';
import { enqueueAction } from './offline-queue.js?v=4.3.11';

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
    } = deps;

    async function handleToggle(id, done) {
        const item = getItemById(id);
        if (item) {
            item.done = done;
            cacheCurrentCategoryItems();
            renderItems();
        }
        try {
            await api('toggle', {
                method: 'POST',
                body: new URLSearchParams({ id: String(id), done: String(done) }),
            });
        } catch (error) {
            if (shouldQueueOffline(error)) {
                enqueueAction('toggle', { id: String(id), done: String(done) });
                setNetworkStatus();
            }
        }
    }

    async function handleDelete(id) {
        try {
            removeItemById(id);
            if (state.noteEditorId === id) {
                try {
                    await closeNoteEditor();
                } catch {
                    // Ignore errors from closing editor
                }
            }
            renderItems();
            setMessage(t('msg.item_deleted'));

            try {
                await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
                invalidateCategoryCache(state.categoryId);
            } catch (error) {
                if (shouldQueueOffline(error)) {
                    enqueueAction('delete', { id: String(id) });
                    setNetworkStatus();
                }
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : t('msg.delete_failed'), true);
        }
    }

    async function handleStatus(id, currentStatus, targetStatus) {
        const next = targetStatus !== undefined ? targetStatus : (currentStatus === '' ? 'in_progress' : currentStatus === 'in_progress' ? 'waiting' : '');
        await api('status', { method: 'POST', body: new URLSearchParams({ id: String(id), status: next }) });
        const item = getItemById(id);
        if (item) {
            item.status = next;
            cacheCurrentCategoryItems();
            renderItems();
        } else {
            invalidateCategoryCache(state.categoryId);
            await loadItems();
        }
    }

    async function handlePin(id, isPinned) {
        await api('pin', { method: 'POST', body: new URLSearchParams({ id: String(id), is_pinned: String(isPinned) }) });
        const item = getItemById(id);
        if (item) {
            item.is_pinned = isPinned;
            cacheCurrentCategoryItems();
            renderItems();
        } else {
            invalidateCategoryCache(state.categoryId);
            await loadItems();
        }
    }

    async function handleMove(item, targetCategoryId) {
        const sourceCategoryId = Number(item.category_id);
        const targetId = Number(targetCategoryId);

        if (!Number.isInteger(sourceCategoryId) || !Number.isInteger(targetId) || sourceCategoryId === targetId) {
            return;
        }

        try {
            await api('move', {
                method: 'POST',
                body: new URLSearchParams({
                    id: String(item.id),
                    target_category_id: String(targetId),
                }),
            });
        } catch (error) {
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
        setMessage(targetCategory ? `Verschoben nach ${targetCategory.name}.` : 'Artikel verschoben.');
    }

    async function handleEditSave(id) {
        const draft = state.editDraft || {};
        if (state.editingId !== id || Number(draft.itemId) !== Number(id)) {
            state.editingId = null;
            state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', content: '' };
            renderItems();
            setMessage(t('msg.edit_draft_stale'), true);
            return;
        }

        const body = itemParams({
            id: String(id),
            name: (draft.name || '').trim(),
            barcode: (draft.barcode || '').trim(),
            quantity: (draft.quantity || '').trim(),
            due_date: (draft.due_date || '').trim(),
            content: (draft.content || '').trim(),
        });

        await api('update', { method: 'POST', body });
        state.editingId = null;
        state.editDraft = { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', content: '' };
        invalidateCategoryCache(state.categoryId);
        await loadItems();
        setMessage('Artikel gespeichert.');
    }

    async function clearDone() {
        const category = getCurrentCategory();
        if (!category) return;

        const removedItemIds = state.items
            .filter(item => item.done === 1)
            .map(item => item.id);

        if (removedItemIds.length === 0) return;

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
        setMessage('Erledigte Artikel entfernt.');

        try {
            await api('clear', {
                method: 'POST',
                body: new URLSearchParams({ category_id: String(category.id) }),
            });
            invalidateCategoryCache(category.id);
        } catch (error) {
            if (await handleStaleCategory(error, category.id)) return;

            if (shouldQueueOffline(error)) {
                enqueueAction('clear', { category_id: String(category.id) });
                setNetworkStatus();
            }
        }
    }

    return {
        handleToggle,
        handleDelete,
        handleStatus,
        handlePin,
        handleMove,
        handleEditSave,
        clearDone,
    };
}
