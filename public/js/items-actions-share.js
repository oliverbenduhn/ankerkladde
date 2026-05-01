import { appUrl, api, apiUpload } from './api.js?v=4.3.4';
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

        let description = sanitizeItemField('content', buildSharedLinkDescription(title, text, url));

        if (!description.trim()) {
            setMessage('Lade Seiten-Infos...');
            const meta = await fetchLinkMetadata(url);
            if (meta?.title || meta?.description) {
                description = sanitizeItemField('content', [meta.title, meta.description].filter(Boolean).join('\n\n'));
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
        const noteName = sanitizeItemField('name', title || (cleanedText.length > 60 ? cleanedText.substring(0, 60) + '\u2026' : cleanedText) || 'Geteilte Notiz');
        const noteContent = cleanedText
            ? cleanedText.split('\n')
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

    return { handleIncomingShare };
}
