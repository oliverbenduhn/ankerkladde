import { t } from './i18n.js';
import { appUrl, api } from './api.js?v=5.1.11';
import { getCurrentCategory, isAttachmentCategory, state } from './state.js?v=4.3.4';
import {
    itemInput,
    linkDescriptionInput,
    quantityInput,
    quickAddAiBtn,
    quickAddFeedback,
    quickAddFeedbackText,
} from './ui.js?v=5.1.11';
import { sanitizeItemField } from './utils.js?v=4.3.11';
import { enqueueAction } from './offline-queue.js?v=4.3.11';

export function createAddActions(deps) {
    const {
        getItemById,
        getUploadMode,
        getVisibleCategories,
        loadItems,
        loadToday,
        openMagic,
        openNoteEditorWithNavigation,
        resetItemForm,
        setMessage,
        setNetworkStatus,
        setCategory,
        invalidateCategoryCache,
        shouldQueueOffline,
        itemParams,
        handleStaleCategory,
        importFileFromUrl,
        uploadSelectedAttachment,
    } = deps;
    let pendingQuickAddInput = '';

    function hideQuickAddFeedback() {
        if (quickAddFeedback) quickAddFeedback.hidden = true;
        if (quickAddFeedbackText) quickAddFeedbackText.textContent = '';
        if (quickAddAiBtn) quickAddAiBtn.hidden = true;
        pendingQuickAddInput = '';
    }

    function showQuickAddFeedback(error, input) {
        const payload = error?.payload || {};
        if (!quickAddFeedback || !quickAddFeedbackText) return;
        pendingQuickAddInput = input;
        quickAddFeedbackText.textContent = payload.error || error.message || 'Quick-Add konnte nicht verarbeitet werden.';
        quickAddFeedback.hidden = false;
        if (quickAddAiBtn) quickAddAiBtn.hidden = payload.can_escalate_to_ai !== true;
    }

    quickAddAiBtn?.addEventListener('click', () => {
        if (pendingQuickAddInput === '') return;
        const input = pendingQuickAddInput;
        hideQuickAddFeedback();
        openMagic(input);
    });
    itemInput?.addEventListener('input', hideQuickAddFeedback);

    async function quickAdd(input, activeCategoryId, { stayOnToday = false } = {}) {
        const body = itemParams({
            input,
            active_category_id: String(activeCategoryId),
        });
        try {
            const payload = await api('quick_add', { method: 'POST', body });
            hideQuickAddFeedback();
            resetItemForm();
            invalidateCategoryCache(activeCategoryId);
            invalidateCategoryCache(payload.category_id);
            if (stayOnToday) {
                await loadToday();
            } else if (Number(payload.category_id) !== Number(activeCategoryId)) {
                await setCategory(payload.category_id);
            } else {
                await loadItems();
            }
            setMessage(t('msg.item_added'));
            return payload;
        } catch (error) {
            if (error?.status === 422 && error?.payload?.error_key?.startsWith('quick_add.')) {
                showQuickAddFeedback(error, input);
                return null;
            }
            throw error;
        }
    }

    async function fetchLinkMetadata(url) {
        try {
            const response = await fetch(appUrl(`api.php?action=fetch_metadata&url=${encodeURIComponent(url)}`));
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    async function addItem(event) {
        event.preventDefault();
        const category = getCurrentCategory();

        if (state.screen === 'today') {
            const dueCategories = getVisibleCategories().filter(entry => entry.type === 'list_due_date');
            const activeDueCategory = dueCategories.find(entry => Number(entry.id) === Number(category?.id));
            const targetCategory = activeDueCategory || dueCategories[0];
            if (!targetCategory) {
                setMessage('Für Quick-Add ist eine Aufgaben-Kategorie erforderlich.', true);
                return;
            }
            await quickAdd(itemInput.value.trim(), Number(targetCategory.id), { stayOnToday: true });
            return;
        }

        if (!category) return;

        if (category.type === 'list_quantity' || category.type === 'list_due_date') {
            await quickAdd(itemInput.value.trim(), Number(category.id));
            return;
        }

        if (category.type === 'notes') {
            const name = sanitizeItemField('name', itemInput.value.trim() || 'Neue Notiz');
            const body = itemParams({ category_id: String(category.id), name });
            try {
                const payload = await api('add', { method: 'POST', body });
                resetItemForm();
                invalidateCategoryCache(category.id);
                await loadItems();
                const item = getItemById(payload.id);
                if (item) {
                    await openNoteEditorWithNavigation(item);
                }
            } catch (error) {
                if (await handleStaleCategory(error, category.id)) return;
                throw error;
            }
            return;
        }

        if (isAttachmentCategory(category.type)) {
            if (getUploadMode() === 'url' && category.type === 'files') {
                await importFileFromUrl();
            } else {
                await uploadSelectedAttachment();
            }
            return;
        }

        const body = itemParams({
            category_id: String(category.id),
            name: itemInput.value.trim(),
        });

        if (category.type === 'links') {
            const manualDescription = sanitizeItemField('content', linkDescriptionInput?.value.trim());
            if (manualDescription) {
                body.set('content', manualDescription);
            } else {
                setMessage('Lade Seiten-Infos...');
                const meta = await fetchLinkMetadata(itemInput.value.trim());
                if (meta?.title || meta?.description) {
                    body.set('content', sanitizeItemField('content', [meta.title, meta.description].filter(Boolean).join('\n\n')));
                }
            }
        }

        if (category.type === 'list_quantity' && quantityInput.value.trim() !== '') {
            body.set('quantity', sanitizeItemField('quantity', quantityInput.value.trim()));
        }

        if (category.type === 'list_due_date' && quantityInput.value.trim() !== '') {
            body.set('due_date', sanitizeItemField('due_date', quantityInput.value.trim()));
        }

        try {
            await api('add', { method: 'POST', body });
            resetItemForm();
            invalidateCategoryCache(category.id);
            await loadItems();
            setMessage(t('msg.item_added'));
        } catch (error) {
            if (await handleStaleCategory(error, category.id)) return;

            if (shouldQueueOffline(error)) {
                enqueueAction('add', Object.fromEntries(body.entries()));
                resetItemForm();
                setNetworkStatus();
                setMessage('Offline gespeichert – wird synchronisiert wenn du wieder online bist.');
                return;
            }

            throw error;
        }
    }

    return { addItem, quickAdd };
}
