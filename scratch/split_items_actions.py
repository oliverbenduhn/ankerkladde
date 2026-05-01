import os

source_file = '/home/oliver/Dokumente/ankerkladde/public/js/items-actions.js'

with open(source_file, 'r') as f:
    content = f.read()

# We'll replace the content manually since we know exactly how to structure it.
# Actually, I'll write the JS files directly from Python using multi-line strings.

utils_js = """import { state } from './state.js?v=4.3.4';
import { sanitizeItemPayload } from './utils.js?v=4.3.11';

export function createActionUtils(deps) {
    const {
        cacheCurrentCategoryItems,
        loadCategories,
        loadItems,
        setNetworkStatus,
        setMessage,
        invalidateCategoryCache,
    } = deps;

    function removeItemById(id) {
        state.items = state.items.filter(item => item.id !== id);
        cacheCurrentCategoryItems();
    }

    function shouldQueueOffline(error) {
        return Boolean(error?.isNetworkError || Number(error?.status) >= 500);
    }

    function itemParams(payload) {
        return new URLSearchParams(sanitizeItemPayload(payload));
    }

    async function handleStaleCategory(error, categoryId) {
        if (Number(error?.status) !== 404) return false;

        invalidateCategoryCache(categoryId);
        await loadCategories();
        await loadItems(undefined, { useCache: false });
        setNetworkStatus();
        setMessage('Diese Kategorie wurde auf einem anderen Gerät gelöscht. Ich habe die Liste aktualisiert.', true);
        return true;
    }

    return { removeItemById, shouldQueueOffline, itemParams, handleStaleCategory };
}
"""

share_js = """import { appUrl, api, apiUpload } from './api.js?v=4.3.4';
import { escapeRegExp, limitText, sanitizeItemField, sanitizeItemPayload } from './utils.js?v=4.3.11';

export function createShareActions(deps) {
    const {
        getVisibleCategories,
        loadItems,
        makeUploadProgressCallback,
        openNoteEditorWithNavigation,
        setCategory,
        setMessage,
        invalidateCategoryCache,
        getItemById,
    } = deps;

    async function fetchLinkMetadata(url) {
        try {
            const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async function readCachedShareData() {
        if (!('caches' in window)) return null;

        const cache = await caches.open('ankerkladde-share-target');
        const response = await cache.match('pending-share');
        if (!response) return null;

        await cache.delete('pending-share');
        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== 'object') return null;

        return {
            title: typeof payload.title === 'string' ? payload.title : '',
            text: typeof payload.text === 'string' ? payload.text : '',
            url: typeof payload.url === 'string' ? payload.url : '',
        };
    }

    async function handleSharedFile() {
        const cache = await caches.open('ankerkladde-share-target');
        const response = await cache.match('pending-file');
        if (!response) {
            setMessage('Geteilte Datei nicht gefunden.', true);
            return;
        }

        const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
        const filename = sanitizeItemField('name', decodeURIComponent(response.headers.get('X-Share-Filename') || 'shared'));
        const blob = await response.blob();
        await cache.delete('pending-file');

        const isImage = contentType.startsWith('image/');
        const targetType = isImage ? 'images' : 'files';
        const category = getVisibleCategories().find(c => c.type === targetType);
        if (!category) {
            setMessage(`Kein ${isImage ? 'Bilder' : 'Dateien'}-Bereich vorhanden.`, true);
            return;
        }

        await setCategory(category.id);

        const file = new File([blob], filename, { type: contentType });
        const formData = new FormData();
        formData.append('category_id', String(category.id));
        formData.append('name', filename);
        formData.append('attachment', file);

        await apiUpload('upload', formData, makeUploadProgressCallback());
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });
        setMessage(isImage ? 'Bild gespeichert.' : 'Datei gespeichert.');
    }

    function buildSharedLinkDescription(title, text, url) {
        const cleanedTitle = title.trim();
        const cleanedText = text
            .replace(new RegExp(escapeRegExp(url), 'g'), ' ')
            .replace(/\\s+/g, ' ')
            .trim();

        return [cleanedTitle, cleanedText]
            .filter((value, index, values) => value !== '' && values.indexOf(value) === index)
            .join('\\n\\n');
    }

    async function handleSharedLink(url, title = '', text = '') {
        const category = getVisibleCategories().find(c => c.type === 'links');
        if (!category) {
            setMessage('Kein Links-Bereich vorhanden.', true);
            return;
        }
        await setCategory(category.id);

        let description = sanitizeItemField('content', buildSharedLinkDescription(title, text, url));

        if (!description.trim()) {
            setMessage('Lade Seiten-Infos...');
            const meta = await fetchLinkMetadata(url);
            if (meta?.title || meta?.description) {
                description = sanitizeItemField('content', [meta.title, meta.description].filter(Boolean).join('\\n\\n'));
            }
        }

        await api('add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sanitizeItemPayload({ category_id: category.id, name: url, content: description }))
        });
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });
        setMessage('Link gespeichert.');
    }

    async function handleSharedText(title, text) {
        const category = getVisibleCategories().find(c => c.type === 'notes');
        if (!category) {
            setMessage('Kein Notizen-Bereich vorhanden.', true);
            return;
        }
        await setCategory(category.id);

        const cleanedText = limitText(text, 8000);
        const noteName = sanitizeItemField('name', title || (cleanedText.length > 60 ? cleanedText.substring(0, 60) + '\\u2026' : cleanedText) || 'Geteilte Notiz');
        const noteContent = cleanedText
            ? cleanedText.split('\\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
                .join('')
            : '';

        const payload = await api('add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sanitizeItemPayload({ category_id: category.id, name: noteName, content: noteContent }))
        });
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });

        const item = getItemById(payload.id);
        if (item) {
            await openNoteEditorWithNavigation(item);
        } else {
            setMessage('Notiz gespeichert.');
        }
    }

    async function handleIncomingShare() {
        const params = new URLSearchParams(window.location.search);
        const hasShare = params.has('share') || params.has('title') || params.has('text') || params.has('url');
        if (!hasShare) return;

        history.replaceState(null, '', window.location.pathname);

        const shareParam = params.get('share');
        const cachedShare = shareParam === 'data' ? await readCachedShareData() : null;
        const title = cachedShare?.title ?? params.get('title') ?? '';
        const text = cachedShare?.text ?? params.get('text') ?? '';
        const sharedUrl = cachedShare?.url ?? params.get('url') ?? /https?:\\/\\/\\S+/.exec(text)?.[0] ?? '';

        try {
            if (shareParam === 'file') {
                await handleSharedFile();
            } else if (sharedUrl) {
                await handleSharedLink(sharedUrl, title, text);
            } else if (text || title) {
                await handleSharedText(title, text);
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Teilen fehlgeschlagen.', true);
        }
    }

    return { handleIncomingShare };
}
"""

upload_js = """import { api, apiUpload } from './api.js?v=4.3.4';
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
"""

add_js = """import { appUrl, api } from './api.js?v=4.3.4';
import { getCurrentCategory, isAttachmentCategory } from './state.js?v=4.3.4';
import { itemInput, linkDescriptionInput, quantityInput } from './ui.js?v=4.3.4';
import { sanitizeItemField } from './utils.js?v=4.3.11';
import { enqueueAction } from './offline-queue.js?v=4.3.11';

export function createAddActions(deps) {
    const {
        getItemById,
        getUploadMode,
        loadItems,
        openNoteEditorWithNavigation,
        resetItemForm,
        setMessage,
        setNetworkStatus,
        invalidateCategoryCache,
        shouldQueueOffline,
        itemParams,
        handleStaleCategory,
        importFileFromUrl,
        uploadSelectedAttachment,
    } = deps;

    async function fetchLinkMetadata(url) {
        try {
            const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async function addItem(event) {
        event.preventDefault();
        const category = getCurrentCategory();
        if (!category) return;

        if (category.type === 'notes') {
            const name = sanitizeItemField('name', itemInput.value.trim() || 'Neue Notiz');
            const body = itemParams({ category_id: String(category.id), name });
            try {
                const payload = await api('add', { method: 'POST', body });
                resetItemForm();
                invalidateCategoryCache(category.id);
                await loadItems();
                const item = getItemById(payload.id);
                if (item) {
                    await openNoteEditorWithNavigation(item);
                }
            } catch (error) {
                if (await handleStaleCategory(error, category.id)) return;
                throw error;
            }
            return;
        }

        if (isAttachmentCategory(category.type)) {
            if (getUploadMode() === 'url' && category.type === 'files') {
                await importFileFromUrl();
            } else {
                await uploadSelectedAttachment();
            }
            return;
        }

        const body = itemParams({
            category_id: String(category.id),
            name: itemInput.value.trim(),
        });

        if (category.type === 'links') {
            const manualDescription = sanitizeItemField('content', linkDescriptionInput?.value.trim());
            if (manualDescription) {
                body.set('content', manualDescription);
            } else {
                setMessage('Lade Seiten-Infos...');
                const meta = await fetchLinkMetadata(itemInput.value.trim());
                if (meta?.title || meta?.description) {
                    body.set('content', sanitizeItemField('content', [meta.title, meta.description].filter(Boolean).join('\\n\\n')));
                }
            }
        }

        if (category.type === 'list_quantity' && quantityInput.value.trim() !== '') {
            body.set('quantity', sanitizeItemField('quantity', quantityInput.value.trim()));
        }

        if (category.type === 'list_due_date' && quantityInput.value.trim() !== '') {
            body.set('due_date', sanitizeItemField('due_date', quantityInput.value.trim()));
        }

        try {
            await api('add', { method: 'POST', body });
            resetItemForm();
            invalidateCategoryCache(category.id);
            await loadItems();
            setMessage('Artikel hinzugefügt.');
        } catch (error) {
            if (await handleStaleCategory(error, category.id)) return;

            if (shouldQueueOffline(error)) {
                enqueueAction('add', Object.fromEntries(body.entries()));
                resetItemForm();
                setNetworkStatus();
                setMessage('Offline gespeichert – wird synchronisiert wenn du wieder online bist.');
                return;
            }

            throw error;
        }
    }

    return { addItem };
}
"""

update_js = """import { api } from './api.js?v=4.3.4';
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
            setMessage('Artikel gelöscht.');

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
            setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
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
            setMessage('Der Bearbeitungsentwurf passte nicht mehr zu diesem Eintrag. Bitte erneut öffnen.', true);
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
"""

main_js = """import { createActionUtils } from './items-actions-utils.js?v=4.3.11';
import { createShareActions } from './items-actions-share.js?v=4.3.11';
import { createUploadActions } from './items-actions-upload.js?v=4.3.11';
import { createAddActions } from './items-actions-add.js?v=4.3.11';
import { createUpdateActions } from './items-actions-update.js?v=4.3.11';

export function createItemsActionsController(deps) {
    const utils = createActionUtils(deps);
    const extendedDeps = { ...deps, ...utils };

    const shareActions = createShareActions(extendedDeps);
    
    // uploadActions is needed by addActions
    const uploadActions = createUploadActions(extendedDeps);
    const depsWithUpload = { ...extendedDeps, ...uploadActions };
    
    const addActions = createAddActions(depsWithUpload);
    const updateActions = createUpdateActions(extendedDeps);

    return {
        ...shareActions,
        ...uploadActions,
        ...addActions,
        ...updateActions,
    };
}
"""

with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions-utils.js', 'w') as f:
    f.write(utils_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions-share.js', 'w') as f:
    f.write(share_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions-upload.js', 'w') as f:
    f.write(upload_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions-add.js', 'w') as f:
    f.write(add_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions-update.js', 'w') as f:
    f.write(update_js)
with open('/home/oliver/Dokumente/ankerkladde/public/js/items-actions.js', 'w') as f:
    f.write(main_js)

print("Done Refactoring!")
