import { initThemeHandling, getLocalThemePreferences } from './settings-theme.js';
import { initUIHandling, renderFlash } from './settings-ui.js';
import { initFormHandling } from './settings-forms.js';
import { initCategoryDragReorder } from './settings-dnd.js';

export { renderFlash };

export function initSettings(root = document) {
    initThemeHandling(root);
    initUIHandling(root);
    initFormHandling(root);
    initCategoryDragReorder(root);

    const categorySwipeInput = root.querySelector('input[name="category_swipe_enabled"]');
    if (categorySwipeInput instanceof HTMLInputElement) {
        import('./settings-state.js').then(({ readLocalPrefs }) => {
            const localPrefs = readLocalPrefs();
            if (typeof localPrefs.category_swipe_enabled === 'boolean') {
                categorySwipeInput.checked = localPrefs.category_swipe_enabled;
            }
        });
    }

    getLocalThemePreferences();
}
