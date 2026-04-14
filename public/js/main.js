import { appUrl, api, apiUpload, normalizeItem } from './api.js';
import { createNavigation } from './navigation.js';
import { applyViewState, createRouter } from './router.js';
import { persistPreferences } from './shared.js';
import {
    BARCODE_FORMATS,
    CATEGORY_SWIPE_THRESHOLD_PX,
    NOTE_SAVE_DEBOUNCE_MS,
    SCANNER_COOLDOWN_MS,
    TAB_REORDER_LONG_PRESS_MS,
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
    cameraBtn,
    cameraInput,
    clearDoneBtn,
    diskFreeEl,
    dropZoneEl,
    fileInput,
    fileInputGroup,
    filePickerButton,
    filePickerName,
    inputHintEl,
    itemForm,
    itemInput,
    linkDescriptionInput,
    listAreaEl,
    listEl,
    listSwipePreviewEl,
    listSwipePreviewHeaderEl,
    listSwipePreviewListEl,
    listSwipeStageEl,
    messageEl,
    modeToggleBtns,
    mehrMenuEl,
    networkStatusEl,
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
    scannerStatus,
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
    uploadProgressBarEl,
    uploadProgressEl,
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
let messageTimer = null;
let noteSaveTimer = null;
let tiptapEditor = null;
let tabDragJustFinished = false;
let swipeState = null;
let swipeTransitionActive = false;
let navigation = null;
let router = null;

function setUserPreferences(nextPreferences) {
    userPreferences = nextPreferences;
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

function setSwipeStagePosition(offsetPx, opacity = 1) {
    if (!listSwipeStageEl) return;
    listSwipeStageEl.style.transform = `translateX(${Math.round(offsetPx)}px)`;
    listSwipeStageEl.style.opacity = String(opacity);
}

function setSwipePreviewPosition(offsetPx, opacity = 0) {
    void offsetPx;
    void opacity;
}

function clearSwipeStageTransition() {
    if (!listSwipeStageEl) return;
    listSwipeStageEl.classList.remove('is-swipe-animating');
}

function enableSwipeStageTransition() {
    if (!listSwipeStageEl) return;
    listSwipeStageEl.classList.add('is-swipe-animating');
}

function animateSwipeStageTo(offsetPx, opacity = 1) {
    if (!listSwipeStageEl) return Promise.resolve();

    enableSwipeStageTransition();

    return new Promise(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            listSwipeStageEl.removeEventListener('transitionend', onEnd);
            resolve();
        };
        const onEnd = event => {
            if (event.target === listSwipeStageEl) {
                finish();
            }
        };

        listSwipeStageEl.addEventListener('transitionend', onEnd);
        setSwipeStagePosition(offsetPx, opacity);
        window.setTimeout(finish, 260);
    });
}

function resetSwipeStage() {
    clearSwipeStageTransition();
    setSwipeStagePosition(0, 1);
    hideSwipePreview();
    listAreaEl?.classList.remove('is-swipe-gesture');
}

function hideSwipePreview() {
    if (!listSwipePreviewEl || !listSwipePreviewHeaderEl || !listSwipePreviewListEl) return;
    listSwipePreviewEl.hidden = true;
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

function getItemById(id) {
    return state.items.find(item => item.id === Number(id)) || null;
}

function getVisibleCategories() {
    return state.categories.filter(category => Number(category.is_hidden) === 0);
}

function cloneItems(items) {
    return items.map(item => ({ ...item }));
}

function cacheCurrentCategoryItems() {
    if (!Number.isInteger(Number(state.categoryId))) return;
    state.itemsByCategoryId.set(Number(state.categoryId), {
        items: cloneItems(state.items),
        diskFreeBytes: state.diskFreeBytes,
    });
}

function invalidateCategoryCache(categoryId) {
    state.itemsByCategoryId.delete(Number(categoryId));
}

function cacheCategoryPayload(categoryId, payload) {
    const normalizedItems = Array.isArray(payload.items) ? payload.items.map(normalizeItem) : [];
    const diskFreeBytes = typeof payload.disk_free_bytes === 'number' ? payload.disk_free_bytes : null;
    state.itemsByCategoryId.set(Number(categoryId), {
        items: cloneItems(normalizedItems),
        diskFreeBytes,
    });
    return { items: normalizedItems, diskFreeBytes };
}

function applyCategoryPayload(categoryId, payload) {
    const normalized = cacheCategoryPayload(categoryId, payload);
    state.items = normalized.items;
    state.diskFreeBytes = normalized.diskFreeBytes;
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
        applyThemePreferences(userPreferences);
    }

    const visibleCategories = getVisibleCategories();
    const preferredCategoryId = Number(userPreferences.last_category_id);
    const preferredVisible = visibleCategories.find(category => category.id === preferredCategoryId);

    state.categoryId = preferredVisible?.id || visibleCategories[0]?.id || state.categories[0]?.id || null;
    renderCategoryTabs();
    applyTabsVisibility(userPreferences.tabs_hidden);
}

async function savePreferences(patch) {
    await persistPreferences(patch, setUserPreferences, applyThemePreferences);
}

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
        if (tabDragJustFinished) return;
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
                if (tabDragJustFinished) return;
                void setCategory(category.id);
            });
            if (mehrMenuEl) mehrMenuEl.appendChild(item);
        });
    }

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
        let isScrolling = false;

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
            document.removeEventListener('pointercancel', onAbort);
        }

        function onMove(moveEvent) {
            if (!dragActive) {
                if (isScrolling) {
                    sectionTabsEl.scrollLeft -= moveEvent.movementX;
                    return;
                }
                const dx = Math.abs(moveEvent.clientX - startX);
                const dy = Math.abs(moveEvent.clientY - startY);
                if (dx > 5 || dy > 5) {
                    window.clearTimeout(longPressTimer);
                    if (dx > dy) {
                        isScrolling = true;
                        sectionTabsEl.scrollLeft -= moveEvent.movementX;
                    } else {
                        cleanup();
                    }
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

        function onAbort() {
            cleanup();
            if (!dragActive) return;
            tab.classList.remove('is-tab-dragging');
            sectionTabsEl.classList.remove('is-tab-reordering');
            Array.from(sectionTabsEl.querySelectorAll('.section-tab')).forEach(other => {
                other.classList.remove('tab-drop-before', 'tab-drop-after');
            });
            delete tab._tabInsertBefore;
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onAbort);
    });
}

function initItemDragReorder() {
    if (!listEl) return;

    listEl.addEventListener('pointerdown', event => {
        if (state.mode !== 'liste' || state.search.open) return;
        if (event.button !== undefined && event.button !== 0) return;
        const dragHandle = event.target.closest('.item-drag-handle');
        if (!dragHandle) return;

        const li = event.target.closest('li.item-card');
        if (!li || li.classList.contains('is-editing')) return;

        let insertBefore = null;
        let dragging = false;
        const startX = event.clientX;
        const startY = event.clientY;

        function startDragging(moveEvent = null) {
            if (dragging) return;
            dragging = true;
            if (moveEvent) {
                moveEvent.preventDefault();
            }
            try {
                li.setPointerCapture(event.pointerId);
            } catch {}
            triggerHapticFeedback();
            document.body.classList.add('is-sorting');
            li.classList.add('is-dragging');
        }

        function getOtherItems() {
            return Array.from(listEl.querySelectorAll('li.item-card:not(.is-dragging)'));
        }

        function clearDropTargets() {
            listEl.querySelectorAll('li.item-card').forEach(other => {
                other.classList.remove('is-drop-target-before', 'is-drop-target-after');
            });
        }

        function cleanup() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
            document.removeEventListener('pointercancel', onAbort);
        }

        function onMove(moveEvent) {
            if (!dragging) {
                const deltaX = Math.abs(moveEvent.clientX - startX);
                const deltaY = Math.abs(moveEvent.clientY - startY);
                const movement = Math.max(deltaX, deltaY);

                if (movement < 4) return;
                startDragging(moveEvent);
            }

            const others = getOtherItems();
            clearDropTargets();

            insertBefore = null;
            for (const other of others) {
                const rect = other.getBoundingClientRect();
                if (moveEvent.clientY < rect.top + rect.height / 2) {
                    insertBefore = other;
                    other.classList.add('is-drop-target-before');
                    break;
                }
            }

            if (!insertBefore && others.length > 0) {
                others[others.length - 1].classList.add('is-drop-target-after');
            }
        }

        function onEnd() {
            cleanup();
            if (!dragging) return;
            document.body.classList.remove('is-sorting');
            li.classList.remove('is-dragging');
            clearDropTargets();

            if (insertBefore) {
                listEl.insertBefore(li, insertBefore);
            } else {
                listEl.appendChild(li);
            }

            void persistItemOrder();
        }

        function onAbort() {
            cleanup();
            if (!dragging) return;
            document.body.classList.remove('is-sorting');
            li.classList.remove('is-dragging');
            clearDropTargets();
        }

        event.preventDefault();
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onAbort);
    });
}

async function persistItemOrder() {
    const orderedIds = Array.from(listEl.querySelectorAll('li.item-card'))
        .map(li => Number(li.dataset.itemId))
        .filter(id => Number.isInteger(id) && id > 0);

    orderedIds.forEach((id, index) => {
        const item = getItemById(id);
        if (item) item.sort_order = index + 1;
    });
    cacheCurrentCategoryItems();

    const body = new URLSearchParams({ category_id: String(state.categoryId) });
    orderedIds.forEach(id => body.append('ids[]', String(id)));

    try {
        await api('reorder', { method: 'POST', body });
    } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Reihenfolge konnte nicht gespeichert werden.', true);
        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }
}

function updateHeaders() {
    if (state.view === 'settings') {
        const titleListe = document.getElementById('titleListe');
        const titleShopping = document.getElementById('titleShopping');
        if (titleListe) titleListe.textContent = 'Einstellungen';
        if (titleShopping) titleShopping.textContent = 'Einstellungen';
        document.title = 'Ankerkladde - Einstellungen';
        return;
    }

    const category = getCurrentCategory();
    if (!category) return;

    const config = getTypeConfig(category.type);
    const titleListe = document.getElementById('titleListe');
    const titleShopping = document.getElementById('titleShopping');
    if (titleListe) titleListe.textContent = config.title(category.name);
    if (titleShopping) titleShopping.textContent = config.shoppingTitle(category.name);
    document.title = `Ankerkladde - ${category.name}`;

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
    const barcodeCategory = type === 'list_quantity';
    const linkCategory = type === 'links';

    if (fileInputGroup) fileInputGroup.hidden = !uploadCategory;
    if (linkDescriptionInput) {
        linkDescriptionInput.hidden = !linkCategory;
        if (!linkCategory && linkDescriptionInput.value !== '') {
            linkDescriptionInput.value = '';
        }
        syncAutoHeight(linkDescriptionInput);
    }
    if (inputHintEl) {
        inputHintEl.hidden = true;
        inputHintEl.textContent = '';
    }

    const submitBtn = itemForm?.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.hidden = uploadCategory;
    if (scanAddBtn) scanAddBtn.hidden = !barcodeCategory || uploadCategory;
    if (scanShoppingBtn) scanShoppingBtn.hidden = !barcodeCategory;

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

function setScannerStatus(text, isError = false) {
    if (!scannerStatus) return;
    scannerStatus.textContent = text;
    scannerStatus.classList.toggle('is-error', Boolean(isError));
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

function getScannerActionLabel() {
    return scannerState.action === 'toggle' ? 'Eintrag abhaken' : 'Artikel hinzufügen';
}

function updateScannerSubtitle() {
    if (!scannerSubtitle) return;
    scannerSubtitle.textContent = scannerState.action === 'toggle'
        ? 'Barcode scannt offene Einträge der aktuellen Liste und hakt sie ab.'
        : 'Barcode scannt Produkte und legt sie direkt in der aktuellen Liste an.';
}

function stopScannerLoop() {
    if (scannerState.rafId) {
        window.cancelAnimationFrame(scannerState.rafId);
        scannerState.rafId = 0;
    }
}

function stopScannerWatchdog() {
    if (scannerState.watchdogId) {
        window.clearTimeout(scannerState.watchdogId);
        scannerState.watchdogId = 0;
    }
}

function stopScannerStream() {
    stopScannerWatchdog();

    const controls = scannerState.controls;
    scannerState.controls = null;
    if (controls && typeof controls.stop === 'function') {
        controls.stop();
    }

    const stream = scannerState.stream;
    scannerState.stream = null;

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    if (scannerVideo) {
        scannerVideo.pause();
        scannerVideo.srcObject = null;
    }
}

function closeScanner() {
    stopScannerLoop();
    stopScannerStream();
    scannerState.detector = null;
    scannerState.mode = 'native';
    scannerState.processing = false;
    scannerState.open = false;
    if (scannerOverlay) scannerOverlay.hidden = true;
}

async function createBarcodeDetector() {
    if (typeof window.BarcodeDetector === 'function') {
        let formats = BARCODE_FORMATS;
        if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
            try {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                const filtered = BARCODE_FORMATS.filter(format => supported.includes(format));
                if (filtered.length > 0) {
                    formats = filtered;
                }
            } catch {}
        }

        try {
            return { mode: 'native', detector: new window.BarcodeDetector({ formats }) };
        } catch {}
    }

    if (window.ZXingBrowser?.BrowserMultiFormatReader) {
        const hints = new Map();
        const zxing = window.ZXing || {};
        const barcodeFormat = zxing.BarcodeFormat || {};
        const decodeHintType = zxing.DecodeHintType || {};
        const formats = [
            barcodeFormat.EAN_13,
            barcodeFormat.EAN_8,
            barcodeFormat.UPC_A,
            barcodeFormat.UPC_E,
        ].filter(Boolean);

        if (decodeHintType.POSSIBLE_FORMATS && formats.length > 0) {
            hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
        }
        if (decodeHintType.TRY_HARDER) {
            hints.set(decodeHintType.TRY_HARDER, true);
        }

        return { mode: 'zxing', detector: new window.ZXingBrowser.BrowserMultiFormatReader(hints) };
    }

    return null;
}

function waitForVideoReady(video, timeoutMs = 5000) {
    if (!video) {
        return Promise.reject(new Error('Videovorschau fehlt.'));
    }

    if (video.readyState >= 2 && video.videoWidth > 0) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error('Kamerabild wurde nicht rechtzeitig bereit.'));
        }, timeoutMs);

        const onReady = () => {
            if (video.readyState < 2 || video.videoWidth === 0) {
                return;
            }
            cleanup();
            resolve();
        };

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            video.removeEventListener('loadedmetadata', onReady);
            video.removeEventListener('canplay', onReady);
            video.removeEventListener('playing', onReady);
        };

        video.addEventListener('loadedmetadata', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('playing', onReady);
    });
}

function scheduleScannerWatchdog() {
    stopScannerWatchdog();

    scannerState.watchdogId = window.setTimeout(() => {
        if (!scannerState.open || scannerState.processing) {
            return;
        }

        if (scannerState.mode === 'zxing' && isIosWebKit()) {
            setScannerStatus('Kamera aktiv. Auf iPad/iPhone erkennt WebKit Barcodes nicht immer zuverlässig. Falls nichts passiert, Barcode unten manuell eingeben.', true);
            return;
        }

        setScannerStatus('Kamera aktiv. Falls kein Scan erkannt wird, Barcode unten manuell eingeben.', true);
    }, 7000);
}

async function lookupProductByBarcode(barcode) {
    try {
        const payload = await api(`product_lookup&barcode=${encodeURIComponent(barcode)}`);
        return payload?.product || null;
    } catch {
        return null;
    }
}

async function addItemFromBarcode(barcode) {
    const category = getCurrentCategory();
    if (!isBarcodeCategory(category)) {
        throw new Error('Barcode-Scan ist nur in Einkaufslisten verfügbar.');
    }

    const product = await lookupProductByBarcode(barcode);
    const productName = typeof product?.product_name === 'string' ? product.product_name.trim() : '';
    const brandName = typeof product?.brands === 'string' ? product.brands.trim() : '';
    const name = productName !== ''
        ? (brandName !== '' ? `${productName} (${brandName})` : productName)
        : (brandName !== '' ? brandName : `Artikel ${barcode}`);
    const body = new URLSearchParams({
        category_id: String(category.id),
        name,
        barcode,
    });

    const quantity = quantityInput?.value.trim() || product?.quantity?.trim() || '';
    if (quantity !== '') {
        body.set('quantity', quantity);
    }

    await api('add', { method: 'POST', body });
    itemForm?.reset();
    syncAutoHeight(itemInput);
    updateFilePickerLabel();
    invalidateCategoryCache(category.id);
    await loadItems();
    setMessage(`${name} hinzugefügt.`);
}

async function toggleItemFromBarcode(barcode) {
    const category = getCurrentCategory();
    if (!isBarcodeCategory(category)) {
        throw new Error('Barcode-Scan ist nur in Einkaufslisten verfügbar.');
    }

    const openItem = state.items.find(item => item.barcode === barcode && item.done !== 1) || null;
    if (openItem) {
        await handleToggle(openItem.id, 1);
        setMessage(`${openItem.name} abgehakt.`);
        return;
    }

    const doneItem = state.items.find(item => item.barcode === barcode) || null;
    if (doneItem) {
        throw new Error(`${doneItem.name} ist bereits abgehakt.`);
    }

    throw new Error('Kein offener Eintrag mit diesem Barcode in der aktuellen Liste gefunden.');
}

async function handleScannedBarcode(rawValue) {
    const barcode = normalizeBarcodeValue(rawValue);
    if (barcode.length < 8) return;

    const now = Date.now();
    if (barcode === scannerState.lastValue && now - scannerState.lastHandledAt < SCANNER_COOLDOWN_MS) {
        return;
    }

    scannerState.lastValue = barcode;
    scannerState.lastHandledAt = now;
    scannerState.processing = true;
    stopScannerWatchdog();
    setScannerStatus(`${getScannerActionLabel()}: ${barcode}`);

    try {
        if (scannerState.action === 'toggle') {
            await toggleItemFromBarcode(barcode);
        } else {
            await addItemFromBarcode(barcode);
        }
        triggerHapticFeedback();
        setScannerStatus(`Erfolgreich: ${barcode}`);
        window.setTimeout(() => {
            if (scannerState.open) {
                navigation.navigateBackOrReplace({ screen: 'list' });
            }
        }, 180);
    } catch (error) {
        setScannerStatus(error instanceof Error ? error.message : 'Barcode konnte nicht verarbeitet werden.', true);
    } finally {
        window.setTimeout(() => {
            scannerState.processing = false;
            if (scannerState.open) {
                scheduleScannerWatchdog();
            }
        }, 350);
    }
}

function scheduleScannerLoop() {
    stopScannerLoop();

    const scanFrame = async () => {
        if (!scannerState.open) return;
        scannerState.rafId = window.requestAnimationFrame(scanFrame);

        if (scannerState.processing || !scannerState.detector || !scannerVideo || scannerVideo.readyState < 2) {
            return;
        }

        try {
            const barcodes = await scannerState.detector.detect(scannerVideo);
            const rawValue = barcodes?.[0]?.rawValue || '';
            if (rawValue) {
                await handleScannedBarcode(rawValue);
            }
        } catch {}
    };

    scannerState.rafId = window.requestAnimationFrame(scanFrame);
}

async function openScanner(action = state.mode === 'einkaufen' ? 'toggle' : 'add') {
    if (scannerState.open) {
        return;
    }
    const category = getCurrentCategory();
    if (!isBarcodeCategory(category)) {
        setMessage('Barcode-Scan ist nur in Einkaufslisten verfügbar.', true);
        return;
    }
    if (state.noteEditorId !== null || state.search.open) {
        setMessage('Scanner ist während Suche oder Notizbearbeitung nicht verfügbar.', true);
        return;
    }

    scannerState.action = action;
    scannerState.processing = false;
    scannerState.lastValue = '';
    scannerState.lastHandledAt = 0;
    scannerState.controls = null;
    scannerState.open = true;
    updateScannerSubtitle();
    setScannerStatus('Kamera wird vorbereitet…');
    if (scannerOverlay) scannerOverlay.hidden = false;
    if (scannerManualInput) scannerManualInput.value = '';

    if (!isScannerSupported()) {
        setScannerStatus('Kamera-Scan braucht HTTPS oder localhost. Manueller Barcode-Eintrag bleibt verfügbar.', true);
        scannerManualInput?.focus();
        return;
    }

    try {
        const engine = await createBarcodeDetector();
        if (!engine) {
            setScannerStatus('Automatischer Barcode-Scan wird in diesem Browser nicht unterstützt. Manueller Barcode-Eintrag ist aktiv.', true);
            scannerManualInput?.focus();
            return;
        }

        scannerState.mode = engine.mode;
        scannerState.detector = engine.detector;

        const modeLabel = engine.mode === 'zxing' ? 'ZXing' : 'nativ';
        setScannerStatus(`Starte ${modeLabel}-Scanner...`);

        if (engine.mode === 'zxing') {
            setScannerStatus('ZXing: Starte Kamera...');
            try {
                scannerState.controls = await scannerState.detector.decodeFromVideoDevice(
                    undefined,
                    scannerVideo,
                    (result, error) => {
                        if (error) return;
                        const rawValue = typeof result?.getText === 'function' ? result.getText() : '';
                        if (rawValue) {
                            void handleScannedBarcode(rawValue);
                        }
                    }
                );
                await waitForVideoReady(scannerVideo);
                setScannerStatus(isIosWebKit()
                    ? 'Kamera aktiv (ZXing). Auf dem iPad/iPhone bitte ruhig halten; alternativ Barcode unten manuell eingeben.'
                    : 'Kamera aktiv (ZXing). Barcode in den Rahmen halten.');
                scheduleScannerWatchdog();
            } catch (err) {
                setScannerStatus('ZXing-Fehler: ' + err.message, true);
            }
            return;
        }

        scannerState.stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
            },
        });

        if (scannerVideo) {
            scannerVideo.srcObject = scannerState.stream;
            await scannerVideo.play();
            await waitForVideoReady(scannerVideo);
        }

        setScannerStatus('Kamera aktiv (nativ). Barcode in den Rahmen halten.');
        scheduleScannerWatchdog();
        scheduleScannerLoop();
    } catch (error) {
        stopScannerStream();
        setScannerStatus(error instanceof Error ? error.message : 'Kamera konnte nicht gestartet werden.', true);
        scannerManualInput?.focus();
    }
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
    if (scannerState.open) {
        closeScanner();
    }
    if (state.noteEditorId !== null) {
        await closeNoteEditor();
    }
    router.closeSettings();

    state.categoryId = Number(categoryId);
    renderCategoryTabs();
    updateHeaders();
    const loadPromise = loadItems();
    void savePreferences({ last_category_id: state.categoryId }).catch(() => {});
    await loadPromise;
    prefetchAdjacentCategories();
}

async function loadItems(categoryId = state.categoryId, options = {}) {
    const resolvedCategoryId = Number(categoryId);
    const useCache = options.useCache !== false;
    const category = state.categories.find(entry => entry.id === resolvedCategoryId) || null;
    if (!category) {
        state.items = [];
        state.diskFreeBytes = null;
        renderItems();
        return;
    }

    if (useCache) {
        const cached = state.itemsByCategoryId.get(resolvedCategoryId);
        if (cached) {
            state.items = cloneItems(cached.items);
            state.diskFreeBytes = cached.diskFreeBytes ?? null;
            renderItems();
            updateUploadUi();
            return;
        }
    }

    const payload = await api(`list&category_id=${encodeURIComponent(category.id)}`);

    if (resolvedCategoryId !== Number(state.categoryId)) {
        cacheCategoryPayload(resolvedCategoryId, payload);
        return;
    }

    applyCategoryPayload(resolvedCategoryId, payload);
    renderItems();
    updateUploadUi();
}

function prefetchAdjacentCategories() {
    const visibleCategories = getVisibleCategories();
    const currentIndex = visibleCategories.findIndex(category => category.id === state.categoryId);
    if (currentIndex === -1) return;

    [currentIndex - 1, currentIndex + 1]
        .map(index => visibleCategories[index]?.id ?? null)
        .filter(categoryId => categoryId !== null && !state.itemsByCategoryId.has(Number(categoryId)))
        .forEach(categoryId => {
            void loadItems(categoryId, { useCache: false }).catch(() => {});
        });
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
    if (state.search.open) {
        navigation.replaceCurrentHistoryState({ screen: 'search', query: state.search.query });
    }

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

function applyTabsVisibility(hidden) {
    if (!sectionTabsEl) return;
    sectionTabsEl.classList.toggle('tabs-hidden', Boolean(hidden));
    tabsToggleBtns.forEach(btn => btn.classList.toggle('is-active', Boolean(hidden)));
}

function canStartCategorySwipe(target) {
    if (!(target instanceof Element)) return false;
    if (state.noteEditorId !== null || state.search.open) return false;
    if (!userPreferences.category_swipe_enabled) return false;
    if (swipeTransitionActive) return false;
    if (target.closest('input, select, textarea, [contenteditable="true"], .note-editor, .section-tabs, .search-bar, .input-area')) {
        return false;
    }
    if (target.closest('.item-card')) {
        return true;
    }
    return !target.closest('button, a');
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
            currentX: touch.clientX,
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

        if (swipeState.lockedAxis !== 'x') return;

        swipeState.currentX = touch.clientX;
        const direction = deltaX < 0 ? 1 : -1;
        const hasTarget = getSwipeTargetCategoryId(direction) !== null;
        const clampedDeltaX = hasTarget ? deltaX : deltaX * 0.18;

        event.preventDefault();
        listAreaEl.classList.add('is-swipe-gesture');
        clearSwipeStageTransition();
        setSwipeStagePosition(clampedDeltaX, 1);
    }, { passive: false });

    listAreaEl.addEventListener('touchend', event => {
        if (!swipeState) return;

        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - swipeState.startX;
        const deltaY = touch.clientY - swipeState.startY;
        const lockedAxis = swipeState.lockedAxis;
        swipeState = null;

        if (lockedAxis !== 'x') return;
        if (Math.abs(deltaY) > Math.abs(deltaX) * 0.6) {
            void animateSwipeStageTo(0, 1).then(() => resetSwipeStage());
            return;
        }

        const direction = deltaX < 0 ? 1 : -1;
        const targetCategoryId = getSwipeTargetCategoryId(direction);
        if (targetCategoryId === null || Math.abs(deltaX) < CATEGORY_SWIPE_THRESHOLD_PX) {
            void animateSwipeStageTo(0, 1).then(() => resetSwipeStage());
            return;
        }

        const width = listAreaEl?.clientWidth || window.innerWidth || 320;
        const exitOffset = deltaX < 0 ? -width : width;
        swipeTransitionActive = true;
        void (async () => {
            try {
                enableSwipeStageTransition();
                setSwipeStagePosition(exitOffset, 1);
                await new Promise(resolve => window.setTimeout(resolve, 220));
                await setCategory(targetCategoryId);
                clearSwipeStageTransition();
                setSwipeStagePosition(0, 1);
            } finally {
                swipeTransitionActive = false;
                resetSwipeStage();
            }
        })();
    }, { passive: true });

    listAreaEl.addEventListener('touchcancel', () => {
        swipeState = null;
        if (!swipeTransitionActive) {
            void animateSwipeStageTo(0, 1).then(() => resetSwipeStage());
        }
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
    cacheCurrentCategoryItems();
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

async function openNoteEditorWithNavigation(item) {
    await openNoteEditor(item);
    if (state.noteEditorId !== null) {
        navigation.pushHistoryState({
            screen: 'note',
            noteId: state.noteEditorId,
            categoryId: state.categoryId,
        });
    }
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
        void cycleThemeMode(userPreferences, setUserPreferences, setMessage);
    });
});

settingsBtns.forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        const targetTab = button.dataset.settingsTab || 'app';
        if (state.view === 'settings' && state.settingsTab === targetTab) {
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
        state.settingsTab = frameUrl.searchParams.get('tab') === 'extension' ? 'extension' : 'app';
        if (state.view === 'settings') {
            navigation.replaceCurrentHistoryState({ screen: 'settings', tab: state.settingsTab });
            void loadCategories()
                .then(() => updateHeaders())
                .catch(() => {});
        }
    } catch {
        // same-origin expected; ignore if unavailable
    }
});

window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'ankerkladde-settings-close') {
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
        searchInput?.focus();
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
        initCategoryTabReorder();
        initItemDragReorder();
        initCategorySwipe();
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
            const reg = await navigator.serviceWorker.register(appBasePath + 'sw.js?v=2.0.10');
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
