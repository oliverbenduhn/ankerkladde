'use strict';

// =========================================
// DOM REFERENCES
// =========================================
const csrfMeta = document.querySelector('meta[name="csrf-token"]');
if (!csrfMeta) throw new Error('csrf-token meta tag missing — page may be stale, please reload.');
const csrfToken     = csrfMeta.content;
const appEl         = document.getElementById('app');
const listEl        = document.getElementById('list');
const listAreaEl    = document.querySelector('.list-area');
const itemForm      = document.getElementById('itemForm');
const itemInput     = document.getElementById('itemInput');
const clearDoneBtn  = document.getElementById('clearDoneBtn');
const messageEl     = document.getElementById('message');
const progressEl    = document.getElementById('progress');
const quantityInput = document.getElementById('quantityInput');
const navBtns       = document.querySelectorAll('.nav-btn');

// =========================================
// CONSTANTS
// =========================================
const DELETE_ANIM_MS = 180;
const DRAG_SCROLL_ZONE_PX = 72;
const DRAG_SCROLL_STEP_PX = 10;

// =========================================
// STATE
// =========================================
const state = {
    items:          [],
    mode:           'liste',   // 'liste' | 'einkaufen'
    pendingIds:     new Set(),
    reorderPending: false,
};

let dragState = null;
let dragScrollFrame = null;

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
    return false;
}

// =========================================
// FLIP ANIMATION
//
// capturePositions() — call BEFORE DOM change
// playFlip(old)      — call AFTER DOM change
//
// Items that already existed animate from their old screen position to
// their new one using the FLIP technique (First / Last / Invert / Play).
// New items (no prior position) play the cardIn CSS animation as normal.
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
function buildItemNode(item, index, totalItems) {
    const isDone = item.done === 1;
    const isBlocked = isInteractionBlocked(item.id);

    const li = document.createElement('li');
    li.className = `item-card ${isDone ? 'done' : 'open'}`;
    li.dataset.itemId = String(item.id);

    const checkbox = document.createElement('input');
    checkbox.type      = 'checkbox';
    checkbox.className = 'toggle';
    checkbox.checked   = isDone;
    checkbox.disabled  = isBlocked;
    checkbox.setAttribute('aria-label', `${item.name} umschalten`);
    checkbox.addEventListener('change', () => handleToggle(item.id));

    const content = document.createElement('div');
    content.className = 'item-content';

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

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const dragHandle = document.createElement('button');
    dragHandle.type      = 'button';
    dragHandle.className = 'btn-drag-handle';
    dragHandle.disabled  = state.mode !== 'liste' || totalItems < 2 || isBlocked;
    dragHandle.setAttribute('aria-label', `${item.name} verschieben`);
    dragHandle.setAttribute('title', 'Per Ziehen umsortieren');
    dragHandle.addEventListener('pointerdown', event => startDrag(event, item.id));
    dragHandle.addEventListener('keydown', event => handleReorderKeydown(event, item.id));
    actions.appendChild(dragHandle);

    const delBtn = document.createElement('button');
    delBtn.type      = 'button';
    delBtn.className = 'btn-delete';
    delBtn.disabled  = isBlocked;
    delBtn.setAttribute('aria-label', `${item.name} löschen`);
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => handleDelete(item.id));
    actions.appendChild(delBtn);

    if (index === 0) {
        dragHandle.dataset.atTop = 'true';
    }
    if (index === totalItems - 1) {
        dragHandle.dataset.atBottom = 'true';
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
    clearDoneBtn.disabled  = doneCount === 0 || state.reorderPending || Boolean(dragState);

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
async function loadItems() {
    try {
        const payload = await api('list');
        state.items   = (payload.items || []).map(item => ({
            ...item,
            id: Number(item.id),
            done: Number(item.done),
            sort_order: Number(item.sort_order),
        }));
        renderItems();
    } catch (err) {
        setMessage(err.message, true);
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
        setMessage(err.message || 'Reihenfolge konnte nicht gespeichert werden.', true);
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
}

function cleanupDragPresentation() {
    if (!dragState) return;

    const { card, handle } = dragState;

    try {
        handle.releasePointerCapture(dragState.pointerId);
    } catch (err) {
        // Pointer capture may already be released.
    }

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
    if (state.mode !== 'liste' || isInteractionBlocked(id)) return;
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
    };

    moveDraggedCard(event.clientY);
    startAutoScroll();
    document.addEventListener('pointermove', onDragPointerMove, { passive: false });
    document.addEventListener('pointerup', onDragPointerEnd);
    document.addEventListener('pointercancel', onDragPointerEnd);
}

// =========================================
// ACTIONS
// =========================================
async function addItem(event) {
    event.preventDefault();
    if (state.reorderPending || dragState) return;

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
        setMessage(err.message, true);
    } finally {
        submitBtn.disabled = false;
    }
}

async function handleToggle(id) {
    const item = state.items.find(entry => entry.id === id);
    if (!item || isInteractionBlocked(id)) return;
    state.pendingIds.add(id);

    const currentDone = Number(item.done);
    const newDone = currentDone === 1 ? 0 : 1;

    const oldPositions = capturePositions();
    item.done = newDone;
    renderItems();
    playFlip(oldPositions);

    try {
        await api('toggle', {
            method: 'POST',
            body:   new URLSearchParams({ id: String(id), done: String(newDone) }),
        });
    } catch (err) {
        item.done = currentDone;
        renderItems();
        setMessage('Offline — Änderung konnte nicht gespeichert werden', true);
    } finally {
        state.pendingIds.delete(id);
        renderItems();
    }
}

async function handleDelete(id) {
    if (isInteractionBlocked(id)) return;
    state.pendingIds.add(id);
    renderItems();

    const card = listEl.querySelector(`[data-item-id="${id}"]`);
    if (card) {
        card.classList.add('is-removing');
        await delay(DELETE_ANIM_MS);
    }

    try {
        await api('delete', { method: 'POST', body: new URLSearchParams({ id: String(id) }) });
        await loadItems();
        setMessage('Artikel gelöscht.');
    } catch (err) {
        setMessage(err.message, true);
        await loadItems();
    } finally {
        state.pendingIds.delete(id);
        renderItems();
    }
}

async function clearDone() {
    if (state.reorderPending || dragState) return;

    clearDoneBtn.disabled = true;
    try {
        await api('clear', { method: 'POST' });
        await loadItems();
        setMessage('Erledigte Artikel entfernt.');
    } catch (err) {
        setMessage(err.message, true);
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

itemInput.addEventListener('keydown', submitOnEnter);
quantityInput.addEventListener('keydown', submitOnEnter);

clearDoneBtn.addEventListener('click', clearDone);
navBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.nav)));

// =========================================
// PWA INSTALL PROMPT
// =========================================
let deferredInstallPrompt = null;
const installBanner  = document.getElementById('installBanner');
const installBtn     = document.getElementById('installBtn');
const installDismiss = document.getElementById('installDismiss');

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installBanner) installBanner.removeAttribute('hidden');
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        installBanner.setAttribute('hidden', '');
    });
}

if (installDismiss) {
    installDismiss.addEventListener('click', () => {
        installBanner.setAttribute('hidden', '');
    });
}

window.addEventListener('appinstalled', () => {
    if (installBanner) installBanner.setAttribute('hidden', '');
    deferredInstallPrompt = null;
});

// =========================================
// INIT
// =========================================
loadItems();
