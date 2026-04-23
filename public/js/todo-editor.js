import { api } from './api.js?v=4.2.56';
import { state } from './state.js?v=4.2.56';
import { appEl, todoEditorEl, todoTitleInput, todoDateInput, todoNoteInput } from './ui.js?v=4.2.56';

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

        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }

    function openTodoEditor(item) {
        currentItem = item;
        currentStatus = item.status || '';

        // Register handlers fresh via onclick to avoid stacking
        document.querySelectorAll('#todoStatusSelector .todo-status-btn').forEach(btn => {
            btn.onclick = () => setStatus(btn.dataset.status);
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
