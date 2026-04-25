import { api } from './api.js?v=4.2.71';
import { TAB_REORDER_LONG_PRESS_MS, state } from './state.js?v=4.2.71';
import { listEl } from './ui.js?v=4.2.71';

export function createReorderController(deps) {
    const {
        cacheCurrentCategoryItems,
        getItemById,
        invalidateCategoryCache,
        loadItems,
        setMessage,
        triggerHapticFeedback,
    } = deps;

    let itemDragJustFinished = false;

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

    function initItemDragReorder() {
        if (!listEl) return;

        listEl.addEventListener('click', event => {
            if (!itemDragJustFinished) return;
            event.preventDefault();
            event.stopPropagation();
        }, true);

        listEl.addEventListener('pointerdown', event => {
            if (state.mode !== 'liste' || state.search.open) return;
            if (event.button !== undefined && event.button !== 0) return;

            // Ignore clicks on interactive elements
            if (
                event.target.closest('.toggle')
                || event.target.closest('.btn-item-menu')
                || event.target.closest('button:not(.item-name-button)')
                || event.target.closest('a')
                || event.target.closest('input')
                || event.target.closest('textarea')
                || event.target.closest('details')
            ) return;

            const li = event.target.closest('li.item-card');
            if (!li || li.classList.contains('is-editing')) return;

            const startX = event.clientX;
            const startY = event.clientY;
            let dragActive = false;
            let isScrolling = false;
            const usesLongPress = event.pointerType !== 'mouse';

            const preventScroll = (e) => {
                if (dragActive) e.preventDefault();
            };

            function beginDrag() {
                if (dragActive) return;
                dragActive = true;
                triggerHapticFeedback();
                document.body.classList.add('is-sorting');
                li.classList.add('is-dragging');
                try {
                    li.setPointerCapture(event.pointerId);
                } catch {}
            }

            const longPressTimer = usesLongPress
                ? window.setTimeout(beginDrag, TAB_REORDER_LONG_PRESS_MS)
                : 0;

            function getOtherItems() {
                return Array.from(listEl.querySelectorAll('li.item-card:not(.is-dragging)'));
            }

            function clearDropTargets() {
                listEl.querySelectorAll('li.item-card').forEach(other => {
                    other.classList.remove('is-drop-target-before', 'is-drop-target-after');
                });
            }

            function cleanup() {
                window.clearTimeout(longPressTimer);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onEnd);
                document.removeEventListener('pointercancel', onAbort);
                window.removeEventListener('touchmove', preventScroll, { capture: true });
            }

            let insertBefore = null;

            function onMove(moveEvent) {
                if (!dragActive) {
                    if (isScrolling) return;
                    const dx = Math.abs(moveEvent.clientX - startX);
                    const dy = Math.abs(moveEvent.clientY - startY);
                    if (dx > 5 || dy > 5) {
                        window.clearTimeout(longPressTimer);
                        if (!usesLongPress) {
                            if (dy >= dx) {
                                beginDrag();
                            } else {
                                cleanup();
                                return;
                            }
                        } else {
                            isScrolling = true;
                        }
                    }
                    if (!dragActive) return;
                }

                moveEvent.preventDefault();
                const currentY = moveEvent.clientY;
                const ty = currentY - startY;
                li.style.transform = `scale(1.01) rotate(-0.4deg) translateY(${ty}px)`;
                li.style.zIndex = '1000';

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
                if (!dragActive) return;
                
                document.body.classList.remove('is-sorting');
                li.classList.remove('is-dragging');
                li.style.transform = '';
                li.style.zIndex = '';
                clearDropTargets();

                if (insertBefore) {
                    listEl.insertBefore(li, insertBefore);
                } else {
                    listEl.appendChild(li);
                }

                void persistItemOrder();
                itemDragJustFinished = true;
                window.setTimeout(() => {
                    itemDragJustFinished = false;
                }, 150);
            }

            function onAbort() {
                cleanup();
                if (!dragActive) return;
                document.body.classList.remove('is-sorting');
                li.classList.remove('is-dragging');
                li.style.transform = '';
                li.style.zIndex = '';
                clearDropTargets();
            }

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onAbort);
            window.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
        });
    }

    return {
        initItemDragReorder,
    };
}
