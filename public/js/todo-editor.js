import { api } from './api.js?v=4.2.52';
import { state } from './state.js?v=4.2.52';
import { appEl, todoEditorEl, todoTitleInput, todoDateInput, todoNoteInput, todoStatusSelector } from './ui.js?v=4.2.52';

export function createTodoEditorController(deps) {
    const { invalidateCategoryCache, loadItems } = deps;

    let currentItem = null;

    todoStatusSelector?.querySelectorAll('.todo-status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            todoStatusSelector.querySelectorAll('.todo-status-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
        });
    });

    function getActiveStatus() {
        return todoStatusSelector?.querySelector('.todo-status-btn.is-active')?.dataset.status ?? '';
    }

    async function save() {
        if (!currentItem) return;

        const name = todoTitleInput?.value.trim() || currentItem.name;
        const dueDate = todoDateInput?.value || '';
        const content = todoNoteInput?.value || '';
        const newStatus = getActiveStatus();

        const body = new URLSearchParams({
            id: String(currentItem.id),
            name,
            barcode: '',
            quantity: '',
            due_date: dueDate,
            content,
        });
        await api('update', { method: 'POST', body });

        if (newStatus !== (currentItem.status || '')) {
            await api('status', { method: 'POST', body: new URLSearchParams({ id: String(currentItem.id), status: newStatus }) });
        }

        invalidateCategoryCache(state.categoryId);
        await loadItems();
    }

    function openTodoEditor(item) {
        currentItem = item;

        if (todoTitleInput) todoTitleInput.value = item.name || '';
        if (todoDateInput) todoDateInput.value = item.due_date || '';
        if (todoNoteInput) todoNoteInput.value = item.content || '';

        todoStatusSelector?.querySelectorAll('.todo-status-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === (item.status || ''));
        });

        if (todoEditorEl) todoEditorEl.hidden = false;
        appEl?.classList.add('todo-editor-open');
        todoTitleInput?.focus();
    }

    async function closeTodoEditor() {
        await save();
        currentItem = null;
        if (todoEditorEl) todoEditorEl.hidden = true;
        appEl?.classList.remove('todo-editor-open');
    }

    return { openTodoEditor, closeTodoEditor };
}
