import { initThemeHandling } from './settings-theme.js?v=5.1.16';
import { initUIHandling } from './settings-ui.js?v=5.1.16';
import { initFormHandling } from './settings-forms.js?v=5.1.16';
import { initCategoryDragReorder } from './settings-dnd.js?v=5.1.16';
import { getLocalThemePreferences } from './settings-theme.js?v=5.1.16';

// Initialize the settings page
initThemeHandling();
initUIHandling();
initFormHandling();
initCategoryDragReorder();

const categorySwipeInput = document.querySelector('input[name="category_swipe_enabled"]');
if (categorySwipeInput instanceof HTMLInputElement) {
    import('./settings-state.js?v=5.1.16').then(({ readLocalPrefs }) => {
        const localPrefs = readLocalPrefs();
        if (typeof localPrefs.category_swipe_enabled === 'boolean') {
            categorySwipeInput.checked = localPrefs.category_swipe_enabled;
        }
    });
}
