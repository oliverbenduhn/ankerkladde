import { CATEGORY_SWIPE_THRESHOLD_PX, state } from './state.js?v=4.2.60';
import {
    listAreaEl,
    listSwipePreviewEl,
    listSwipePreviewHeaderEl,
    listSwipePreviewListEl,
    listSwipeStageEl,
} from './ui.js?v=4.2.60';

export function createSwipeController(deps) {
    const {
        getUserPreferences,
        getVisibleCategories,
        setCategory,
    } = deps;

    let swipeState = null;
    let swipeTransitionActive = false;

    function setSwipeStagePosition(offsetPx, opacity = 1) {
        if (!listSwipeStageEl) return;
        listSwipeStageEl.style.transform = `translateX(${Math.round(offsetPx)}px)`;
        listSwipeStageEl.style.opacity = String(opacity);
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

    function hideSwipePreview() {
        if (!listSwipePreviewEl || !listSwipePreviewHeaderEl || !listSwipePreviewListEl) return;
        listSwipePreviewEl.hidden = true;
    }

    function resetSwipeStage() {
        clearSwipeStageTransition();
        setSwipeStagePosition(0, 1);
        hideSwipePreview();
        listAreaEl?.classList.remove('is-swipe-gesture');
    }

    function canStartCategorySwipe(target) {
        if (!(target instanceof Element)) return false;
        if (state.noteEditorId !== null || state.search.open) return false;
        if (!getUserPreferences().category_swipe_enabled) return false;
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

    return {
        initCategorySwipe,
    };
}
