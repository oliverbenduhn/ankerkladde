import { t } from './i18n.js';
import { state } from './state.js?v=4.3.4';
import { sanitizeItemPayload } from './utils.js?v=4.3.11';

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

    return { removeItemById, shouldQueueOffline, itemParams, handleStaleCategory };
}
