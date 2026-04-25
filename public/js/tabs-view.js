import { basePath, state } from './state.js?v=4.2.71';
import { sectionTabsEl } from './ui.js?v=4.2.71';

function normalizeIconKey(icon, fallbackIcon) {
    const value = String(icon || '').trim();
    if (/^[a-z0-9_-]+$/.test(value)) return value;
    return /^[a-z0-9_-]+$/.test(String(fallbackIcon || '')) ? fallbackIcon : 'stern';
}

function appendCategoryIcon(container, category, fallbackIcon) {
    const iconKey = normalizeIconKey(category.icon, fallbackIcon);
    const image = document.createElement('img');
    image.className = 'category-icon-img';
    image.src = `${basePath}category-icon.php?icon=${encodeURIComponent(iconKey)}`;
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.draggable = false;
    container.appendChild(image);
}

export function createTabsViewController(deps) {
    const {
        getTypeConfig,
        getVisibleCategories,
        onCategorySelect,
    } = deps;

    let scrollListenerAttached = false;
    let wheelListenerAttached = false;
    let dragScrollListenerAttached = false;
    let tabDragScrollJustFinished = false;

    function makeCategoryTab(category) {
        const button = document.createElement('button');
        button.className = 'section-tab';
        button.type = 'button';
        button.draggable = false;
        button.dataset.categoryId = String(category.id);
        button.setAttribute('aria-label', category.name);
        button.title = category.name;
        if (category.id === state.categoryId) {
            button.setAttribute('aria-current', 'page');
        }

        const icon = document.createElement('span');
        icon.className = 'section-icon';
        icon.setAttribute('aria-hidden', 'true');
        appendCategoryIcon(icon, category, getTypeConfig(category.type).icon);

        const dot = document.createElement('span');
        dot.className = 'section-dot';

        const label = document.createElement('span');
        label.className = 'section-label';
        label.textContent = category.name;

        button.append(icon, label, dot);
        button.addEventListener('click', () => {
            if (tabDragScrollJustFinished) return;
            void onCategorySelect(category.id);
        });
        return button;
    }

    function updateScrollHints() {
        if (!sectionTabsEl) return;

        const maxScrollLeft = Math.max(0, sectionTabsEl.scrollWidth - sectionTabsEl.clientWidth);
        const canScroll = maxScrollLeft > 1;
        const scrollLeft = Math.min(Math.max(0, sectionTabsEl.scrollLeft), maxScrollLeft);

        sectionTabsEl.classList.toggle('is-scrollable', canScroll);
        sectionTabsEl.classList.toggle('can-scroll-left', canScroll && scrollLeft > 1);
        sectionTabsEl.classList.toggle('can-scroll-right', canScroll && scrollLeft < maxScrollLeft - 1);
    }

    function queueScrollHintUpdate() {
        window.requestAnimationFrame(updateScrollHints);
    }

    function ensureScrollListener() {
        if (!sectionTabsEl || scrollListenerAttached) return;
        sectionTabsEl.addEventListener('scroll', queueScrollHintUpdate, { passive: true });
        scrollListenerAttached = true;
    }

    function ensureWheelListener() {
        if (!sectionTabsEl || wheelListenerAttached) return;
        sectionTabsEl.addEventListener('wheel', event => {
            const maxScrollLeft = sectionTabsEl.scrollWidth - sectionTabsEl.clientWidth;
            if (maxScrollLeft <= 1) return;

            const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
                ? event.deltaY
                : event.deltaX;
            if (primaryDelta === 0) return;

            const previousScrollLeft = sectionTabsEl.scrollLeft;
            sectionTabsEl.scrollLeft = Math.min(
                Math.max(0, previousScrollLeft + primaryDelta),
                maxScrollLeft
            );

            if (sectionTabsEl.scrollLeft !== previousScrollLeft) {
                event.preventDefault();
                queueScrollHintUpdate();
            }
        }, { passive: false });
        wheelListenerAttached = true;
    }

    function ensureDragScrollListener() {
        if (!sectionTabsEl || dragScrollListenerAttached) return;

        sectionTabsEl.addEventListener('dragstart', event => {
            event.preventDefault();
        });

        sectionTabsEl.addEventListener('contextmenu', event => {
            event.preventDefault();
        });

        sectionTabsEl.addEventListener('pointerdown', event => {
            if (event.button !== undefined && event.button !== 0) return;
            const maxScrollLeft = sectionTabsEl.scrollWidth - sectionTabsEl.clientWidth;
            if (maxScrollLeft <= 1) return;

            const startX = event.clientX;
            const startScrollLeft = sectionTabsEl.scrollLeft;
            let isDragging = false;

            function finishDragScroll() {
                tabDragScrollJustFinished = true;
                window.setTimeout(() => {
                    tabDragScrollJustFinished = false;
                }, 120);
            }

            function cleanup() {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onEnd);
                document.removeEventListener('pointercancel', onAbort);
                sectionTabsEl.classList.remove('is-drag-scrolling');
            }

            function onMove(moveEvent) {
                const dx = moveEvent.clientX - startX;
                if (!isDragging && Math.abs(dx) > 4) {
                    isDragging = true;
                    sectionTabsEl.classList.add('is-drag-scrolling');
                }
                if (!isDragging) return;

                moveEvent.preventDefault();
                sectionTabsEl.scrollLeft = Math.min(
                    Math.max(0, startScrollLeft - dx),
                    maxScrollLeft
                );
                queueScrollHintUpdate();
            }

            function onEnd() {
                cleanup();
                if (isDragging) finishDragScroll();
            }

            function onAbort() {
                cleanup();
                if (isDragging) finishDragScroll();
            }

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onAbort);
        });

        dragScrollListenerAttached = true;
    }

    function scrollActiveTabIntoView() {
        const activeTab = sectionTabsEl?.querySelector('.section-tab[aria-current="page"]');
        activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function renderCategoryTabs() {
        if (!sectionTabsEl) return;

        ensureScrollListener();
        ensureWheelListener();
        ensureDragScrollListener();
        sectionTabsEl.replaceChildren();
        sectionTabsEl.classList.add('is-scrollable');

        const categories = getVisibleCategories();
        const fragment = document.createDocumentFragment();

        categories.forEach(category => {
            fragment.appendChild(makeCategoryTab(category));
        });

        sectionTabsEl.appendChild(fragment);
        scrollActiveTabIntoView();
        queueScrollHintUpdate();
    }

    return {
        renderCategoryTabs,
    };
}
