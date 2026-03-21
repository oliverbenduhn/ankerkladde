'use strict';

// =========================================
// DOM REFERENCES
// =========================================
const csrfToken     = document.querySelector('meta[name="csrf-token"]').content;
const appEl         = document.getElementById('app');
const listEl        = document.getElementById('list');
const itemForm      = document.getElementById('itemForm');
const itemInput     = document.getElementById('itemInput');
const clearDoneBtn  = document.getElementById('clearDoneBtn');
const messageEl     = document.getElementById('message');
const progressEl    = document.getElementById('progress');
const navBtns       = document.querySelectorAll('.nav-btn');

// =========================================
// STATE
// =========================================
const state = {
    items:      [],
    mode:       'liste',   // 'liste' | 'einkaufen'
    pendingIds: new Set(),
};

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
        if (!oldRect) return;   // new item — cardIn CSS animation handles it

        const newRect = el.getBoundingClientRect();
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dy) < 1) return;  // no movement

        // Suppress cardIn on this item (it already existed, just moved)
        el.style.animation = 'none';

        // Snap to old position instantly
        el.style.transition = 'none';
        el.style.transform  = `translateY(${dy}px)`;
        el.offsetHeight;                              // force reflow

        // Animate to final position
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
// BUILD ITEM NODE (DOM — no innerHTML for user data)
//
// Creates a complete <li> element for one item using DOM methods only.
// All user-provided strings go through element.textContent or
// element.setAttribute (aria-label). No string is concatenated into HTML.
// =========================================
function buildItemNode(item) {
    const isDone = Number(item.done) === 1;

    const li = document.createElement('li');
    li.className = `item-card ${isDone ? 'done' : 'open'}`;
    li.dataset.itemId = String(item.id);

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type      = 'checkbox';
    checkbox.className = 'toggle';
    checkbox.checked   = isDone;
    checkbox.setAttribute('aria-label', `${item.name} umschalten`);
    checkbox.addEventListener('change', () => handleToggle(item.id, isDone ? 1 : 0));

    // Content wrapper
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

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.type      = 'button';
    delBtn.className = 'btn-delete';
    delBtn.setAttribute('aria-label', `${item.name} löschen`);
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => handleDelete(item.id));

    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(delBtn);

    return li;
}

// =========================================
// RENDER
// =========================================
function renderItems() {
    const items      = state.items;
    const doneCount  = items.filter(i => Number(i.done) === 1).length;
    const totalCount = items.length;

    progressEl.textContent  = `${doneCount} / ${totalCount}`;
    clearDoneBtn.disabled   = doneCount === 0;

    // Clear list
    listEl.replaceChildren();

    // Empty state: no items at all
    if (items.length === 0) {
        const li = document.createElement('li');
        li.className   = 'empty-state';
        li.textContent = state.mode === 'liste'
            ? 'Noch nichts auf der Liste. Füge oben etwas hinzu.'
            : 'Keine Artikel auf der Liste.';
        listEl.appendChild(li);
        return;
    }

    // Empty state: all done (Einkaufen mode only)
    if (state.mode === 'einkaufen' && items.every(i => Number(i.done) === 1)) {
        const li = document.createElement('li');
        li.className   = 'empty-state';
        li.textContent = 'Alles erledigt 🎉';
        listEl.appendChild(li);
        return;
    }

    // Sort: open first, done last (stable)
    const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done));

    const fragment = document.createDocumentFragment();
    sorted.forEach(item => fragment.appendChild(buildItemNode(item)));
    listEl.appendChild(fragment);
}

// =========================================
// MODE SWITCHING
// =========================================
function setMode(mode) {
    state.mode         = mode;
    appEl.dataset.mode = mode;

    navBtns.forEach(btn => {
        btn.setAttribute(
            'aria-current',
            btn.dataset.nav === mode ? 'page' : 'false'
        );
    });

    renderItems();
}

// =========================================
// API
// =========================================
async function api(action, options = {}) {
    const method       = (options.method || 'GET').toUpperCase();
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
        state.items   = payload.items || [];
        renderItems();
    } catch (err) {
        setMessage(err.message, true);
    }
}

// =========================================
// ACTIONS
// =========================================
async function addItem(event) {
    event.preventDefault();
    const formData = new FormData(itemForm);

    try {
        await api('add', { method: 'POST', body: new URLSearchParams(formData) });
        itemForm.reset();
        itemInput.focus();
        await loadItems();
        setMessage('Artikel hinzugefügt.');
    } catch (err) {
        setMessage(err.message, true);
    }
}

async function handleToggle(id, currentDone) {
    // currentDone: 1 = currently done, 0 = currently open
    if (state.pendingIds.has(id)) return;
    state.pendingIds.add(id);

    const newDone = currentDone === 1 ? 0 : 1;
    const item    = state.items.find(i => i.id === id);

    // Optimistic update + FLIP
    if (item) item.done = newDone;
    const oldPositions = capturePositions();
    renderItems();
    playFlip(oldPositions);

    try {
        await api('toggle', {
            method: 'POST',
            body:   new URLSearchParams({ id: String(id), done: String(newDone) }),
        });
    } catch (err) {
        // Revert: restore original done state and re-render
        if (item) item.done = currentDone;
        renderItems();
        setMessage('Offline — Änderung konnte nicht gespeichert werden', true);
    } finally {
        state.pendingIds.delete(id);
    }
}

async function handleDelete(id) {
    if (state.pendingIds.has(id)) return;
    state.pendingIds.add(id);

    const card = listEl.querySelector(`[data-item-id="${id}"]`);
    if (card) {
        card.classList.add('is-removing');
        await delay(180);
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
    }
}

async function clearDone() {
    try {
        await api('clear', { method: 'POST' });
        await loadItems();
        setMessage('Erledigte Artikel entfernt.');
    } catch (err) {
        setMessage(err.message, true);
    }
}

// =========================================
// EVENT LISTENERS
// =========================================
itemForm.addEventListener('submit', addItem);
clearDoneBtn.addEventListener('click', clearDone);
navBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.nav)));

// =========================================
// INIT
// =========================================
loadItems();
