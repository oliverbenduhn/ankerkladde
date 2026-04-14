import { appUrl, api, apiUpload } from './api.js';
import { createAppUiController } from './app-ui.js';
import { createItemsController } from './items.js';
import { createNavigation } from './navigation.js';
import { createEditorController } from './editor.js';
import { createReorderController } from './reorder.js';
import { applyViewState, createRouter } from './router.js';
import { createScannerController } from './scanner.js';
import { createSwipeController } from './swipe.js';
import {
    BARCODE_FORMATS,
    NOTE_SAVE_DEBOUNCE_MS,
    SCANNER_COOLDOWN_MS,
    getCurrentCategory,
    getCurrentType,
    getTypeConfig,
    isAttachmentCategory,
    isBarcodeCategory,
    isIosWebKit,
    isNotesCategory,
    isScannerSupported,
    normalizePreferences,
    readInitialPreferences,
    scannerState,
    state,
    themeMediaQuery,
} from './state.js';
import { applyThemePreferences, cycleThemeMode } from './theme.js';
import {
    appEl,
    cameraInput,
    clearDoneBtn,
    dropZoneEl,
    fileInput,
    itemForm,
    itemInput,
    listAreaEl,
    listEl,
    modeToggleBtns,
    mehrMenuEl,
    noteEditorBack,
    noteEditorBody,
    noteEditorEl,
    noteSaveStatus,
    noteTitleInput,
    noteToolbar,
    progressEl,
    quantityInput,
    scanAddBtn,
    scanShoppingBtn,
    scannerCloseBtn,
    scannerManualForm,
    scannerManualInput,
    scannerOverlay,
    scannerSubtitle,
    scannerVideo,
    searchBar,
    searchBtn,
    searchClose,
    searchInput,
    sectionTabsEl,
    settingsBtns,
    settingsFrameEl,
    svgIcon,
    tabsToggleBtns,
    themeModeBtns,
    updateBannerEl,
    updateViewportHeight,
} from './ui.js';
import { escapeRegExp, normalizeBarcodeValue, syncAutoHeight } from './utils.js';

const MIN_VISIBLE_TAB_WIDTH = 64;
const MEHR_BUTTON_WIDTH = 48;
let mehrOpen = false;
function resetItemForm() {
    itemForm?.reset();
    syncAutoHeight(itemInput);
    syncAutoHeight(linkDescriptionInput);
    updateFilePickerLabel();
}

let userPreferences = readInitialPreferences();
let noteSaveTimer = null;
let tiptapEditor = null;
let navigation = null;
let router = null;
let appUiController = null;
let itemsController = null;
let scannerController = null;
let editorController = null;
let reorderController = null;
let swipeController = null;

function setUserPreferences(nextPreferences) {
    userPreferences = nextPreferences;
}

function syncSettingsFrameTheme() {
    if (!settingsFrameEl?.contentWindow || state.view !== 'settings') return;
    settingsFrameEl.contentWindow.postMessage({
        type: 'ankerkladde-theme-update',
        preferences: {
            theme_mode: userPreferences.theme_mode,
            light_theme: userPreferences.light_theme,
            dark_theme: userPreferences.dark_theme,
        },
    }, window.location.origin);
}

async function fetchLinkMetadata(url) {
    try {
        const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
        if (!response.ok) return null;
        const data = await response.json();
        return data;
    } catch {
        return null;
    }
}

function triggerHapticFeedback() {
    if ('vibrate' in navigator) {
        navigator.vibrate(12);
    }
}

function getItemById(id) { return itemsController.getItemById(id); }
function getVisibleCategories() { return itemsController.getVisibleCategories(); }
function cacheCurrentCategoryItems() { return itemsController.cacheCurrentCategoryItems(); }
function invalidateCategoryCache(categoryId) { return itemsController.invalidateCategoryCache(categoryId); }
async function loadCategories() { await itemsController.loadCategories(); }
async function savePreferences(patch) { await itemsController.savePreferences(patch); }

function makeCategoryTab(category) {
    const button = document.createElement('button');
    button.className = 'section-tab';
    button.type = 'button';
    button.dataset.categoryId = String(category.id);
    button.setAttribute('aria-label', category.name);
    button.title = category.name;
    if (category.id === state.categoryId) {
        button.setAttribute('aria-current', 'page');
    }

    const icon = document.createElement('span');
    icon.className = 'section-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = category.icon || getTypeConfig(category.type).icon;

    const dot = document.createElement('span');
    dot.className = 'section-dot';

    const label = document.createElement('span');
    label.className = 'section-label';
    label.textContent = category.name;

    button.append(icon, label, dot);
    button.addEventListener('click', () => {
        if (reorderController?.wasTabDragJustFinished()) return;
        void setCategory(category.id);
    });
    return button;
}

function getMaxVisibleTabs(categoryCount) {
    if (!sectionTabsEl || categoryCount <= 0) return 0;

    const navWidth = sectionTabsEl.clientWidth || window.innerWidth || 320;
    const tabsWithoutOverflow = Math.max(1, Math.floor(navWidth / MIN_VISIBLE_TAB_WIDTH));
    if (categoryCount <= tabsWithoutOverflow) {
        return categoryCount;
    }

    return Math.max(1, Math.floor((navWidth - MEHR_BUTTON_WIDTH) / MIN_VISIBLE_TAB_WIDTH));
}

function toggleMehrMenu() {
    mehrOpen = !mehrOpen;
    if (mehrMenuEl) mehrMenuEl.hidden = !mehrOpen;
}

function closeMehrMenu() {
    mehrOpen = false;
    if (mehrMenuEl) mehrMenuEl.hidden = true;
}

function renderCategoryTabs() {
    if (!sectionTabsEl) return;

    sectionTabsEl.replaceChildren();
    if (mehrMenuEl) {
        mehrMenuEl.replaceChildren();
        sectionTabsEl.appendChild(mehrMenuEl); // muss innerhalb der nav sein für position:absolute
    }
    closeMehrMenu();

    const categories = getVisibleCategories();
    const maxVisibleTabs = getMaxVisibleTabs(categories.length);
    const activeIndex = Math.max(categories.findIndex(category => category.id === state.categoryId), 0);
    const maxStart = Math.max(0, categories.length - maxVisibleTabs);
    const windowStart = Math.min(Math.max(0, activeIndex - Math.floor(maxVisibleTabs / 2)), maxStart);
    const visibleTabs = categories.slice(windowStart, windowStart + maxVisibleTabs);
    const visibleTabIds = new Set(visibleTabs.map(category => category.id));
    const overflowCategories = categories.filter(category => !visibleTabIds.has(category.id));

    const fragment = document.createDocumentFragment();

    visibleTabs.forEach(category => {
        fragment.appendChild(makeCategoryTab(category));
    });

    if (overflowCategories.length > 0) {
        const mehrBtn = document.createElement('button');
        mehrBtn.type = 'button';
        mehrBtn.className = 'mehr-btn';
        mehrBtn.setAttribute('aria-label', 'Weitere Bereiche');
        mehrBtn.appendChild(svgIcon('more-horizontal'));
        mehrBtn.addEventListener('click', toggleMehrMenu);
        fragment.appendChild(mehrBtn);

        overflowCategories.forEach(category => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'mehr-item' + (category.id === state.categoryId ? ' active' : '');
            item.dataset.categoryId = String(category.id);

            const icon = document.createElement('span');
            icon.className = 'mehr-item-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = category.icon || getTypeConfig(category.type).icon;

            const label = document.createElement('span');
            label.textContent = category.name;

            item.append(icon, label);
            item.addEventListener('click', () => {
                closeMehrMenu();
                if (reorderController?.wasTabDragJustFinished()) return;
                void setCategory(category.id);
            });
            if (mehrMenuEl) mehrMenuEl.appendChild(item);
        });
    }

    sectionTabsEl.appendChild(fragment);
}

function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isOverdueItem(item) {
    return item.category_type === 'list_due_date'
        && item.done !== 1
        && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date || '')
        && item.due_date < getTodayDateString();
}

function closeScanner() { scannerController.closeScanner(); }
async function handleScannedBarcode(rawValue) { await scannerController.handleScannedBarcode(rawValue); }
async function openScanner(action = state.mode === 'einkaufen' ? 'toggle' : 'add') { await scannerController.openScanner(action); }

async function setCategory(categoryId) { await itemsController.setCategory(categoryId); }
async function loadItems(categoryId = state.categoryId, options = {}) { await itemsController.loadItems(categoryId, options); }
function prefetchAdjacentCategories() { itemsController.prefetchAdjacentCategories(); }
function getVisibleItems() { return itemsController.getVisibleItems(); }
function openSearch() { itemsController.openSearch(); }
function closeSearch() { itemsController.closeSearch(); }
async function doSearch(query) { await itemsController.doSearch(query); }

function getAttachmentTitle(item) {
    return item.name || item.attachmentOriginalName || 'Anhang';
}

function openLightbox(src, alt) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', alt);

    const img = document.createElement('img');
    img.className = 'lightbox-img';
    img.src = src;
    img.alt = alt;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', 'Schließen');
    closeBtn.textContent = '×';

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    function onKey(event) {
        if (event.key === 'Escape') close();
    }

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    overlay.append(img, closeBtn);
    document.body.appendChild(overlay);
    closeBtn.focus();
}

function openItemMenu(item) {
    const overlay = document.createElement('div');
    overlay.className = 'item-menu-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${item.name || 'Eintrag'} Aktionen`);

    const sheet = document.createElement('div');
    sheet.className = 'item-menu-sheet';

    const title = document.createElement('div');
    title.className = 'item-menu-title';
    title.textContent = item.name || getAttachmentTitle(item);
    sheet.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'item-menu-actions';

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    function onKey(event) {
        if (event.key === 'Escape') close();
    }

    function appendAction(label, onClick, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `item-menu-action${className ? ` ${className}` : ''}`;
        button.textContent = label;
        button.addEventListener('click', async event => {
            event.stopPropagation();
            close();
            await onClick();
        });
        actions.appendChild(button);
    }

    if (item.category_type === 'notes') {
        appendAction('Notiz öffnen', () => openNoteEditorWithNavigation(item));
    } else {
        appendAction('Bearbeiten', async () => {
            state.editingId = item.id;
            state.editDraft = {
                name: item.name || '',
                barcode: item.barcode || '',
                quantity: item.quantity || '',
                due_date: item.due_date || '',
                content: item.content || '',
            };
            renderItems();
        });
    }

    appendAction(item.is_pinned ? 'Lösen' : 'Anheften', () => handlePin(item.id, item.is_pinned ? 0 : 1));

    appendAction('Löschen', () => handleDelete(item.id), 'is-danger');
    appendAction('Abbrechen', async () => {}, 'is-secondary');

    sheet.appendChild(actions);
    overlay.appendChild(sheet);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
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
            openLightbox(item.attachmentOriginalUrl || item.attachmentDownloadUrl || item.attachmentUrl, getAttachmentTitle(item));
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

function renderSearchResults() {
    listEl.replaceChildren();
    clearDoneBtn.disabled = true;

    if (state.search.query.trim().length < 2) {
        const li = document.createElement('li');
        li.className = 'empty-state';
        li.textContent = 'Mindestens 2 Zeichen eingeben...';
        listEl.appendChild(li);
        return;
    }

    if (state.search.results.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-state';
        li.textContent = 'Keine Ergebnisse gefunden.';
        listEl.appendChild(li);
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

    listEl.appendChild(fragment);
}

function renderItems() {
    if (state.search.open) {
        renderSearchResults();
        return;
    }

    listEl.replaceChildren();

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
        listEl.appendChild(li);
        return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(item => fragment.appendChild(buildItemNode(item)));
    listEl.appendChild(fragment);
}

async function handleIncomingShare() {
    const params = new URLSearchParams(window.location.search);
    const hasShare = params.has('share') || params.has('title') || params.has('text') || params.has('url');
    if (!hasShare) return;

    history.replaceState(null, '', window.location.pathname);

    const shareParam = params.get('share');
    const title     = params.get('title') || '';
    const text      = params.get('text')  || '';
    // Chrome often puts the URL only in `text`, not in `url`
    const sharedUrl = params.get('url') || /https?:\/\/\S+/.exec(text)?.[0] || '';

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
    await loadItems();
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
    await loadItems();
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
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
            .join('')
        : '';

    const body = new URLSearchParams({ category_id: String(category.id), name: noteName, content: noteContent });
    const payload = await api('add', { method: 'POST', body });
    invalidateCategoryCache(category.id);
    await loadItems();

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
    await loadItems();
    setMessage(category.type === 'images' ? 'Bild hochgeladen.' : 'Datei hochgeladen.');
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
        await uploadSelectedAttachment();
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

    await api('add', { method: 'POST', body });
    resetItemForm();
    invalidateCategoryCache(category.id);
    await loadItems();
    setMessage('Artikel hinzugefügt.');
}

async function handleToggle(id, done) {
    await api('toggle', {
        method: 'POST',
        body: new URLSearchParams({ id: String(id), done: String(done) }),
    });
    const item = getItemById(id);
    if (item) {
        item.done = done;
        cacheCurrentCategoryItems();
        renderItems();
    } else {
        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }
}

async function handleDelete(id) {
    await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
    if (state.noteEditorId === id) {
        await closeNoteEditor();
    }
    invalidateCategoryCache(state.categoryId);
    await loadItems();
    setMessage('Artikel gelöscht.');
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

    await api('clear', {
        method: 'POST',
        body: new URLSearchParams({ category_id: String(category.id) }),
    });
    invalidateCategoryCache(category.id);
    await loadItems();
    setMessage('Erledigte Artikel entfernt.');
}

function formatDate(value) {
    try {
        return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
    } catch {
        return value;
    }
}

async function openNoteEditor(item) { await editorController.openNoteEditor(item); }
async function openNoteEditorWithNavigation(item) { await editorController.openNoteEditorWithNavigation(item); }
async function closeNoteEditor() { await editorController.closeNoteEditor(); }
function scheduleNoteSave() { editorController.scheduleNoteSave(); }
function setMessage(text, isError = false) { appUiController.setMessage(text, isError); }
function setUploadProgress(fraction) { appUiController.setUploadProgress(fraction); }
function makeUploadProgressCallback() { return appUiController.makeUploadProgressCallback(); }
function updateHeaders() { appUiController.updateHeaders(); }
function updateUploadUi() { appUiController.updateUploadUi(); }
function updateFilePickerLabel() { appUiController.updateFilePickerLabel(); }
function setScannerStatus(text, isError = false) { appUiController.setScannerStatus(text, isError); }
function setNetworkStatus() { appUiController.setNetworkStatus(); }
function applyTabsVisibility(hidden) { appUiController.applyTabsVisibility(hidden); }
function formatBytes(sizeBytes) { return appUiController.formatBytes(sizeBytes); }

router = createRouter({
    closeNoteEditor,
    closeScanner,
    closeSearch,
    doSearch,
    getItemById,
    openNoteEditor,
    openScanner,
    openSearch,
    scannerState,
    setCategory,
    updateHeaders,
});

navigation = createNavigation({
    applyRouteState: router.applyRouteState,
    getCurrentRouteState: router.getCurrentRouteState,
});

appUiController = createAppUiController();

itemsController = createItemsController({
    applyTabsVisibility,
    applyThemePreferences,
    closeNoteEditor,
    closeScanner,
    closeSettings: () => router.closeSettings(),
    getUserPreferences: () => userPreferences,
    navigation,
    normalizePreferences,
    renderCategoryTabs,
    renderItems,
    scannerState,
    setMessage,
    setUserPreferences,
    updateHeaders,
    updateUploadUi,
});

scannerController = createScannerController({
    getCurrentCategory,
    getItemById,
    getScannerCooldownMs: () => SCANNER_COOLDOWN_MS,
    getScannerSupportedFormats: () => BARCODE_FORMATS,
    handleToggle,
    invalidateCategoryCache,
    loadItems,
    navigation,
    setMessage,
    setScannerStatus,
    triggerHapticFeedback,
    updateFilePickerLabel,
});

editorController = createEditorController({
    cacheCurrentCategoryItems,
    getItemById,
    getNoteSaveTimer: () => noteSaveTimer,
    navigation,
    setNoteSaveTimer: value => { noteSaveTimer = value; },
    setTiptapEditor: value => { tiptapEditor = value; },
    getTiptapEditor: () => tiptapEditor,
});

reorderController = createReorderController({
    applyTabsVisibility,
    cacheCurrentCategoryItems,
    getItemById,
    getUserPreferences: () => userPreferences,
    getVisibleCategories,
    invalidateCategoryCache,
    loadCategories,
    loadItems,
    renderCategoryTabs,
    setMessage,
    triggerHapticFeedback,
    updateHeaders,
});

swipeController = createSwipeController({
    getUserPreferences: () => userPreferences,
    getVisibleCategories,
    setCategory,
});

itemForm?.addEventListener('submit', event => {
    void addItem(event).catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', true);
    });
});

fileInput?.addEventListener('change', () => {
    updateFilePickerLabel();

    if (!isAttachmentCategory()) return;
    if (!fileInput.files?.[0]) return;

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

itemInput?.addEventListener('input', () => {
    syncAutoHeight(itemInput);
});
syncAutoHeight(itemInput);

cameraBtn?.addEventListener('click', () => cameraInput?.click());
cameraInput?.addEventListener('change', () => {
    if (!cameraInput?.files?.[0] || !fileInput) return;
    fileInput.files = cameraInput.files;
    updateFilePickerLabel();

    if (!isAttachmentCategory()) return;

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

clearDoneBtn?.addEventListener('click', () => {
    void clearDone().catch(error => {
        setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
    });
});

scanAddBtn?.addEventListener('click', () => {
    void openScanner('add').then(() => {
        if (scannerState.open) {
            navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
        }
    }).catch(error => {
        setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
    });
});

scanShoppingBtn?.addEventListener('click', () => {
    void openScanner('toggle').then(() => {
        if (scannerState.open) {
            navigation.pushHistoryState({ screen: 'scanner', action: scannerState.action, categoryId: state.categoryId });
        }
    }).catch(error => {
        setScannerStatus(error instanceof Error ? error.message : 'Scanner konnte nicht gestartet werden.', true);
    });
});

scannerCloseBtn?.addEventListener('click', () => navigation.navigateBackOrReplace({ screen: 'list' }));
scannerOverlay?.addEventListener('click', event => {
    if (event.target === scannerOverlay) {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

scannerManualForm?.addEventListener('submit', event => {
    event.preventDefault();
    const barcode = normalizeBarcodeValue(scannerManualInput?.value || '');
    if (barcode === '') {
        setScannerStatus('Bitte Barcode eingeben.', true);
        return;
    }

    void handleScannedBarcode(barcode);
});

modeToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        if (scannerState.open) {
            closeScanner();
        }
        state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
        appEl.dataset.mode = state.mode;
        void savePreferences({ mode: state.mode });
        renderItems();
    });
});

themeModeBtns.forEach(button => {
    button.addEventListener('click', () => {
        void cycleThemeMode(userPreferences, setUserPreferences, setMessage).then(() => {
            syncSettingsFrameTheme();
        });
    });
});

settingsBtns.forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        const targetTab = button.dataset.settingsTab || 'app';
        if (state.view === 'settings' && state.settingsTab === targetTab) {
            router.closeSettings();
            navigation.navigateBackOrReplace({ screen: 'list' });
            return;
        }
        void router.openSettings(targetTab).then(() => {
            navigation.pushHistoryState({ screen: 'settings', tab: state.settingsTab });
        }).catch(() => {});
    });
});

settingsFrameEl?.addEventListener('load', () => {
    try {
        const frameUrl = new URL(settingsFrameEl.contentWindow?.location.href || settingsFrameEl.src, window.location.href);
        if (frameUrl.protocol === 'about:') {
            return;
        }
        state.settingsTab = frameUrl.searchParams.get('tab') === 'extension' ? 'extension' : 'app';
        if (state.view === 'settings') {
            navigation.replaceCurrentHistoryState({ screen: 'settings', tab: state.settingsTab });
            void loadCategories()
                .then(() => {
                    updateHeaders();
                    syncSettingsFrameTheme();
                })
                .catch(() => {});
        }
    } catch {
        // same-origin expected; ignore if unavailable
    }
});

window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'ankerkladde-settings-close') {
        router.closeSettings();
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

window.addEventListener('popstate', event => {
    void navigation.handlePopState(event, setMessage);
});

tabsToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
        applyTabsVisibility(hidden);
        void savePreferences({ tabs_hidden: hidden });
    });
});

document.addEventListener('click', (e) => {
    if (mehrOpen && !e.target.closest('.mehr-menu') && !e.target.closest('.mehr-btn')) {
        closeMehrMenu();
    }
});

window.addEventListener('resize', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.addEventListener('orientationchange', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.addEventListener('pageshow', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.visualViewport?.addEventListener('resize', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

window.visualViewport?.addEventListener('scroll', () => {
    updateViewportHeight();
    renderCategoryTabs();
});

linkDescriptionInput?.addEventListener('input', () => {
    syncAutoHeight(linkDescriptionInput);
});

[itemInput, quantityInput, linkDescriptionInput].forEach(field => {
    field?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        if (event.isComposing) return;
        if (field instanceof HTMLTextAreaElement && event.shiftKey) return;
        event.preventDefault();
        itemForm?.requestSubmit();
    });
});

searchBtn?.addEventListener('click', () => {
    if (state.view === 'settings' || state.noteEditorId !== null) return;
    if (state.search.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (scannerState.open) closeScanner();
    openSearch();
    navigation.pushHistoryState({ screen: 'search', query: state.search.query });
});
searchClose?.addEventListener('click', () => {
    navigation.navigateBackOrReplace({ screen: 'list' });
});
searchInput?.addEventListener('input', () => {
    void doSearch(searchInput.value);
});
searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeSearch();
    }
});

noteEditorBack?.addEventListener('click', () => {
    navigation.navigateBackOrReplace({ screen: 'list' });
});

noteTitleInput?.addEventListener('input', scheduleNoteSave);

noteToolbar?.addEventListener('click', event => {
    editorController.handleToolbarClick(event);
});

dropZoneEl?.addEventListener('dragover', event => {
    if (!isAttachmentCategory()) return;
    event.preventDefault();
    dropZoneEl.classList.add('drop-active');
});

dropZoneEl?.addEventListener('dragleave', () => {
    dropZoneEl.classList.remove('drop-active');
});

dropZoneEl?.addEventListener('drop', event => {
    if (!isAttachmentCategory()) return;
    event.preventDefault();
    dropZoneEl.classList.remove('drop-active');
    const file = event.dataTransfer?.files?.[0] || null;
    if (!file || !fileInput) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    updateFilePickerLabel();

    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

document.addEventListener('paste', event => {
    if (!isAttachmentCategory()) return;
    if (state.noteEditorId !== null) return; // let TipTap handle paste in note editor
    const file = Array.from(event.clipboardData?.items || [])
        .find(item => item.kind === 'file')
        ?.getAsFile() || null;
    if (!file || !fileInput) return;
    event.preventDefault();
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    updateFilePickerLabel();
    void uploadSelectedAttachment().catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Upload fehlgeschlagen.', true);
    });
});

window.addEventListener('online', setNetworkStatus);
if (themeMediaQuery) {
    const onThemeMediaChange = () => {
        if (userPreferences.theme_mode === 'auto') applyThemePreferences(userPreferences);
    };
    if (typeof themeMediaQuery.addEventListener === 'function') {
        themeMediaQuery.addEventListener('change', onThemeMediaChange);
    } else if (typeof themeMediaQuery.addListener === 'function') {
        themeMediaQuery.addListener(onThemeMediaChange);
    }
}
window.addEventListener('offline', setNetworkStatus);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && scannerState.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.search.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.noteEditorId !== null) {
        navigation.navigateBackOrReplace({ screen: 'list' });
        return;
    }
    if (event.key === 'Escape' && state.view === 'settings') {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && scannerState.open) {
        navigation.navigateBackOrReplace({ screen: 'list' });
    }
});

{
    let deferredInstallPrompt = null;
    const installBannerEl = document.getElementById('installBanner');
    const installBtn = document.getElementById('installBtn');
    const installDismiss = document.getElementById('installDismiss');

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        if (userPreferences.install_banner_dismissed) return;
        deferredInstallPrompt = e;
        if (installBannerEl) installBannerEl.hidden = false;
    });
    installBtn?.addEventListener('click', async () => {
        if (installBannerEl) installBannerEl.hidden = true;
        await deferredInstallPrompt?.prompt();
        deferredInstallPrompt = null;
    });
    installDismiss?.addEventListener('click', () => {
        if (installBannerEl) installBannerEl.hidden = true;
        deferredInstallPrompt = null;
        void savePreferences({ install_banner_dismissed: true });
    });
}

(async function init() {
    try {
        applyThemePreferences(userPreferences);
        updateViewportHeight();
        setNetworkStatus();
        applyViewState();
        state.mode = userPreferences.mode;
        appEl.dataset.mode = state.mode;
        reorderController.initCategoryTabReorder();
        reorderController.initItemDragReorder();
        swipeController.initCategorySwipe();
        await loadCategories();
        updateHeaders();
        await loadItems();
        const initialRoute = navigation.readInitialRouteFromUrl();
        if (initialRoute.screen !== 'list') {
            await router.applyRouteState(initialRoute, route => route);
        }
        navigation.replaceCurrentHistoryState();
        prefetchAdjacentCategories();
        await handleIncomingShare();
        navigation.replaceCurrentHistoryState();
    } catch (error) {
        setMessage(error instanceof Error ? error.message : 'App konnte nicht geladen werden.', true);
    }

    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register(appBasePath + 'sw.js?v=2.0.21');
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                w?.addEventListener('statechange', () => {
                    if (w.state === 'installed' && navigator.serviceWorker.controller) {
                        if (updateBannerEl) updateBannerEl.hidden = false;
                    }
                });
            });
        } catch {
            // SW registration failure is non-fatal
        }
    }

    document.getElementById('updateReloadBtn')?.addEventListener('click', async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        window.location.reload();
    });
})();
