import { api } from './api.js?v=4.2.71';
import { TAB_REORDER_LONG_PRESS_MS, state } from './state.js?v=4.2.71';
import { listEl, sectionTabsEl } from './ui.js?v=4.2.71';

export function createReorderController(deps) {
    const {
        applyTabsVisibility,
        cacheCurrentCategoryItems,
        getItemById,
        getUserPreferences,
        getVisibleCategories,
        invalidateCategoryCache,
        loadCategories,
        loadItems,
        renderCategoryTabs,
        setMessage,
        triggerHapticFeedback,
        updateHeaders,
    } = deps;

    let tabDragJustFinished = false;

    function wasTabDragJustFinished() {
        return tabDragJustFinished;
    }

    function mergeDisplayedCategoryOrder(displayedIds) {
        const visibleIds = getVisibleCategories().map(category => Number(category.id));
        if (displayedIds.length === 0 || displayedIds.length >= visibleIds.length) {
            return visibleIds;
        }

        const firstDisplayedIndex = visibleIds.findIndex(id => id === displayedIds[0]);
        if (firstDisplayedIndex === -1) {
            return visibleIds;
        }

        const displayedIdSet = new Set(displayedIds);
        const remainingIds = visibleIds.filter(id => !displayedIdSet.has(id));

        let insertionIndex = 0;
        for (; insertionIndex < remainingIds.length; insertionIndex += 1) {
            const originalIndex = visibleIds.findIndex(id => id === remainingIds[insertionIndex]);
            if (originalIndex > firstDisplayedIndex) {
                break;
            }
        }

        return [
            ...remainingIds.slice(0, insertionIndex),
            ...displayedIds,
            ...remainingIds.slice(insertionIndex),
        ];
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
            applyTabsVisibility(getUserPreferences().tabs_hidden);
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

            const preventScroll = (e) => {
                if (dragActive) e.preventDefault();
            };

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
                window.removeEventListener('touchmove', preventScroll, { capture: true });
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

                const currentX = moveEvent.clientX;
                const tx = currentX - startX;
                tab.style.transform = `translateX(${tx}px)`;
                tab.style.zIndex = '1000';

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
                tab.style.transform = '';
                tab.style.zIndex = '';
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

                const displayedIds = Array.from(sectionTabsEl.querySelectorAll('.section-tab'))
                    .map(button => Number(button.dataset.categoryId))
                    .filter(Number.isInteger);
                const orderedIds = mergeDisplayedCategoryOrder(displayedIds);

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
                tab.style.transform = '';
                tab.style.zIndex = '';
                sectionTabsEl.classList.remove('is-tab-reordering');
                Array.from(sectionTabsEl.querySelectorAll('.section-tab')).forEach(other => {
                    other.classList.remove('tab-drop-before', 'tab-drop-after');
                });
                delete tab._tabInsertBefore;
            }

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onAbort);
            window.addEventListener('touchmove', preventScroll, { passive: false, capture: true });
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

    function initItemDragReorder() {
        if (!listEl) return;

        listEl.addEventListener('pointerdown', event => {
            if (state.mode !== 'liste' || state.search.open) return;
            if (event.button !== undefined && event.button !== 0) return;

            // Ignore clicks on interactive elements
            if (event.target.closest('.toggle') || event.target.closest('.btn-item-menu') || event.target.closest('button') || event.target.closest('a') || event.target.closest('input') || event.target.closest('textarea') || event.target.closest('details')) return;

            const li = event.target.closest('li.item-card');
            if (!li || li.classList.contains('is-editing')) return;

            const startX = event.clientX;
            const startY = event.clientY;
            let dragActive = false;
            let isScrolling = false;

            const preventScroll = (e) => {
                if (dragActive) e.preventDefault();
            };

            const longPressTimer = window.setTimeout(() => {
                dragActive = true;
                triggerHapticFeedback();
                document.body.classList.add('is-sorting');
                li.classList.add('is-dragging');
                try {
                    li.setPointerCapture(event.pointerId);
                } catch {}
            }, TAB_REORDER_LONG_PRESS_MS);

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
                        isScrolling = true;
                    }
                    return;
                }

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
        initCategoryTabReorder,
        initItemDragReorder,
        wasTabDragJustFinished,
    };
}
