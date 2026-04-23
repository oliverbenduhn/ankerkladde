import { isNotesCategory, state } from './state.js?v=4.2.50';
import { clearDoneBtn, listEl, progressEl, svgIcon } from './ui.js?v=4.2.50';
import { normalizeBarcodeValue, syncAutoHeight } from './utils.js?v=4.2.50';
import { createLightboxController } from './lightbox.js?v=4.2.50';
import { createItemMenuController } from './item-menu.js?v=4.2.50';

export function createItemsViewController(deps) {
    const {
        closeSearch,
        formatBytes,
        formatDate,
        getItemById,
        getVisibleItems,
        handleDelete,
        handleEditSave,
        handlePin,
        handleStatus,
        handleToggle,
        isOverdueItem,
        openNoteEditorWithNavigation,
        setCategory,
    } = deps;

    const lightbox = createLightboxController();
    const itemMenu = createItemMenuController({
        getAttachmentTitle: (item) => item.name || item.attachmentOriginalName || 'Anhang',
        openNoteEditorWithNavigation,
        handlePin,
        handleDelete,
        handleEditStart: (item) => {
            state.editingId = item.id;
            state.editDraft = {
                name: item.name || '',
                barcode: item.barcode || '',
                quantity: item.quantity || '',
                due_date: item.due_date || '',
                content: item.content || '',
            };
            renderItems();
        },
    });

    function getAttachmentTitle(item) {
        return item.name || item.attachmentOriginalName || 'Anhang';
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

    function buildReadOnlyContent(item, content) {
        const type = item.category_type;

        if ((type === 'images' || type === 'files') && !item.has_attachment) {
            content.classList.add('item-content-attachment', 'item-content-missing-attachment');

            const meta = document.createElement('div');
            meta.className = 'attachment-meta';

            const titleEl = document.createElement('span');
            titleEl.className = 'item-name attachment-title';
            titleEl.textContent = getAttachmentTitle(item);
            meta.appendChild(titleEl);

            const missingEl = document.createElement('span');
            missingEl.className = 'attachment-subline';
            missingEl.textContent = 'Anhang nicht verfügbar';
            meta.appendChild(missingEl);

            content.appendChild(meta);
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

            const meta = document.createElement('div');
            meta.className = 'attachment-meta';

            const titleEl = document.createElement('span');
            titleEl.className = 'item-name attachment-title';
            titleEl.textContent = getAttachmentTitle(item);
            meta.appendChild(titleEl);

            if (item.attachmentOriginalName) {
                const originalEl = document.createElement('span');
                originalEl.className = 'attachment-subline';
                originalEl.textContent = item.attachmentOriginalName;
                meta.appendChild(originalEl);
            }

            const actions = document.createElement('div');
            actions.className = 'attachment-inline-actions';

            const downloadLink = document.createElement('a');
            downloadLink.className = 'attachment-download-link';
            downloadLink.href = item.attachmentDownloadUrl || item.attachmentUrl;
            downloadLink.target = '_blank';
            downloadLink.rel = 'noopener noreferrer';
            downloadLink.download = item.attachmentOriginalName || getAttachmentTitle(item);
            downloadLink.textContent = 'Download';
            downloadLink.addEventListener('click', event => event.stopPropagation());
            actions.appendChild(downloadLink);

            meta.appendChild(actions);
            content.append(previewLink, meta);
            return;
        }

        if (type === 'files' && item.has_attachment) {
            content.classList.add('item-content-attachment', 'item-content-file');

            const meta = document.createElement('div');
            meta.className = 'attachment-meta';

            const titleEl = document.createElement('span');
            titleEl.className = 'item-name attachment-title';
            titleEl.textContent = getAttachmentTitle(item);
            meta.appendChild(titleEl);

            const detailValues = [
                item.attachmentOriginalName || null,
                item.attachmentMediaType || null,
                item.attachmentSizeBytes > 0 ? formatBytes(item.attachmentSizeBytes) : null,
            ].filter(Boolean);

            if (detailValues.length > 0) {
                const detailsEl = document.createElement('span');
                detailsEl.className = 'attachment-subline';
                detailsEl.textContent = detailValues.join(' · ');
                meta.appendChild(detailsEl);
            }

            const actions = document.createElement('div');
            actions.className = 'attachment-inline-actions';

            const downloadLink = document.createElement('a');
            downloadLink.className = 'attachment-download-link';
            downloadLink.href = item.attachmentDownloadUrl || item.attachmentUrl;
            downloadLink.target = '_blank';
            downloadLink.rel = 'noopener noreferrer';
            downloadLink.download = item.attachmentOriginalName || getAttachmentTitle(item);
            downloadLink.textContent = 'Download';
            downloadLink.addEventListener('click', event => event.stopPropagation());
            actions.appendChild(downloadLink);

            meta.appendChild(actions);
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
        } else {
            const nameEl = document.createElement('span');
            nameEl.className = 'item-name';
            nameEl.textContent = item.name;
            content.appendChild(nameEl);

            if (item.category_type === 'list_due_date' && item.content) {
                const noteEl = document.createElement('span');
                noteEl.className = 'item-note';
                noteEl.textContent = item.content;
                content.appendChild(noteEl);
            }

            if (item.category_type === 'list_due_date') {
                const STATUS_LABELS = { in_progress: 'In Arbeit', waiting: 'Wartet' };
                const STATUS_ICONS = { in_progress: 'play', waiting: 'clock' };
                const st = item.status || '';
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = `item-status-chip${st ? ` item-status-chip--${st}` : ''}`;
                chip.setAttribute('aria-label', st ? `Status: ${STATUS_LABELS[st]} – wechseln` : 'Status setzen');
                if (st) {
                    chip.appendChild(svgIcon(STATUS_ICONS[st]));
                    chip.append(STATUS_LABELS[st]);
                }
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
        nameInput.value = state.editDraft.name;
        nameInput.addEventListener('input', event => {
            state.editDraft.name = event.target.value;
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
            barcodeInput.value = state.editDraft.barcode;
            barcodeInput.addEventListener('input', event => {
                state.editDraft.barcode = normalizeBarcodeValue(event.target.value);
                barcodeInput.value = state.editDraft.barcode;
            });
            fields.appendChild(barcodeInput);

            const quantity = document.createElement('input');
            quantity.type = 'text';
            quantity.className = 'item-edit-input';
            quantity.maxLength = 40;
            quantity.value = state.editDraft.quantity;
            quantity.placeholder = 'Menge';
            quantity.addEventListener('input', event => {
                state.editDraft.quantity = event.target.value;
            });
            fields.appendChild(quantity);
        }

        if (item.category_type === 'list_due_date') {
            const dueDate = document.createElement('input');
            dueDate.type = 'date';
            dueDate.className = 'item-edit-input';
            dueDate.value = state.editDraft.due_date;
            dueDate.addEventListener('input', event => {
                state.editDraft.due_date = event.target.value;
            });
            fields.appendChild(dueDate);

            const noteInput = document.createElement('textarea');
            noteInput.className = 'item-edit-input item-edit-textarea';
            noteInput.rows = 3;
            noteInput.maxLength = 4000;
            noteInput.placeholder = 'Notiz optional';
            noteInput.value = state.editDraft.content;
            noteInput.addEventListener('input', event => {
                state.editDraft.content = event.target.value;
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
            descriptionInput.value = state.editDraft.content;
            descriptionInput.addEventListener('input', event => {
                state.editDraft.content = event.target.value;
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

    function buildItemNode(item) {
        const li = document.createElement('li');
        li.className = `item-card ${item.done === 1 ? 'done' : 'open'}${item.is_pinned ? ' is-pinned' : ''}${isOverdueItem(item) ? ' is-overdue' : ''}`;
        li.dataset.itemId = String(item.id);

        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'item-drag-handle';
        dragHandle.setAttribute('aria-label', `${item.name || 'Eintrag'} verschieben`);
        dragHandle.appendChild(svgIcon('grip'));

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'toggle';
        checkbox.checked = item.done === 1;
        checkbox.setAttribute('aria-label', `${item.name} umschalten`);
        checkbox.addEventListener('change', () => void handleToggle(item.id, item.done === 1 ? 0 : 1));

        const content = document.createElement('div');
        content.className = 'item-content';

        if (state.editingId === item.id) {
            buildEditContent(item, content);
        } else {
            buildReadOnlyContent(item, content);
        }

        const actions = document.createElement('div');
        actions.className = 'item-actions';

        if (state.editingId === item.id) {
            actions.appendChild(buildActionButton('check', `${item.name} speichern`, () => void handleEditSave(item.id)));
            actions.appendChild(buildActionButton('rotate-ccw', `${item.name} abbrechen`, () => {
                state.editingId = null;
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

        li.append(dragHandle, checkbox, content, actions);

        if (item.category_type === 'notes') {
            li.addEventListener('click', event => {
                if (event.target.closest('.toggle') || event.target.closest('.btn-item-menu') || event.target.closest('.item-drag-handle')) return;
                void openNoteEditorWithNavigation(item);
            });
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
            li.addEventListener('click', async () => {
                closeSearch();
                await setCategory(item.category_id);
                if (item.category_type === 'notes') {
                    const current = getItemById(item.id);
                    if (current) {
                        await openNoteEditorWithNavigation(current);
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
        renderItems,
    };
}
