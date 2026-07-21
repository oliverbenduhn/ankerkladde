import { state } from './state.js?v=5.1.34';
import { itemForm, itemInput, linkDescriptionInput } from './ui.js?v=5.1.34';
import { syncAutoHeight } from './utils.js?v=5.1.34';

export function createHelpersController(deps) {
    const {
        getUserPreferences,
        updateFilePickerLabel,
    } = deps;

    function resetItemForm() {
        itemForm?.reset();
        syncAutoHeight(itemInput);
        syncAutoHeight(linkDescriptionInput);
        updateFilePickerLabel();
    }

    function triggerHapticFeedback() {
        if ('vibrate' in navigator) {
            navigator.vibrate(12);
        }
    }

    function getTodayDateString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isOverdueItem(item) {
        return item.category_type === 'list_due_date'
            && item.done !== 1
            && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date || '')
            && item.due_date < getTodayDateString();
    }

    function formatDate(value) {
        try {
            return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE');
        } catch {
            return value;
        }
    }

    return {
        formatDate,
        getTodayDateString,
        isOverdueItem,
        resetItemForm,
        triggerHapticFeedback,
    };
}
