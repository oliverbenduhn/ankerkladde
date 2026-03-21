# Einkaufsliste Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the shopping list frontend with a Warm Beige theme, two-mode Bottom Navigation (Liste/Einkaufen), and full PWA offline support, without changing the backend.

**Architecture:** The PHP backend (`api.php`, `db.php`, `security.php`) stays entirely untouched. `public/index.php` becomes a thin HTML shell. All CSS moves to `public/style.css`, all JS to `public/app.js`. A Service Worker (`public/sw.js`) and PWA manifest (`public/manifest.json`) add installability and offline support.

**Tech Stack:** Vanilla PHP, Vanilla JS (no frameworks/bundlers), CSS custom properties, Service Worker API, SQLite via existing backend.

**Security note:** All user-controlled content (item names, quantities) is inserted via `element.textContent` — never via `innerHTML`. The only `innerHTML` usage is for static structural markup with no user data.

---

## Chunk 1: HTML Shell + CSS

### Task 1: Rewrite public/index.php as HTML shell

**Files:**
- Modify: `public/index.php`

- [ ] **Step 1: Rewrite index.php**

Replace the entire file with:

```php
<?php
declare(strict_types=1);

require dirname(__DIR__) . '/security.php';

startAppSession();
$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f5f0eb">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="manifest" href="/manifest.json">
    <link rel="stylesheet" href="/style.css">
    <title>Einkaufsliste</title>
</head>
<body>
<div class="app" id="app" data-mode="liste">

    <header class="app-header liste-only">
        <h1 class="app-title">Einkaufsliste</h1>
    </header>

    <header class="app-header shopping-only">
        <h1 class="app-title">Einkaufen</h1>
        <span class="progress" id="progress" aria-live="polite">0 / 0</span>
    </header>

    <section class="input-area liste-only" id="inputArea">
        <form id="itemForm" novalidate>
            <input type="text" id="itemInput" name="name"
                   placeholder="Artikel..." maxlength="120"
                   autocomplete="off" required>
            <input type="text" id="quantityInput" name="quantity"
                   placeholder="Menge" maxlength="40" autocomplete="off">
            <button type="submit" class="btn-add" aria-label="Artikel hinzufügen">+</button>
        </form>
    </section>

    <main class="list-area">
        <ul id="list" aria-live="polite" aria-label="Einkaufsliste"></ul>
        <button type="button" class="btn-clear liste-only"
                id="clearDoneBtn" disabled>Erledigte löschen</button>
    </main>

    <div class="message" id="message" role="status" aria-live="polite"></div>

    <nav class="bottom-nav" aria-label="Hauptnavigation">
        <button class="nav-btn" data-nav="liste"
                aria-current="page" aria-label="Listen-Modus">
            <span class="nav-icon" aria-hidden="true">✏️</span>
            <span class="nav-label">Liste</span>
        </button>
        <button class="nav-btn" data-nav="einkaufen"
                aria-label="Einkaufs-Modus">
            <span class="nav-icon" aria-hidden="true">🛒</span>
            <span class="nav-label">Einkaufen</span>
        </button>
    </nav>
</div>

<script src="/app.js"></script>
<script>
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
</script>
</body>
</html>
```

- [ ] **Step 2: Verify PHP parses without errors**

```bash
php -l public/index.php
```
Expected: `No syntax errors detected in public/index.php`

---

### Task 2: Create public/style.css

**Files:**
- Create: `public/style.css`

- [ ] **Step 1: Create style.css**

```css
/* ===========================================
   TOKENS
   =========================================== */
:root {
    --bg:             #f5f0eb;
    --surface:        #fffdf9;
    --border:         #e8e0d5;
    --text-primary:   #2c2416;
    --text-secondary: #7a6350;
    --text-muted:     #b0a090;
    --accent:         #c8b89a;
    --done-bg:        #f0ebe4;
}

/* ===========================================
   RESET & BASE
   =========================================== */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }

body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.4;
    -webkit-tap-highlight-color: transparent;
}

button, input { font: inherit; }

:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

/* ===========================================
   APP LAYOUT (full-height, fixed bottom nav)
   =========================================== */
.app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
}

/* ===========================================
   HEADERS
   =========================================== */
.app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 16px 10px;
    flex-shrink: 0;
}

.app-title {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.03em;
}

.progress {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-weight: 500;
}

/* ===========================================
   INPUT AREA (Liste-Modus only)
   =========================================== */
.input-area {
    padding: 0 16px 12px;
    flex-shrink: 0;
}

.input-area form {
    display: flex;
    gap: 8px;
    align-items: stretch;
}

.input-area input {
    min-height: 48px;
    padding: 0 14px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.input-area input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(200, 184, 154, 0.2);
}

.input-area input::placeholder { color: var(--text-muted); }

.input-area input[name="quantity"] { flex: 0 0 72px; }

.btn-add {
    min-width: 48px;
    min-height: 48px;
    padding: 0;
    background: var(--text-primary);
    color: var(--surface);
    border: none;
    border-radius: 12px;
    font-size: 1.6rem;
    font-weight: 300;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease, transform 0.1s ease;
}

.btn-add:hover  { background: #3d3024; }
.btn-add:active { transform: scale(0.94); }

/* ===========================================
   LIST AREA
   =========================================== */
.list-area {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
    -webkit-overflow-scrolling: touch;
}

#list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

/* ===========================================
   ITEM CARDS
   =========================================== */
.item-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    animation: cardIn 0.22s ease both;
    transition: opacity 0.2s ease, background 0.2s ease;
}

.item-card.done {
    background: var(--done-bg);
    border-color: transparent;
    opacity: 0.55;
}

.item-card.is-removing {
    opacity: 0;
    transform: translateX(12px);
    transition: opacity 0.18s ease, transform 0.18s ease;
}

/* Shopping mode: larger tap targets */
[data-mode="einkaufen"] .item-card { padding: 14px 16px; gap: 14px; }

/* ===========================================
   CHECKBOX TOGGLE
   =========================================== */
.toggle {
    appearance: none;
    -webkit-appearance: none;
    width: 24px;
    height: 24px;
    min-width: 24px;
    border: 1.5px solid var(--accent);
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
}

.toggle:checked { background: var(--accent); border-color: var(--accent); }

.toggle:checked::after {
    content: "✓";
    font-size: 13px;
    color: var(--surface);
    line-height: 1;
}

[data-mode="einkaufen"] .toggle {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border-radius: 8px;
}

[data-mode="einkaufen"] .toggle:checked::after { font-size: 15px; }

/* ===========================================
   ITEM CONTENT
   =========================================== */
.item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.item-name {
    font-size: 0.95rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.item-card.done .item-name {
    text-decoration: line-through;
    color: var(--text-muted);
}

[data-mode="einkaufen"] .item-name { font-size: 1rem; font-weight: 500; }

.quantity-badge {
    padding: 2px 8px;
    background: var(--border);
    color: var(--text-secondary);
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    flex-shrink: 0;
    white-space: nowrap;
}

/* ===========================================
   DELETE BUTTON
   =========================================== */
.btn-delete {
    min-width: 36px;
    min-height: 36px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 8px;
    font-size: 1.25rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
}

.btn-delete:hover { color: #a05030; background: rgba(160, 80, 48, 0.08); }

/* Hidden in shopping mode */
[data-mode="einkaufen"] .btn-delete { display: none; }

/* ===========================================
   EMPTY STATE
   =========================================== */
.empty-state {
    list-style: none;
    padding: 40px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.95rem;
    animation: cardIn 0.22s ease both;
}

/* ===========================================
   CLEAR DONE BUTTON
   =========================================== */
.btn-clear {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 10px;
    background: none;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 0.85rem;
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
}

.btn-clear:hover   { border-color: var(--accent); color: var(--text-secondary); }
.btn-clear:disabled { opacity: 0.4; cursor: not-allowed; }

/* ===========================================
   STATUS MESSAGE (toast)
   =========================================== */
.message {
    position: fixed;
    bottom: calc(64px + env(safe-area-inset-bottom, 8px) + 12px);
    left: 50%;
    transform: translateX(-50%) translateY(10px);
    background: var(--text-primary);
    color: var(--surface);
    padding: 8px 18px;
    border-radius: 20px;
    font-size: 0.85rem;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 100;
    max-width: calc(100vw - 32px);
    text-align: center;
}

.message.is-visible { opacity: 1; transform: translateX(-50%) translateY(0); }
.message.is-error   { background: #a05030; }

/* ===========================================
   BOTTOM NAVIGATION
   =========================================== */
.bottom-nav {
    display: flex;
    border-top: 1.5px solid var(--border);
    background: var(--surface);
    padding-bottom: env(safe-area-inset-bottom, 8px);
    flex-shrink: 0;
}

.nav-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 10px 8px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    min-height: 56px;
    transition: color 0.15s ease;
}

.nav-btn[aria-current="page"] { color: var(--text-primary); font-weight: 700; }

.nav-icon  { font-size: 1.2rem; line-height: 1; }
.nav-label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

/* ===========================================
   MODE VISIBILITY (CSS-driven)
   =========================================== */
[data-mode="einkaufen"] .liste-only { display: none; }
[data-mode="liste"]     .shopping-only { display: none; }

/* ===========================================
   ANIMATIONS
   =========================================== */
@keyframes cardIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0);   }
}

/* ===========================================
   REDUCED MOTION
   =========================================== */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 2: Visual check**

Start: `php -S 127.0.0.1:8000 -t public`
Open `http://127.0.0.1:8000` and verify:
- Warm Beige background
- Bottom nav with ✏️ Liste / 🛒 Einkaufen
- Input area visible (Liste mode default)
- Full viewport height, no body scroll

- [ ] **Step 3: Commit**

```bash
git add public/index.php public/style.css
git commit -m "feat: new HTML shell and Warm Beige CSS design system"
```

---

## Chunk 2: JavaScript

### Task 3: Create public/app.js

**Files:**
- Create: `public/app.js`

**Security:** All user content (`item.name`, `item.quantity`) is written via `element.textContent`. No user data is concatenated into HTML strings.

- [ ] **Step 1: Create app.js**

```javascript
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
```

- [ ] **Step 2: Functional test**

Start: `php -S 127.0.0.1:8000 -t public`

Test each feature:
- Add item (name only) → appears in list
- Add item with quantity → badge shows
- Check item → moves to bottom with smooth FLIP animation, becomes semi-transparent
- Uncheck → moves back to top with FLIP
- Delete button (×) → slides out, list reloads
- "Erledigte löschen" → clears done items, button disables
- Switch to Einkaufen → input disappears, delete buttons hidden, progress shows
- Check all items in Einkaufen → "Alles erledigt 🎉"
- Open empty list in Einkaufen → "Keine Artikel auf der Liste."
- Open empty list in Liste mode → "Noch nichts auf der Liste. Füge oben etwas hinzu."

- [ ] **Step 3: Smoke tests**

```bash
bash scripts/smoke-test.sh
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: two-mode JS with FLIP animation and offline toggle revert"
```

---

## Chunk 3: PWA

### Task 4: Create public/manifest.json

**Files:**
- Create: `public/manifest.json`

- [ ] **Step 1: Create manifest.json**

```json
{
  "name": "Einkaufsliste",
  "short_name": "Einkauf",
  "lang": "de",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f0eb",
  "theme_color": "#f5f0eb",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

### Task 5: Create app icons

**Files:**
- Create: `public/icons/icon.svg`
- Create: `public/icons/icon-192.png` (committed binary)
- Create: `public/icons/icon-512.png` (committed binary)

- [ ] **Step 1: Create icons directory and SVG source**

```bash
mkdir -p public/icons
```

Create `public/icons/icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#f5f0eb"/>
  <g fill="none" stroke="#2c2416" stroke-width="6"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 20 L25 20 L38 65 L75 65"/>
    <path d="M28 35 L78 35 L72 58 L34 58 Z"/>
    <circle cx="42" cy="76" r="6" fill="#2c2416" stroke="none"/>
    <circle cx="66" cy="76" r="6" fill="#2c2416" stroke="none"/>
  </g>
</svg>
```

- [ ] **Step 2: Generate PNGs (try methods in order)**

```bash
# Method 1: rsvg-convert
rsvg-convert -w 192 -h 192 public/icons/icon.svg -o public/icons/icon-192.png && \
rsvg-convert -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-512.png

# Method 2 (if method 1 fails): ImageMagick
convert -background none -resize 192x192 public/icons/icon.svg public/icons/icon-192.png && \
convert -background none -resize 512x512 public/icons/icon.svg public/icons/icon-512.png

# Method 3 (if method 2 fails): Inkscape
inkscape --export-type=png --export-width=192 \
  --export-filename=public/icons/icon-192.png public/icons/icon.svg && \
inkscape --export-type=png --export-width=512 \
  --export-filename=public/icons/icon-512.png public/icons/icon.svg
```

Verify:
```bash
file public/icons/icon-192.png public/icons/icon-512.png
```
Expected: both report `PNG image data, 192 x 192` and `PNG image data, 512 x 512`

---

### Task 6: Create public/sw.js

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Create sw.js**

```javascript
'use strict';

const CACHE_NAME = 'einkauf-v1';

const STATIC_ASSETS = [
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// INSTALL: pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// ACTIVATE: delete stale caches, claim clients immediately
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// FETCH: per-resource strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    // Static assets: cache-first
    if (STATIC_ASSETS.some(asset => url.pathname === asset)) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // index.php: network-first (CSRF token must always be fresh from session)
    if (url.pathname === '/' || url.pathname === '/index.php') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // api.php GET (action=list): network-first, fallback to cached list
    if (url.pathname === '/api.php' && event.request.method === 'GET') {
        event.respondWith(networkFirstWithClone(event.request));
        return;
    }

    // api.php POST (toggle, add, delete, clear):
    // Pass through unmodified. Fetch failures propagate to app.js,
    // which reverts the optimistic UI update and shows the offline message.
    // Never cache POST requests.
});

// STRATEGY HELPERS

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('<html><body>Offline</body></html>', {
            headers: { 'Content-Type': 'text/html' },
        });
    }
}

async function networkFirstWithClone(request) {
    try {
        const response = await fetch(request);
        // api.php sets Cache-Control: no-store — clone before storing
        // so the original response body is not consumed by the cache write.
        (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Offline with no cache: return empty list so app renders gracefully
        return new Response(JSON.stringify({ items: [] }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
```

---

### Task 7: Final verification

- [ ] **Step 1: Run smoke tests**

```bash
bash scripts/smoke-test.sh
```
Expected: all tests pass

- [ ] **Step 2: PWA manifest check**

Start `php -S 127.0.0.1:8000 -t public`, open Chrome.
DevTools → Application → Manifest
Expected: Name "Einkaufsliste", theme_color `#f5f0eb`, two icons listed

- [ ] **Step 3: Service Worker check**

DevTools → Application → Service Workers
Expected: `sw.js` shows "activated and is running"

- [ ] **Step 4: Offline test**

DevTools → Network → tick "Offline"
- Reload → app loads from cache
- Tap a checkbox → revertiert, Toast "Offline — Änderung konnte nicht gespeichert werden"
- Untick "Offline" → normal operation

- [ ] **Step 5: Commit**

```bash
git add public/manifest.json public/icons/ public/sw.js
git commit -m "feat: add PWA manifest, service worker, and app icons"
```

- [ ] **Step 6: Final smoke test**

```bash
bash scripts/smoke-test.sh
```
Expected: all API tests pass — confirms backend is intact
