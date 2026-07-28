import { t } from './i18n.js';
import { state } from './state.js';
import { sanitizeItemPayload } from './utils.js';

export function createActionUtils(deps) {
    const {
        cacheCurrentCategoryItems,
        loadCategories,
        loadItems,
        setNetworkStatus,
        setMessage,
        invalidateCategoryCache,
    } = deps;

    function removeItemById(id) {
        state.items = state.items.filter(item => item.id !== id);
        cacheCurrentCategoryItems();
    }

    function shouldQueueOffline(error) {
        return Boolean(error?.isNetworkError || Number(error?.status) >= 500);
    }

    // Uebernehme die kanonische Server-Fassung aus einer 409-Antwort in den
    // lokalen state (Spec AC4: Browser uebernimmt den vollstaendigen
    // Serverzustand bei Revisions-Konflikt ohne zusaetzlichen GET).
    function applyServerItem(item) {
        if (!item || Number(item.id) <= 0) return;
        const idx = state.items.findIndex(entry => Number(entry.id) === Number(item.id));
        if (idx >= 0) {
            state.items[idx] = { ...state.items[idx], ...item };
        } else {
            state.items.push(item);
        }
        cacheCurrentCategoryItems();
    }

    function itemParams(payload) {
        return new URLSearchParams(sanitizeItemPayload(payload));
    }

    async function handleStaleCategory(error, categoryId) {
        if (Number(error?.status) !== 404) return false;

        invalidateCategoryCache(categoryId);
        await loadCategories();
        await loadItems(undefined, { useCache: false });
        setNetworkStatus();
        setMessage(t('msg.category_deleted_remote'), true);
        return true;
    }

    return { removeItemById, shouldQueueOffline, itemParams, handleStaleCategory, applyServerItem };
}
