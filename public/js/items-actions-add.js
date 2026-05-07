import { t } from './i18n.js';
import { appUrl, api } from './api.js?v=4.3.4';
import { getCurrentCategory, isAttachmentCategory } from './state.js?v=4.3.4';
import { itemInput, linkDescriptionInput, quantityInput } from './ui.js?v=4.3.4';
import { sanitizeItemField } from './utils.js?v=4.3.11';
import { enqueueAction } from './offline-queue.js?v=4.3.11';

export function createAddActions(deps) {
    const {
        getItemById,
        getUploadMode,
        loadItems,
        openNoteEditorWithNavigation,
        resetItemForm,
        setMessage,
        setNetworkStatus,
        invalidateCategoryCache,
        shouldQueueOffline,
        itemParams,
        handleStaleCategory,
        importFileFromUrl,
        uploadSelectedAttachment,
    } = deps;

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
        if (!category) return;

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

    return { addItem };
}
