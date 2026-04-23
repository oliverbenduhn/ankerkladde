import { api } from './api.js?v=4.2.55';
import { state } from './state.js?v=4.2.55';
import { appEl, todoEditorEl, todoTitleInput, todoDateInput, todoNoteInput, todoStatusSelector } from './ui.js?v=4.2.55';

export function createTodoEditorController(deps) {
    const { invalidateCategoryCache, loadItems } = deps;

    let currentItem = null;
    let currentStatus = '';

    function setStatus(status) {
        currentStatus = status;
        todoStatusSelector?.querySelectorAll('.todo-status-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === status);
        });
    }

    todoStatusSelector?.querySelectorAll('.todo-status-btn').forEach(btn => {
        btn.addEventListener('click', () => setStatus(btn.dataset.status));
    });

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

        if (todoTitleInput) todoTitleInput.value = item.name || '';
        if (todoDateInput) todoDateInput.value = item.due_date || '';
        if (todoNoteInput) todoNoteInput.value = item.content || '';

        setStatus(currentStatus);

        if (todoEditorEl) todoEditorEl.hidden = false;
        appEl?.classList.add('todo-editor-open');
        todoTitleInput?.focus();
    }

    async function closeTodoEditor() {
        await save();
        currentItem = null;
        currentStatus = '';
        if (todoEditorEl) todoEditorEl.hidden = true;
        appEl?.classList.remove('todo-editor-open');
    }

    return { openTodoEditor, closeTodoEditor };
}
