import { api } from './api.js?v=4.2.59';
import { state } from './state.js?v=4.2.59';
import { appEl, todoEditorEl, todoTitleInput, todoDateInput, todoNoteInput } from './ui.js?v=4.2.59';

export function createTodoEditorController(deps) {
    const { invalidateCategoryCache, loadItems } = deps;

    let currentItem = null;
    let currentStatus = '';

    function setStatus(status) {
        currentStatus = status;
        document.querySelectorAll('#todoStatusSelector .todo-status-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === status);
        });
    }

    async function save() {
        if (!currentItem) return;

        const name = todoTitleInput?.value.trim() || currentItem.name;
        const dueDate = todoDateInput?.value || '';
        const content = todoNoteInput?.value || '';

        const body = new URLSearchParams({
            id: String(currentItem.id),
            name,
            barcode: '',
            quantity: '',
            due_date: dueDate,
            content,
            status: currentStatus,
        });
        await api('update', { method: 'POST', body });

        currentItem = {
            ...currentItem,
            name,
            due_date: dueDate,
            content,
            status: currentStatus,
        };
        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }

    function openTodoEditor(item) {
        currentItem = item;
        currentStatus = item.status || '';

        // Register handlers fresh via onclick to avoid stacking.
        document.querySelectorAll('#todoStatusSelector .todo-status-btn').forEach(btn => {
            btn.onclick = async () => {
                const nextStatus = btn.dataset.status;
                if (nextStatus === currentStatus) {
                    return;
                }

                setStatus(nextStatus);
                await save();
            };
        });

        if (todoTitleInput) todoTitleInput.value = item.name || '';
        if (todoDateInput) todoDateInput.value = item.due_date || '';
        if (todoNoteInput) todoNoteInput.value = item.content || '';

        setStatus(currentStatus);

        if (todoEditorEl) todoEditorEl.hidden = false;
        appEl?.classList.add('todo-editor-open');
        todoTitleInput?.focus();
    }

    async function closeTodoEditor() {
        try {
            await save();
        } catch {
            // Fehler beim Speichern ignorieren, Editor trotzdem schließen
        }
        currentItem = null;
        currentStatus = '';
        if (todoEditorEl) todoEditorEl.hidden = true;
        appEl?.classList.remove('todo-editor-open');
    }

    return { openTodoEditor, closeTodoEditor };
}
