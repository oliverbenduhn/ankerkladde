import { basePath, state } from './state.js?v=4.2.60';
import { mehrMenuEl, sectionTabsEl, svgIcon } from './ui.js?v=4.2.60';

const MIN_VISIBLE_TAB_WIDTH = 64;
const MEHR_BUTTON_WIDTH = 48;

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

    let mehrOpen = false;

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
            sectionTabsEl.appendChild(mehrMenuEl);
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
                appendCategoryIcon(icon, category, getTypeConfig(category.type).icon);

                const label = document.createElement('span');
                label.textContent = category.name;

                item.append(icon, label);
                item.addEventListener('click', () => {
                    closeMehrMenu();
                    if (isTabDragJustFinished()) return;
                    void onCategorySelect(category.id);
                });
                if (mehrMenuEl) mehrMenuEl.appendChild(item);
            });
        }

        sectionTabsEl.appendChild(fragment);
    }

    function handleDocumentClick(target) {
        if (mehrOpen && !target.closest('.mehr-menu') && !target.closest('.mehr-btn')) {
            closeMehrMenu();
        }
    }

    return {
        closeMehrMenu,
        handleDocumentClick,
        renderCategoryTabs,
    };
}
