export function initCategoryDragReorder() {
    const categoryList = document.querySelector('[data-category-list]');
    if (!categoryList) return;

    let dragEl = null;
    let pointerStartY = 0;
    let dragMoved = false;
    let activeHandle = null;
    let activePointerId = null;

    function getCategoryOrder() {
        return Array.from(categoryList.querySelectorAll('.settings-category-row'))
            .map(row => parseInt(row.dataset.categoryId || '', 10))
            .filter(id => id > 0);
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

    async function persistCategoryOrder() {
        const order = getCategoryOrder();
        if (!order.length) return;

        const csrfToken = (categoryList.querySelector('input[name="csrf_token"]') || document.querySelector('input[name="csrf_token"]'))?.value || '';
        try {
            await fetch(window.location.href, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
                body: new URLSearchParams({ action: 'reorder_categories', csrf_token: csrfToken, order: JSON.stringify(order) }),
            });
        } catch (_) {}
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
        resetDragState(e.pointerId);

        if (wasDragged) {
            void persistCategoryOrder();
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
