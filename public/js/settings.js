import { initThemeHandling, getLocalThemePreferences } from './settings-theme.js?v=5.1.34';
import { initUIHandling, renderFlash } from './settings-ui.js?v=5.1.34';
import { initFormHandling } from './settings-forms.js?v=5.1.34';
import { initCategoryDragReorder } from './settings-dnd.js?v=5.1.34';

export { renderFlash };

export function initSettings(root = document) {
    initThemeHandling(root);
    initUIHandling(root);
    initFormHandling(root);
    initCategoryDragReorder(root);

    const categorySwipeInput = root.querySelector('input[name="category_swipe_enabled"]');
    if (categorySwipeInput instanceof HTMLInputElement) {
        import('./settings-state.js?v=5.1.34').then(({ readLocalPrefs }) => {
            const localPrefs = readLocalPrefs();
            if (typeof localPrefs.category_swipe_enabled === 'boolean') {
                categorySwipeInput.checked = localPrefs.category_swipe_enabled;
            }
        });
    }

    getLocalThemePreferences();
}
