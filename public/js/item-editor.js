import { api } from './api.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { clearDraftSnapshot, wrapDraftForPersistence } from './draft-persistence.js';
import { itemContentSnapshot, itemDraftHasLocalChanges } from './item-content-conflict.js';
import {
    appEl,
    itemBarcodeInput,
    itemCategoryInput,
    itemCategorySection,
    itemCreateBtn,
    itemDateInput,
    itemDueDateSection,
    itemEditorBody,
    itemEditorEl,
    itemNoteInput,
    itemNoteSection,
    itemPriorityInput,
    itemQuantityInput,
    itemQuantitySection,
    itemSaveBtn,
    itemStatusSection,
    itemTimeInput,
    itemTitleInput,
} from './ui.js';

const TYPE_SECTIONS = {
    list_quantity: { quantity: true, dueDate: false, status: false, note: false },
    list_due_date: { quantity: false, dueDate: true, status: true, note: true },
};

function emptyDraft() {
    return {
        itemId: null,
        categoryId: null,
        name: '',
        barcode: '',
        quantity: '',
        due_date: '',
        due_time: '',
        priority: '',
        content: '',
    };
}

export function createItemEditorController(deps) {
    const {
        acceptServerItemContent,
        discardDeletedDraft,
        getItemById,
        getVisibleCategories,
        handleEditSave,
        handleToggle,
        invalidateCategoryCache,
        keepLocalItemContent,
        loadItems,
        refreshOpenJournal,
        renderItems,
        restoreDeletedDraft,
        setMessage,
    } = deps;

    let currentItem = null;
    let currentStatus = '';
    let baseStatus = '';
    let isCreating = false;
    let sourceScreen = 'list';

    function setStatus(status) {
        currentStatus = status;
        document.querySelectorAll('#itemStatusSelector .item-status-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === status);
        });
    }

    function activeDraft() {
        const draft = state.editDraft;
        if (!draft || !currentItem) return null;
        if (Number(draft.itemId) !== Number(currentItem.id)) return null;
        return draft;
    }

    // Der Save-Pfad raeumt den Draft weg, sobald er durch ist — auch verzoegert,
    // wenn ein 409 mit passender Basis intern neu zugestellt wird. Solange der
    // Editor offen bleibt, setzt er dann einen frischen Draft auf die kanonische
    // Fassung auf, statt in den Stale-Zweig zu laufen.
    function ensureDraft() {
        if (!currentItem || isCreating) return null;
        if (!activeDraft() || state.editingId === null) {
            currentItem = getItemById(currentItem.id) || currentItem;
            beginDraft(currentItem);
        }
        return state.editDraft;
    }

    // Der Editor ist nur ein Eingabe-Frontend fuer den Draft; der Save-Pfad
    // (items-actions-update.js) liest ausschliesslich den Draft.
    function syncDraftFromInputs() {
        const draft = ensureDraft();
        if (!draft) return;
        const dueDate = itemDateInput?.value || '';
        const next = {
            name: itemTitleInput?.value.trim() || '',
            barcode: itemBarcodeInput?.value || '',
            quantity: itemQuantityInput?.value || '',
            due_date: dueDate,
            due_time: dueDate ? (itemTimeInput?.value || '') : '',
            priority: itemPriorityInput?.value || '',
            content: itemNoteInput?.value || '',
            status: currentStatus,
        };
        Object.entries(next).forEach(([field, value]) => {
            if (String(draft[field] ?? '') !== value) draft[field] = value;
        });
    }

    function fillInputsFromItem(item) {
        if (itemTitleInput) itemTitleInput.value = item.name || '';
        if (itemQuantityInput) itemQuantityInput.value = item.quantity || '';
        if (itemBarcodeInput) itemBarcodeInput.value = item.barcode || '';
        if (itemDateInput) itemDateInput.value = item.due_date || '';
        if (itemTimeInput) itemTimeInput.value = item.due_time || '';
        if (itemPriorityInput) itemPriorityInput.value = item.priority || '';
        if (itemNoteInput) itemNoteInput.value = item.content || '';
    }

    function applyTypeSections(type) {
        const sections = TYPE_SECTIONS[type] || TYPE_SECTIONS.list_due_date;
        if (itemQuantitySection) itemQuantitySection.hidden = !sections.quantity;
        if (itemDueDateSection) itemDueDateSection.hidden = !sections.dueDate;
        if (itemStatusSection) itemStatusSection.hidden = !sections.status;
        if (itemNoteSection) itemNoteSection.hidden = !sections.note;
    }

    function beginDraft(item) {
        state.editingId = item.id;
        state.editDraft = wrapDraftForPersistence({
            itemId: item.id,
            categoryId: item.category_id ?? null,
            ...itemContentSnapshot(item),
            status: item.status || '',
            baseContent: itemContentSnapshot(item),
            baseRevision: Number(item.revision) || 0,
            baseUpdatedAt: item.updated_at || '',
            requestId: '',
            conflict: null,
        }, item.id, item);
        baseStatus = item.status || '';
    }

    function resetDraftState() {
        state.editingId = null;
        state.editDraft = emptyDraft();
        clearDraftSnapshot();
        baseStatus = '';
    }

    // Status gehoert inhaltlich zum Item, ist aber noch nicht Teil von
    // ITEM_CONTENT_FIELDS (folgt in #3b). Bis dahin haelt der Editor die
    // Status-Aenderung selbst als "ungespeichert" fest.
    function hasUnsavedChanges() {
        const draft = activeDraft();
        if (!draft) return false;
        return itemDraftHasLocalChanges(draft) || String(currentStatus) !== String(baseStatus);
    }

    function clearBanners() {
        itemEditorBody?.querySelectorAll('.item-conflict').forEach(node => node.remove());
    }

    function buildBanner(text, actions) {
        const banner = document.createElement('div');
        banner.className = 'item-conflict';
        const hint = document.createElement('p');
        hint.className = 'item-conflict-hint';
        hint.textContent = text;
        const row = document.createElement('div');
        row.className = 'item-conflict-actions';
        actions.forEach(({ label, className, onClick }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.textContent = label;
            button.addEventListener('click', onClick);
            row.appendChild(button);
        });
        banner.append(hint, row);
        itemEditorBody?.prepend(banner);
    }

    function serverSummary(conflict) {
        const server = conflict?.server || {};
        const parts = [server.name, server.due_date, server.due_time, server.content]
            .map(value => String(value ?? '').trim())
            .filter(Boolean);
        return `${t('ui.content_conflict_server')}: ${parts.join(' · ')}`;
    }

    function renderConflictBanner() {
        clearBanners();
        if (!currentItem || isCreating) return;
        const id = currentItem.id;

        if (currentItem.server_deleted === 1) {
            buildBanner(t('msg.server_delete_detected'), [
                {
                    label: t('ui.accept_deletion'),
                    className: 'btn-clear',
                    onClick: () => {
                        discardDeletedDraft(id);
                        hideEditor();
                    },
                },
                {
                    label: t('ui.restore_as_new'),
                    className: 'btn-add',
                    onClick: async () => {
                        await restoreDeletedDraft(id);
                        hideEditor();
                    },
                },
            ]);
            return;
        }

        const conflict = activeDraft()?.conflict;
        if (!conflict) return;

        buildBanner(`${t('ui.content_conflict_hint')} ${serverSummary(conflict)}`, [
            {
                label: t('ui.accept_server_version'),
                className: 'btn-clear',
                onClick: () => {
                    acceptServerItemContent(id);
                    const canonical = getItemById(id);
                    if (canonical) {
                        currentItem = canonical;
                        fillInputsFromItem(canonical);
                        setStatus(canonical.status || '');
                        beginDraft(canonical);
                    }
                    clearBanners();
                },
            },
            {
                label: t('ui.keep_local_version'),
                className: 'btn-add',
                onClick: async () => {
                    await keepLocalItemContent(id);
                    afterSaveAttempt(id);
                },
            },
        ]);
    }

    function afterSaveAttempt(id) {
        const canonical = getItemById(id);
        if (canonical) currentItem = canonical;
        if (state.editingId === null && currentItem && currentItem.server_deleted !== 1) {
            // Erfolgreich gespeichert: Editor bleibt offen, also frischen
            // Draft auf der kanonischen Server-Fassung aufsetzen.
            beginDraft(currentItem);
            setStatus(currentItem.status || '');
        }
        renderConflictBanner();
    }

    async function saveEdit() {
        if (!currentItem || isCreating) return;
        const id = currentItem.id;
        syncDraftFromInputs();
        await handleEditSave(id);
        afterSaveAttempt(id);
    }

    function hideEditor() {
        currentItem = null;
        currentStatus = '';
        baseStatus = '';
        isCreating = false;
        clearBanners();
        if (itemCreateBtn) {
            itemCreateBtn.hidden = true;
            itemCreateBtn.disabled = false;
        }
        if (itemSaveBtn) {
            itemSaveBtn.hidden = true;
            itemSaveBtn.disabled = false;
        }
        if (itemCategorySection) itemCategorySection.hidden = true;
        if (itemStatusSection) itemStatusSection.hidden = false;
        if (itemEditorEl) itemEditorEl.hidden = true;
        appEl?.classList.remove('item-editor-open');
    }

    async function createItem() {
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
            state.editDraft = emptyDraft();
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

    function openItemCreate({ categoryId = null, dueDate = '' } = {}) {
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
        baseStatus = '';
        clearBanners();

        // Create-Flow hat keine Server-Basis: kein Snapshot, keine Persistenz.
        state.editingId = null;
        state.editDraft = {
            ...emptyDraft(),
            categoryId: Number(selectedCategory.id),
            due_date: dueDate,
            status: '',
            baseContent: {},
            baseRevision: 0,
        };

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
        applyTypeSections('list_due_date');
        if (itemStatusSection) itemStatusSection.hidden = true;
        if (itemSaveBtn) itemSaveBtn.hidden = true;
        if (itemCreateBtn) {
            itemCreateBtn.hidden = false;
            itemCreateBtn.disabled = false;
        }
        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        itemTitleInput?.focus();
    }

    function openItemEdit(item) {
        isCreating = false;
        currentItem = item;
        clearBanners();
        beginDraft(item);

        const showsStatus = item.category_type === 'list_due_date';
        if (showsStatus) {
            // Register handlers fresh via onclick to avoid stacking.
            document.querySelectorAll('#itemStatusSelector .item-status-btn').forEach(btn => {
                if (btn.id === 'itemDoneBtn') return;
                btn.onclick = () => {
                    setStatus(btn.dataset.status || '');
                    syncDraftFromInputs();
                };
            });

            const doneBtn = document.getElementById('itemDoneBtn');
            if (doneBtn) {
                doneBtn.onclick = async () => {
                    const id = currentItem.id;
                    await saveEdit();
                    const canonical = getItemById(id) || currentItem;
                    await handleToggle(id, canonical.done === 1 ? 0 : 1);
                    afterSaveAttempt(id);
                    const updated = getItemById(id);
                    if (updated) Object.assign(item, updated);
                    doneBtn.classList.toggle('is-active', (updated || canonical).done === 1);
                };
                doneBtn.classList.toggle('is-active', item.done === 1);
            }
        }

        fillInputsFromItem(item);
        if (itemCategorySection) itemCategorySection.hidden = true;
        applyTypeSections(item.category_type);
        if (itemCreateBtn) itemCreateBtn.hidden = true;
        if (itemSaveBtn) {
            itemSaveBtn.hidden = false;
            itemSaveBtn.disabled = false;
        }

        setStatus(item.status || '');
        renderConflictBanner();

        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        itemTitleInput?.focus();
    }

    async function closeItemEditor() {
        if (isCreating) {
            // Create-Draft ist reiner Speicherzustand — den persistierten
            // Inline-Entwurf eines anderen Items darf er nicht mitloeschen.
            state.editDraft = emptyDraft();
            hideEditor();
            return;
        }
        if (currentItem) {
            syncDraftFromInputs();
            if (hasUnsavedChanges() && !window.confirm(t('todo.discard_changes'))) return;
            resetDraftState();
            renderItems();
        }
        hideEditor();
    }

    [itemTitleInput, itemDateInput, itemTimeInput, itemPriorityInput, itemNoteInput].forEach(input => {
        input?.addEventListener('input', () => syncDraftFromInputs());
        input?.addEventListener('change', () => syncDraftFromInputs());
    });
    itemCreateBtn?.addEventListener('click', () => void createItem());
    itemSaveBtn?.addEventListener('click', async () => {
        if (!itemSaveBtn.disabled) {
            itemSaveBtn.disabled = true;
            try {
                await saveEdit();
            } finally {
                itemSaveBtn.disabled = false;
            }
        }
    });

    return { openItemCreate, openItemEdit, closeItemEditor };
}
