'use strict';

// =========================================
// DOM REFERENCES
// =========================================
const csrfMeta = document.querySelector('meta[name="csrf-token"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing — page may be stale, please reload.');
const appBasePathMeta = document.querySelector('meta[name="app-base-path"]');
const csrfToken       = csrfMeta.content;
const appBasePath     = appBasePathMeta?.content || '/';
const appEl           = document.getElementById('app');
const listEl          = document.getElementById('list');
const listAreaEl      = document.querySelector('.list-area');
const itemForm        = document.getElementById('itemForm');
const itemInput       = document.getElementById('itemInput');
const fileInput       = document.getElementById('fileInput');
const fileInputGroup  = document.getElementById('fileInputGroup');
const filePickerButton = document.getElementById('filePickerButton');
const filePickerName  = document.getElementById('filePickerName');
const cameraBtn       = document.getElementById('cameraBtn');
const cameraInput     = document.getElementById('cameraInput');
const dropZoneEl      = document.getElementById('dropZone');
const inputHintEl     = document.getElementById('inputHint');
const clearDoneBtn    = document.getElementById('clearDoneBtn');
const messageEl       = document.getElementById('message');
const progressEl      = document.getElementById('progress');
const quantityInput   = document.getElementById('quantityInput');
const modeToggleBtns  = document.querySelectorAll('.btn-mode-toggle');
const sectionTabEls   = document.querySelectorAll('.section-tab');
const networkStatusEl = document.getElementById('networkStatus');
const updateBannerEl  = document.getElementById('updateBanner');
const updateReloadBtn = document.getElementById('updateReloadBtn');
const tabsToggleBtn   = document.getElementById('tabsToggleBtn');
const sectionTabsEl   = document.getElementById('sectionTabs');
const noteEditorEl    = document.getElementById('noteEditor');
const noteEditorBack  = document.getElementById('noteEditorBack');
const noteTitleInput  = document.getElementById('noteTitleInput');
const noteSaveStatus  = document.getElementById('noteSaveStatus');
const noteEditorBody  = document.getElementById('noteEditorEl');
const noteToolbar     = document.getElementById('noteToolbar');

// =========================================
// CONSTANTS
// =========================================
const DELETE_ANIM_MS = 180;
const DRAG_SCROLL_ZONE_PX = 72;
const DRAG_SCROLL_STEP_PX = 10;
const HAPTIC_FEEDBACK_MS = 12;
const INSTALL_BANNER_DISMISSED_KEY = 'einkauf-install-banner-dismissed-v2';
const ITEMS_CACHE_KEY_PREFIX = 'einkauf-items-cache-v1-';
const TOGGLE_QUEUE_KEY = 'einkauf-toggle-queue-v1';
const SECTION_KEY     = 'einkauf-section-v1';
const TABS_HIDDEN_KEY = 'einkauf-tabs-hidden-v1';
const ATTACHMENT_SECTIONS = new Set(['images', 'files']);
const TABS_ORDER_KEY  = 'einkauf-tabs-order-v1';

const SECTIONS = {
    shopping:     { label: 'Einkauf',    title: 'Einkaufsliste',     shoppingTitle: 'Einkaufen'       },
    meds:         { label: 'Medizin',    title: 'Medikamentenliste', shoppingTitle: 'Einkaufen'       },
    todo_private: { label: 'Privat',     title: 'ToDo Privat',       shoppingTitle: 'ToDo Privat'     },
    todo_work:    { label: 'Arbeit',     title: 'ToDo Arbeit',       shoppingTitle: 'ToDo Arbeit'     },
    notes:        { label: 'Notizen',    title: 'Notizen',           shoppingTitle: 'Notizen'         },
    images:       { label: 'Bilder',     title: 'Bilder',            shoppingTitle: 'Bilder'          },
    files:        { label: 'Dateien',    title: 'Dateien',           shoppingTitle: 'Dateien'         },
    links:        { label: 'Links',      title: 'Links',             shoppingTitle: 'Links'           },
};

// =========================================
// STATE
// =========================================
const state = {
    items:          [],
    mode:           'liste',   // 'liste' | 'einkaufen'
    section:        'shopping',
    pendingIds:     new Set(),
    reorderPending: false,
    editingId:      null,
    editDraft:      { name: '', quantity: '' },
    noteEditorId:   null,
};

let dragState = null;
let dragScrollFrame = null;
let swRefreshPending = false;
let swRegistration = null;
let offlineSyncInFlight = false;

// =========================================
// UTILITIES
// =========================================
let messageTimer = null;

function isAttachmentSection(section = state.section) {
    return ATTACHMENT_SECTIONS.has(section);
}

function setMessage(text, isError = false) {
    clearTimeout(messageTimer);
    messageEl.textContent = text;
    messageEl.classList.toggle('is-error', isError);
    messageEl.classList.add('is-visible');
    messageTimer = setTimeout(() => messageEl.classList.remove('is-visible'), 2500);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function appUrl(path) {
    return new URL(path, `${window.location.origin}${appBasePath}`).toString();
}

function getUserFacingError(error, fallbackMessage) {
    if (error instanceof Error) {
        const message = error.message.trim();
        if (message !== '' && message !== 'Failed to fetch' && message !== 'Load failed') {
            return message;
        }
    }

    return fallbackMessage;
}

function isConnectivityError(error) {
    if (!(error instanceof Error)) return false;
    const message = error.message.trim();
    return message === 'Failed to fetch' || message === 'Load failed';
}

function normalizeNameInput(name) {
    return String(name).trim().replace(/\s+/gu, ' ').slice(0, 120);
}

function normalizeQuantityInput(quantity) {
    return String(quantity).trim().replace(/\s+/gu, ' ').slice(0, 40);
}

function resolveAttachmentUrl(url) {
    if (!url) return '';

    try {
        return new URL(url, appUrl('')).toString();
    } catch {
        return String(url);
    }
}

function getAttachmentTitle(item) {
    return normalizeNameInput(item.name || '') || item.attachmentOriginalName || 'Ohne Titel';
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

function getItemById(id) {
    return state.items.find(item => item.id === Number(id)) || null;
}

function hasActiveEdit() {
    return state.editingId !== null;
}

function isEditingItem(id) {
    return state.editingId === Number(id);
}

function setEditDraftFromItem(item) {
    state.editDraft = {
        name: item.name || '',
        quantity: item.quantity || '',
        replacementFile: null,
    };
}

function clearEditState() {
    state.editingId = null;
    state.editDraft = { name: '', quantity: '', replacementFile: null };
}

function setNetworkStatus() {
    if (!networkStatusEl) return;

    const pendingToggleCount = readQueuedToggles().length;

    if (navigator.onLine) {
        if (offlineSyncInFlight || pendingToggleCount > 0) {
            networkStatusEl.textContent = 'Verbindung wieder da: Offline-Änderungen werden synchronisiert.';
            networkStatusEl.removeAttribute('hidden');
            return;
        }

        networkStatusEl.setAttribute('hidden', '');
        networkStatusEl.textContent = '';
        return;
    }

    networkStatusEl.textContent = pendingToggleCount > 0
        ? 'Offline: Die Liste bleibt sichtbar, Änderungen werden später synchronisiert.'
        : 'Offline: Die zuletzt geladene Liste bleibt sichtbar.';
    networkStatusEl.removeAttribute('hidden');
}

function syncViewportHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${h}px`);
}

function normalizeItem(item) {
    return {
        ...item,
        id: Number(item.id),
        done: Number(item.done),
        sort_order: Number(item.sort_order),
        content: item.content || '',
        has_attachment: Number(item.has_attachment || 0),
        attachment_size_bytes: Number(item.attachment_size_bytes || 0),
        attachment_url: resolveAttachmentUrl(item.attachment_url || ''),
        attachment_original_name: item.attachment_original_name || '',
        attachment_media_type: item.attachment_media_type || '',
        attachment_storage_section: item.attachment_storage_section || '',
        attachmentOriginalName: item.attachment_original_name || '',
        attachmentMediaType: item.attachment_media_type || '',
        attachmentSizeBytes: Number(item.attachment_size_bytes || 0),
        attachmentUrl: resolveAttachmentUrl(item.attachment_url || ''),
        hasAttachment: Number(item.has_attachment || 0) === 1,
    };
}

function getSelectedAttachment() {
    return fileInput?.files?.[0] || null;
}

function updateFilePickerLabel() {
    if (!filePickerName) return;
    const attachment = getSelectedAttachment();
    filePickerName.textContent = attachment ? attachment.name : 'Keine Datei ausgewählt';
}

function clearAttachmentInput() {
    if (fileInput) fileInput.value = '';
    updateFilePickerLabel();
}

function setUploadUiState() {
    if (!fileInputGroup || !fileInput || !inputHintEl || !filePickerButton) return;

    const isUploadSection = isAttachmentSection();
    const isImageSection = state.section === 'images';
    const isOffline = !navigator.onLine;

    fileInputGroup.hidden = !isUploadSection;
    fileInputGroup.classList.toggle('is-disabled', isUploadSection && isOffline);
    inputHintEl.hidden = !isUploadSection;
    filePickerButton.textContent = isImageSection ? 'Bild wählen' : 'Datei wählen';
    fileInput.accept = isImageSection ? 'image/*' : '';
    fileInput.disabled = !isUploadSection || isOffline;

    if (cameraBtn) {
        cameraBtn.hidden = !isImageSection || isOffline;
        cameraBtn.disabled = !isImageSection || isOffline;
    }
    if (dropZoneEl) {
        dropZoneEl.hidden = !isUploadSection || isOffline;
        const dropLabel = dropZoneEl.querySelector('.drop-zone-label');
        if (dropLabel) {
            dropLabel.textContent = isImageSection
                ? 'Bild hierher ziehen oder aus Zwischenablage einfügen'
                : 'Datei hierher ziehen oder aus Zwischenablage einfügen';
        }
    }

    if (!isUploadSection) {
        inputHintEl.textContent = '';
        return;
    }

    inputHintEl.textContent = isOffline
        ? 'Uploads sind offline nicht verfügbar. Vorhandene Einträge bleiben sichtbar.'
        : isImageSection
            ? 'Ein einzelnes Bild auswählen oder Foto aufnehmen. Titel optional.'
            : 'Eine einzelne Datei auswählen. Titel optional.';
}

function focusPrimaryInput() {
    if (isAttachmentSection() && navigator.onLine && fileInput && !fileInput.disabled) {
        fileInput.focus();
        return;
    }

    itemInput.focus();
}

function readJsonStorage(key, fallbackValue) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallbackValue;
        const parsed = JSON.parse(raw);
        return parsed ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
}

function writeJsonStorage(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore storage quota / private mode errors.
    }
}

function sectionCacheKey() {
    return ITEMS_CACHE_KEY_PREFIX + state.section;
}

function readCachedItems() {
    const items = readJsonStorage(sectionCacheKey(), []);
    if (!Array.isArray(items)) return [];
    return items.map(normalizeItem);
}

function writeCachedItems(items) {
    writeJsonStorage(sectionCacheKey(), items.map(normalizeItem));
}

function readQueuedToggles() {
    const queue = readJsonStorage(TOGGLE_QUEUE_KEY, []);
    if (!Array.isArray(queue)) return [];

    return queue
        .map(entry => ({
            id: Number(entry?.id),
            done: Number(entry?.done),
        }))
        .filter(entry => Number.isInteger(entry.id) && entry.id > 0 && (entry.done === 0 || entry.done === 1));
}

function writeQueuedToggles(queue) {
    writeJsonStorage(TOGGLE_QUEUE_KEY, queue);
}

function queueToggle(id, done) {
    const filteredQueue = readQueuedToggles().filter(entry => entry.id !== Number(id));
    filteredQueue.push({ id: Number(id), done: Number(done) });
    writeQueuedToggles(filteredQueue);
    setNetworkStatus();
}

function clearQueuedToggleIfUnchanged(id, done) {
    const queue = readQueuedToggles();
    const nextQueue = queue.filter(entry => !(entry.id === Number(id) && entry.done === Number(done)));
    if (nextQueue.length !== queue.length) {
        writeQueuedToggles(nextQueue);
    }
}

function persistItemsLocally() {
    writeCachedItems(state.items);
}

function applyQueuedToggles(items) {
    const queuedToggles = new Map(readQueuedToggles().map(entry => [entry.id, entry.done]));

    return items.map(item => {
        if (!queuedToggles.has(item.id)) {
            return item;
        }

        return {
            ...item,
            done: queuedToggles.get(item.id),
        };
    });
}

function updateItemsState(items) {
    state.items = applyQueuedToggles(items.map(normalizeItem));

    if (hasActiveEdit() && !getItemById(state.editingId)) {
        clearEditState();
    }

    persistItemsLocally();
    renderItems();
}

async function flushQueuedToggles() {
    if (offlineSyncInFlight || !navigator.onLine) return;

    const initialQueue = readQueuedToggles();
    if (initialQueue.length === 0) {
        setNetworkStatus();
        return;
    }

    offlineSyncInFlight = true;
    setNetworkStatus();

    let syncedCount = 0;
    let currentEntry = null;

    try {
        while (navigator.onLine) {
            [currentEntry] = readQueuedToggles();
            if (!currentEntry) break;

            await api('toggle', {
                method: 'POST',
                body: new URLSearchParams({
                    id: String(currentEntry.id),
                    done: String(currentEntry.done),
                }),
            });

            clearQueuedToggleIfUnchanged(currentEntry.id, currentEntry.done);
            currentEntry = null;
            syncedCount += 1;
        }

        if (syncedCount > 0) {
            await loadItems({ skipOfflineSync: true, silent: true });
            setMessage('Offline-Änderungen synchronisiert.');
        }
    } catch (error) {
        if (!isConnectivityError(error)) {
            if (currentEntry) clearQueuedToggleIfUnchanged(currentEntry.id, currentEntry.done);
            setMessage(getUserFacingError(error, 'Offline-Änderungen konnten nicht synchronisiert werden.'), true);
        }
    } finally {
        offlineSyncInFlight = false;
        setNetworkStatus();
    }
}

function showUpdateBanner() {
    if (!updateBannerEl) return;
    updateBannerEl.removeAttribute('hidden');
}

function hideUpdateBanner() {
    if (!updateBannerEl) return;
    updateBannerEl.setAttribute('hidden', '');
}

function readInstallBannerDismissed() {
    try {
        return window.localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
}

function writeInstallBannerDismissed(isDismissed) {
    try {
        if (isDismissed) {
            window.localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, '1');
            return;
        }

        window.localStorage.removeItem(INSTALL_BANNER_DISMISSED_KEY);
    } catch {
        // Ignore storage errors in private browsing or restricted contexts.
    }
}

function sortByPosition(items) {
    return [...items].sort((a, b) => {
        const sortDiff = Number(a.sort_order) - Number(b.sort_order);
        if (sortDiff !== 0) return sortDiff;
        return Number(a.id) - Number(b.id);
    });
}

function getVisibleItems() {
    const ordered = sortByPosition(state.items);

    if (state.mode === 'liste') {
        return ordered;
    }

    return ordered.sort((a, b) => {
        const doneDiff = Number(a.done) - Number(b.done);
        if (doneDiff !== 0) return doneDiff;
        return Number(a.sort_order) - Number(b.sort_order);
    });
}

function getVisibleIds() {
    return getVisibleItems().map(item => Number(item.id));
}

function getDomOrderIds() {
    return Array.from(listEl.querySelectorAll('.item-card[data-item-id]'))
        .map(card => Number(card.dataset.itemId));
}

function areArraysEqual(left, right) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function updateStateOrder(orderedIds) {
    const positions = new Map(orderedIds.map((id, index) => [Number(id), index + 1]));

    state.items.forEach(item => {
        const nextPosition = positions.get(Number(item.id));
        if (nextPosition) {
            item.sort_order = nextPosition;
        }
    });
}

function buildReorderBody(orderedIds) {
    const params = new URLSearchParams();
    orderedIds.forEach(id => params.append('ids[]', String(id)));
    return params;
}

function isInteractionBlocked(id = null) {
    if (state.reorderPending || dragState) return true;
    if (id !== null && state.pendingIds.has(id)) return true;
    if (hasActiveEdit() && state.editingId !== Number(id)) return true;
    return false;
}

function focusEditNameInput(id) {
    window.requestAnimationFrame(() => {
        const input = listEl.querySelector(`[data-item-id="${id}"] .edit-name-input`);
        if (!input) return;
        input.focus();
        input.select();
    });
}

function setEditField(field, value) {
    state.editDraft = {
        ...state.editDraft,
        [field]: value,
    };
}

function triggerHapticFeedback() {
    if (!('vibrate' in navigator)) return;
    navigator.vibrate(HAPTIC_FEEDBACK_MS);
}

function clearDropIndicators() {
    if (!dragState) return;

    if (dragState.targetCard) {
        dragState.targetCard.classList.remove('is-drop-target-before', 'is-drop-target-after');
    }

    dragState.targetCard = null;
    dragState.targetPosition = null;
}

function updateDropIndicator(nextSibling, siblings) {
    if (!dragState) return;

    let targetCard = null;
    let targetPosition = null;

    if (nextSibling) {
        targetCard = nextSibling;
        targetPosition = 'before';
    } else if (siblings.length > 0) {
        targetCard = siblings[siblings.length - 1];
        targetPosition = 'after';
    }

    if (
        dragState.targetCard === targetCard
        && dragState.targetPosition === targetPosition
    ) {
        return;
    }

    clearDropIndicators();

    if (!targetCard || !targetPosition) {
        return;
    }

    targetCard.classList.add(
        targetPosition === 'before' ? 'is-drop-target-before' : 'is-drop-target-after'
    );
    dragState.targetCard = targetCard;
    dragState.targetPosition = targetPosition;
}

function updatePlaceholderFeedback() {
    if (!dragState) return;

    const index = Array.from(listEl.children).indexOf(dragState.placeholder);
    if (index === -1 || index === dragState.lastPlaceholderIndex) return;

    dragState.lastPlaceholderIndex = index;
    triggerHapticFeedback();
}

// =========================================
// FLIP ANIMATION
// =========================================
function capturePositions() {
    const map = new Map();
    listEl.querySelectorAll('[data-item-id]').forEach(el => {
        map.set(el.dataset.itemId, el.getBoundingClientRect());
    });
    return map;
}

function playFlip(oldMap) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    listEl.querySelectorAll('[data-item-id]').forEach(el => {
        const oldRect = oldMap.get(el.dataset.itemId);
        if (!oldRect) return;

        const newRect = el.getBoundingClientRect();
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dy) < 1) return;

        el.style.animation = 'none';
        el.style.transition = 'none';
        el.style.transform  = `translateY(${dy}px)`;
        el.offsetHeight;

        el.style.transition = 'transform 300ms ease';
        el.style.transform  = '';

        el.addEventListener('transitionend', () => {
            el.style.transition = '';
            el.style.transform  = '';
            el.style.animation  = '';
        }, { once: true });
    });
}

// =========================================
// BUILD ITEM NODE
// =========================================
function formatDateBadge(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d)) return dateStr;
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
        return dateStr;
    }
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

function buildReadOnlyContent(item, content) {
    if (isAttachmentSection() && !item.hasAttachment) {
        const titleEl = document.createElement('span');
        titleEl.className = 'item-name attachment-title';
        titleEl.textContent = getAttachmentTitle(item);

        const missingEl = document.createElement('span');
        missingEl.className = 'attachment-subline';
        missingEl.textContent = 'Anhang nicht verfügbar';

        const meta = document.createElement('div');
        meta.className = 'attachment-meta';
        meta.append(titleEl, missingEl);
        content.appendChild(meta);
        return;
    }

    if (state.section === 'images') {
        content.classList.add('item-content-attachment', 'item-content-image');

        const previewLink = document.createElement('button');
        previewLink.type = 'button';
        previewLink.className = 'attachment-preview-link';
        previewLink.setAttribute('aria-label', `${getAttachmentTitle(item)} öffnen`);
        previewLink.addEventListener('click', event => {
            event.stopPropagation();
            openLightbox(item.attachmentUrl, getAttachmentTitle(item));
        });

        const preview = document.createElement('img');
        preview.className = 'attachment-image-preview';
        preview.src = item.attachmentUrl;
        preview.alt = getAttachmentTitle(item);
        preview.loading = 'lazy';
        preview.decoding = 'async';
        previewLink.appendChild(preview);

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
        downloadLink.href = item.attachmentUrl;
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

    if (state.section === 'files') {
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
        downloadLink.href = item.attachmentUrl;
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

    if (state.section === 'links') {
        const link = document.createElement('a');
        link.className  = 'item-name item-link';
        link.textContent = item.name;
        link.href       = item.name;
        link.target     = '_blank';
        link.rel        = 'noopener noreferrer';
        link.addEventListener('click', event => event.stopPropagation());
        content.appendChild(link);
        return;
    }

    const nameEl = document.createElement('span');
    nameEl.className   = 'item-name';
    nameEl.textContent = item.name;
    content.appendChild(nameEl);

    if (item.quantity) {
        const isTodo = state.section === 'todo_private' || state.section === 'todo_work';
        const badge  = document.createElement('span');
        badge.className   = isTodo ? 'quantity-badge date-badge' : 'quantity-badge';
        badge.textContent = isTodo ? formatDateBadge(item.quantity) : item.quantity;
        content.appendChild(badge);
    }
}

function buildEditContent(content) {
    const isSaving = state.pendingIds.has(state.editingId);
    const fields = document.createElement('div');
    fields.className = 'item-edit-fields';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'item-edit-input edit-name-input';
    nameInput.value = state.editDraft.name;
    nameInput.placeholder = isAttachmentSection() ? 'Titel (optional)' : 'Artikel';
    nameInput.maxLength = 120;
    nameInput.autocomplete = 'off';
    nameInput.disabled = isSaving;
    nameInput.addEventListener('input', event => setEditField('name', event.target.value));
    fields.appendChild(nameInput);

    const isTodoSection = state.section === 'todo_private' || state.section === 'todo_work';
    const hasQtySection = state.section === 'shopping' || state.section === 'meds';

    if (hasQtySection || isTodoSection) {
        const quantityField = document.createElement('div');
        quantityField.className = 'item-edit-quantity-row';

        const quantityInputEl = document.createElement('input');
        quantityInputEl.type      = isTodoSection ? 'date' : 'text';
        quantityInputEl.className = 'item-edit-input';
        quantityInputEl.value     = state.editDraft.quantity;
        if (!isTodoSection) {
            quantityInputEl.placeholder = 'Menge';
            quantityInputEl.maxLength   = 40;
        }
        quantityInputEl.autocomplete = 'off';
        quantityInputEl.disabled     = isSaving;
        quantityInputEl.addEventListener('input', event => setEditField('quantity', event.target.value));
        quantityField.appendChild(quantityInputEl);

        fields.appendChild(quantityField);
    }

    if (isAttachmentSection()) {
        const replaceRow = document.createElement('div');
        replaceRow.className = 'item-edit-replace-row';

        const replaceLabel = document.createElement('span');
        replaceLabel.className = 'item-edit-replace-label';
        replaceLabel.textContent = state.editDraft.replacementFile
            ? state.editDraft.replacementFile.name
            : 'Kein neues Attachment gewählt';

        const replaceInput = document.createElement('input');
        replaceInput.type = 'file';
        replaceInput.className = 'item-edit-replace-input visually-hidden';
        replaceInput.accept = state.section === 'images' ? 'image/*' : '';
        replaceInput.disabled = isSaving;
        replaceInput.addEventListener('change', () => {
            const file = replaceInput.files?.[0] || null;
            setEditField('replacementFile', file);
            replaceLabel.textContent = file ? file.name : 'Kein neues Attachment gewählt';
        });

        const replaceBtn = document.createElement('button');
        replaceBtn.type = 'button';
        replaceBtn.className = 'btn-replace-attachment';
        replaceBtn.textContent = state.section === 'images' ? 'Bild ersetzen' : 'Datei ersetzen';
        replaceBtn.disabled = isSaving;
        replaceBtn.addEventListener('click', () => replaceInput.click());

        replaceRow.append(replaceBtn, replaceLabel, replaceInput);
        fields.appendChild(replaceRow);
    }

    content.appendChild(fields);
}

function buildIconButton(className, label, text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
}

function buildItemNode(item, index, totalItems) {
    const isDone = item.done === 1;
    const isBlocked = isInteractionBlocked(item.id);
    const isEditing = isEditingItem(item.id);

    const li = document.createElement('li');
    li.className = `item-card ${isDone ? 'done' : 'open'}`;
    if (isEditing) {
        li.classList.add('is-editing');
    }
    li.dataset.itemId = String(item.id);

    const checkbox = document.createElement('input');
    checkbox.type      = 'checkbox';
    checkbox.className = 'toggle';
    checkbox.checked   = isDone;
    checkbox.disabled  = isBlocked || isEditing;
    checkbox.setAttribute('aria-label', `${item.name} umschalten`);
    checkbox.addEventListener('change', () => handleToggle(item.id));

    const content = document.createElement('div');
    content.className = 'item-content';
    if (isAttachmentSection() && !item.hasAttachment) {
        content.classList.add('item-content-missing-attachment');
    }

    if (isEditing) {
        buildEditContent(content);
    } else {
        buildReadOnlyContent(item, content);
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    if (state.mode === 'liste' && isEditing) {
        const saveBtn = buildIconButton(
            'btn-item-action btn-save',
            `${item.name} speichern`,
            '✓',
            () => { void handleEditSave(item.id); }
        );
        saveBtn.disabled = state.pendingIds.has(item.id);
        actions.appendChild(saveBtn);

        const cancelBtn = buildIconButton(
            'btn-item-action btn-cancel',
            `${item.name} Bearbeiten abbrechen`,
            '↺',
            () => handleEditCancel()
        );
        cancelBtn.disabled = state.pendingIds.has(item.id);
        actions.appendChild(cancelBtn);
    } else {
        if (state.mode === 'liste') {
            const editBtn = buildIconButton(
                'btn-item-action btn-edit',
                `${item.name} bearbeiten`,
                '✎',
                () => handleEditStart(item.id)
            );
            editBtn.disabled = isBlocked;
            actions.appendChild(editBtn);
        }

        const dragHandle = document.createElement('button');
        dragHandle.type      = 'button';
        dragHandle.className = 'btn-drag-handle';
        dragHandle.disabled  = state.mode !== 'liste' || totalItems < 2 || isBlocked;
        dragHandle.setAttribute('aria-label', `${item.name} verschieben`);
        dragHandle.setAttribute('title', 'Per Ziehen umsortieren');
        dragHandle.addEventListener('pointerdown', event => startDrag(event, item.id));
        dragHandle.addEventListener('keydown', event => handleReorderKeydown(event, item.id));
        actions.appendChild(dragHandle);

        const delBtn = buildIconButton(
            'btn-delete',
            `${item.name} löschen`,
            '×',
            () => { void handleDelete(item.id); }
        );
        delBtn.disabled = isBlocked;
        actions.appendChild(delBtn);

        if (index === 0) {
            dragHandle.dataset.atTop = 'true';
        }
        if (index === totalItems - 1) {
            dragHandle.dataset.atBottom = 'true';
        }
    }

    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(actions);

    return li;
}

// =========================================
// RENDER
// =========================================
function renderItems() {
    const items      = state.items;
    const doneCount  = items.filter(i => i.done === 1).length;
    const totalCount = items.length;

    progressEl.textContent = `${doneCount} / ${totalCount}`;
    clearDoneBtn.disabled  = doneCount === 0 || state.reorderPending || Boolean(dragState) || hasActiveEdit();

    listEl.replaceChildren();

    if (state.section === 'notes') {
        progressEl.textContent = '';
        clearDoneBtn.disabled  = true;

        if (items.length === 0) {
            const li = document.createElement('li');
            li.className   = 'empty-state';
            li.textContent = 'Noch keine Notizen. Titel eingeben und + drücken.';
            listEl.appendChild(li);
            return;
        }

        const fragment = document.createDocumentFragment();
        sortByPosition(items).forEach(item => fragment.appendChild(buildNoteCard(item)));
        listEl.appendChild(fragment);
        return;
    }

    if (items.length === 0) {
        const li = document.createElement('li');
        li.className   = 'empty-state';
        li.textContent = state.mode === 'liste'
            ? 'Noch nichts auf der Liste. Füge oben etwas hinzu.'
            : 'Keine Artikel auf der Liste.';
        listEl.appendChild(li);
        return;
    }

    if (state.mode === 'einkaufen' && items.every(i => i.done === 1)) {
        const li = document.createElement('li');
        li.className   = 'empty-state';
        li.textContent = 'Alles erledigt 🎉';
        listEl.appendChild(li);
        return;
    }

    const visibleItems = getVisibleItems();
    const fragment = document.createDocumentFragment();

    visibleItems.forEach((item, index) => {
        fragment.appendChild(buildItemNode(item, index, visibleItems.length));
    });

    listEl.appendChild(fragment);
}

// =========================================
// MODE SWITCHING
// =========================================
function setMode(mode) {
    if (dragState && mode !== state.mode) {
        finishDrag(true);
    }

    if (hasActiveEdit() && mode !== state.mode) {
        clearEditState();
    }

    state.mode         = mode;
    appEl.dataset.mode = mode;

    renderItems();
}

// =========================================
// SECTION SWITCHING
// =========================================
function updateSectionHeaders() {
    const cfg = SECTIONS[state.section] || SECTIONS.shopping;
    const titleListe    = document.getElementById('titleListe');
    const titleShopping = document.getElementById('titleShopping');
    if (titleListe)    titleListe.textContent    = cfg.title;
    if (titleShopping) titleShopping.textContent = cfg.shoppingTitle;
    document.title = cfg.title;

    const isNotes    = state.section === 'notes';
    const isLinks    = state.section === 'links';
    const isUploadSection = isAttachmentSection();
    const isTodo     = state.section === 'todo_private' || state.section === 'todo_work';
    const hasQty     = state.section === 'shopping' || state.section === 'meds';

    if (itemInput) {
        itemInput.placeholder = isNotes
            ? 'Titel...'
            : isLinks
                ? 'https://...'
                : isUploadSection
                    ? 'Titel optional...'
                    : 'Artikel...';
    }

    if (quantityInput) {
        if (hasQty) {
            quantityInput.type        = 'text';
            quantityInput.placeholder = 'Menge';
            quantityInput.style.display = '';
        } else if (isTodo) {
            quantityInput.type        = 'date';
            quantityInput.placeholder = '';
            quantityInput.style.display = '';
        } else {
            quantityInput.style.display = 'none';
        }
    }

    if (itemInput) {
        itemInput.required = !isUploadSection;
    }

    setUploadUiState();
    updateFilePickerLabel();
}

function setSection(section) {
    if (!SECTIONS[section]) return;

    if (dragState) finishDrag(true);
    if (hasActiveEdit()) clearEditState();
    if (state.noteEditorId !== null) flushNoteEditorAndClose();

    state.section = section;
    writeJsonStorage(SECTION_KEY, section);

    sectionTabEls.forEach(tab => {
        if (tab.dataset.section === section) {
            tab.setAttribute('aria-current', 'page');
        } else {
            tab.removeAttribute('aria-current');
        }
    });

    updateSectionHeaders();
    void loadItems();
}

// =========================================
// API
// =========================================
async function api(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const fetchOptions = { ...options };

    if (method !== 'GET') {
        fetchOptions.headers = {
            'X-CSRF-Token': csrfToken,
            ...(fetchOptions.headers || {}),
        };
    }

    const sectionParam = `&section=${encodeURIComponent(state.section)}`;
    const url = method === 'GET'
        ? `api.php?action=${encodeURIComponent(action)}${sectionParam}`
        : `api.php?action=${encodeURIComponent(action)}`;

    const response = await fetch(url, fetchOptions);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
}

// =========================================
// LOAD
// =========================================
async function loadItems(options = {}) {
    const { skipOfflineSync = false, silent = false } = options;

    try {
        const payload = await api('list');
        updateItemsState(payload.items || []);

        if (!skipOfflineSync && readQueuedToggles().length > 0) {
            void flushQueuedToggles();
        }
    } catch (err) {
        const cachedItems = readCachedItems();

        if (cachedItems.length > 0) {
            updateItemsState(cachedItems);

            if (!silent) {
                setMessage('Offline: Lokale Liste geladen.');
            }
            return;
        }

        if (!silent) {
            setMessage(getUserFacingError(err, 'Die Liste konnte nicht geladen werden.'), true);
        }
    }
}

async function uploadAttachment(uploadFormData) {
    try {
        return await api('upload', { method: 'POST', body: uploadFormData });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message !== 'Unbekannte Aktion.') {
            throw error;
        }

        return api('add', { method: 'POST', body: uploadFormData });
    }
}

// =========================================
// REORDER
// =========================================
async function persistOrder(orderedIds) {
    state.reorderPending = true;
    renderItems();

    try {
        const reorderBody = buildReorderBody(orderedIds);
        reorderBody.append('section', state.section);
        await api('reorder', {
            method: 'POST',
            body: reorderBody,
        });
        setMessage('Reihenfolge gespeichert.');
    } catch (err) {
        await loadItems();
        setMessage(getUserFacingError(err, 'Reihenfolge konnte nicht gespeichert werden.'), true);
    } finally {
        state.reorderPending = false;
        renderItems();
    }
}

async function moveItemByKeyboard(id, direction) {
    if (state.mode !== 'liste' || isInteractionBlocked(id)) return;

    const orderedIds = getVisibleIds();
    const currentIndex = orderedIds.indexOf(Number(id));
    const nextIndex = currentIndex + direction;

    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= orderedIds.length) {
        return;
    }

    const oldPositions = capturePositions();
    const [movedId] = orderedIds.splice(currentIndex, 1);
    orderedIds.splice(nextIndex, 0, movedId);
    updateStateOrder(orderedIds);
    renderItems();
    playFlip(oldPositions);
    triggerHapticFeedback();

    void persistOrder(orderedIds);
}

function handleReorderKeydown(event, id) {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        void moveItemByKeyboard(id, -1);
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        void moveItemByKeyboard(id, 1);
    }
}

function startAutoScroll() {
    stopAutoScroll();

    const tick = () => {
        if (!dragState || !listAreaEl) return;

        const rect = listAreaEl.getBoundingClientRect();
        let delta = 0;

        if (dragState.pointerY < rect.top + DRAG_SCROLL_ZONE_PX) {
            delta = -DRAG_SCROLL_STEP_PX;
        } else if (dragState.pointerY > rect.bottom - DRAG_SCROLL_ZONE_PX) {
            delta = DRAG_SCROLL_STEP_PX;
        }

        if (delta !== 0) {
            listAreaEl.scrollTop += delta;
            movePlaceholder(dragState.pointerY);
        }

        dragScrollFrame = window.requestAnimationFrame(tick);
    };

    dragScrollFrame = window.requestAnimationFrame(tick);
}

function stopAutoScroll() {
    if (dragScrollFrame !== null) {
        window.cancelAnimationFrame(dragScrollFrame);
        dragScrollFrame = null;
    }
}

function moveDraggedCard(clientY) {
    if (!dragState) return;

    dragState.pointerY = clientY;
    dragState.card.style.top = `${clientY - dragState.offsetY}px`;
    movePlaceholder(clientY);
}

function movePlaceholder(clientY) {
    if (!dragState) return;

    const siblings = Array.from(
        listEl.querySelectorAll('.item-card:not(.is-dragging):not(.drag-placeholder)')
    );
    const nextSibling = siblings.find(card => {
        const rect = card.getBoundingClientRect();
        return clientY < rect.top + (rect.height / 2);
    });

    if (nextSibling) {
        listEl.insertBefore(dragState.placeholder, nextSibling);
    } else {
        listEl.appendChild(dragState.placeholder);
    }

    updateDropIndicator(nextSibling, siblings);
    updatePlaceholderFeedback();
}

function cleanupDragPresentation() {
    if (!dragState) return;

    const { card, handle } = dragState;

    try {
        handle.releasePointerCapture(dragState.pointerId);
    } catch (err) {
        // Pointer capture may already be released.
    }

    clearDropIndicators();

    card.classList.remove('is-dragging');
    card.style.position = '';
    card.style.top = '';
    card.style.left = '';
    card.style.width = '';
    card.style.pointerEvents = '';
    card.style.zIndex = '';
    card.style.margin = '';

    document.body.classList.remove('is-sorting');
    document.removeEventListener('pointermove', onDragPointerMove);
    document.removeEventListener('pointerup', onDragPointerEnd);
    document.removeEventListener('pointercancel', onDragPointerEnd);
    stopAutoScroll();
}

function finishDrag(cancelled = false) {
    if (!dragState) return;

    const { card, placeholder, initialOrder } = dragState;
    cleanupDragPresentation();

    placeholder.replaceWith(card);

    const finalOrder = getDomOrderIds();
    dragState = null;

    if (cancelled) {
        renderItems();
        return;
    }

    if (areArraysEqual(initialOrder, finalOrder)) {
        renderItems();
        return;
    }

    updateStateOrder(finalOrder);
    renderItems();
    void persistOrder(finalOrder);
}

function onDragPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    event.preventDefault();
    moveDraggedCard(event.clientY);
}

function onDragPointerEnd(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    finishDrag(false);
}

function startDrag(event, id) {
    if (state.mode !== 'liste' || isInteractionBlocked(id) || hasActiveEdit()) return;
    if (event.button !== undefined && event.button !== 0) return;

    const handle = event.currentTarget;
    const card = handle.closest('.item-card');
    if (!card) return;

    const cards = Array.from(listEl.querySelectorAll('.item-card'));
    if (cards.length < 2) return;

    event.preventDefault();

    const rect = card.getBoundingClientRect();
    const placeholder = document.createElement('li');
    placeholder.className = 'item-card drag-placeholder';
    placeholder.style.height = `${rect.height}px`;
    placeholder.setAttribute('aria-hidden', 'true');

    card.after(placeholder);
    card.classList.add('is-dragging');
    card.style.position = 'fixed';
    card.style.top = `${rect.top}px`;
    card.style.left = `${rect.left}px`;
    card.style.width = `${rect.width}px`;
    card.style.pointerEvents = 'none';
    card.style.zIndex = '20';
    card.style.margin = '0';

    document.body.classList.add('is-sorting');

    if (typeof handle.setPointerCapture === 'function') {
        handle.setPointerCapture(event.pointerId);
    }

    dragState = {
        id: Number(id),
        card,
        handle,
        placeholder,
        pointerId: event.pointerId,
        pointerY: event.clientY,
        offsetY: event.clientY - rect.top,
        initialOrder: getVisibleIds(),
        lastPlaceholderIndex: Array.from(listEl.children).indexOf(placeholder),
        targetCard: null,
        targetPosition: null,
    };

    moveDraggedCard(event.clientY);
    startAutoScroll();
    document.addEventListener('pointermove', onDragPointerMove, { passive: false });
    document.addEventListener('pointerup', onDragPointerEnd);
    document.addEventListener('pointercancel', onDragPointerEnd);
}

// =========================================
// EDITING
// =========================================
function handleEditStart(id) {
    if (state.mode !== 'liste' || dragState || state.reorderPending || isInteractionBlocked(id)) return;

    const item = getItemById(id);
    if (!item) return;

    state.editingId = item.id;
    setEditDraftFromItem(item);
    renderItems();
    focusEditNameInput(item.id);
}

function handleEditCancel() {
    if (!hasActiveEdit()) return;
    clearEditState();
    renderItems();
}

async function handleEditSave(id) {
    if (!isEditingItem(id)) return;

    const item = getItemById(id);
    if (!item) return;

    const rawName = normalizeNameInput(state.editDraft.name);
    const name = isAttachmentSection()
        ? (rawName || item.attachmentOriginalName || item.name || 'Ohne Titel')
        : rawName;
    const quantity = normalizeQuantityInput(state.editDraft.quantity);

    if (name === '') {
        setMessage('Bitte gib einen Artikelnamen ein.', true);
        focusEditNameInput(id);
        return;
    }

    state.pendingIds.add(id);
    renderItems();

    try {
        const replacementFile = state.editDraft.replacementFile || null;

        if (isAttachmentSection() && replacementFile) {
            const uploadFormData = new FormData();
            uploadFormData.append('section', state.section);
            uploadFormData.append('item_id', String(id));
            uploadFormData.append('name', name);
            uploadFormData.append('attachment', replacementFile);
            await uploadAttachment(uploadFormData);
            await loadItems({ silent: true });
            clearEditState();
            renderItems();
            setMessage(state.section === 'images' ? 'Bild ersetzt.' : 'Datei ersetzt.');
        } else {
            await api('update', {
                method: 'POST',
                body: new URLSearchParams({
                    id: String(id),
                    name,
                    quantity,
                }),
            });

            item.name = name;
            item.quantity = quantity;
            clearEditState();
            renderItems();
            setMessage('Artikel gespeichert.');
        }
    } catch (err) {
        setMessage(getUserFacingError(err, 'Artikel konnte nicht gespeichert werden.'), true);
    } finally {
        state.pendingIds.delete(id);
        renderItems();
        if (isEditingItem(id)) {
            focusEditNameInput(id);
        }
    }
}

function handleEditKeydown(event, id) {
    if (event.key === 'Escape') {
        event.preventDefault();
        handleEditCancel();
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        void handleEditSave(id);
    }
}

// =========================================
// ACTIONS
// =========================================
async function addItem(event) {
    event.preventDefault();
    if (state.reorderPending || dragState || hasActiveEdit()) return;

    const submitBtn = itemForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;

    if (state.section === 'notes') {
        const name = normalizeNameInput(itemInput.value) || 'Neue Notiz';
        try {
            const payload = await api('add', {
                method: 'POST',
                body: new URLSearchParams({ name, section: 'notes' }),
            });
            itemForm.reset();
            await loadItems({ silent: true });
            const newItem = state.items.find(i => i.id === payload.id);
            if (newItem) void openNoteEditor(newItem);
        } catch (err) {
            setMessage(getUserFacingError(err, 'Notiz konnte nicht erstellt werden.'), true);
        } finally {
            submitBtn.disabled = false;
        }
        return;
    }

    if (isAttachmentSection()) {
        const attachment = getSelectedAttachment();
        const title = normalizeNameInput(itemInput.value);

        if (!navigator.onLine) {
            setMessage('Uploads sind offline nicht möglich.', true);
            submitBtn.disabled = false;
            return;
        }

        if (!attachment) {
            setMessage(state.section === 'images' ? 'Bitte wähle ein Bild aus.' : 'Bitte wähle eine Datei aus.', true);
            submitBtn.disabled = false;
            return;
        }

        const uploadFormData = new FormData();
        uploadFormData.append('section', state.section);
        uploadFormData.append('name', title || attachment.name);
        uploadFormData.append('attachment', attachment);

        try {
            await uploadAttachment(uploadFormData);
            itemForm.reset();
            clearAttachmentInput();
            focusPrimaryInput();
            await loadItems();
            setMessage(state.section === 'images' ? 'Bild hochgeladen.' : 'Datei hochgeladen.');
        } catch (err) {
            setMessage(getUserFacingError(err, 'Upload konnte nicht abgeschlossen werden.'), true);
        } finally {
            submitBtn.disabled = false;
        }
        return;
    }

    const formData = new FormData(itemForm);

    try {
        const addParams = new URLSearchParams(formData);
        addParams.append('section', state.section);
        await api('add', { method: 'POST', body: addParams });
        itemForm.reset();
        clearAttachmentInput();
        focusPrimaryInput();
        await loadItems();
        setMessage('Artikel hinzugefügt.');
    } catch (err) {
        setMessage(getUserFacingError(err, 'Artikel konnte nicht hinzugefügt werden.'), true);
    } finally {
        submitBtn.disabled = false;
    }
}

async function handleToggle(id) {
    const item = getItemById(id);
    if (!item || isInteractionBlocked(id) || isEditingItem(id)) return;
    state.pendingIds.add(id);

    const currentDone = Number(item.done);
    const newDone = currentDone === 1 ? 0 : 1;

    const oldPositions = capturePositions();
    item.done = newDone;
    persistItemsLocally();
    renderItems();
    playFlip(oldPositions);

    try {
        await api('toggle', {
            method: 'POST',
            body:   new URLSearchParams({ id: String(id), done: String(newDone) }),
        });
        clearQueuedToggleIfUnchanged(id, newDone);
        persistItemsLocally();
        setNetworkStatus();
    } catch (err) {
        if (isConnectivityError(err)) {
            queueToggle(id, newDone);
            persistItemsLocally();
            setMessage('Offline: Änderung lokal gespeichert und wird später synchronisiert.');
        } else {
            item.done = currentDone;
            persistItemsLocally();
            renderItems();
            setMessage(getUserFacingError(err, 'Änderung konnte nicht gespeichert werden.'), true);
        }
    } finally {
        state.pendingIds.delete(id);
        renderItems();
    }
}

async function handleDelete(id) {
    if (isInteractionBlocked(id) || isEditingItem(id)) return;
    state.pendingIds.add(id);
    renderItems();

    const card = listEl.querySelector(`[data-item-id="${id}"]`);
    if (card) {
        card.classList.add('is-removing');
        await delay(DELETE_ANIM_MS);
    }

    try {
        await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
        if (isEditingItem(id)) {
            clearEditState();
        }
        await loadItems();
        setMessage('Artikel gelöscht.');
    } catch (err) {
        setMessage(getUserFacingError(err, 'Artikel konnte nicht gelöscht werden.'), true);
        await loadItems();
    } finally {
        state.pendingIds.delete(id);
        renderItems();
    }
}

async function clearDone() {
    if (state.reorderPending || dragState || hasActiveEdit()) return;

    clearDoneBtn.disabled = true;
    try {
        await api('clear', { method: 'POST', body: new URLSearchParams({ section: state.section }) });
        await loadItems();
        setMessage('Erledigte Artikel entfernt.');
    } catch (err) {
        setMessage(getUserFacingError(err, 'Erledigte Artikel konnten nicht entfernt werden.'), true);
        clearDoneBtn.disabled = false;
    }
}

// =========================================
// EVENT LISTENERS
// =========================================
itemForm.addEventListener('submit', addItem);

function submitOnEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        itemForm.requestSubmit();
    }
}

function handleListKeydown(event) {
    if (!event.target.matches('.item-edit-input')) return;
    const itemId = event.target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId || !isEditingItem(Number(itemId))) return;
    handleEditKeydown(event, Number(itemId));
}

itemInput.addEventListener('keydown', submitOnEnter);
quantityInput.addEventListener('keydown', submitOnEnter);
if (fileInput) {
    fileInput.addEventListener('change', updateFilePickerLabel);
}
if (cameraBtn && cameraInput) {
    cameraBtn.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', async () => {
        const photo = cameraInput.files?.[0];
        if (!photo) return;
        await uploadFileDirectly(photo);
        cameraInput.value = '';
    });
}
async function uploadFileDirectly(file) {
    if (!file) return;
    if (!navigator.onLine) {
        setMessage('Uploads sind offline nicht möglich.', true);
        return;
    }

    const section = state.section;
    if (section === 'images' && !file.type.startsWith('image/')) {
        setMessage(`Nur Bilddateien unterstützt (erkannt: "${file.type || 'unbekannt'}")`, true);
        return;
    }

    const title = normalizeNameInput(itemInput.value) || file.name;

    const uploadFormData = new FormData();
    uploadFormData.append('section', section);
    uploadFormData.append('name', title);
    uploadFormData.append('attachment', file);

    try {
        await uploadAttachment(uploadFormData);
        itemInput.value = '';
        await loadItems();
        setMessage(section === 'images' ? 'Bild hochgeladen.' : 'Datei hochgeladen.');
    } catch (err) {
        setMessage(getUserFacingError(err, 'Upload konnte nicht abgeschlossen werden.'), true);
    }
}

if (dropZoneEl) {
    dropZoneEl.addEventListener('dragover', event => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        dropZoneEl.classList.add('drop-active');
    });

    dropZoneEl.addEventListener('dragleave', event => {
        if (event.relatedTarget && dropZoneEl.contains(event.relatedTarget)) return;
        dropZoneEl.classList.remove('drop-active');
    });

    dropZoneEl.addEventListener('drop', async event => {
        event.preventDefault();
        dropZoneEl.classList.remove('drop-active');
        const file = event.dataTransfer?.files?.[0] || null;
        if (file) await uploadFileDirectly(file);
    });
}

document.addEventListener('paste', async event => {
    if (!isAttachmentSection()) return;
    if (!navigator.onLine) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.kind === 'file') {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) await uploadFileDirectly(file);
            break;
        }
    }
});

listEl.addEventListener('keydown', handleListKeydown);

clearDoneBtn.addEventListener('click', clearDone);
modeToggleBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.nav)));
let tabDragJustFinished = false;
sectionTabEls.forEach(tab => tab.addEventListener('click', () => {
    if (tabDragJustFinished) return;
    setSection(tab.dataset.section);
}));

// =========================================
// PWA INSTALL PROMPT
// =========================================
let deferredInstallPrompt = null;
const installBanner  = document.getElementById('installBanner');
const installText    = installBanner ? installBanner.querySelector('.install-text') : null;
const installBtn     = document.getElementById('installBtn');
const installDismiss = document.getElementById('installDismiss');
let installBannerDismissed = readInstallBannerDismissed();
let installBannerMode = 'hidden';

function isStandaloneApp() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isInstallSecureContext() {
    const { hostname } = window.location;
    return (
        window.isSecureContext
        || hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname.endsWith('.localhost')
    );
}

function isIosSafari() {
    const ua = window.navigator.userAgent || '';
    const isIosDevice = /iPad|iPhone|iPod/u.test(ua)
        || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const isSafariBrowser = /Safari\//u.test(ua)
        && !/(Chrome|CriOS|Edg|OPR|Firefox|FxiOS|SamsungBrowser)\//u.test(ua);

    return isIosDevice && isSafariBrowser;
}

function isAndroidChromium() {
    const ua = window.navigator.userAgent || '';
    return /Android/u.test(ua) && /(Chrome|CriOS|EdgA|SamsungBrowser)\//u.test(ua);
}

function getInstallBannerConfig() {
    if (!installBanner || installBannerDismissed || isStandaloneApp()) {
        return { visible: false };
    }

    if (deferredInstallPrompt) {
        return {
            visible: true,
            mode: 'prompt',
            text: 'App installieren?',
            buttonLabel: 'Installieren',
        };
    }

    if (!isInstallSecureContext()) {
        return {
            visible: true,
            mode: 'insecure',
            text: 'Installation nur über HTTPS oder localhost möglich.',
            buttonLabel: 'Warum?',
        };
    }

    if (isIosSafari()) {
        return {
            visible: true,
            mode: 'ios',
            text: 'Auf iPhone/iPad über Teilen und "Zum Home-Bildschirm" installieren.',
            buttonLabel: 'Anleitung',
        };
    }

    if (isAndroidChromium()) {
        return { visible: false };
    }

    return {
        visible: true,
        mode: 'manual',
        text: 'Installation im Browser-Menü unter "Installieren" oder "Zum Startbildschirm hinzufügen".',
        buttonLabel: 'Anleitung',
    };
}

function renderInstallBanner() {
    if (!installBanner) return;

    const config = getInstallBannerConfig();

    if (!config.visible) {
        installBannerMode = 'hidden';
        installBanner.setAttribute('hidden', '');
        return;
    }

    installBannerMode = config.mode;

    if (installText) {
        installText.textContent = config.text;
    }

    if (installBtn) {
        installBtn.textContent = config.buttonLabel;
        installBtn.hidden = false;
    }

    installBanner.removeAttribute('hidden');
}

function dismissInstallBanner({ persist = true } = {}) {
    if (persist) {
        installBannerDismissed = true;
        writeInstallBannerDismissed(true);
    }

    if (installBanner) {
        installBanner.setAttribute('hidden', '');
    }
}

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBannerDismissed = false;
    writeInstallBannerDismissed(false);
    renderInstallBanner();
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (installBannerMode === 'prompt' && deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;

            if (choice?.outcome === 'accepted') {
                dismissInstallBanner({ persist: true });
                return;
            }

            renderInstallBanner();
            return;
        }

        if (installBannerMode === 'ios') {
            setMessage('In Safari auf "Teilen" tippen und dann "Zum Home-Bildschirm".');
            return;
        }

        if (installBannerMode === 'insecure') {
            setMessage('PWA-Installation funktioniert nur über HTTPS oder auf localhost.', true);
            return;
        }

        setMessage('Im Browser-Menü "Installieren" oder "Zum Startbildschirm hinzufügen" wählen.');
    });
}

if (installDismiss) {
    installDismiss.addEventListener('click', () => {
        dismissInstallBanner({ persist: true });
    });
}

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    dismissInstallBanner({ persist: true });
});

// =========================================
// NETWORK + SERVICE WORKER
// =========================================
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
        swRegistration = await navigator.serviceWorker.register(appUrl('sw.js'), {
            scope: appBasePath,
        });

        if (swRegistration.waiting) {
            showUpdateBanner();
        }

        swRegistration.addEventListener('updatefound', () => {
            const installingWorker = swRegistration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
                if (
                    installingWorker.state === 'installed'
                    && navigator.serviceWorker.controller
                ) {
                    showUpdateBanner();
                }
            });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (swRefreshPending) return;
            swRefreshPending = true;
            window.location.reload();
        });
    } catch (err) {
        console.error('Service Worker registration failed', err);
    }
}

if (updateReloadBtn) {
    updateReloadBtn.addEventListener('click', () => {
        if (swRegistration && swRegistration.waiting) {
            swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            return;
        }

        hideUpdateBanner();
        window.location.reload();
    });
}

window.addEventListener('online', () => {
    setNetworkStatus();
    setUploadUiState();
    void flushQueuedToggles();
});
window.addEventListener('offline', () => {
    setNetworkStatus();
    setUploadUiState();
});
window.addEventListener('resize', syncViewportHeight);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportHeight);
}

// =========================================
// NOTE EDITOR
// =========================================
let tiptapEditor = null;
let noteSaveTimer = null;
const NOTE_SAVE_DEBOUNCE_MS = 800;

function waitForTipTap() {
    return new Promise(resolve => {
        if (window.TipTap) { resolve(window.TipTap); return; }
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
    try {
        await api('update', {
            method: 'POST',
            body: new URLSearchParams({ id: String(id), name: title || 'Ohne Titel', content: htmlContent }),
        });
        const item = getItemById(id);
        if (item) { item.name = title || 'Ohne Titel'; item.content = htmlContent; }
        setNoteSaveStatus('Gespeichert');
    } catch {
        setNoteSaveStatus('Fehler');
    }
}

function scheduleNoteSave() {
    clearTimeout(noteSaveTimer);
    setNoteSaveStatus('…');
    noteSaveTimer = setTimeout(() => {
        if (state.noteEditorId === null || !tiptapEditor) return;
        const title = noteTitleInput ? noteTitleInput.value : '';
        void saveNoteContent(state.noteEditorId, title, tiptapEditor.getHTML());
    }, NOTE_SAVE_DEBOUNCE_MS);
}

function updateNoteToolbar() {
    if (!tiptapEditor || !noteToolbar) return;
    noteToolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
        const cmd   = btn.dataset.cmd;
        const level = btn.dataset.level ? Number(btn.dataset.level) : undefined;
        let active  = false;
        if (cmd === 'heading' && level) {
            active = tiptapEditor.isActive('heading', { level });
        } else if (cmd === 'link') {
            active = tiptapEditor.isActive('link');
        } else if (cmd !== 'undo' && cmd !== 'redo') {
            active = tiptapEditor.isActive(cmd);
        }
        btn.classList.toggle('is-active', active);
    });
}

function flushNoteEditorAndClose() {
    clearTimeout(noteSaveTimer);
    if (tiptapEditor && state.noteEditorId !== null) {
        const title = noteTitleInput ? noteTitleInput.value : '';
        void saveNoteContent(state.noteEditorId, title, tiptapEditor.getHTML());
    }
    destroyTipTap();
    state.noteEditorId = null;
    if (noteEditorEl) noteEditorEl.setAttribute('hidden', '');
    appEl.classList.remove('note-editor-open');
}

async function openNoteEditor(item) {
    flushNoteEditorAndClose();

    state.noteEditorId = item.id;
    if (noteTitleInput) noteTitleInput.value = item.name || '';
    setNoteSaveStatus('');

    if (noteEditorEl) noteEditorEl.removeAttribute('hidden');
    appEl.classList.add('note-editor-open');

    const { Editor, StarterKit, Link } = await waitForTipTap();

    if (noteEditorBody) noteEditorBody.innerHTML = '';

    tiptapEditor = new Editor({
        element: noteEditorBody,
        extensions: [StarterKit, Link.configure({ openOnClick: false })],
        content: item.content || '',
        onUpdate: () => { updateNoteToolbar(); scheduleNoteSave(); },
        onSelectionUpdate: updateNoteToolbar,
    });

    updateNoteToolbar();
}

async function closeNoteEditor() {
    if (state.noteEditorId === null) return;

    clearTimeout(noteSaveTimer);
    if (tiptapEditor) {
        const title = noteTitleInput ? noteTitleInput.value : '';
        await saveNoteContent(state.noteEditorId, title, tiptapEditor.getHTML());
    }

    destroyTipTap();
    state.noteEditorId = null;
    if (noteEditorEl) noteEditorEl.setAttribute('hidden', '');
    appEl.classList.remove('note-editor-open');
    void loadItems({ silent: true });
}

function buildNoteCard(item) {
    const li = document.createElement('li');
    li.className   = 'item-card note-card';
    li.dataset.itemId = String(item.id);

    const body    = document.createElement('div');
    body.className = 'note-card-body';

    const title   = document.createElement('span');
    title.className   = 'note-card-title';
    title.textContent = item.name || 'Ohne Titel';
    body.appendChild(title);

    if (item.content) {
        const tmp = document.createElement('div');
        tmp.innerHTML = item.content;
        const text = (tmp.textContent || '').trim();
        if (text) {
            const preview     = document.createElement('span');
            preview.className = 'note-card-preview';
            preview.textContent = text.slice(0, 100);
            body.appendChild(preview);
        }
    }

    const actions    = document.createElement('div');
    actions.className = 'item-actions';
    const delBtn = buildIconButton('btn-item-action btn-delete', 'Notiz löschen', '🗑', async event => {
        event.stopPropagation();
        await handleDelete(item.id);
    });
    actions.appendChild(delBtn);

    li.appendChild(body);
    li.appendChild(actions);

    li.addEventListener('click', event => {
        if (event.target.closest('.btn-delete')) return;
        void openNoteEditor(item);
    });

    return li;
}

if (noteEditorBack) {
    noteEditorBack.addEventListener('click', () => void closeNoteEditor());
}

if (noteTitleInput) {
    noteTitleInput.addEventListener('input', scheduleNoteSave);
}

if (noteToolbar) {
    noteToolbar.addEventListener('click', event => {
        const btn = event.target.closest('button[data-cmd]');
        if (!btn || !tiptapEditor) return;

        const cmd   = btn.dataset.cmd;
        const level = btn.dataset.level ? Number(btn.dataset.level) : undefined;
        const chain = tiptapEditor.chain().focus();

        switch (cmd) {
            case 'heading':     chain.toggleHeading({ level }).run(); break;
            case 'bold':        chain.toggleBold().run(); break;
            case 'italic':      chain.toggleItalic().run(); break;
            case 'strike':      chain.toggleStrike().run(); break;
            case 'bulletList':  chain.toggleBulletList().run(); break;
            case 'orderedList': chain.toggleOrderedList().run(); break;
            case 'blockquote':  chain.toggleBlockquote().run(); break;
            case 'codeBlock':   chain.toggleCodeBlock().run(); break;
            case 'link': {
                const prev = tiptapEditor.isActive('link') ? tiptapEditor.getAttributes('link').href : '';
                const url  = prompt('URL:', prev);
                if (url === null) break;
                if (url === '') { chain.unsetLink().run(); break; }
                chain.setLink({ href: url }).run();
                break;
            }
            case 'undo':  chain.undo().run(); break;
            case 'redo':  chain.redo().run(); break;
        }

        updateNoteToolbar();
    });
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.noteEditorId !== null) {
        void closeNoteEditor();
    }
});

// =========================================
// TAB DRAG REORDER
// =========================================
function saveTabOrder() {
    const order = Array.from(sectionTabsEl.querySelectorAll('.section-tab'))
        .map(tab => tab.dataset.section);
    writeJsonStorage(TABS_ORDER_KEY, order);
}

function applyTabOrder() {
    const saved = readJsonStorage(TABS_ORDER_KEY, null);
    if (!Array.isArray(saved) || !saved.every(s => SECTIONS[s])) return;

    const tabMap = new Map(
        Array.from(sectionTabsEl.querySelectorAll('.section-tab'))
            .map(tab => [tab.dataset.section, tab])
    );
    const savedSet = new Set(saved);
    const extras = Array.from(tabMap.values()).filter(t => !savedSet.has(t.dataset.section));

    [...saved, ...extras.map(t => t.dataset.section)].forEach(section => {
        const tab = tabMap.get(section);
        if (tab) sectionTabsEl.appendChild(tab);
    });
}

function initTabDrag() {
    applyTabOrder();

    sectionTabsEl.addEventListener('pointerdown', event => {
        const tab = event.target.closest('.section-tab');
        if (!tab || (event.button !== undefined && event.button !== 0)) return;

        const startX    = event.clientX;
        const startY    = event.clientY;
        let   dragActive = false;

        const longPressTimer = setTimeout(() => {
            dragActive = true;
            triggerHapticFeedback();
            tab.classList.add('is-tab-dragging');
            sectionTabsEl.classList.add('is-tab-reordering');
            try { tab.setPointerCapture(event.pointerId); } catch {}
        }, 400);

        function onMove(e) {
            if (!dragActive) {
                if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
                    clearTimeout(longPressTimer);
                    cleanup();
                }
                return;
            }

            const others = Array.from(sectionTabsEl.querySelectorAll('.section-tab:not(.is-tab-dragging)'));
            others.forEach(t => t.classList.remove('tab-drop-before', 'tab-drop-after'));

            let insertBefore = null;
            for (const t of others) {
                const rect = t.getBoundingClientRect();
                if (e.clientX < rect.left + rect.width / 2) {
                    insertBefore = t;
                    t.classList.add('tab-drop-before');
                    break;
                }
            }
            if (!insertBefore && others.length > 0) {
                others[others.length - 1].classList.add('tab-drop-after');
            }

            tab._tabInsertBefore = insertBefore;
        }

        function onEnd() {
            clearTimeout(longPressTimer);
            cleanup();

            if (!dragActive) return;

            tab.classList.remove('is-tab-dragging');
            sectionTabsEl.classList.remove('is-tab-reordering');
            Array.from(sectionTabsEl.querySelectorAll('.section-tab'))
                .forEach(t => t.classList.remove('tab-drop-before', 'tab-drop-after'));

            const insertBefore = tab._tabInsertBefore;
            delete tab._tabInsertBefore;

            if (insertBefore) {
                sectionTabsEl.insertBefore(tab, insertBefore);
            } else {
                sectionTabsEl.appendChild(tab);
            }

            saveTabOrder();
            tabDragJustFinished = true;
            setTimeout(() => { tabDragJustFinished = false; }, 150);
        }

        function cleanup() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup',   onEnd);
            document.removeEventListener('pointercancel', onEnd);
        }

        document.addEventListener('pointermove',   onMove);
        document.addEventListener('pointerup',     onEnd);
        document.addEventListener('pointercancel', onEnd);
    });
}

// =========================================
// TABS TOGGLE
// =========================================
function applyTabsVisibility(hidden) {
    if (!sectionTabsEl) return;
    sectionTabsEl.classList.toggle('tabs-hidden', hidden);
    document.querySelectorAll('.btn-tabs-toggle').forEach(btn => btn.classList.toggle('is-active', hidden));
}

function initTabsToggle() {
    const hidden = readJsonStorage(TABS_HIDDEN_KEY, false);
    applyTabsVisibility(hidden);
}

document.querySelectorAll('.btn-tabs-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const nowHidden = !sectionTabsEl.classList.contains('tabs-hidden');
        writeJsonStorage(TABS_HIDDEN_KEY, nowHidden);
        applyTabsVisibility(nowHidden);
    });
});

// =========================================
// INIT
// =========================================
syncViewportHeight();
setNetworkStatus();
renderInstallBanner();
registerServiceWorker();
initTabsToggle();
initTabDrag();

// Restore last active section
(function initSection() {
    const saved = readJsonStorage(SECTION_KEY, 'shopping');
    if (saved && SECTIONS[saved] && saved !== 'shopping') {
        state.section = saved;
        sectionTabEls.forEach(tab => {
            if (tab.dataset.section === saved) {
                tab.setAttribute('aria-current', 'page');
            } else {
                tab.removeAttribute('aria-current');
            }
        });
        updateSectionHeaders();
    }
})();

updateSectionHeaders();
updateFilePickerLabel();
loadItems();
