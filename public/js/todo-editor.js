import { api } from './api.js';
import { t } from './i18n.js';
import { state } from './state.js';
import {
    appEl,
    itemCategoryInput,
    itemCategorySection,
    itemCreateBtn,
    itemDateInput,
    itemEditorEl,
    itemNoteInput,
    itemPriorityInput,
    itemStatusSection,
    itemTimeInput,
    itemTitleInput,
} from './ui.js';

export function createTodoEditorController(deps) {
    const {
        getVisibleCategories,
        invalidateCategoryCache,
        loadItems,
        handleStatus,
        handleToggle,
        refreshOpenJournal,
        setMessage,
    } = deps;

    let currentItem = null;
    let currentStatus = '';
    let isCreating = false;
    let sourceScreen = 'list';

    function setStatus(status) {
        currentStatus = status;
        document.querySelectorAll('#itemStatusSelector .item-status-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === status);
        });
    }

    async function save() {
        if (!currentItem) return;

        const name = itemTitleInput?.value.trim() || currentItem.name;
        const dueDate = itemDateInput?.value || '';
        const dueTime = dueDate ? (itemTimeInput?.value || '') : '';
        const priority = itemPriorityInput?.value || '';
        const content = itemNoteInput?.value || '';
        const expectedRevision = Number(currentItem.revision);
        if (expectedRevision < 1) {
            throw new Error(t('error.revision_required'));
        }

        const body = new URLSearchParams({
            id: String(currentItem.id),
            expected_revision: String(expectedRevision),
            name,
            barcode: '',
            quantity: '',
            due_date: dueDate,
            due_time: dueTime,
            priority,
            content,
            status: currentStatus,
        });
        let result;
        try {
            result = await api('update', { method: 'POST', body });
        } catch (error) {
            if (Number(error?.status) === 409 && error.payload?.item) {
                // Konflikt: kanonische Server-Fassung uebernehmen.
                Object.assign(currentItem, error.payload.item);
            }
            throw error;
        }

        currentItem = {
            ...currentItem,
            name,
            due_date: dueDate,
            due_time: dueTime,
            priority,
            content,
            status: currentStatus,
            revision: Number(result.item?.revision ?? expectedRevision + 1),
        };
        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }

    function hideEditor() {
        currentItem = null;
        currentStatus = '';
        isCreating = false;
        if (itemCreateBtn) {
            itemCreateBtn.hidden = true;
            itemCreateBtn.disabled = false;
        }
        if (itemCategorySection) itemCategorySection.hidden = true;
        if (itemStatusSection) itemStatusSection.hidden = false;
        if (itemEditorEl) itemEditorEl.hidden = true;
        appEl?.classList.remove('item-editor-open');
    }

    async function createTodo() {
        if (!isCreating) return;
        const name = itemTitleInput?.value.trim() || '';
        if (name === '') {
            setMessage(t('error.item_name_required'), true);
            itemTitleInput?.focus();
            return;
        }

        const categoryId = Number(itemCategoryInput?.value);
        const dueDate = itemDateInput?.value || '';
        const body = new URLSearchParams({
            category_id: String(categoryId),
            name,
            barcode: '',
            quantity: '',
            due_date: dueDate,
            due_time: dueDate ? (itemTimeInput?.value || '') : '',
            priority: itemPriorityInput?.value || '',
            content: itemNoteInput?.value || '',
        });

        if (itemCreateBtn) itemCreateBtn.disabled = true;
        try {
            await api('add', { method: 'POST', body });
            invalidateCategoryCache(categoryId);
            hideEditor();
            if (sourceScreen === 'journal') {
                await refreshOpenJournal?.();
            } else if (Number(state.categoryId) === categoryId) {
                await loadItems(undefined, { useCache: false });
            }
            setMessage(t('msg.item_added'));
        } catch (error) {
            if (itemCreateBtn) itemCreateBtn.disabled = false;
            setMessage(error instanceof Error ? error.message : t('error.item_name_required'), true);
        }
    }

    function openTodoCreate({ categoryId = null, dueDate = '' } = {}) {
        const dueCategories = getVisibleCategories().filter(category => category.type === 'list_due_date');
        if (dueCategories.length === 0) {
            setMessage(t('quick_add.no_due_category'), true);
            return;
        }

        const selectedCategory = dueCategories.find(category => Number(category.id) === Number(categoryId)) || dueCategories[0];
        isCreating = true;
        sourceScreen = state.screen;
        currentItem = null;
        currentStatus = '';

        if (itemCategoryInput) {
            itemCategoryInput.replaceChildren(...dueCategories.map(category => new Option(category.name, String(category.id))));
            itemCategoryInput.value = String(selectedCategory.id);
        }
        if (itemTitleInput) itemTitleInput.value = '';
        if (itemDateInput) itemDateInput.value = dueDate;
        if (itemTimeInput) itemTimeInput.value = '';
        if (itemPriorityInput) itemPriorityInput.value = '';
        if (itemNoteInput) itemNoteInput.value = '';
        if (itemCategorySection) itemCategorySection.hidden = false;
        if (itemStatusSection) itemStatusSection.hidden = true;
        if (itemCreateBtn) {
            itemCreateBtn.hidden = false;
            itemCreateBtn.disabled = false;
        }
        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        itemTitleInput?.focus();
    }

    function openTodoEditor(item) {
        isCreating = false;
        currentItem = item;
        currentStatus = item.status || '';

        // Register handlers fresh via onclick to avoid stacking.
        document.querySelectorAll('#itemStatusSelector .item-status-btn').forEach(btn => {
            btn.onclick = async () => {
                const nextStatus = btn.dataset.status;
                if (nextStatus === currentStatus) {
                    return;
                }

                await handleStatus(currentItem.id, currentStatus, nextStatus);
                const canonical = state.items.find(item => Number(item.id) === Number(currentItem.id));
                if (canonical) Object.assign(currentItem, canonical);
                setStatus(currentItem.status || '');
            };
        });

        const doneBtn = document.getElementById('itemDoneBtn');
        if (doneBtn) {
            doneBtn.onclick = async () => {
                await save();
                await handleToggle(item.id, item.done === 1 ? 0 : 1);
                const canonical = state.items.find(entry => Number(entry.id) === Number(item.id));
                if (canonical) {
                    Object.assign(currentItem, canonical);
                    Object.assign(item, canonical);
                }
                doneBtn.classList.toggle('is-active', currentItem.done === 1);
            };
            doneBtn.classList.toggle('is-active', item.done === 1);
        }

        if (itemTitleInput) itemTitleInput.value = item.name || '';
        if (itemDateInput) itemDateInput.value = item.due_date || '';
        if (itemTimeInput) itemTimeInput.value = item.due_time || '';
        if (itemPriorityInput) itemPriorityInput.value = item.priority || '';
        if (itemNoteInput) itemNoteInput.value = item.content || '';
        if (itemCategorySection) itemCategorySection.hidden = true;
        if (itemStatusSection) itemStatusSection.hidden = false;
        if (itemCreateBtn) itemCreateBtn.hidden = true;

        setStatus(currentStatus);

        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        itemTitleInput?.focus();
    }

    async function closeTodoEditor() {
        if (isCreating) {
            hideEditor();
            return;
        }
        try {
            await save();
        } catch {
            // Fehler beim Speichern ignorieren, Editor trotzdem schließen
        }
        hideEditor();
    }

    itemCreateBtn?.addEventListener('click', () => void createTodo());

    return { openTodoCreate, openTodoEditor, closeTodoEditor };
}
