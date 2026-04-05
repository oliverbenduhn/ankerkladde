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
const clearDoneBtn    = document.getElementById('clearDoneBtn');
const messageEl       = document.getElementById('message');
const progressEl      = document.getElementById('progress');
const quantityInput   = document.getElementById('quantityInput');
const navBtns         = document.querySelectorAll('.nav-btn');
const networkStatusEl = document.getElementById('networkStatus');
const updateBannerEl  = document.getElementById('updateBanner');
const updateReloadBtn = document.getElementById('updateReloadBtn');

// =========================================
// CONSTANTS
// =========================================
const DELETE_ANIM_MS = 180;
const DRAG_SCROLL_ZONE_PX = 72;
const DRAG_SCROLL_STEP_PX = 10;
const HAPTIC_FEEDBACK_MS = 12;
const INSTALL_BANNER_DISMISSED_KEY = 'einkauf-install-banner-dismissed-v2';
const ITEMS_CACHE_KEY = 'einkauf-items-cache-v1';
const TOGGLE_QUEUE_KEY = 'einkauf-toggle-queue-v1';

// =========================================
// STATE
// =========================================
const state = {
    items:          [],
    mode:           'liste',   // 'liste' | 'einkaufen'
    pendingIds:     new Set(),
    reorderPending: false,
    editingId:      null,
    editDraft:      { name: '', quantity: '' },
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
    };
}

function clearEditState() {
    state.editingId = null;
    state.editDraft = { name: '', quantity: '' };
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
    };
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

function readCachedItems() {
    const items = readJsonStorage(ITEMS_CACHE_KEY, []);
    if (!Array.isArray(items)) return [];
    return items.map(normalizeItem);
}

function writeCachedItems(items) {
    writeJsonStorage(ITEMS_CACHE_KEY, items.map(normalizeItem));
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

    try {
        while (navigator.onLine) {
            const [nextEntry] = readQueuedToggles();
            if (!nextEntry) break;

            await api('toggle', {
                method: 'POST',
                body: new URLSearchParams({
                    id: String(nextEntry.id),
                    done: String(nextEntry.done),
                }),
            });

            clearQueuedToggleIfUnchanged(nextEntry.id, nextEntry.done);
            syncedCount += 1;
        }

        if (syncedCount > 0) {
            await loadItems({ skipOfflineSync: true, silent: true });
            setMessage('Offline-Änderungen synchronisiert.');
        }
    } catch (error) {
        if (!isConnectivityError(error)) {
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
function buildReadOnlyContent(item, content) {
    const nameEl = document.createElement('span');
    nameEl.className   = 'item-name';
    nameEl.textContent = item.name;
    content.appendChild(nameEl);

    if (item.quantity) {
        const badge = document.createElement('span');
        badge.className   = 'quantity-badge';
        badge.textContent = item.quantity;
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
    nameInput.placeholder = 'Artikel';
    nameInput.maxLength = 120;
    nameInput.autocomplete = 'off';
    nameInput.disabled = isSaving;
    nameInput.addEventListener('input', event => setEditField('name', event.target.value));
    fields.appendChild(nameInput);

    const quantityField = document.createElement('div');
    quantityField.className = 'item-edit-quantity-row';

    const quantityInputEl = document.createElement('input');
    quantityInputEl.type = 'text';
    quantityInputEl.className = 'item-edit-input';
    quantityInputEl.value = state.editDraft.quantity;
    quantityInputEl.placeholder = 'Menge';
    quantityInputEl.maxLength = 40;
    quantityInputEl.autocomplete = 'off';
    quantityInputEl.disabled = isSaving;
    quantityInputEl.addEventListener('input', event => setEditField('quantity', event.target.value));
    quantityField.appendChild(quantityInputEl);

    fields.appendChild(quantityField);
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

    navBtns.forEach(btn => {
        if (btn.dataset.nav === mode) {
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.removeAttribute('aria-current');
        }
    });

    renderItems();
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

    const response = await fetch(
        `api.php?action=${encodeURIComponent(action)}`,
        fetchOptions
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(payload.error || 'Unbekannter Fehler');
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

// =========================================
// REORDER
// =========================================
async function persistOrder(orderedIds) {
    state.reorderPending = true;
    renderItems();

    try {
        await api('reorder', {
            method: 'POST',
            body: buildReorderBody(orderedIds),
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

    const name = normalizeNameInput(state.editDraft.name);
    const quantity = normalizeQuantityInput(state.editDraft.quantity);

    if (name === '') {
        setMessage('Bitte gib einen Artikelnamen ein.', true);
        focusEditNameInput(id);
        return;
    }

    state.pendingIds.add(id);
    renderItems();

    try {
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

    const formData = new FormData(itemForm);
    const submitBtn = itemForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;

    try {
        await api('add', { method: 'POST', body: new URLSearchParams(formData) });
        itemForm.reset();
        itemInput.focus();
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
        await api('clear', { method: 'POST' });
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
listEl.addEventListener('keydown', handleListKeydown);

clearDoneBtn.addEventListener('click', clearDone);
navBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.nav)));

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
    void flushQueuedToggles();
});
window.addEventListener('offline', setNetworkStatus);
window.addEventListener('resize', syncViewportHeight);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportHeight);
}

// =========================================
// INIT
// =========================================
syncViewportHeight();
setNetworkStatus();
renderInstallBanner();
registerServiceWorker();
loadItems();
