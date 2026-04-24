import { basePath, state } from './state.js?v=4.2.69';
import { sectionTabsEl } from './ui.js?v=4.2.69';

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
    container.appendChild(image);
}

export function createTabsViewController(deps) {
    const {
        getTypeConfig,
        getVisibleCategories,
        isTabDragJustFinished,
        onCategorySelect,
    } = deps;

    let scrollListenerAttached = false;

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
        appendCategoryIcon(icon, category, getTypeConfig(category.type).icon);

        const dot = document.createElement('span');
        dot.className = 'section-dot';

        const label = document.createElement('span');
        label.className = 'section-label';
        label.textContent = category.name;

        button.append(icon, label, dot);
        button.addEventListener('click', () => {
            if (isTabDragJustFinished()) return;
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

    function scrollActiveTabIntoView() {
        const activeTab = sectionTabsEl?.querySelector('.section-tab[aria-current="page"]');
        activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function renderCategoryTabs() {
        if (!sectionTabsEl) return;

        ensureScrollListener();
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
