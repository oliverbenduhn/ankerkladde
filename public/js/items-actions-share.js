import { appUrl, api, apiUpload } from './api.js?v=4.3.4';
import { escapeRegExp, limitText, sanitizeItemField, sanitizeItemPayload } from './utils.js?v=4.3.11';

export function createShareActions(deps) {
    const {
        getCurrentCategory,
        getVisibleCategories,
        loadItems,
        makeUploadProgressCallback,
        openNoteEditorWithNavigation,
        setCategory,
        setMessage,
        invalidateCategoryCache,
        getItemById,
    } = deps;

    const CATEGORY_TYPE_LABELS = {
        list_quantity: 'Liste',
        list_due_date: 'Aufgaben',
        notes: 'Notizen',
        images: 'Bilder',
        files: 'Dateien',
        links: 'Links',
    };

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

    function categoryIconUrl(category) {
        const icon = category.icon || category.type || 'einkauf';
        return appUrl(`category-icon.php?icon=${encodeURIComponent(icon)}`);
    }

    function makeCategoryOption(category, badge = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'share-category-option';
        button.dataset.categoryId = String(category.id);

        const icon = document.createElement('img');
        icon.className = 'share-category-icon';
        icon.src = categoryIconUrl(category);
        icon.alt = '';
        icon.draggable = false;

        const textWrap = document.createElement('span');
        textWrap.className = 'share-category-text';

        const name = document.createElement('span');
        name.className = 'share-category-name';
        name.textContent = category.name || 'Kategorie';

        const type = document.createElement('span');
        type.className = 'share-category-type';
        type.textContent = CATEGORY_TYPE_LABELS[category.type] || category.type || '';

        textWrap.append(name, type);
        button.append(icon, textWrap);

        if (badge) {
            const badgeEl = document.createElement('span');
            badgeEl.className = 'share-category-badge';
            badgeEl.textContent = badge;
            button.appendChild(badgeEl);
        }

        return button;
    }

    function orderShareCategories(categories, recommendedType) {
        const currentCategoryId = Number(getCurrentCategory?.()?.id || 0);

        return [...categories].sort((a, b) => {
            const aRecommended = a.type === recommendedType ? 0 : 1;
            const bRecommended = b.type === recommendedType ? 0 : 1;
            if (aRecommended !== bRecommended) return aRecommended - bRecommended;

            const aCurrent = Number(a.id) === currentCategoryId ? 0 : 1;
            const bCurrent = Number(b.id) === currentCategoryId ? 0 : 1;
            if (aCurrent !== bCurrent) return aCurrent - bCurrent;

            return Number(a.sort_order || 0) - Number(b.sort_order || 0);
        });
    }

    function pickShareCategory({ title, subtitle, recommendedType, isCompatible }) {
        const categories = getVisibleCategories().filter(isCompatible);
        if (categories.length === 0) return Promise.resolve(null);

        return new Promise(resolve => {
            const currentCategoryId = Number(getCurrentCategory?.()?.id || 0);
            const overlay = document.createElement('div');
            overlay.className = 'share-category-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'shareCategoryTitle');

            const sheet = document.createElement('div');
            sheet.className = 'share-category-sheet';

            const header = document.createElement('div');
            header.className = 'share-category-header';

            const headingWrap = document.createElement('div');
            const heading = document.createElement('h2');
            heading.id = 'shareCategoryTitle';
            heading.className = 'share-category-title';
            heading.textContent = title;

            const sub = document.createElement('p');
            sub.className = 'share-category-subtitle';
            sub.textContent = subtitle;
            headingWrap.append(heading, sub);

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'header-icon-btn';
            closeBtn.setAttribute('aria-label', 'Auswahl abbrechen');
            closeBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

            header.append(headingWrap, closeBtn);

            const list = document.createElement('div');
            list.className = 'share-category-list';

            orderShareCategories(categories, recommendedType).forEach(category => {
                const badge = category.type === recommendedType
                    ? 'Empfohlen'
                    : Number(category.id) === currentCategoryId ? 'Zuletzt' : '';
                const option = makeCategoryOption(category, badge);
                option.addEventListener('click', () => {
                    cleanup();
                    resolve(category);
                });
                list.appendChild(option);
            });

            sheet.append(header, list);
            overlay.appendChild(sheet);

            function cleanup() {
                document.removeEventListener('keydown', onKeydown);
                overlay.remove();
            }

            function cancel() {
                cleanup();
                resolve(null);
            }

            function onKeydown(event) {
                if (event.key === 'Escape') cancel();
            }

            closeBtn.addEventListener('click', cancel);
            overlay.addEventListener('click', event => {
                if (event.target === overlay) cancel();
            });
            document.addEventListener('keydown', onKeydown);
            document.body.appendChild(overlay);
            list.querySelector('button')?.focus();
        });
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
        const category = await pickShareCategory({
            title: 'Speichern in',
            subtitle: filename,
            recommendedType: targetType,
            isCompatible: candidate => candidate.type === 'files' || (isImage && candidate.type === 'images'),
        });
        if (!category) {
            setMessage('Teilen abgebrochen.', true);
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
        setMessage(category.type === 'images' ? 'Bild gespeichert.' : 'Datei gespeichert.');
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

    function firstNonEmpty(...values) {
        return values.find(value => typeof value === 'string' && value.trim() !== '')?.trim() || '';
    }

    function extractSharedUrl(...values) {
        const match = values
            .filter(value => typeof value === 'string' && value.trim() !== '')
            .join('\n')
            .match(/https?:\/\/[^\s<>"']+/i);

        return match?.[0].replace(/[),.;:!?]+$/g, '') || '';
    }

    function buildNoteHtml(title, text, url = '') {
        const raw = [title, text, url]
            .filter((value, index, values) => typeof value === 'string' && value.trim() !== '' && values.indexOf(value) === index)
            .join('\n');
        const cleanedText = limitText(raw, 8000);

        return cleanedText
            ? cleanedText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
                .join('')
            : '';
    }

    async function addSharedListItem(category, title, text, url = '') {
        await setCategory(category.id);

        const name = sanitizeItemField('name', title || url || (text.length > 80 ? `${text.substring(0, 80)}...` : text) || 'Geteilter Eintrag');
        const payload = { category_id: category.id, name };

        if (category.type === 'list_due_date') {
            payload.content = sanitizeItemField('content', [text, url].filter(Boolean).join('\n'));
        }

        await api('add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sanitizeItemPayload(payload))
        });
        invalidateCategoryCache(category.id);
        await loadItems(category.id, { useCache: false });
        setMessage('Eintrag gespeichert.');
    }

    async function handleSharedLink(category, url, title = '', text = '') {
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

    async function handleSharedText(category, title, text, url = '') {
        await setCategory(category.id);

        const cleanedText = limitText(text, 8000);
        const noteName = sanitizeItemField('name', title || (cleanedText.length > 60 ? cleanedText.substring(0, 60) + '\u2026' : cleanedText) || url || 'Geteilte Notiz');
        const noteContent = buildNoteHtml(title ? '' : title, text, url);

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
        const sharedUrl = firstNonEmpty(cachedShare?.url, params.get('url')) || extractSharedUrl(text, title);

        try {
            if (shareParam === 'file') {
                await handleSharedFile();
            } else if (sharedUrl) {
                const category = await pickShareCategory({
                    title: 'Link speichern in',
                    subtitle: title || sharedUrl,
                    recommendedType: 'links',
                    isCompatible: candidate => candidate.type !== 'images' && candidate.type !== 'files',
                });
                if (!category) {
                    setMessage('Teilen abgebrochen.', true);
                    return;
                }

                if (category.type === 'links') {
                    await handleSharedLink(category, sharedUrl, title, text);
                } else if (category.type === 'notes') {
                    await handleSharedText(category, title, text, sharedUrl);
                } else {
                    await addSharedListItem(category, title, text, sharedUrl);
                }
            } else if (text || title) {
                const category = await pickShareCategory({
                    title: 'Text speichern in',
                    subtitle: title || (text.length > 80 ? `${text.substring(0, 80)}...` : text),
                    recommendedType: 'notes',
                    isCompatible: candidate => candidate.type !== 'links' && candidate.type !== 'images' && candidate.type !== 'files',
                });
                if (!category) {
                    setMessage('Teilen abgebrochen.', true);
                    return;
                }

                if (category.type === 'notes') {
                    await handleSharedText(category, title, text);
                } else {
                    await addSharedListItem(category, title, text);
                }
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Teilen fehlgeschlagen.', true);
        }
    }

    return { handleIncomingShare };
}
