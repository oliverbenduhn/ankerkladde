import { appUrl, api, apiUpload } from './api.js?v=4.2.64';
import { getCurrentCategory, isAttachmentCategory, state } from './state.js?v=4.2.64';
import { fileInput, itemInput, linkDescriptionInput, quantityInput, urlImportInput } from './ui.js?v=4.2.64';
import { escapeRegExp } from './utils.js?v=4.2.64';
import { enqueueAction } from './offline-queue.js?v=4.2.64';

export function createItemsActionsController(deps) {
    const {
        cacheCurrentCategoryItems,
        closeNoteEditor,
        getItemById,
        getUploadMode,
        getVisibleCategories,
        loadItems,
        makeUploadProgressCallback,
        openNoteEditorWithNavigation,
        renderItems,
        resetItemForm,
        setCategory,
        setMessage,
        setNetworkStatus,
        setRemoteImportLoading,
        invalidateCategoryCache,
    } = deps;

    // Local helper for removing items (needs state import)
    function removeItemById(id) {
        state.items = state.items.filter(item => item.id !== id);
        cacheCurrentCategoryItems();
    }

    async function fetchLinkMetadata(url) {
        try {
            const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
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
        const sharedUrl = cachedShare?.url ?? params.get('url') ?? /https?:\/\/\S+/.exec(text)?.[0] ?? '';

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
        const filename = decodeURIComponent(response.headers.get('X-Share-Filename') || 'shared');
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
            .replace(/\s+/g, ' ')
            .trim();

        return [cleanedTitle, cleanedText]
            .filter((value, index, values) => value !== '' && values.indexOf(value) === index)
            .join('\n\n');
    }

    async function handleSharedLink(url, title = '', text = '') {
        const category = getVisibleCategories().find(c => c.type === 'links');
        if (!category) {
            setMessage('Kein Links-Bereich vorhanden.', true);
            return;
        }
        await setCategory(category.id);

        let description = buildSharedLinkDescription(title, text, url);

        if (!description.trim()) {
            setMessage('Lade Seiten-Infos...');
            const meta = await fetchLinkMetadata(url);
            if (meta?.title || meta?.description) {
                description = [meta.title, meta.description].filter(Boolean).join('\n\n');
            }
        }

        const body = new URLSearchParams({
            category_id: String(category.id),
            name: url,
            content: description,
        });
        await api('add', { method: 'POST', body });
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

        const noteName = title || (text.length > 60 ? text.substring(0, 60) + '\u2026' : text) || 'Geteilte Notiz';
        const noteContent = text
            ? text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
                .join('')
            : '';

        const body = new URLSearchParams({ category_id: String(category.id), name: noteName, content: noteContent });
        const payload = await api('add', { method: 'POST', body });
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });

        const item = getItemById(payload.id);
        if (item) {
            await openNoteEditorWithNavigation(item);
        } else {
            setMessage('Notiz gespeichert.');
        }
    }

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
        formData.append('name', itemInput.value.trim() || file.name);
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

        const url = urlImportInput?.value.trim() || '';
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

        const body = new URLSearchParams({
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

    async function addItem(event) {
        event.preventDefault();
        const category = getCurrentCategory();
        if (!category) return;

        if (category.type === 'notes') {
            const name = itemInput.value.trim() || 'Neue Notiz';
            const body = new URLSearchParams({ category_id: String(category.id), name });
            const payload = await api('add', { method: 'POST', body });
            resetItemForm();
            invalidateCategoryCache(category.id);
            await loadItems();
            const item = getItemById(payload.id);
            if (item) {
                await openNoteEditorWithNavigation(item);
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

        const body = new URLSearchParams({
            category_id: String(category.id),
            name: itemInput.value.trim(),
        });

        if (category.type === 'links') {
            const manualDescription = linkDescriptionInput?.value.trim();
            if (manualDescription) {
                body.set('content', manualDescription);
            } else {
                setMessage('Lade Seiten-Infos...');
                const meta = await fetchLinkMetadata(itemInput.value.trim());
                if (meta?.title || meta?.description) {
                    body.set('content', [meta.title, meta.description].filter(Boolean).join('\n\n'));
                }
            }
        }

        if (category.type === 'list_quantity' && quantityInput.value.trim() !== '') {
            body.set('quantity', quantityInput.value.trim());
        }

        if (category.type === 'list_due_date' && quantityInput.value.trim() !== '') {
            body.set('due_date', quantityInput.value.trim());
        }

        try {
            await api('add', { method: 'POST', body });
            resetItemForm();
            invalidateCategoryCache(category.id);
            await loadItems();
            setMessage('Artikel hinzugefügt.');
        } catch {
            enqueueAction('add', Object.fromEntries(body.entries()));
            resetItemForm();
            setNetworkStatus();
            setMessage('Offline gespeichert – wird synchronisiert wenn du wieder online bist.');
        }
    }

    async function handleToggle(id, done) {
        // Optimistisch lokal sofort anwenden
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
        } catch {
            enqueueAction('toggle', { id: String(id), done: String(done) });
            setNetworkStatus();
        }
    }

    async function handleDelete(id) {
        try {
            // Optimistisch lokal sofort entfernen
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

            // Versuch API-Call (nicht-blocking)
            try {
                await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
                invalidateCategoryCache(state.categoryId);
            } catch {
                // Offline: enqueue für späteren sync
                enqueueAction('delete', { id: String(id) });
                setNetworkStatus();
            }
        } catch (error) {
            // Final fallback - should not reach here
            setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
        }
    }

    async function handleStatus(id, currentStatus) {
        const next = currentStatus === '' ? 'in_progress' : currentStatus === 'in_progress' ? 'waiting' : '';
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
        const body = new URLSearchParams({
            id: String(id),
            name: state.editDraft.name.trim(),
            barcode: state.editDraft.barcode.trim(),
            quantity: state.editDraft.quantity.trim(),
            due_date: state.editDraft.due_date.trim(),
            content: state.editDraft.content.trim(),
        });

        await api('update', { method: 'POST', body });
        state.editingId = null;
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
        } catch {
            enqueueAction('clear', { category_id: String(category.id) });
            setNetworkStatus();
        }
    }

    return {
        addItem,
        clearDone,
        handleDelete,
        handleEditSave,
        handleIncomingShare,
        handleMove,
        handlePin,
        handleStatus,
        handleToggle,
        uploadSelectedAttachment,
    };
}
