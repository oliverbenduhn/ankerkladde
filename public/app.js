'use strict';

const csrfMeta = document.querySelector('meta[name="csrf-token"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing');
const appBasePathMeta = document.querySelector('meta[name="app-base-path"]');
const csrfToken = csrfMeta.content;
const appBasePath = appBasePathMeta?.content || '/';

const appEl = document.getElementById('app');
const listEl = document.getElementById('list');
const listAreaEl = document.querySelector('.list-area');
const itemForm = document.getElementById('itemForm');
const itemInput = document.getElementById('itemInput');
const quantityInput = document.getElementById('quantityInput');
const fileInput = document.getElementById('fileInput');
const fileInputGroup = document.getElementById('fileInputGroup');
const filePickerButton = document.getElementById('filePickerButton');
const filePickerName = document.getElementById('filePickerName');
const cameraBtn = document.getElementById('cameraBtn');
const cameraInput = document.getElementById('cameraInput');
const dropZoneEl = document.getElementById('dropZone');
const inputHintEl = document.getElementById('inputHint');
const clearDoneBtn = document.getElementById('clearDoneBtn');
const messageEl = document.getElementById('message');
const uploadProgressEl = document.getElementById('uploadProgress');
const uploadProgressBarEl = document.getElementById('uploadProgressBar');
const progressEl = document.getElementById('progress');
const searchBtn = document.getElementById('searchBtn');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const searchClose = document.getElementById('searchClose');
const modeToggleBtns = document.querySelectorAll('.btn-mode-toggle');
const sectionTabsEl = document.getElementById('sectionTabs');
const tabsToggleBtns = document.querySelectorAll('.btn-tabs-toggle');
const networkStatusEl = document.getElementById('networkStatus');
const diskFreeEl = document.getElementById('diskFreeDisplay');
const noteEditorEl = document.getElementById('noteEditor');
const noteEditorBack = document.getElementById('noteEditorBack');
const noteTitleInput = document.getElementById('noteTitleInput');
const noteSaveStatus = document.getElementById('noteSaveStatus');
const noteEditorBody = document.getElementById('noteEditorEl');
const noteToolbar = document.getElementById('noteToolbar');
const userPreferencesScript = document.getElementById('userPreferences');

const TYPE_CONFIG = {
    list_quantity: { icon: '🛒', title: name => name, shoppingTitle: name => name, placeholder: 'Artikel...', quantityMode: 'text' },
    list_due_date: { icon: '✅', title: name => name, shoppingTitle: name => name, placeholder: 'Aufgabe...', quantityMode: 'date' },
    notes: { icon: '📝', title: name => name, shoppingTitle: name => name, placeholder: 'Titel...', quantityMode: 'hidden' },
    images: { icon: '🖼️', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    files: { icon: '📁', title: name => name, shoppingTitle: name => name, placeholder: 'Titel optional...', quantityMode: 'hidden' },
    links: { icon: '🔗', title: name => name, shoppingTitle: name => name, placeholder: 'https://...', quantityMode: 'hidden' },
};

const DEFAULT_PREFERENCES = {
    mode: 'liste',
    tabs_hidden: false,
    category_swipe_enabled: true,
    last_category_id: null,
    install_banner_dismissed: false,
};

const state = {
    categories: [],
    categoryId: null,
    items: [],
    mode: 'liste',
    editingId: null,
    editDraft: { name: '', quantity: '', due_date: '' },
    search: { open: false, query: '', results: [] },
    noteEditorId: null,
    diskFreeBytes: null,
};

let userPreferences = readInitialPreferences();
let messageTimer = null;
let noteSaveTimer = null;
let tiptapEditor = null;
let tabDragJustFinished = false;
let swipeState = null;
const NOTE_SAVE_DEBOUNCE_MS = 800;
const TAB_REORDER_LONG_PRESS_MS = 400;
const CATEGORY_SWIPE_THRESHOLD_PX = 72;

function appUrl(path) {
    return new URL(path, `${window.location.origin}${appBasePath}`).toString();
}

function readInitialPreferences() {
    if (!userPreferencesScript) {
        return { ...DEFAULT_PREFERENCES };
    }

    try {
        return normalizePreferences(JSON.parse(userPreferencesScript.textContent || '{}'));
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

function normalizePreferences(preferences) {
    return {
        mode: preferences?.mode === 'einkaufen' ? 'einkaufen' : 'liste',
        tabs_hidden: Boolean(preferences?.tabs_hidden),
        category_swipe_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'category_swipe_enabled') || Boolean(preferences?.category_swipe_enabled),
        last_category_id: Number.isInteger(Number(preferences?.last_category_id)) ? Number(preferences.last_category_id) : null,
        install_banner_dismissed: Boolean(preferences?.install_banner_dismissed),
    };
}

function getCurrentCategory() {
    return state.categories.find(category => category.id === Number(state.categoryId)) || null;
}

function getCurrentType() {
    return getCurrentCategory()?.type || 'list_quantity';
}

function getTypeConfig(type = getCurrentType()) {
    return TYPE_CONFIG[type] || TYPE_CONFIG.list_quantity;
}

function isAttachmentCategory(type = getCurrentType()) {
    return type === 'images' || type === 'files';
}

function isNotesCategory(type = getCurrentType()) {
    return type === 'notes';
}

function setMessage(text, isError = false) {
    clearTimeout(messageTimer);
    messageEl.textContent = text;
    messageEl.classList.toggle('is-error', isError);
    messageEl.classList.add('is-visible');
    messageTimer = setTimeout(() => messageEl.classList.remove('is-visible'), 2500);
}

function triggerHapticFeedback() {
    if ('vibrate' in navigator) {
        navigator.vibrate(12);
    }
}

function setUploadProgress(fraction) {
    if (!uploadProgressEl || !uploadProgressBarEl) return;

    if (fraction <= 0) {
        uploadProgressEl.hidden = true;
        uploadProgressBarEl.style.width = '0%';
        return;
    }

    uploadProgressEl.hidden = false;
    uploadProgressBarEl.style.width = `${Math.round(fraction * 100)}%`;

    if (fraction >= 1) {
        window.setTimeout(() => {
            uploadProgressEl.hidden = true;
            uploadProgressBarEl.style.width = '0%';
        }, 600);
    }
}

function makeUploadProgressCallback() {
    return fraction => {
        setUploadProgress(fraction);
        messageEl.classList.remove('is-error');
        messageEl.classList.add('is-visible');
        messageEl.textContent = fraction < 1 ? `Hochladen ${Math.round(fraction * 100)} %` : 'Wird gespeichert...';
    };
}

async function api(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const fetchOptions = { ...options };

    if (method !== 'GET') {
        fetchOptions.headers = {
            'X-CSRF-Token': csrfToken,
            ...(fetchOptions.headers || {}),
        };
    }

    const [actionName, ...queryParts] = action.split('&');
    const url = method === 'GET'
        ? appUrl(`api.php?action=${encodeURIComponent(actionName)}${queryParts.length > 0 ? `&${queryParts.join('&')}` : ''}`)
        : appUrl(`api.php?action=${encodeURIComponent(actionName)}`);

    const response = await fetch(url, fetchOptions);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Unbekannter Fehler');
    }

    return payload;
}

function apiUpload(action, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', appUrl(`api.php?action=${encodeURIComponent(action)}`));
        xhr.setRequestHeader('X-CSRF-Token', csrfToken);

        if (typeof onProgress === 'function') {
            xhr.upload.addEventListener('progress', event => {
                if (event.lengthComputable) {
                    onProgress(event.loaded / event.total);
                }
            });
        }

        xhr.addEventListener('load', () => {
            let payload = {};
            try {
                payload = JSON.parse(xhr.responseText);
            } catch {}

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
                return;
            }

            reject(new Error(payload.error || 'Unbekannter Fehler'));
        });

        xhr.addEventListener('error', () => reject(new Error('Failed to fetch')));
        xhr.send(formData);
    });
}

function normalizeItem(item) {
    return {
        ...item,
        id: Number(item.id),
        category_id: Number(item.category_id),
        done: Number(item.done),
        sort_order: Number(item.sort_order),
        is_pinned: Number(item.is_pinned || 0),
        has_attachment: Number(item.has_attachment || 0),
        attachmentSizeBytes: Number(item.attachment_size_bytes || 0),
        attachmentOriginalName: item.attachment_original_name || '',
        attachmentMediaType: item.attachment_media_type || '',
        attachmentUrl: item.attachment_url || '',
        attachmentPreviewUrl: item.attachment_preview_url || '',
        attachmentDownloadUrl: item.attachment_download_url || '',
    };
}

function getItemById(id) {
    return state.items.find(item => item.id === Number(id)) || null;
}

function getVisibleCategories() {
    return state.categories.filter(category => Number(category.is_hidden) === 0);
}

async function loadCategories() {
    const payload = await api('categories_list');
    state.categories = Array.isArray(payload.categories) ? payload.categories.map(category => ({
        ...category,
        id: Number(category.id),
        sort_order: Number(category.sort_order),
        is_hidden: Number(category.is_hidden),
    })) : [];

    if (payload.preferences) {
        userPreferences = normalizePreferences(payload.preferences);
    }

    const visibleCategories = getVisibleCategories();
    const preferredCategoryId = Number(userPreferences.last_category_id);
    const preferredVisible = visibleCategories.find(category => category.id === preferredCategoryId);

    state.categoryId = preferredVisible?.id || visibleCategories[0]?.id || state.categories[0]?.id || null;
    renderCategoryTabs();
    applyTabsVisibility(userPreferences.tabs_hidden);
}

async function savePreferences(patch) {
    const body = new URLSearchParams();
    Object.entries(patch).forEach(([key, value]) => {
        body.set(key, String(value));
    });

    const payload = await api('preferences', { method: 'POST', body });
    if (payload.preferences) {
        userPreferences = normalizePreferences(payload.preferences);
    }
}

function renderCategoryTabs() {
    if (!sectionTabsEl) return;

    sectionTabsEl.replaceChildren();

    const fragment = document.createDocumentFragment();

    getVisibleCategories().forEach(category => {
        const button = document.createElement('button');
        button.className = 'section-tab';
        button.dataset.categoryId = String(category.id);
        if (category.id === state.categoryId) {
            button.setAttribute('aria-current', 'page');
        }

        const icon = document.createElement('span');
        icon.className = 'section-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = category.icon || getTypeConfig(category.type).icon;

        const label = document.createElement('span');
        label.className = 'section-label';
        label.textContent = category.name;

        button.append(icon, label);
        button.addEventListener('click', () => {
            if (tabDragJustFinished) return;
            void setCategory(category.id);
        });
        fragment.appendChild(button);
    });

    sectionTabsEl.appendChild(fragment);
}

function updateCategoryOrderState(orderedIds) {
    const positions = new Map(orderedIds.map((id, index) => [Number(id), index + 1]));
    state.categories = [...state.categories]
        .map(category => ({
            ...category,
            sort_order: positions.get(Number(category.id)) ?? category.sort_order,
        }))
        .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
}

async function persistCategoryOrder(orderedIds) {
    const hiddenIds = state.categories
        .filter(category => Number(category.is_hidden) === 1)
        .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
        .map(category => Number(category.id));
    const allOrderedIds = [...orderedIds, ...hiddenIds];
    const body = new URLSearchParams();
    allOrderedIds.forEach(id => body.append('ids[]', String(id)));

    try {
        await api('categories_reorder', { method: 'POST', body });
        updateCategoryOrderState(allOrderedIds);
        renderCategoryTabs();
        applyTabsVisibility(userPreferences.tabs_hidden);
    } catch (error) {
        await loadCategories();
        updateHeaders();
        setMessage(error instanceof Error ? error.message : 'Reihenfolge konnte nicht gespeichert werden.', true);
    }
}

function initCategoryTabReorder() {
    if (!sectionTabsEl) return;

    sectionTabsEl.addEventListener('pointerdown', event => {
        const tab = event.target.closest('.section-tab');
        if (!tab || (event.button !== undefined && event.button !== 0)) return;

        const startX = event.clientX;
        const startY = event.clientY;
        let dragActive = false;

        const longPressTimer = window.setTimeout(() => {
            dragActive = true;
            triggerHapticFeedback();
            tab.classList.add('is-tab-dragging');
            sectionTabsEl.classList.add('is-tab-reordering');
            try {
                tab.setPointerCapture(event.pointerId);
            } catch {}
        }, TAB_REORDER_LONG_PRESS_MS);

        function cleanup() {
            window.clearTimeout(longPressTimer);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
            document.removeEventListener('pointercancel', onEnd);
        }

        function onMove(moveEvent) {
            if (!dragActive) {
                if (Math.abs(moveEvent.clientX - startX) > 8 || Math.abs(moveEvent.clientY - startY) > 8) {
                    cleanup();
                }
                return;
            }

            const others = Array.from(sectionTabsEl.querySelectorAll('.section-tab:not(.is-tab-dragging)'));
            others.forEach(other => other.classList.remove('tab-drop-before', 'tab-drop-after'));

            let insertBefore = null;
            for (const other of others) {
                const rect = other.getBoundingClientRect();
                if (moveEvent.clientX < rect.left + rect.width / 2) {
                    insertBefore = other;
                    other.classList.add('tab-drop-before');
                    break;
                }
            }

            if (!insertBefore && others.length > 0) {
                others[others.length - 1].classList.add('tab-drop-after');
            }

            tab._tabInsertBefore = insertBefore;
        }

        function onEnd() {
            cleanup();

            if (!dragActive) return;

            tab.classList.remove('is-tab-dragging');
            sectionTabsEl.classList.remove('is-tab-reordering');
            Array.from(sectionTabsEl.querySelectorAll('.section-tab')).forEach(other => {
                other.classList.remove('tab-drop-before', 'tab-drop-after');
            });

            const insertBefore = tab._tabInsertBefore || null;
            delete tab._tabInsertBefore;

            if (insertBefore) {
                sectionTabsEl.insertBefore(tab, insertBefore);
            } else {
                sectionTabsEl.appendChild(tab);
            }

            const orderedIds = Array.from(sectionTabsEl.querySelectorAll('.section-tab'))
                .map(button => Number(button.dataset.categoryId))
                .filter(Number.isInteger);

            tabDragJustFinished = true;
            window.setTimeout(() => {
                tabDragJustFinished = false;
            }, 150);

            void persistCategoryOrder(orderedIds);
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
    });
}

function updateHeaders() {
    const category = getCurrentCategory();
    if (!category) return;

    const config = getTypeConfig(category.type);
    const titleListe = document.getElementById('titleListe');
    const titleShopping = document.getElementById('titleShopping');
    if (titleListe) titleListe.textContent = config.title(category.name);
    if (titleShopping) titleShopping.textContent = config.shoppingTitle(category.name);
    document.title = category.name;

    if (itemInput) {
        itemInput.placeholder = config.placeholder;
        itemInput.required = !isAttachmentCategory(category.type);
    }

    if (quantityInput) {
        if (config.quantityMode === 'text') {
            quantityInput.type = 'text';
            quantityInput.placeholder = 'Menge';
            quantityInput.style.display = '';
        } else if (config.quantityMode === 'date') {
            quantityInput.type = 'date';
            quantityInput.placeholder = '';
            quantityInput.style.display = '';
            if (!quantityInput.value) {
                quantityInput.value = new Date().toISOString().slice(0, 10);
            }
        } else {
            quantityInput.style.display = 'none';
            quantityInput.value = '';
        }
    }

    if (searchInput) {
        searchInput.placeholder = 'In allen Kategorien suchen...';
    }

    updateUploadUi();
}

function updateUploadUi() {
    const type = getCurrentType();
    const uploadCategory = isAttachmentCategory(type);
    const imageCategory = type === 'images';

    if (fileInputGroup) fileInputGroup.hidden = !uploadCategory;
    if (inputHintEl) {
        inputHintEl.hidden = true;
        inputHintEl.textContent = '';
    }

    const submitBtn = itemForm?.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.hidden = uploadCategory;

    if (filePickerButton) filePickerButton.textContent = imageCategory ? 'Bild wählen' : 'Datei wählen';
    if (fileInput) {
        fileInput.accept = imageCategory ? 'image/*' : '';
    }
    if (cameraBtn) cameraBtn.hidden = !imageCategory;
    if (dropZoneEl) {
        dropZoneEl.hidden = !uploadCategory;
        const label = dropZoneEl.querySelector('.drop-zone-label');
        if (label) {
            label.textContent = imageCategory
                ? 'Bild hierher ziehen oder aus Zwischenablage einfügen'
                : 'Datei hierher ziehen oder aus Zwischenablage einfügen';
        }
    }
    if (diskFreeEl) {
        diskFreeEl.hidden = !uploadCategory || state.diskFreeBytes === null;
        if (!diskFreeEl.hidden) {
            diskFreeEl.textContent = formatBytes(state.diskFreeBytes) + ' frei';
        }
    }

    updateFilePickerLabel();
}

function updateFilePickerLabel() {
    if (!filePickerName) return;
    const attachment = fileInput?.files?.[0] || null;
    filePickerName.textContent = attachment ? attachment.name : 'Keine Datei ausgewählt';
}

function formatBytes(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size < 0) return 'Unbekannt';
    if (size < 1024) return `${size} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value.toLocaleString('de-DE', {
        minimumFractionDigits: value < 10 ? 1 : 0,
        maximumFractionDigits: 1,
    })} ${units[unitIndex]}`;
}

async function setCategory(categoryId) {
    if (state.noteEditorId !== null) {
        await closeNoteEditor();
    }

    state.categoryId = Number(categoryId);
    renderCategoryTabs();
    updateHeaders();
    await savePreferences({ last_category_id: state.categoryId });
    await loadItems();
}

async function loadItems() {
    const category = getCurrentCategory();
    if (!category) {
        state.items = [];
        renderItems();
        return;
    }

    const payload = await api(`list&category_id=${encodeURIComponent(category.id)}`);
    state.items = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
    state.diskFreeBytes = typeof payload.disk_free_bytes === 'number' ? payload.disk_free_bytes : null;
    renderItems();
    updateUploadUi();
}

function getVisibleItems() {
    const items = [...state.items].sort((a, b) => {
        if (state.mode === 'einkaufen') {
            const doneDiff = a.done - b.done;
            if (doneDiff !== 0) return doneDiff;
        }
        if (b.is_pinned !== a.is_pinned) return b.is_pinned - a.is_pinned;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.id - b.id;
    });

    if (state.mode === 'einkaufen') {
        return items;
    }

    return items;
}

function openSearch() {
    state.search.open = true;
    appEl.classList.add('is-searching');
    searchBar?.removeAttribute('hidden');
    searchBtn?.classList.add('is-active');
    if (searchInput) {
        searchInput.value = state.search.query;
        searchInput.focus();
    }
    renderItems();
}

function closeSearch() {
    state.search = { open: false, query: '', results: [] };
    appEl.classList.remove('is-searching');
    searchBar?.setAttribute('hidden', '');
    searchBtn?.classList.remove('is-active');
    renderItems();
}

async function doSearch(query) {
    state.search.query = query;

    if (query.trim().length < 2) {
        state.search.results = [];
        renderItems();
        return;
    }

    try {
        const payload = await api(`search&q=${encodeURIComponent(query.trim())}`);
        state.search.results = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
    } catch (error) {
        state.search.results = [];
        setMessage(error instanceof Error ? error.message : 'Suche fehlgeschlagen.', true);
    }

    renderItems();
}

function buildReadOnlyContent(item, content) {
    const type = item.category_type;

    if (type === 'images' && item.has_attachment) {
        const preview = document.createElement('img');
        preview.className = 'attachment-image-preview';
        preview.src = item.attachmentUrl;
        preview.alt = item.name;
        preview.loading = 'lazy';
        content.appendChild(preview);
    }

    if (type === 'links') {
        const link = document.createElement('a');
        link.className = 'item-name item-link';
        link.href = item.name;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = item.name;
        content.appendChild(link);
    } else {
        const nameEl = document.createElement('span');
        nameEl.className = 'item-name';
        nameEl.textContent = item.name;
        content.appendChild(nameEl);
    }

    if (item.due_date) {
        const badge = document.createElement('span');
        badge.className = 'quantity-badge date-badge';
        badge.textContent = formatDate(item.due_date);
        content.appendChild(badge);
    } else if (item.quantity) {
        const badge = document.createElement('span');
        badge.className = 'quantity-badge';
        badge.textContent = item.quantity;
        content.appendChild(badge);
    }

    if ((type === 'files' || type === 'images') && item.has_attachment) {
        const link = document.createElement('a');
        link.className = 'attachment-download-link';
        link.href = item.attachmentDownloadUrl || item.attachmentUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Download';
        content.appendChild(link);
    }
}

function buildEditContent(item, content) {
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'item-edit-input edit-name-input';
    nameInput.value = state.editDraft.name;
    nameInput.addEventListener('input', event => {
        state.editDraft.name = event.target.value;
    });
    content.appendChild(nameInput);

    if (item.category_type === 'list_quantity') {
        const quantity = document.createElement('input');
        quantity.type = 'text';
        quantity.className = 'item-edit-input';
        quantity.value = state.editDraft.quantity;
        quantity.placeholder = 'Menge';
        quantity.addEventListener('input', event => {
            state.editDraft.quantity = event.target.value;
        });
        content.appendChild(quantity);
    }

    if (item.category_type === 'list_due_date') {
        const dueDate = document.createElement('input');
        dueDate.type = 'date';
        dueDate.className = 'item-edit-input';
        dueDate.value = state.editDraft.due_date;
        dueDate.addEventListener('input', event => {
            state.editDraft.due_date = event.target.value;
        });
        content.appendChild(dueDate);
    }
}

function buildItemNode(item) {
    const li = document.createElement('li');
    li.className = `item-card ${item.done === 1 ? 'done' : 'open'}`;
    li.dataset.itemId = String(item.id);

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
        actions.appendChild(buildActionButton('✓', `${item.name} speichern`, () => void handleEditSave(item.id)));
        actions.appendChild(buildActionButton('↺', `${item.name} abbrechen`, () => {
            state.editingId = null;
            renderItems();
        }));
    } else if (item.category_type !== 'notes') {
        actions.appendChild(buildActionButton('✎', `${item.name} bearbeiten`, () => {
            state.editingId = item.id;
            state.editDraft = { name: item.name || '', quantity: item.quantity || '', due_date: item.due_date || '' };
            renderItems();
        }));
    }

    actions.appendChild(buildActionButton('×', `${item.name} löschen`, () => void handleDelete(item.id), 'btn-delete'));

    li.append(checkbox, content, actions);

    if (item.category_type === 'notes') {
        li.addEventListener('click', event => {
            if (event.target.closest('.toggle') || event.target.closest('.btn-delete')) return;
            void openNoteEditor(item);
        });
    }

    return li;
}

function buildActionButton(text, label, onClick, className = 'btn-item-action') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
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
                    await openNoteEditor(current);
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

async function addItem(event) {
    event.preventDefault();
    const category = getCurrentCategory();
    if (!category) return;

    if (category.type === 'notes') {
        const name = itemInput.value.trim() || 'Neue Notiz';
        const body = new URLSearchParams({ category_id: String(category.id), name });
        const payload = await api('add', { method: 'POST', body });
        itemForm.reset();
        await loadItems();
        const item = getItemById(payload.id);
        if (item) {
            await openNoteEditor(item);
        }
        return;
    }

    if (isAttachmentCategory(category.type)) {
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
        itemForm.reset();
        updateFilePickerLabel();
        await loadItems();
        setMessage(category.type === 'images' ? 'Bild hochgeladen.' : 'Datei hochgeladen.');
        return;
    }

    const body = new URLSearchParams({
        category_id: String(category.id),
        name: itemInput.value.trim(),
    });

    if (category.type === 'list_quantity' && quantityInput.value.trim() !== '') {
        body.set('quantity', quantityInput.value.trim());
    }

    if (category.type === 'list_due_date' && quantityInput.value.trim() !== '') {
        body.set('due_date', quantityInput.value.trim());
    }

    await api('add', { method: 'POST', body });
    itemForm.reset();
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
        renderItems();
    } else {
        await loadItems();
    }
}

async function handleDelete(id) {
    await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
    if (state.noteEditorId === id) {
        await closeNoteEditor();
    }
    await loadItems();
    setMessage('Artikel gelöscht.');
}

async function handleEditSave(id) {
    const body = new URLSearchParams({
        id: String(id),
        name: state.editDraft.name.trim(),
        quantity: state.editDraft.quantity.trim(),
        due_date: state.editDraft.due_date.trim(),
    });

    await api('update', { method: 'POST', body });
    state.editingId = null;
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
    await loadItems();
    setMessage('Erledigte Artikel entfernt.');
}

function applyTabsVisibility(hidden) {
    if (!sectionTabsEl) return;
    sectionTabsEl.classList.toggle('tabs-hidden', Boolean(hidden));
    tabsToggleBtns.forEach(btn => btn.classList.toggle('is-active', Boolean(hidden)));
}

function canStartCategorySwipe(target) {
    if (!(target instanceof Element)) return false;
    if (state.noteEditorId !== null || state.search.open) return false;
    if (!userPreferences.category_swipe_enabled) return false;
    return !target.closest('input, select, textarea, button, a, [contenteditable="true"], .note-editor, .section-tabs, .search-bar, .input-area');
}

function getSwipeTargetCategoryId(direction) {
    const visibleCategories = getVisibleCategories();
    const currentIndex = visibleCategories.findIndex(category => category.id === state.categoryId);
    if (currentIndex === -1) return null;

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= visibleCategories.length) {
        return null;
    }

    return visibleCategories[nextIndex]?.id ?? null;
}

function initCategorySwipe() {
    if (!listAreaEl) return;

    listAreaEl.addEventListener('touchstart', event => {
        if (event.touches.length !== 1) {
            swipeState = null;
            return;
        }

        if (!canStartCategorySwipe(event.target)) {
            swipeState = null;
            return;
        }

        const touch = event.touches[0];
        swipeState = {
            startX: touch.clientX,
            startY: touch.clientY,
            lockedAxis: null,
        };
    }, { passive: true });

    listAreaEl.addEventListener('touchmove', event => {
        if (!swipeState || event.touches.length !== 1) return;

        const touch = event.touches[0];
        const deltaX = touch.clientX - swipeState.startX;
        const deltaY = touch.clientY - swipeState.startY;

        if (swipeState.lockedAxis === null) {
            if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
                return;
            }

            swipeState.lockedAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
        }
    }, { passive: true });

    listAreaEl.addEventListener('touchend', event => {
        if (!swipeState) return;

        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - swipeState.startX;
        const deltaY = touch.clientY - swipeState.startY;
        const lockedAxis = swipeState.lockedAxis;
        swipeState = null;

        if (lockedAxis !== 'x') return;
        if (Math.abs(deltaX) < CATEGORY_SWIPE_THRESHOLD_PX) return;
        if (Math.abs(deltaY) > Math.abs(deltaX) * 0.6) return;

        const direction = deltaX < 0 ? 1 : -1;
        const targetCategoryId = getSwipeTargetCategoryId(direction);
        if (targetCategoryId === null) return;

        void setCategory(targetCategoryId);
    }, { passive: true });

    listAreaEl.addEventListener('touchcancel', () => {
        swipeState = null;
    }, { passive: true });
}

function formatDate(value) {
    try {
        return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
    } catch {
        return value;
    }
}

async function waitForTipTap() {
    return new Promise(resolve => {
        if (window.TipTap) {
            resolve(window.TipTap);
            return;
        }

        window.addEventListener('tiptap-ready', () => resolve(window.TipTap), { once: true });
    });
}

function destroyTipTap() {
    if (tiptapEditor) {
        tiptapEditor.destroy();
        tiptapEditor = null;
    }
}

function setNoteSaveStatus(text) {
    if (noteSaveStatus) noteSaveStatus.textContent = text;
}

async function saveNoteContent(id, title, htmlContent) {
    await api('update', {
        method: 'POST',
        body: new URLSearchParams({ id: String(id), name: title || 'Ohne Titel', content: htmlContent }),
    });
    const item = getItemById(id);
    if (item) {
        item.name = title || 'Ohne Titel';
        item.content = htmlContent;
    }
    setNoteSaveStatus('Gespeichert');
}

function scheduleNoteSave() {
    clearTimeout(noteSaveTimer);
    setNoteSaveStatus('...');
    noteSaveTimer = setTimeout(() => {
        if (state.noteEditorId === null || !tiptapEditor) return;
        void saveNoteContent(state.noteEditorId, noteTitleInput?.value || '', tiptapEditor.getHTML());
    }, NOTE_SAVE_DEBOUNCE_MS);
}

function updateNoteToolbar() {
    if (!tiptapEditor || !noteToolbar) return;

    noteToolbar.querySelectorAll('button[data-cmd]').forEach(button => {
        const cmd = button.dataset.cmd;
        const level = button.dataset.level ? Number(button.dataset.level) : undefined;
        let active = false;

        if (cmd === 'heading' && level) {
            active = tiptapEditor.isActive('heading', { level });
        } else if (cmd === 'link') {
            active = tiptapEditor.isActive('link');
        } else if (cmd !== 'undo' && cmd !== 'redo') {
            active = tiptapEditor.isActive(cmd);
        }

        button.classList.toggle('is-active', active);
    });
}

async function openNoteEditor(item) {
    await closeNoteEditor();

    state.noteEditorId = item.id;
    if (noteTitleInput) noteTitleInput.value = item.name || '';
    if (noteEditorEl) noteEditorEl.hidden = false;
    appEl.classList.add('note-editor-open');

    const { Editor, StarterKit, Link } = await waitForTipTap();
    if (noteEditorBody) noteEditorBody.innerHTML = '';

    tiptapEditor = new Editor({
        element: noteEditorBody,
        extensions: [StarterKit, Link.configure({ openOnClick: false })],
        content: item.content || '',
        onUpdate: () => {
            updateNoteToolbar();
            scheduleNoteSave();
        },
        onSelectionUpdate: updateNoteToolbar,
    });

    updateNoteToolbar();
    setNoteSaveStatus('');
}

async function closeNoteEditor() {
    clearTimeout(noteSaveTimer);

    if (tiptapEditor && state.noteEditorId !== null) {
        await saveNoteContent(state.noteEditorId, noteTitleInput?.value || '', tiptapEditor.getHTML());
    }

    destroyTipTap();
    state.noteEditorId = null;
    appEl.classList.remove('note-editor-open');
    if (noteEditorEl) noteEditorEl.hidden = true;
}

function setNetworkStatus() {
    if (!networkStatusEl) return;
    if (navigator.onLine) {
        networkStatusEl.hidden = true;
        networkStatusEl.textContent = '';
    } else {
        networkStatusEl.hidden = false;
        networkStatusEl.textContent = 'Offline: Die zuletzt geladene Liste bleibt sichtbar.';
    }
}

itemForm?.addEventListener('submit', event => {
    void addItem(event).catch(error => {
        setUploadProgress(0);
        setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.', true);
    });
});

fileInput?.addEventListener('change', updateFilePickerLabel);
cameraBtn?.addEventListener('click', () => cameraInput?.click());
cameraInput?.addEventListener('change', () => {
    if (!cameraInput?.files?.[0] || !fileInput) return;
    fileInput.files = cameraInput.files;
    updateFilePickerLabel();
});

clearDoneBtn?.addEventListener('click', () => {
    void clearDone().catch(error => {
        setMessage(error instanceof Error ? error.message : 'Löschen fehlgeschlagen.', true);
    });
});

modeToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
        appEl.dataset.mode = state.mode;
        void savePreferences({ mode: state.mode });
        renderItems();
    });
});

tabsToggleBtns.forEach(button => {
    button.addEventListener('click', () => {
        const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
        applyTabsVisibility(hidden);
        void savePreferences({ tabs_hidden: hidden });
    });
});

searchBtn?.addEventListener('click', openSearch);
searchClose?.addEventListener('click', closeSearch);
searchInput?.addEventListener('input', () => {
    void doSearch(searchInput.value);
});
searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeSearch();
    }
});

noteEditorBack?.addEventListener('click', () => {
    void closeNoteEditor().catch(error => {
        setMessage(error instanceof Error ? error.message : 'Notiz konnte nicht geschlossen werden.', true);
    });
});

noteTitleInput?.addEventListener('input', scheduleNoteSave);

noteToolbar?.addEventListener('click', event => {
    const button = event.target.closest('button[data-cmd]');
    if (!button || !tiptapEditor) return;

    const cmd = button.dataset.cmd;
    const level = button.dataset.level ? Number(button.dataset.level) : undefined;
    const chain = tiptapEditor.chain().focus();

    switch (cmd) {
        case 'heading': chain.toggleHeading({ level }).run(); break;
        case 'bold': chain.toggleBold().run(); break;
        case 'italic': chain.toggleItalic().run(); break;
        case 'strike': chain.toggleStrike().run(); break;
        case 'bulletList': chain.toggleBulletList().run(); break;
        case 'orderedList': chain.toggleOrderedList().run(); break;
        case 'blockquote': chain.toggleBlockquote().run(); break;
        case 'codeBlock': chain.toggleCodeBlock().run(); break;
        case 'undo': chain.undo().run(); break;
        case 'redo': chain.redo().run(); break;
        case 'link': {
            const previous = tiptapEditor.isActive('link') ? tiptapEditor.getAttributes('link').href : '';
            const url = prompt('URL:', previous);
            if (url === null) break;
            if (url === '') {
                chain.unsetLink().run();
                break;
            }
            chain.setLink({ href: url }).run();
            break;
        }
    }

    updateNoteToolbar();
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
});

window.addEventListener('online', setNetworkStatus);
window.addEventListener('offline', setNetworkStatus);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.search.open) {
        closeSearch();
    }
});

(async function init() {
    try {
        setNetworkStatus();
        state.mode = userPreferences.mode;
        appEl.dataset.mode = state.mode;
        initCategoryTabReorder();
        initCategorySwipe();
        await loadCategories();
        updateHeaders();
        await loadItems();
    } catch (error) {
        setMessage(error instanceof Error ? error.message : 'App konnte nicht geladen werden.', true);
    }
})();
