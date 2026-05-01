import { saveLocalPrefs, state, themeMediaQuery, getCurrentType } from './state.js?v=4.3.4';
import { appEl, sectionTabsEl, updateViewportHeight } from './ui.js?v=4.3.4';
import { applyThemePreferences } from './theme.js?v=4.3.4';

export function registerLayoutEvents(deps) {
    const { applyTabsVisibility, renderCategoryTabs, renderItems, savePreferences, navigation, closeSearch, closeScanner, updateHeaders, router } = deps;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    function applyDesktopLayout(layout) {
        state.desktopLayout = layout;
        if (appEl) appEl.dataset.desktopLayout = layout;
        deps.desktopLayoutBtns.forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.layout === layout ? 'true' : 'false');
        });
        saveLocalPrefs({ desktop_layout: layout });
        renderItems();
    }

    function transitionDesktopLayout(layout) {
        if (layout === state.desktopLayout) return;
        const reduceMotion = Boolean(prefersReducedMotion?.matches);
        const canUseViewTransition = !reduceMotion && typeof document.startViewTransition === 'function';

        if (canUseViewTransition) {
            document.startViewTransition(() => applyDesktopLayout(layout));
            return;
        }

        if (!reduceMotion) {
            appEl?.classList.add('is-layout-transitioning');
            window.setTimeout(() => {
                appEl?.classList.remove('is-layout-transitioning');
            }, 260);
        }
        applyDesktopLayout(layout);
    }

    deps.modeToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            if (deps.scannerState?.open) {
                closeScanner();
            }
            state.mode = button.dataset.nav === 'einkaufen' ? 'einkaufen' : 'liste';
            appEl.dataset.mode = state.mode;
            void savePreferences({ mode: state.mode });
            renderItems();
        });
    });

    deps.desktopLayoutBtns.forEach(button => {
        button.addEventListener('click', () => {
            let layout = button.dataset.layout || 'liste';
            if (layout === 'kanban' && getCurrentType() !== 'list_due_date') {
                layout = 'liste';
            }
            transitionDesktopLayout(layout);
        });
    });

    deps.tabsToggleBtns.forEach(button => {
        button.addEventListener('click', () => {
            const hidden = !sectionTabsEl.classList.contains('tabs-hidden');
            applyTabsVisibility(hidden);
            void savePreferences({ tabs_hidden: hidden });
        });
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

    if (themeMediaQuery) {
        const onThemeMediaChange = () => {
            if (deps.userPreferencesRef().theme_mode === 'auto') applyThemePreferences(deps.userPreferencesRef());
        };
        if (typeof themeMediaQuery.addEventListener === 'function') {
            themeMediaQuery.addEventListener('change', onThemeMediaChange);
        } else if (typeof themeMediaQuery.addListener === 'function') {
            themeMediaQuery.addListener(onThemeMediaChange);
        }
    }

    document.querySelectorAll('.clickable-brand').forEach(el => {
        el.addEventListener('click', () => {
            const visibleCategories = state.categories?.filter(c => Number(c.is_hidden) !== 1) || [];
            if (visibleCategories.length > 0) {
                const firstCatId = visibleCategories[0].id;
                if (state.categoryId === String(firstCatId) && state.view !== 'settings' && !state.search.open && !deps.scannerState?.open) return;
                state.categoryId = String(firstCatId);
                state.swipeTransitionActive = true;
                void savePreferences({ last_category_id: firstCatId });
                if (state.search.open) closeSearch();
                if (state.view === 'settings') router.closeSettings();
                if (deps.scannerState?.open) closeScanner();
                navigation.pushHistoryState({ screen: 'list', categoryId: firstCatId });
                renderCategoryTabs();
                renderItems();
                updateHeaders();
                document.querySelectorAll('details').forEach(el => el.removeAttribute('open'));
                setTimeout(() => { state.swipeTransitionActive = false; }, 300);
            }
        });
    });
}
