import { api, apiUpload } from './api.js?v=4.3.4';
import { getCurrentCategory, isAttachmentCategory } from './state.js?v=4.3.4';
import { fileInput, itemInput, urlImportInput } from './ui.js?v=4.3.4';
import { sanitizeItemField } from './utils.js?v=4.3.11';

export function createUploadActions(deps) {
    const {
        loadItems,
        makeUploadProgressCallback,
        resetItemForm,
        setMessage,
        setRemoteImportLoading,
        invalidateCategoryCache,
        itemParams,
    } = deps;

    async function uploadSelectedAttachment() {
        const category = getCurrentCategory();
        if (!category || !isAttachmentCategory(category.type)) return;

        const file = fileInput?.files?.[0] || null;
        if (!file) {
            setMessage(category.type === 'images' ? 'Bitte wähle ein Bild aus.' : 'Bitte wähle eine Datei aus.', true);
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
            setMessage('Ungültige URL.', true);
            return;
        }

        const body = itemParams({
            category_id: String(category.id),
            url,
            name: itemInput.value.trim(),
        });
        setRemoteImportLoading?.(true, 'Datei wird von URL geladen... Das kann bei großen Dateien dauern.');
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

    return { uploadSelectedAttachment, importFileFromUrl };
}
