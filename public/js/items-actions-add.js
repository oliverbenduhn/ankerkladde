import { t } from './i18n.js';
import { appUrl, api, fetchLinkMetadata } from './api.js?v=5.1.24';
import { getCurrentCategory, isAttachmentCategory, state } from './state.js?v=5.1.24';
import {
    itemInput,
    linkDescriptionInput,
    quantityInput,
    quickAddAiBtn,
    quickAddFeedback,
    quickAddFeedbackText,
} from './ui.js?v=5.1.24';
import { sanitizeItemField } from './utils.js?v=5.1.24';
import { enqueueAction } from './offline-queue.js?v=5.1.24';

export function createAddActions(deps) {
    const {
        getItemById,
        getUploadMode,
        getVisibleCategories,
        loadItems,
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
        quickAddFeedbackText.textContent = payload.error || error.message || t('quick_add.processing_error');
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

    async function quickAdd(input, activeCategoryId, { stayOnScreen = false } = {}) {
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
            if (stayOnScreen) {
                // ponytail: caller (e.g. journal quick-add) is responsible for refreshing its view.
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

    // Journal-specific quick-add: pass the chosen date as a default and pick the most
    // appropriate due-date category, then signal the caller that nothing else needs
    // to switch.
    async function quickAddForJournal(input, date) {
        const dueCategories = getVisibleCategories().filter(entry => entry.type === 'list_due_date');
        if (dueCategories.length === 0) {
            setMessage(t('quick_add.no_due_category'), true);
            return null;
        }
        const activeDueCategory = dueCategories.find(entry => Number(entry.id) === Number(state.categoryId));
        const targetCategory = activeDueCategory || dueCategories[0];
        if (!targetCategory) {
            setMessage(t('quick_add.no_due_category'), true);
            return null;
        }
        // Explicit ISO or relative date phrase in the input wins over the journal default.
        const hasExplicitDate = /\b\d{4}-\d{2}-\d{2}\b|\b(heute|morgen|übermorgen|gestern)\b/i.test(input);
        const body = itemParams({
            input: !hasExplicitDate && date ? `${input} ${date}` : input,
            active_category_id: String(targetCategory.id),
        });
        try {
            const payload = await api('quick_add', { method: 'POST', body });
            hideQuickAddFeedback();
            resetItemForm();
            invalidateCategoryCache(Number(targetCategory.id));
            if (typeof deps.afterJournalQuickAdd === 'function') {
                await deps.afterJournalQuickAdd(payload);
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

    async function addItem(event) {
        event.preventDefault();
        const category = getCurrentCategory();

        if (state.screen === 'journal') {
            await quickAddForJournal(itemInput.value.trim(), state.journalDate || state.serverToday);
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
                setMessage(t('msg.offline_saved'));
                return;
            }

            throw error;
        }
    }

    return { addItem, quickAdd, quickAddForJournal };
}
