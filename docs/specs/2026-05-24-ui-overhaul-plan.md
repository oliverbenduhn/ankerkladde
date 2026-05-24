# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed mode/view system with three independent state axes (screen, mode, layout), unify to a single header, and clean up CSS/router workarounds.

**Architecture:** Bottom-up approach — introduce the new state model first, then progressively migrate router, header, controls, and CSS. Each phase is independently testable. Old code is aliased/mapped before removal.

**Tech Stack:** Vanilla JS (ESM modules), PHP 8.1+, CSS, SQLite

---

### Task 1: Introduce new state variables and helpers

**Files:**
- Modify: `public/js/state.js:81-95` (state object)
- Modify: `public/js/state.js:17-31` (DEFAULT_PREFERENCES)
- Modify: `public/js/state.js:35-45` (LOCAL_PREF_KEYS)
- Modify: `public/js/state.js:138-156` (normalizePreferences)

- [ ] **Step 1: Add `state.screen` and rename mode/layout values in state object**

In `public/js/state.js`, change the state object (line 81):

```js
export const state = {
    categories: [],
    categoryId: null,
    items: [],
    itemsByCategoryId: new Map(),
    view: 'list',
    settingsTab: 'app',
    screen: 'list',           // NEW: list | search | settings | scanner | note
    mode: 'liste',            // KEEP OLD VALUE for now — will be migrated in Task 2
    layout: 'list',           // NEW: list | grid | kanban
    desktopLayout: 'liste',   // KEEP OLD — will be removed in Task 2
    editingId: null,
    editDraft: { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', content: '' },
    search: { open: false, query: '', results: [] },
    noteEditorId: null,
    diskFreeBytes: null,
};
```

- [ ] **Step 2: Add layout availability map and helper functions**

Append to `public/js/state.js` after the `isIosWebKit` function:

```js
const AVAILABLE_LAYOUTS = {
    list_quantity: ['list', 'grid'],
    list_due_date: ['list', 'grid', 'kanban'],
    notes: ['list', 'grid'],
    images: ['list', 'grid'],
    files: ['list'],
    links: ['list', 'grid'],
};

export function getAvailableLayouts(categoryType = getCurrentType()) {
    return AVAILABLE_LAYOUTS[categoryType] || ['list'];
}

export function isLayoutAvailable(layout, categoryType = getCurrentType()) {
    return getAvailableLayouts(categoryType).includes(layout);
}
```

- [ ] **Step 3: Run syntax check**

Run: `php -l public/js/state.js` won't work (JS file). Instead:
```bash
node --check public/js/state.js
```
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add public/js/state.js
git commit -m "feat: add screen/layout state and layout availability helpers"
```

---

### Task 2: Wire up state migration — map old values to new

**Files:**
- Modify: `public/js/state.js:81-95` (state object — remove old aliases)
- Modify: `public/js/state.js:17-31` (DEFAULT_PREFERENCES)
- Modify: `public/js/state.js:35-45` (LOCAL_PREF_KEYS)
- Modify: `public/js/state.js:138-156` (normalizePreferences)
- Modify: `public/js/app-init.js:27-34` (initial state setup)

- [ ] **Step 1: Update DEFAULT_PREFERENCES — rename mode values and desktop_layout**

In `public/js/state.js`, change `DEFAULT_PREFERENCES`:

```js
export const DEFAULT_PREFERENCES = {
    mode: 'edit',
    tabs_hidden: false,
    category_swipe_enabled: true,
    product_scanner_enabled: true,
    shopping_list_scanner_enabled: true,
    magic_button_enabled: true,
    last_category_id: null,
    install_banner_dismissed: false,
    theme_mode: 'auto',
    light_theme: 'hafenblau',
    dark_theme: 'nachtwache',
    layout: 'list',
};
```

- [ ] **Step 2: Update LOCAL_PREF_KEYS**

Replace `'desktop_layout'` with `'layout'` in `LOCAL_PREF_KEYS`:

```js
export const LOCAL_PREF_KEYS = [
    'mode',
    'last_category_id',
    'tabs_hidden',
    'category_swipe_enabled',
    'install_banner_dismissed',
    'theme_mode',
    'light_theme',
    'dark_theme',
    'layout',
];
```

- [ ] **Step 3: Update normalizePreferences — migrate old values**

Replace the `normalizePreferences` function:

```js
export function normalizePreferences(preferences) {
    const validThemes = getValidThemes();
    const rawLight = preferences?.light_theme === 'grauton' ? 'regenbogen' : preferences?.light_theme;

    // Migrate old mode values: 'liste' -> 'edit', 'einkaufen' -> 'view'
    let rawMode = preferences?.mode;
    if (rawMode === 'liste') rawMode = 'edit';
    else if (rawMode === 'einkaufen') rawMode = 'view';

    // Migrate old desktop_layout values: 'liste' -> 'list'
    let rawLayout = preferences?.layout ?? preferences?.desktop_layout;
    if (rawLayout === 'liste') rawLayout = 'list';

    return {
        mode: rawMode === 'view' ? 'view' : 'edit',
        tabs_hidden: Boolean(preferences?.tabs_hidden),
        category_swipe_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'category_swipe_enabled') || Boolean(preferences?.category_swipe_enabled),
        product_scanner_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'product_scanner_enabled') || Boolean(preferences?.product_scanner_enabled),
        shopping_list_scanner_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'shopping_list_scanner_enabled') || Boolean(preferences?.shopping_list_scanner_enabled),
        magic_button_enabled: !Object.prototype.hasOwnProperty.call(preferences || {}, 'magic_button_enabled') || Boolean(preferences?.magic_button_enabled),
        last_category_id: Number.isInteger(Number(preferences?.last_category_id)) ? Number(preferences.last_category_id) : null,
        install_banner_dismissed: Boolean(preferences?.install_banner_dismissed),
        theme_mode: THEME_MODE_ORDER.includes(preferences?.theme_mode) ? preferences.theme_mode : 'auto',
        light_theme: validThemes.light.includes(rawLight) ? rawLight : 'hafenblau',
        dark_theme: validThemes.dark.includes(preferences?.dark_theme) ? preferences.dark_theme : 'nachtwache',
        layout: ['list', 'grid', 'kanban'].includes(rawLayout) ? rawLayout : 'list',
    };
}
```

- [ ] **Step 4: Remove old state aliases, update state object**

In `public/js/state.js`, update the state object to remove `view` and `desktopLayout`:

```js
export const state = {
    categories: [],
    categoryId: null,
    items: [],
    itemsByCategoryId: new Map(),
    settingsTab: 'app',
    screen: 'list',
    mode: 'edit',
    layout: 'list',
    editingId: null,
    editDraft: { itemId: null, categoryId: null, name: '', barcode: '', quantity: '', due_date: '', content: '' },
    search: { open: false, query: '', results: [] },
    noteEditorId: null,
    diskFreeBytes: null,
};
```

- [ ] **Step 5: Update app-init.js — use new preference names**

In `public/js/app-init.js`, update the initial state setup. Change:

```js
        state.mode = userPreferences.mode;
        state.desktopLayout = userPreferences.desktop_layout;
        if (appEl) {
            appEl.dataset.mode = state.mode;
            appEl.dataset.desktopLayout = state.desktopLayout;
        }
        desktopLayoutBtns.forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.layout === state.desktopLayout ? 'true' : 'false');
        });
```

to:

```js
        state.mode = userPreferences.mode;
        state.layout = userPreferences.layout;
        if (appEl) {
            appEl.dataset.mode = state.mode;
            appEl.dataset.layout = state.layout;
        }
        desktopLayoutBtns.forEach(btn => {
            const btnLayout = btn.dataset.layout === 'liste' ? 'list' : btn.dataset.layout;
            btn.setAttribute('aria-pressed', btnLayout === state.layout ? 'true' : 'false');
        });
```

- [ ] **Step 6: Update all JS files referencing old state values**

Update references in the following files:

In `public/js/app-events.js` (and/or `app-events-layout.js`), change all `state.desktopLayout` to `state.layout` and `desktop_layout` to `layout` in `saveLocalPrefs` calls. Also change mode value comparisons from `'liste'`/`'einkaufen'` to `'edit'`/`'view'`:

- `state.desktopLayout = layout` → `state.layout = layoutMap[layout] || layout` (where `layoutMap = { liste: 'list' }`)
- `appEl.dataset.desktopLayout = layout` → `appEl.dataset.layout = state.layout`
- `saveLocalPrefs({ desktop_layout: layout })` → `saveLocalPrefs({ layout: state.layout })`
- `layout === state.desktopLayout` → same but with new values
- `state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste'` → `state.mode = state.mode === 'edit' ? 'view' : 'edit'`
- `appEl.dataset.mode = state.mode` → same
- `void savePreferences({ mode: state.mode })` → same

In `public/js/router.js`:
- `switchToListMode`: change `state.mode = 'liste'` to `state.mode = 'edit'`
- `state.view = 'settings'` → `state.screen = 'settings'`
- `state.view = 'list'` → `state.screen = 'list'`
- `state.view === 'settings'` → `state.screen === 'settings'`

In `public/js/items-view.js`:
- `state.mode === 'liste'` → `state.mode === 'edit'`

In `public/js/reorder.js`:
- `state.mode !== 'liste'` → `state.mode !== 'edit'`

In `public/js/items.js`:
- `state.mode === 'einkaufen'` → `state.mode === 'view'`

In `public/js/scanner.js`:
- `state.mode === 'einkaufen'` → `state.mode === 'view'`

In `public/js/app-runtime.js`:
- `state.mode === 'einkaufen'` → `state.mode === 'view'`
- `state.desktopLayout === 'kanban'` → `state.layout === 'kanban'`

- [ ] **Step 7: Update index.php — initial data-mode and data-layout attributes**

In `public/index.php`, change the PHP that computes initial values (lines 50-53):

```php
$initialMode = ($userPreferences['mode'] ?? 'liste') === 'einkaufen' ? 'view' : 'edit';
$validLayouts = ['list', 'grid', 'kanban'];
$rawLayout = $userPreferences['layout'] ?? $userPreferences['desktop_layout'] ?? 'list';
if ($rawLayout === 'liste') $rawLayout = 'list';
$initialLayout = in_array($rawLayout, $validLayouts, true) ? $rawLayout : 'list';
```

And on the app div (line 84):

```html
<div class="app" id="app" data-mode="<?= htmlspecialchars($initialMode, ENT_QUOTES, 'UTF-8') ?>" data-layout="<?= htmlspecialchars($initialLayout, ENT_QUOTES, 'UTF-8') ?>">
```

- [ ] **Step 8: Update CSS — change data-mode selectors**

In `public/style.css`, replace all `[data-mode="einkaufen"]` with `[data-mode="view"]` and `[data-mode="liste"]` with `[data-mode="edit"]`. Also replace `[data-desktop-layout=` with `[data-layout=` and adjust the values (`"liste"` → `"list"`).

- [ ] **Step 9: Run syntax check and smoke test**

```bash
node --check public/js/state.js && node --check public/js/router.js && node --check public/js/navigation.js && node --check public/js/app-init.js
php -l public/index.php
bash scripts/smoke-test.sh
```

- [ ] **Step 10: Bump version and commit**

Bump version in `public/version.php`, then:

```bash
git add -A
git commit -m "refactor: migrate state from liste/einkaufen to edit/view, desktopLayout to layout"
```

---

### Task 3: Normalize router to use screen/mode/layout URL parameters

**Files:**
- Modify: `public/js/navigation.js` (URL building, reading, normalizing)
- Modify: `public/js/router.js` (remove switchToListMode workaround)

- [ ] **Step 1: Update normalizeRouteState to include mode and layout**

In `public/js/navigation.js`, update `normalizeRouteState`:

```js
    function normalizeRouteState(route = {}) {
        const screen = ['list', 'settings', 'search', 'note', 'scanner'].includes(route?.screen)
            ? route.screen
            : 'list';

        const base = {
            mode: route?.mode === 'view' ? 'view' : 'edit',
            layout: ['list', 'grid', 'kanban'].includes(route?.layout) ? route.layout : 'list',
        };

        if (screen === 'settings') {
            return { ...base, screen, tab: normalizeSettingsTab(route?.tab) };
        }

        if (screen === 'search') {
            return { ...base, screen, query: typeof route?.query === 'string' ? route.query : '' };
        }

        if (screen === 'note') {
            const noteId = Number(route?.noteId);
            return {
                ...base,
                screen,
                noteId: Number.isInteger(noteId) && noteId > 0 ? noteId : null,
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }

        if (screen === 'scanner') {
            return {
                ...base,
                screen,
                action: route?.action === 'toggle' ? 'toggle' : 'add',
                categoryId: Number.isInteger(Number(route?.categoryId)) ? Number(route.categoryId) : null,
            };
        }

        return { ...base, screen: 'list' };
    }
```

- [ ] **Step 2: Update buildUrlForRoute to write screen/mode/layout params**

In `public/js/navigation.js`, update `buildUrlForRoute`:

```js
    function buildUrlForRoute(route) {
        const normalized = normalizeRouteState(route);
        const url = new URL(window.location.href);

        // Clear old and new params
        for (const key of ['view', 'screen', 'mode', 'layout', 'tab', 'note', 'scanner_action', 'q', 'category_id']) {
            url.searchParams.delete(key);
        }

        // Only write non-default values
        if (normalized.screen !== 'list') {
            url.searchParams.set('screen', normalized.screen);
        }
        if (normalized.mode !== 'edit') {
            url.searchParams.set('mode', normalized.mode);
        }
        if (normalized.layout !== 'list') {
            url.searchParams.set('layout', normalized.layout);
        }

        if (normalized.screen === 'settings') {
            url.searchParams.set('tab', normalized.tab);
        } else if (normalized.screen === 'search') {
            if (normalized.query.trim() !== '') {
                url.searchParams.set('q', normalized.query);
            }
        } else if (normalized.screen === 'note' && normalized.noteId) {
            url.searchParams.set('note', String(normalized.noteId));
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
        } else if (normalized.screen === 'scanner') {
            url.searchParams.set('scanner_action', normalized.action);
            if (normalized.categoryId !== null) {
                url.searchParams.set('category_id', String(normalized.categoryId));
            }
        }

        return `${url.pathname}${url.search}${url.hash}`;
    }
```

- [ ] **Step 3: Update readInitialRouteFromUrl for backwards compatibility**

In `public/js/navigation.js`, update `readInitialRouteFromUrl`:

```js
    function readInitialRouteFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const categoryId = Number(params.get('category_id'));

        // Read new params, fall back to old 'view' param
        let screen = params.get('screen');
        if (!screen) {
            const oldView = params.get('view');
            if (oldView) screen = oldView;
        }

        // Read mode and layout from URL, fall back to localStorage defaults
        const urlMode = params.get('mode');
        const urlLayout = params.get('layout');
        const mode = urlMode === 'view' ? 'view' : 'edit';
        const layout = ['list', 'grid', 'kanban'].includes(urlLayout) ? urlLayout : null;

        const base = { mode, layout: layout || state.layout };

        if (screen === 'settings') {
            return normalizeRouteState({ ...base, screen: 'settings', tab: params.get('tab') });
        }

        if (screen === 'search') {
            return normalizeRouteState({ ...base, screen: 'search', query: params.get('q') || '' });
        }

        if (screen === 'note') {
            return normalizeRouteState({
                ...base,
                screen: 'note',
                noteId: Number(params.get('note')),
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }

        if (screen === 'scanner') {
            return normalizeRouteState({
                ...base,
                screen: 'scanner',
                action: params.get('scanner_action'),
                categoryId: Number.isInteger(categoryId) ? categoryId : null,
            });
        }

        return normalizeRouteState({ ...base, screen: 'list' });
    }
```

Note: This requires importing `state` — add to the import line at top of navigation.js:

```js
import { normalizeSettingsTab } from './api.js?v=4.3.4';
import { state } from './state.js?v=4.3.4';
```

- [ ] **Step 4: Update getCurrentRouteState in router.js to include mode/layout**

In `public/js/router.js`, update `getCurrentRouteState`:

```js
    function getCurrentRouteState() {
        const base = { mode: state.mode, layout: state.layout };

        if (deps.scannerState.open) {
            return { ...base, screen: 'scanner', action: deps.scannerState.action, categoryId: state.categoryId };
        }
        if (state.noteEditorId !== null) {
            return { ...base, screen: 'note', noteId: state.noteEditorId, categoryId: state.categoryId };
        }
        if (state.screen === 'settings') {
            return { ...base, screen: 'settings', tab: state.settingsTab };
        }
        if (state.search.open) {
            return { ...base, screen: 'search', query: state.search.query };
        }
        return { ...base, screen: 'list' };
    }
```

- [ ] **Step 5: Remove switchToListMode workaround from search in router.js**

In `public/js/router.js`, in the `applyRouteState` function, remove the `switchToListMode()` call before `openSearch()` (line 135). The search screen now operates independently of mode.

Also remove the `switchToListMode` function entirely since it's no longer used.

- [ ] **Step 6: Apply mode and layout from route state**

In `public/js/router.js`, at the start of `applyRouteState`, add mode/layout application:

```js
    async function applyRouteState(route, normalizeRouteState) {
        const target = normalizeRouteState(route);

        // Apply mode and layout from route
        if (target.mode && target.mode !== state.mode) {
            state.mode = target.mode;
            if (appEl) appEl.dataset.mode = state.mode;
        }
        if (target.layout && target.layout !== state.layout) {
            state.layout = target.layout;
            if (appEl) appEl.dataset.layout = state.layout;
        }

        // ... rest of existing close/open logic unchanged
```

This requires importing `appEl` — add to imports at top of router.js.

- [ ] **Step 7: Run syntax checks and smoke test**

```bash
node --check public/js/navigation.js && node --check public/js/router.js
bash scripts/smoke-test.sh
```

- [ ] **Step 8: Bump version and commit**

```bash
git add public/js/navigation.js public/js/router.js public/version.php
git commit -m "refactor: normalize router to use screen/mode/layout URL parameters"
```

---

### Task 4: Unify header in index.php

**Files:**
- Modify: `public/index.php:99-158` (replace two headers with one)

- [ ] **Step 1: Replace both headers with a single unified header**

In `public/index.php`, replace everything from line 99 (`<header class="app-header liste-only">`) through line 158 (`</header>` of the shopping-only header) with:

```php
    <header class="app-header" id="appHeader">
        <div class="app-title-group clickable-brand">
            <img src="<?= htmlspecialchars($brandMarkSrc, ENT_QUOTES, 'UTF-8') ?>" alt="" class="brand-mark brand-mark-app" aria-hidden="true">
            <div class="app-title-stack">
                <h1 class="app-title">Ankerkladde</h1>
                <div class="app-subtitle" id="categoryTitle"></div>
            </div>
            <button type="button" id="modeChip" class="mode-chip" aria-label="<?= t('ui.toggle_mode') ?>">
                <span class="mode-chip-label" id="modeChipLabel"></span>
            </button>
        </div>
        <div class="header-actions">
            <button type="button" id="conflictAlertBtn" class="header-icon-btn btn-conflict-alert" aria-label="<?= t('ui.show_conflicts') ?>" hidden><?= icon('alert-triangle') ?></button>
            <span class="progress view-only" id="progress" aria-live="polite">0 / 0</span>
            <div class="layout-switcher" id="layoutSwitcher" aria-label="<?= t('ui.desktop_view') ?>">
                <button type="button" class="header-icon-btn btn-layout" data-layout="list" aria-label="<?= t('ui.view_list') ?>"><?= icon('menu') ?></button>
                <button type="button" class="header-icon-btn btn-layout" data-layout="grid" aria-label="<?= t('ui.view_grid') ?>"><?= icon('layout-grid') ?></button>
                <button type="button" class="header-icon-btn btn-layout" data-layout="kanban" aria-label="<?= t('ui.view_kanban') ?>"><?= icon('layout-kanban') ?></button>
            </div>
            <button type="button" id="tabsToggleBtn" class="header-icon-btn btn-tabs-toggle" aria-label="<?= t('ui.toggle_tabs') ?>"><?= icon('panel-bottom') ?></button>
            <a href="<?= htmlspecialchars(appPath('barcode.php'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-product-scanner" aria-label="<?= t('ui.scan_product') ?>"<?= !$productScannerEnabled ? ' hidden' : '' ?>><?= icon('scan-info') ?></a>
            <button type="button" id="scanShoppingBtn" class="header-icon-btn btn-scan" aria-label="<?= t('ui.scan_barcode') ?>"<?= !$shoppingListScannerEnabled ? ' hidden' : '' ?>><?= icon('scan') ?></button>
            <button type="button" id="searchBtn" class="header-icon-btn btn-search" aria-label="<?= t('ui.search') ?>"><?= icon('search') ?></button>
            <button type="button" id="magicBtn" class="header-icon-btn btn-magic" aria-label="<?= t('ui.ai_assistant') ?>"<?= !$magicButtonEnabled ? ' hidden' : '' ?>><?= icon('sparkles') ?></button>
            <a href="<?= htmlspecialchars(appPath('index.php?view=settings'), ENT_QUOTES, 'UTF-8') ?>" class="header-icon-btn btn-settings" data-settings-tab="app" aria-label="<?= t('ui.settings') ?>"><?= icon('settings') ?></a>
        </div>
    </header>
```

- [ ] **Step 2: Remove `liste-only` class from search bar and input area**

Change line 123:
```html
<div class="search-bar" id="searchBar" hidden>
```

Change line 160:
```html
<section class="input-area edit-only" id="inputArea">
```

Change line 201:
```html
<button type="button" class="btn-clear edit-only"
```

- [ ] **Step 3: Remove duplicate element IDs**

The old shopping header had duplicate IDs (`conflictAlertBtn`). Since we now have only one header, this is automatically resolved.

- [ ] **Step 4: Run syntax check**

```bash
php -l public/index.php
```

- [ ] **Step 5: Bump version and commit**

```bash
git add public/index.php public/version.php
git commit -m "refactor: unify dual headers into single header with mode chip and layout switcher"
```

---

### Task 5: Implement mode chip and layout switcher JS logic

**Files:**
- Modify: `public/js/ui.js` (add new DOM references)
- Modify: `public/js/app-events.js` or `public/js/app-events-layout.js` (wire up new controls)
- Modify: `public/js/app-ui.js` (update header rendering based on category type)

- [ ] **Step 1: Add new DOM references in ui.js**

In `public/js/ui.js`, add:

```js
export const modeChip = document.getElementById('modeChip');
export const modeChipLabel = document.getElementById('modeChipLabel');
export const layoutSwitcher = document.getElementById('layoutSwitcher');
export const layoutBtns = document.querySelectorAll('.btn-layout');
export const categoryTitle = document.getElementById('categoryTitle');
```

Remove the old `desktopLayoutBtns` export if still present.

- [ ] **Step 2: Implement mode chip toggle**

In the events module (wherever mode toggle is handled, likely `app-events-layout.js`), add click handler for the mode chip:

```js
if (deps.modeChip) {
    deps.modeChip.addEventListener('click', () => {
        state.mode = state.mode === 'edit' ? 'view' : 'edit';
        if (appEl) appEl.dataset.mode = state.mode;
        saveLocalPrefs({ mode: state.mode });
        void savePreferences({ mode: state.mode });
        updateModeChip();
        deps.updateHeaders();
    });
}
```

- [ ] **Step 3: Implement updateModeChip function**

In `public/js/app-ui.js` or the appropriate UI module:

```js
export function updateModeChip() {
    const chip = document.getElementById('modeChip');
    const label = document.getElementById('modeChipLabel');
    if (!chip || !label) return;
    const isEdit = state.mode === 'edit';
    label.textContent = isEdit ? t('ui.mode_edit') : t('ui.mode_view');
    chip.classList.toggle('mode-chip--view', !isEdit);
}
```

- [ ] **Step 4: Implement layout switcher — filter by category type**

In the events module, replace the old desktop layout button logic:

```js
function updateLayoutSwitcher() {
    const available = getAvailableLayouts();
    layoutBtns.forEach(btn => {
        const layout = btn.dataset.layout;
        btn.hidden = !available.includes(layout);
        btn.setAttribute('aria-pressed', layout === state.layout ? 'true' : 'false');
    });
}

layoutBtns.forEach(button => {
    button.addEventListener('click', () => {
        const layout = button.dataset.layout;
        if (layout === state.layout) return;
        if (!isLayoutAvailable(layout)) return;
        state.layout = layout;
        if (appEl) appEl.dataset.layout = layout;
        saveLocalPrefs({ layout });
        updateLayoutSwitcher();
        deps.renderItems();
    });
});
```

- [ ] **Step 5: Call updateModeChip and updateLayoutSwitcher on category change**

In the function that handles category switching (likely in `app-runtime.js` or wherever `updateHeaders` is called), add calls to `updateModeChip()` and `updateLayoutSwitcher()` so they refresh when the user switches categories (since available layouts may differ).

- [ ] **Step 6: Remove old mode toggle and desktop layout switcher code**

Remove the old `btn-mode-toggle` event handlers and `desktopLayoutBtns` logic. Remove old `modeToggleBtns` DOM references from `ui.js`.

- [ ] **Step 7: Run smoke test**

```bash
bash scripts/smoke-test.sh
```

- [ ] **Step 8: Bump version and commit**

```bash
git add public/js/ui.js public/js/app-events.js public/js/app-events-layout.js public/js/app-ui.js public/js/app-runtime.js public/version.php
git commit -m "feat: implement mode chip toggle and category-aware layout switcher"
```

---

### Task 6: Add CSS for new header, mode chip, and layout switcher

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add mode chip styles**

Add to `public/style.css`:

```css
.mode-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 12px;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
}

.mode-chip--view {
    border-color: var(--color-success, #2d6a4f);
    background: color-mix(in srgb, var(--color-success, #2d6a4f) 20%, transparent);
    color: var(--color-success, #2d6a4f);
}
```

- [ ] **Step 2: Add layout switcher styles**

```css
.layout-switcher {
    display: inline-flex;
    gap: 2px;
}

.layout-switcher .btn-layout[aria-pressed="true"] {
    opacity: 1;
}

.layout-switcher .btn-layout[aria-pressed="false"] {
    opacity: 0.4;
}

.layout-switcher .btn-layout[hidden] {
    display: none;
}
```

- [ ] **Step 3: Replace old CSS mode selectors**

Replace all `[data-mode="einkaufen"]` selectors with `[data-mode="view"]` and all `[data-mode="liste"]` with `[data-mode="edit"]` if not already done in Task 2.

Replace:
```css
[data-mode="einkaufen"] .liste-only { display: none; }
[data-mode="liste"]     .shopping-only { display: none; }
```

with:
```css
[data-mode="view"] .edit-only { display: none; }
[data-mode="edit"] .view-only { display: none; }
```

- [ ] **Step 4: Replace data-desktop-layout selectors**

Find all `[data-desktop-layout=` selectors and replace with `[data-layout=`. Change value `"liste"` to `"list"` in these selectors.

- [ ] **Step 5: Run smoke test**

```bash
bash scripts/smoke-test.sh
```

- [ ] **Step 6: Bump version and commit**

```bash
git add public/style.css public/version.php
git commit -m "style: add mode chip and layout switcher CSS, migrate selectors to edit/view"
```

---

### Task 7: Add i18n strings for new UI labels

**Files:**
- Modify: `lang/de.json`
- Modify: `lang/en.json`

- [ ] **Step 1: Add German translation strings**

In `lang/de.json`, add:

```json
"ui.toggle_mode": "Modus wechseln",
"ui.mode_edit": "Bearb.",
"ui.mode_view": "Ansehen"
```

- [ ] **Step 2: Add English translation strings**

In `lang/en.json`, add:

```json
"ui.toggle_mode": "Toggle mode",
"ui.mode_edit": "Edit",
"ui.mode_view": "View"
```

- [ ] **Step 3: Commit**

```bash
git add lang/de.json lang/en.json
git commit -m "i18n: add mode chip translation strings"
```

---

### Task 8: Update PWA shortcuts to use new URL parameters

**Files:**
- Modify: `public/manifest.php` (shortcut URLs)

- [ ] **Step 1: Update shortcut URLs**

In `public/manifest.php`, find the `shortcuts` array and update URLs:

- `?view=scanner` → `?screen=scanner`
- `?view=search` → `?screen=search`
- `?view=settings` → `?screen=settings`

- [ ] **Step 2: Bump version and commit**

```bash
git add public/manifest.php public/version.php
git commit -m "feat: update PWA shortcuts to use new screen URL parameter"
```

---

### Task 9: Update Service Worker cache version

**Files:**
- Modify: `public/sw.js` (cache version)

- [ ] **Step 1: Bump SW cache version**

In `public/sw.js`, increment the cache version string to force a cache refresh for all clients.

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "chore: bump service worker cache version for UI overhaul"
```

---

### Task 10: Final cleanup and integration test

**Files:**
- Modify: various (remove any remaining old references)

- [ ] **Step 1: Search for and remove remaining old references**

```bash
grep -rn 'liste-only\|shopping-only\|desktopLayout\|desktop_layout\|data-mode="einkaufen"\|data-mode="liste"\|data-desktop-layout' public/
```

Remove or update any remaining occurrences.

- [ ] **Step 2: Search for remaining old state.view references**

```bash
grep -rn 'state\.view\b' public/js/
```

Replace any remaining `state.view` with `state.screen`.

- [ ] **Step 3: Run full test suite**

```bash
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
php scripts/test-security.php
```

- [ ] **Step 4: Manual test checklist**

Test in the browser:
- [ ] Mode chip toggles between Bearbeiten/Ansehen
- [ ] Layout icons filter correctly per category type
- [ ] Switching categories updates available layouts
- [ ] Search opens from any mode/layout
- [ ] Scanner opens from any mode/layout
- [ ] Settings opens from any mode/layout
- [ ] Back navigation works correctly
- [ ] Old URLs (`?view=search`) still work
- [ ] New URLs (`?screen=search&mode=view&layout=grid`) work
- [ ] PWA shortcuts work
- [ ] Input area hides in view mode
- [ ] Edit/delete buttons hide in view mode
- [ ] Progress counter shows in view mode

- [ ] **Step 5: Bump final version and commit**

```bash
git add -A
git commit -m "refactor: complete UI overhaul — unified header, three-axis state model"
```
