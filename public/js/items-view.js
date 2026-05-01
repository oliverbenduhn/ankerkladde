import { isNotesCategory, state } from './state.js?v=4.3.4';
import { clearDoneBtn, listEl, progressEl, svgIcon } from './ui.js?v=4.3.4';
import { normalizeBarcodeValue, sanitizeItemField, syncAutoHeight } from './utils.js?v=4.3.11';
import { createLightboxController } from './lightbox.js?v=4.3.4';
import { createItemMenuController } from './item-menu.js?v=4.3.10';

export function createItemsViewController(deps) {
    const {
        closeSearch,
        formatBytes,
        formatDate,
        getItemById,
        getMoveTargetCategories,
        getVisibleItems,
        handleDelete,
        handleEditSave,
        handleMove,
        handlePin,
        handleStatus,
        handleToggle,
        isOverdueItem,
        openNoteEditorWithNavigation,
        openTodoEditor,
        setCategory,
        setMessage,
    } = deps;

    const lightbox = createLightboxController();
    const previewDecoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8', { fatal: true }) : null;
    const previewTextCache = new Map();
    const itemMenu = createItemMenuController({
        getAttachmentTitle: (item) => item.name || item.attachmentOriginalName || 'Anhang',
        getMoveTargetCategories,
        openNoteEditorWithNavigation,
        openTodoEditor,
        handlePin,
        handleDelete,
        handleMove,
        onActionError: (error) => {
            const message = error instanceof Error && error.message
                ? error.message
                : 'Aktion fehlgeschlagen.';
            setMessage(message, true);
        },
        handleEditStart: (item) => {
            state.editingId = item.id;
            state.editDraft = createEditDraft(item);
            renderItems();
        },
    });

    function createEditDraft(item) {
        return {
            itemId: item.id,
            categoryId: item.category_id,
            name: item.name || '',
            barcode: item.barcode || '',
            quantity: item.quantity || '',
            due_date: item.due_date || '',
            content: item.content || '',
        };
    }

    function resetEditDraft() {
        state.editingId = null;
        state.editDraft = createEditDraft({ id: null, category_id: null });
    }

    function getEditDraftForItem(item) {
        if (state.editDraft?.itemId !== item.id) {
            state.editDraft = createEditDraft(item);
        }
        return state.editDraft;
    }

    function getAttachmentTitle(item) {
        return item.name || item.attachmentOriginalName || 'Anhang';
    }

    function hasLikelyMojibake(value) {
        return value.includes('Ã') || value.includes('Â') || value.includes('â');
    }

    function mojibakeScore(value) {
        let score = 0;
        for (let i = 0; i < value.length; i += 1) {
            const code = value.charCodeAt(i);
            if (code === 0x00C3 || code === 0x00C2 || code === 0x00E2) score += 1;
        }
        return score;
    }

    function repairPreviewEncoding(value) {
        if (typeof value !== 'string' || value === '' || !previewDecoder || !hasLikelyMojibake(value)) return value;

        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const code = value.charCodeAt(i);
            if (code > 0xFF) return value;
            bytes[i] = code;
        }

        try {
            const decoded = previewDecoder.decode(bytes);
            return mojibakeScore(decoded) < mojibakeScore(value) ? decoded : value;
        } catch {
            return value;
        }
    }

    function decodeHtmlEntities(value) {
        const namedEntities = {
            amp: '&',
            apos: "'",
            gt: '>',
            lt: '<',
            nbsp: ' ',
            quot: '"',
        };

        return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
            const normalized = entity.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(namedEntities, normalized)) {
                return namedEntities[normalized];
            }

            if (normalized.startsWith('#x')) {
                const codePoint = Number.parseInt(normalized.slice(2), 16);
                return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match;
            }

            if (normalized.startsWith('#')) {
                const codePoint = Number.parseInt(normalized.slice(1), 10);
                return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match;
            }

            return match;
        });
    }

    function htmlPreviewText(value) {
        if (typeof value !== 'string' || value === '') return '';

        return decodeHtmlEntities(
            value
                .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
                .replace(/<[^>]*>/g, ' ')
        ).replace(/\s+/g, ' ').trim();
    }

    function getNotePreviewText(content) {
        if (typeof content !== 'string' || content === '') return '';
        if (previewTextCache.has(content)) return previewTextCache.get(content);

        const preview = repairPreviewEncoding(htmlPreviewText(content));
        previewTextCache.set(content, preview);
        if (previewTextCache.size > 250) {
            previewTextCache.delete(previewTextCache.keys().next().value);
        }
        return preview;
    }

    function openItemMenu(item) {
        itemMenu.open(item);
    }

    function createImagePreviewPlaceholder(label = 'Kein Vorschaubild') {
        const placeholder = document.createElement('span');
        placeholder.className = 'attachment-preview-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '🖼';
        placeholder.title = label;
        return placeholder;
    }

    function createAttachmentSubline(text) {
        const subline = document.createElement('span');
        subline.className = 'attachment-subline';
        subline.textContent = text;
        return subline;
    }

    function createDownloadLink(item) {
        const downloadLink = document.createElement('a');
        downloadLink.className = 'attachment-download-link';
        downloadLink.href = item.attachmentDownloadUrl || item.attachmentUrl;
        downloadLink.target = '_blank';
        downloadLink.rel = 'noopener noreferrer';
        downloadLink.download = item.attachmentOriginalName || getAttachmentTitle(item);
        downloadLink.textContent = 'Download';
        downloadLink.addEventListener('click', event => event.stopPropagation());
        return downloadLink;
    }

    function createAttachmentMeta(item, sublineText = '') {
        const meta = document.createElement('div');
        meta.className = 'attachment-meta';

        const titleEl = document.createElement('span');
        titleEl.className = 'item-name attachment-title';
        titleEl.textContent = getAttachmentTitle(item);
        meta.appendChild(titleEl);

        if (sublineText) {
            meta.appendChild(createAttachmentSubline(sublineText));
        }

        return meta;
    }

    function appendDownloadAction(meta, item) {
        const actions = document.createElement('div');
        actions.className = 'attachment-inline-actions';
        actions.appendChild(createDownloadLink(item));
        meta.appendChild(actions);
    }

    function buildReadOnlyContent(item, content) {
        const type = item.category_type;

        if ((type === 'images' || type === 'files') && !item.has_attachment) {
            content.classList.add('item-content-attachment', 'item-content-missing-attachment');

            content.appendChild(createAttachmentMeta(item, 'Anhang nicht verfügbar'));
            return;
        }

        if (type === 'images' && item.has_attachment) {
            content.classList.add('item-content-attachment', 'item-content-image');

            const previewLink = document.createElement('button');
            previewLink.type = 'button';
            previewLink.className = 'attachment-preview-link';
            previewLink.setAttribute('aria-label', `${getAttachmentTitle(item)} öffnen`);
            previewLink.addEventListener('click', event => {
                event.stopPropagation();
                lightbox.open(item.attachmentOriginalUrl || item.attachmentDownloadUrl || item.attachmentUrl, getAttachmentTitle(item));
            });

            const preview = document.createElement('img');
            preview.className = 'attachment-image-preview';
            preview.src = item.attachmentPreviewUrl || '';
            preview.alt = getAttachmentTitle(item);
            preview.loading = 'lazy';
            preview.decoding = 'async';
            preview.addEventListener('error', () => {
                preview.remove();
                if (!previewLink.querySelector('.attachment-preview-placeholder')) {
                    previewLink.appendChild(createImagePreviewPlaceholder());
                }
            }, { once: true });
            previewLink.appendChild(preview);

            if (!item.attachmentPreviewUrl) {
                preview.remove();
                previewLink.appendChild(createImagePreviewPlaceholder());
            }

            const meta = createAttachmentMeta(item, item.attachmentOriginalName || '');
            appendDownloadAction(meta, item);
            content.append(previewLink, meta);
            return;
        }

        if (type === 'files' && item.has_attachment) {
            content.classList.add('item-content-attachment', 'item-content-file');

            const detailValues = [
                item.attachmentOriginalName || null,
                item.attachmentMediaType || null,
                item.attachmentSizeBytes > 0 ? formatBytes(item.attachmentSizeBytes) : null,
            ].filter(Boolean);

            const meta = createAttachmentMeta(item, detailValues.join(' · '));
            appendDownloadAction(meta, item);
            content.appendChild(meta);
            return;
        }

        if (type === 'links') {
            content.classList.add('item-content-link');

            if (item.content) {
                const meta = document.createElement('div');
                meta.className = 'item-link-meta';

                const link = document.createElement('a');
                link.className = 'item-name item-link';
                link.href = item.name;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.name;
                meta.appendChild(link);

                const description = document.createElement('span');
                description.className = 'item-link-description';
                description.textContent = item.content;
                meta.appendChild(description);

                content.appendChild(meta);
            } else {
                const link = document.createElement('a');
                link.className = 'item-name item-link';
                link.href = item.name;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.name;
                content.appendChild(link);
            }
        } else if (type === 'notes') {
            content.classList.add('item-content-note');

            if (item.content) {
                const meta = document.createElement('div');
                meta.className = 'item-note-meta';

                const title = document.createElement('span');
                title.className = 'item-name item-note-title';
                title.textContent = item.name;
                meta.appendChild(title);

                const notePreview = document.createElement('span');
                notePreview.className = 'item-note-preview';
                notePreview.textContent = getNotePreviewText(item.content);
                meta.appendChild(notePreview);

                content.appendChild(meta);
            } else {
                const title = document.createElement('span');
                title.className = 'item-name';
                title.textContent = item.name;
                content.appendChild(title);
            }
        } else {
            const nameEl = item.category_type === 'list_due_date'
                ? document.createElement('button')
                : document.createElement('span');
            nameEl.className = item.category_type === 'list_due_date'
                ? 'item-name item-name-button'
                : 'item-name';
            nameEl.textContent = item.name;
            if (item.category_type === 'list_due_date') {
                nameEl.type = 'button';
                nameEl.setAttribute('aria-label', `${item.name} bearbeiten`);
                nameEl.addEventListener('click', event => {
                    event.stopPropagation();
                    openTodoEditor(item);
                });
            }
            content.appendChild(nameEl);

            if (item.category_type === 'list_due_date' && item.content) {
                const details = document.createElement('details');
                details.className = 'item-note-details';
                details.addEventListener('click', event => event.stopPropagation());

                const summary = document.createElement('summary');
                summary.className = 'item-note-summary';
                summary.textContent = 'Notiz';
                details.appendChild(summary);

                const noteEl = document.createElement('span');
                noteEl.className = 'item-note';
                noteEl.textContent = item.content;
                details.appendChild(noteEl);

                content.appendChild(details);
            }

            if (item.category_type === 'list_due_date') {
                const STATUS_LABELS = { '': 'Offen', in_progress: 'In Arbeit', waiting: 'Wartet' };
                const STATUS_ICONS = { '': 'circle', in_progress: 'play', waiting: 'clock' };
                const st = item.status || '';
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `item-status-chip item-status-chip--${st}`;
                chip.setAttribute('aria-label', `Status: ${STATUS_LABELS[st]} – wechseln`);
                chip.appendChild(svgIcon(STATUS_ICONS[st]));
                chip.append(STATUS_LABELS[st]);
                chip.addEventListener('click', event => {
                    event.stopPropagation();
                    void handleStatus(item.id, st);
                });
                content.appendChild(chip);
            }
        }

        if (item.due_date) {
            const badge = document.createElement('span');
            badge.className = 'quantity-badge date-badge';
            if (isOverdueItem(item)) {
                badge.classList.add('is-overdue');
            }
            badge.textContent = formatDate(item.due_date);
            content.appendChild(badge);
        } else if (item.quantity) {
            const badge = document.createElement('span');
            badge.className = 'quantity-badge';
            badge.textContent = item.quantity;
            content.appendChild(badge);
        }
    }

    function buildEditContent(item, content) {
        const draft = getEditDraftForItem(item);
        const fields = document.createElement('div');
        fields.className = 'item-edit-fields';

        const nameInput = document.createElement('textarea');
        nameInput.className = 'item-edit-input item-edit-textarea edit-name-input';
        nameInput.rows = 5;
        nameInput.maxLength = 120;
        nameInput.placeholder = item.category_type === 'links' ? 'https://...' : 'Eintrag';
        if (item.category_type === 'links') {
            nameInput.rows = 3;
            nameInput.inputMode = 'url';
        }
        nameInput.value = draft.name;
        nameInput.addEventListener('input', event => {
            draft.name = sanitizeItemField('name', event.target.value);
            if (event.target.value !== draft.name) event.target.value = draft.name;
            syncAutoHeight(nameInput);
        });
        syncAutoHeight(nameInput);
        fields.appendChild(nameInput);

        if (item.category_type === 'list_quantity') {
            const barcodeInput = document.createElement('input');
            barcodeInput.type = 'text';
            barcodeInput.inputMode = 'numeric';
            barcodeInput.className = 'item-edit-input';
            barcodeInput.maxLength = 64;
            barcodeInput.placeholder = 'Barcode';
            barcodeInput.value = draft.barcode;
            barcodeInput.addEventListener('input', event => {
                draft.barcode = normalizeBarcodeValue(event.target.value);
                barcodeInput.value = draft.barcode;
            });
            fields.appendChild(barcodeInput);

            const quantity = document.createElement('input');
            quantity.type = 'text';
            quantity.className = 'item-edit-input';
            quantity.maxLength = 40;
            quantity.value = draft.quantity;
            quantity.placeholder = 'Menge';
            quantity.addEventListener('input', event => {
                draft.quantity = sanitizeItemField('quantity', event.target.value);
                if (event.target.value !== draft.quantity) event.target.value = draft.quantity;
            });
            fields.appendChild(quantity);
        }

        if (item.category_type === 'list_due_date') {
            const dueDate = document.createElement('input');
            dueDate.type = 'date';
            dueDate.className = 'item-edit-input';
            dueDate.value = draft.due_date;
            dueDate.addEventListener('input', event => {
                draft.due_date = sanitizeItemField('due_date', event.target.value);
                if (event.target.value !== draft.due_date) event.target.value = draft.due_date;
            });
            fields.appendChild(dueDate);

            const noteInput = document.createElement('textarea');
            noteInput.className = 'item-edit-input item-edit-textarea item-edit-textarea--note';
            noteInput.rows = 6;
            noteInput.maxLength = 8000;
            noteInput.placeholder = 'Notiz optional';
            noteInput.value = draft.content;
            noteInput.addEventListener('input', event => {
                draft.content = sanitizeItemField('content', event.target.value);
                if (event.target.value !== draft.content) event.target.value = draft.content;
                syncAutoHeight(noteInput);
            });
            syncAutoHeight(noteInput);
            fields.appendChild(noteInput);
        }

        if (item.category_type === 'links') {
            const descriptionInput = document.createElement('textarea');
            descriptionInput.className = 'item-edit-input item-edit-textarea';
            descriptionInput.rows = 3;
            descriptionInput.maxLength = 4000;
            descriptionInput.placeholder = 'Beschreibung optional';
            descriptionInput.value = draft.content;
            descriptionInput.addEventListener('input', event => {
                draft.content = sanitizeItemField('content', event.target.value);
                if (event.target.value !== draft.content) event.target.value = draft.content;
                syncAutoHeight(descriptionInput);
            });
            syncAutoHeight(descriptionInput);
            fields.appendChild(descriptionInput);
        }

        content.appendChild(fields);
    }

    function buildActionButton(iconName, label, onClick, className = 'btn-item-action') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.appendChild(svgIcon(iconName));
        button.setAttribute('aria-label', label);
        button.addEventListener('click', event => {
            event.stopPropagation();
            onClick();
        });
        return button;
    }

    function isNestedInteractiveTarget(event, root) {
        const target = event.target;
        if (!(target instanceof Element)) return false;
        const interactive = target.closest('button, a, input, textarea, select, [tabindex], [role="button"]');
        return Boolean(interactive && interactive !== root);
    }

    function makeListItemButton(li, label, onActivate) {
        li.setAttribute('role', 'button');
        li.tabIndex = 0;
        li.setAttribute('aria-label', label);

        li.addEventListener('click', event => {
            if (isNestedInteractiveTarget(event, li)) return;
            onActivate();
        });

        li.addEventListener('keydown', event => {
            if (isNestedInteractiveTarget(event, li)) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onActivate();
        });
    }

    function buildItemNode(item) {
        const li = document.createElement('li');
        li.className = `item-card item-type-${item.category_type} ${item.done === 1 ? 'done' : 'open'}${item.is_pinned ? ' is-pinned' : ''}${isOverdueItem(item) ? ' is-overdue' : ''}`;
        li.dataset.itemId = String(item.id);


        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'toggle';
        checkbox.checked = item.done === 1;
        checkbox.setAttribute('aria-label', `${item.name} umschalten`);
        checkbox.addEventListener('change', () => void handleToggle(item.id, item.done === 1 ? 0 : 1));

        const content = document.createElement('div');
        content.className = 'item-content';

        if (state.editingId === item.id && item.category_type !== 'list_due_date') {
            buildEditContent(item, content);
        } else {
            buildReadOnlyContent(item, content);
        }

        const actions = document.createElement('div');
        actions.className = 'item-actions';

        if (state.editingId === item.id) {
            actions.appendChild(buildActionButton('check', `${item.name} speichern`, () => void handleEditSave(item.id)));
            actions.appendChild(buildActionButton('rotate-ccw', `${item.name} abbrechen`, () => {
                resetEditDraft();
                renderItems();
            }));
        } else {
            const menuButton = document.createElement('button');
            menuButton.type = 'button';
            menuButton.className = 'btn-item-menu';
            menuButton.setAttribute('aria-label', `${item.name} Aktionen`);
            menuButton.appendChild(svgIcon('more-horizontal'));
            menuButton.addEventListener('click', event => {
                event.stopPropagation();
                openItemMenu(item);
            });
            actions.appendChild(menuButton);
        }

        li.append(checkbox, content, actions);

        if (item.category_type === 'notes') {
            makeListItemButton(li, `${item.name} öffnen`, () => void openNoteEditorWithNavigation(item));
        }

        return li;
    }

    function renderSearchResults() {
        if (state.search.query.trim().length < 2) {
            const li = document.createElement('li');
            li.className = 'empty-state';
            li.textContent = 'Mindestens 2 Zeichen eingeben...';
            listEl.replaceChildren(li);
            clearDoneBtn.disabled = true;
            return;
        }

        if (state.search.results.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-state';
            li.textContent = 'Keine Ergebnisse gefunden.';
            listEl.replaceChildren(li);
            clearDoneBtn.disabled = true;
            return;
        }

        const fragment = document.createDocumentFragment();
        state.search.results.forEach(item => {
            const li = document.createElement('li');
            li.className = 'item-card search-result';

            const content = document.createElement('div');
            content.className = 'item-content';

            const nameEl = document.createElement('span');
            nameEl.className = 'item-name';
            nameEl.textContent = item.name;
            content.appendChild(nameEl);

            const badge = document.createElement('span');
            badge.className = 'search-result-section';
            badge.textContent = item.category_name;
            content.appendChild(badge);

            li.appendChild(content);
            makeListItemButton(li, `${item.name} in ${item.category_name} öffnen`, async () => {
                closeSearch();
                await setCategory(item.category_id);
                if (item.category_type === 'notes') {
                    const current = getItemById(item.id);
                    if (current) {
                        await openNoteEditorWithNavigation(current);
                    }
                } else if (item.category_type === 'list_due_date') {
                    const current = getItemById(item.id);
                    if (current) {
                        openTodoEditor(current);
                    }
                }
            });
            fragment.appendChild(li);
        });

        clearDoneBtn.disabled = true;
        listEl.replaceChildren(fragment);
    }

    function renderItems() {
        if (state.search.open) {
            renderSearchResults();
            return;
        }

        const items = getVisibleItems();
        if (state.editingId !== null && !items.some(item => item.id === state.editingId)) {
            resetEditDraft();
        }
        const doneCount = items.filter(item => item.done === 1).length;
        progressEl.textContent = `${doneCount} / ${items.length}`;
        clearDoneBtn.disabled = doneCount === 0;

        if (items.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-state';
            li.textContent = isNotesCategory()
                ? 'Noch keine Notizen. Titel eingeben und + drücken.'
                : state.mode === 'liste'
                    ? 'Noch nichts auf der Liste. Füge oben etwas hinzu.'
                    : 'Keine Einträge vorhanden.';
            listEl.replaceChildren(li);
            return;
        }

        const fragment = document.createDocumentFragment();
        items.forEach(item => fragment.appendChild(buildItemNode(item)));
        listEl.replaceChildren(fragment);
    }

    return {
        buildItemNode,
        renderItems,
    };
}
