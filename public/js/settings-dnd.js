import { t } from './i18n.js';
import { renderFlash } from './settings-ui.js';

export function initCategoryDragReorder(root = document) {
    const categoryList = root.querySelector('[data-category-list]');
    if (!categoryList) return;

    let dragEl = null;
    let pointerStartY = 0;
    let dragMoved = false;
    let activeHandle = null;
    let activePointerId = null;
    let orderBeforeDrag = [];

    function getCategoryOrder() {
        return Array.from(categoryList.querySelectorAll('.settings-category-row'))
            .map(row => parseInt(row.dataset.categoryId || '', 10))
            .filter(id => id > 0);
    }

    function restoreCategoryOrder(order) {
        const rowsById = new Map(
            Array.from(categoryList.querySelectorAll('.settings-category-row'))
                .map(row => [Number(row.dataset.categoryId), row])
        );
        order.forEach(id => {
            const row = rowsById.get(Number(id));
            if (row) categoryList.appendChild(row);
        });
        updateMoveButtons();
    }

    function updateMoveButtons() {
        const rows = Array.from(categoryList.querySelectorAll('.settings-category-row'));
        rows.forEach((row, index) => {
            const moveUp = row.querySelector('[data-category-move="up"]');
            const moveDown = row.querySelector('[data-category-move="down"]');
            if (moveUp instanceof HTMLButtonElement) moveUp.disabled = index === 0;
            if (moveDown instanceof HTMLButtonElement) moveDown.disabled = index === rows.length - 1;
        });
    }

    function moveDraggedCategory(y) {
        if (!dragEl) return;

        const rows = Array.from(categoryList.querySelectorAll('.settings-category-row:not(.settings-category-dragging)'));
        let insertBefore = null;

        for (const item of rows) {
            const rect = item.getBoundingClientRect();
            if (y < rect.top + rect.height / 2) {
                insertBefore = item;
                break;
            }
        }

        if (insertBefore) {
            categoryList.insertBefore(dragEl, insertBefore);
        } else {
            categoryList.appendChild(dragEl);
        }
    }

    function cleanupDragListeners() {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
    }

    async function persistCategoryOrder(previousOrder) {
        const order = getCategoryOrder();
        if (!order.length) return;

        const csrfToken = (categoryList.querySelector('input[name="csrf_token"]') || root.querySelector('input[name="csrf_token"]'))?.value || '';
        const actionUrl = categoryList.querySelector('form')?.getAttribute('action') || 'settings.php';
        try {
            const response = await fetch(actionUrl, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                body: new URLSearchParams({ action: 'reorder_categories', csrf_token: csrfToken, order: JSON.stringify(order) }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || payload.ok === false) {
                throw new Error(payload?.flash || t('settings.flash.order_save_failed'));
            }
            updateMoveButtons();
            renderFlash(payload.flash || t('settings.flash.order_saved'), payload.flash_type || 'ok', root);
            window.dispatchEvent(new CustomEvent('ankerkladde-settings-content-changed'));
        } catch (error) {
            restoreCategoryOrder(previousOrder);
            renderFlash(error instanceof Error ? error.message : t('settings.flash.order_save_failed'), 'err', root);
        }
    }

    function resetDragState(pointerId = activePointerId) {
        if (dragEl) {
            dragEl.classList.remove('settings-category-dragging');
        }
        try {
            if (pointerId !== null) activeHandle?.releasePointerCapture?.(pointerId);
        } catch (_) {}
        dragEl = null;
        activeHandle = null;
        activePointerId = null;
        dragMoved = false;
        orderBeforeDrag = [];
    }

    function onPointerMove(e) {
        if (!dragEl || e.pointerId !== activePointerId) return;

        e.preventDefault();
        const y = e.clientY;
        const dy = Math.abs(y - pointerStartY);
        if (dy > 4) dragMoved = true;

        if (!dragMoved) return;

        moveDraggedCategory(y);
    }

    function onPointerUp(e) {
        if (!dragEl || e.pointerId !== activePointerId) return;
        e.preventDefault();
        cleanupDragListeners();
        const wasDragged = dragMoved;
        const previousOrder = orderBeforeDrag.slice();
        resetDragState(e.pointerId);

        if (wasDragged) {
            void persistCategoryOrder(previousOrder);
        }
    }

    function onPointerCancel(e) {
        if (!dragEl || e.pointerId !== activePointerId) return;
        cleanupDragListeners();
        resetDragState(e.pointerId);
    }

    categoryList.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.settings-drag-handle');
        if (!handle) return;
        const row = handle.closest('.settings-category-row');
        if (!row) return;

        e.preventDefault();
        e.stopPropagation();
        dragEl = row;
        activeHandle = handle;
        dragMoved = false;
        orderBeforeDrag = getCategoryOrder();
        activePointerId = e.pointerId;
        pointerStartY = e.clientY;
        dragEl.classList.add('settings-category-dragging');
        handle.setPointerCapture(e.pointerId);

        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerCancel);
    });

    categoryList.addEventListener('click', (e) => {
        if (e.target.closest('.settings-drag-handle')) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
}
