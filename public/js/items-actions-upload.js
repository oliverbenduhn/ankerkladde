import { t } from './i18n.js';
import { api, apiUpload, buildIdempotencyKey } from './api.js';
import { getCurrentCategory, isAttachmentCategory, state } from './state.js';
import { fileInput, itemInput, urlImportInput } from './ui.js';
import { sanitizeItemField } from './utils.js';
import { clearDraftSnapshot, markDraftServerDeleted } from './draft-persistence.js';
import { clearItemSaving, isItemSaving, markItemSaving } from './item-sync-state.js';

const replacementDrafts = new Map();

export function createUploadActions(deps) {
    const {
        loadItems,
        makeUploadProgressCallback,
        resetItemForm,
        setMessage,
        setRemoteImportLoading,
        invalidateCategoryCache,
        itemParams,
        getItemById,
        renderItems,
        applyServerItem,
    } = deps;

    function resetInlineEdit() {
        state.editingId = null;
        state.editDraft = {
            itemId: null,
            categoryId: null,
            name: '',
            barcode: '',
            quantity: '',
            due_date: '',
            due_time: '',
            priority: '',
            content: '',
        };
        clearDraftSnapshot();
    }

    function getAttachmentReplacement(itemId) {
        return replacementDrafts.get(Number(itemId)) || null;
    }

    function selectAttachmentReplacement(itemId, file) {
        const id = Number(itemId);
        if (!(file instanceof File)) {
            replacementDrafts.delete(id);
            renderItems();
            return;
        }
        replacementDrafts.set(id, {
            file,
            requestId: '',
            conflictItem: null,
        });
        renderItems();
    }

    function clearAttachmentReplacement(itemId) {
        replacementDrafts.delete(Number(itemId));
    }

    async function replaceAttachment(itemId) {
        const id = Number(itemId);
        const pending = getAttachmentReplacement(id);
        if (!pending) return false;
        if (isItemSaving(id)) return true;

        const item = getItemById(id);
        const expectedRevision = Number(item?.revision);
        if (!item || expectedRevision < 1) {
            setMessage(t('error.revision_required'), true);
            return true;
        }
        if (!pending.requestId) pending.requestId = await buildIdempotencyKey();

        const requestId = pending.requestId;
        const formData = new FormData();
        formData.append('category_id', String(item.category_id));
        formData.append('item_id', String(id));
        formData.append('expected_revision', String(expectedRevision));
        formData.append('name', (state.editDraft?.name || item.name || pending.file.name).trim());
        formData.append('attachment', pending.file);

        markItemSaving(id);
        renderItems();
        try {
            const result = await apiUpload('upload', formData, makeUploadProgressCallback(), {
                idempotencyKey: requestId,
            });
            applyServerItem(result?.item);
            if (getAttachmentReplacement(id)?.requestId === requestId) {
                clearAttachmentReplacement(id);
                resetInlineEdit();
            }
            invalidateCategoryCache(item.category_id);
            renderItems();
            setMessage('Anhang ersetzt.');
        } catch (error) {
            if (Number(error?.status) === 409 && error.payload?.item) {
                applyServerItem(error.payload.item);
                const currentPending = getAttachmentReplacement(id);
                if (currentPending?.requestId === requestId) {
                    currentPending.conflictItem = error.payload.item;
                }
                renderItems();
                setMessage('Der Anhang wurde parallel geändert. Bitte wähle eine Fassung.', true);
                return true;
            }
            if (Number(error?.status) === 404) {
                item.server_deleted = 1;
                markDraftServerDeleted();
                renderItems();
                setMessage(t('msg.server_delete_detected'), true);
                return true;
            }
            renderItems();
            setMessage(error instanceof Error ? error.message : 'Ersetzen fehlgeschlagen.', true);
        } finally {
            clearItemSaving(id);
            renderItems();
        }
        return true;
    }

    async function keepLocalAttachment(itemId) {
        const pending = getAttachmentReplacement(itemId);
        if (!pending?.conflictItem) return;
        applyServerItem(pending.conflictItem);
        pending.conflictItem = null;
        await replaceAttachment(itemId);
    }

    function acceptServerAttachment(itemId) {
        const pending = getAttachmentReplacement(itemId);
        if (pending?.conflictItem) applyServerItem(pending.conflictItem);
        clearAttachmentReplacement(itemId);
        resetInlineEdit();
        renderItems();
        setMessage('Server-Anhang übernommen.');
    }

    async function restoreDeletedAttachment(itemId) {
        const id = Number(itemId);
        const pending = getAttachmentReplacement(id);
        if (!pending) return false;
        const item = getItemById(id);
        if (!item) return false;
        if (!pending.requestId) pending.requestId = await buildIdempotencyKey();

        const formData = new FormData();
        formData.append('category_id', String(item.category_id));
        formData.append('name', (state.editDraft?.name || item.name || pending.file.name).trim());
        formData.append('attachment', pending.file);
        await apiUpload('upload', formData, makeUploadProgressCallback(), {
            idempotencyKey: pending.requestId,
        });
        clearAttachmentReplacement(id);
        resetInlineEdit();
        invalidateCategoryCache(item.category_id);
        await loadItems(undefined, { useCache: false });
        setMessage(t('msg.deleted_draft_restored'));
        return true;
    }

    async function uploadSelectedAttachment() {
        const category = getCurrentCategory();
        if (!category || !isAttachmentCategory(category.type)) return;

        const file = fileInput?.files?.[0] || null;
        if (!file) {
            setMessage(category.type === 'images' ? t('error.select_image') : t('error.select_file'), true);
            return;
        }

        const formData = new FormData();
        formData.append('category_id', String(category.id));
        formData.append('name', sanitizeItemField('name', itemInput.value.trim() || file.name));
        formData.append('attachment', file);

        await apiUpload('upload', formData, makeUploadProgressCallback());
        resetItemForm();
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });
        setMessage(category.type === 'images' ? 'Bild hochgeladen.' : 'Datei hochgeladen.');
    }

    async function importFileFromUrl() {
        const category = getCurrentCategory();
        if (!category || category.type !== 'files') return;

        const url = sanitizeItemField('url', urlImportInput?.value || '');
        if (!url) {
            setMessage('Bitte gib eine URL ein.', true);
            return;
        }

        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                setMessage('Nur HTTP(S)-URLs erlaubt.', true);
                return;
            }
        } catch {
            setMessage(t('error.invalid_url_client'), true);
            return;
        }

        const body = itemParams({
            category_id: String(category.id),
            url,
            name: itemInput.value.trim(),
        });
        setRemoteImportLoading?.(true, t('msg.url_loading'));
        try {
            await api('import_url', { method: 'POST', body });
            resetItemForm();
            if (urlImportInput) urlImportInput.value = '';
            invalidateCategoryCache(category.id);
            await loadItems(category.id, { useCache: false });
            setMessage('Datei importiert.');
        } finally {
            setRemoteImportLoading?.(false);
        }
    }

    return {
        acceptServerAttachment,
        clearAttachmentReplacement,
        getAttachmentReplacement,
        importFileFromUrl,
        keepLocalAttachment,
        replaceAttachment,
        restoreDeletedAttachment,
        selectAttachmentReplacement,
        uploadSelectedAttachment,
    };
}
