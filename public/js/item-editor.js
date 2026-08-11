import { api } from './api.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { clearDraftSnapshot, loadDraftSnapshot, wrapDraftForPersistence } from './draft-persistence.js';
import {
    ITEM_CONTENT_FIELDS,
    itemContentSnapshot,
    itemDraftHasLocalChanges,
    rebaseItemDraft,
} from './item-content-conflict.js';
import { activateModal } from './utils.js';
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
    listEl,
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
    let createBaseline = null;
    let modalSession = null;

    function openEditorModal(label, fallbackFocus) {
        if (!itemEditorEl) return;
        itemEditorEl.setAttribute('aria-label', label);
        modalSession?.deactivate({ restoreFocus: false });
        modalSession = activateModal(itemEditorEl, {
            initialFocus: itemTitleInput,
            onEscape: () => { void closeItemEditor(); },
            additionalBackground: [appEl?.querySelector('#listSwipeStage')],
            fallbackFocus,
        });
    }

    function itemEditorFallback(itemId = null) {
        if (itemId !== null) {
            const card = listEl?.querySelector(`.item-card[data-item-id="${Number(itemId)}"]`);
            const action = card?.querySelector('.btn-item-menu') || card?.querySelector('.item-name-button');
            if (action) return action;
        }
        if (sourceScreen === 'journal') return document.getElementById('agendaAddBtn');
        return document.getElementById('itemInput');
    }

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

    // Nimmt sowohl ein Item als auch einen Draft entgegen — beide tragen die
    // ITEM_CONTENT_FIELDS unter denselben Namen (name, barcode, quantity, ...).
    function fillInputsFromDraft(source) {
        if (itemTitleInput) itemTitleInput.value = source.name || '';
        if (itemQuantityInput) itemQuantityInput.value = source.quantity || '';
        if (itemBarcodeInput) itemBarcodeInput.value = source.barcode || '';
        if (itemDateInput) itemDateInput.value = source.due_date || '';
        if (itemTimeInput) itemTimeInput.value = source.due_time || '';
        if (itemPriorityInput) itemPriorityInput.value = source.priority || '';
        if (itemNoteInput) itemNoteInput.value = source.content || '';
    }

    function ensureDraftBase(draft, item) {
        if (!draft.baseContent || typeof draft.baseContent !== 'object') {
            draft.baseContent = itemContentSnapshot(item);
        }
        if (!Number(draft.baseRevision)) draft.baseRevision = Number(item.revision) || 0;
        if (!('requestId' in draft)) draft.requestId = '';
        if (!('conflict' in draft)) draft.conflict = null;
        if (!('status' in draft)) draft.status = item.status || '';
        return draft;
    }

    function applyTypeSections(type) {
        const sections = TYPE_SECTIONS[type] || TYPE_SECTIONS.list_due_date;
        if (itemQuantitySection) itemQuantitySection.hidden = !sections.quantity;
        if (itemDueDateSection) itemDueDateSection.hidden = !sections.dueDate;
        if (itemStatusSection) itemStatusSection.hidden = !sections.status;
        if (itemNoteSection) itemNoteSection.hidden = !sections.note;
    }

    // Der Editor liegt als Overlay ueber der Liste — die Karte darunter bleibt
    // sichtbar und muss ihr "Lokal geändert"-Badge unabhaengig vom Editor-DOM
    // pflegen, sonst faellt AC #63 (Badge ab erster Eingabe) fuer den
    // Vollbild-Pfad weg.
    function updateCardDirtyBadge(itemId, draft) {
        const content = listEl?.querySelector(`.item-card[data-item-id="${Number(itemId)}"] .item-content`);
        if (!content) return;
        const existing = content.querySelector('.item-sync-badge-dirty');
        if (!itemDraftHasLocalChanges(draft)) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const badge = document.createElement('span');
        badge.className = 'item-sync-badge item-sync-badge-dirty';
        badge.textContent = 'Lokal geändert';
        content.appendChild(badge);
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
        }, item.id, item, changedDraft => updateCardDirtyBadge(item.id, changedDraft));
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
    function isDirty() {
        const draft = activeDraft();
        if (!draft) return false;
        return itemDraftHasLocalChanges(draft) || String(currentStatus) !== String(baseStatus);
    }

    function createInputSnapshot() {
        const dueDate = itemDateInput?.value || '';
        return {
            categoryId: Number(itemCategoryInput?.value) || null,
            name: itemTitleInput?.value.trim() || '',
            barcode: itemBarcodeInput?.value || '',
            quantity: itemQuantityInput?.value || '',
            due_date: dueDate,
            due_time: dueDate ? (itemTimeInput?.value || '') : '',
            priority: itemPriorityInput?.value || '',
            content: itemNoteInput?.value || '',
        };
    }

    function isCreateDirty() {
        if (!isCreating || !createBaseline) return false;
        const current = createInputSnapshot();
        return Object.keys(createBaseline).some(field => String(current[field] ?? '') !== String(createBaseline[field] ?? ''));
    }

    function clearBanners() {
        itemEditorBody?.querySelectorAll('.item-conflict').forEach(node => node.remove());
    }

    function buildBanner(text, actions, extra = null) {
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
        banner.append(hint);
        if (extra) banner.append(extra);
        banner.append(row);
        itemEditorBody?.prepend(banner);
    }

    // Baut die Lokal-/Server-Vorschau fuer den Konflikt-Banner — Testfluss
    // liest die Werte ueber die Klassen "local"/"server" aus dem Banner-DOM.
    function buildConflictVersions(conflict) {
        const container = document.createElement('div');
        container.className = 'item-conflict-versions';
        const buildVersion = (className, source) => {
            const version = document.createElement('div');
            version.className = className;
            ITEM_CONTENT_FIELDS.forEach(field => {
                const value = String(source?.[field] ?? '');
                if (!value) return;
                const row = document.createElement('p');
                row.textContent = value;
                version.appendChild(row);
            });
            return version;
        };
        container.append(buildVersion('local', conflict.local), buildVersion('server', conflict.server));
        return container;
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
                        fillInputsFromDraft(canonical);
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
        ], buildConflictVersions(conflict));
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

    // Wird bei jedem renderItems() aufgerufen: haelt den offenen Editor mit
    // Hintergrund-Aktualisierungen synchron (items.js#refreshVisibleCategory),
    // ohne auf einen Reload zu warten — Server-Loeschung erkennen, und ohne
    // lokale Aenderungen den rebased Draft auch in den Eingabefeldern zeigen.
    function refreshFromState() {
        if (!currentItem || isCreating) return;
        if (Number(state.editingId) !== Number(currentItem.id)) return;
        const live = getItemById(currentItem.id);
        if (live?.server_deleted === 1) {
            currentItem = live;
            renderConflictBanner();
            return;
        }
        if (currentItem.server_deleted === 1) return;
        if (live) currentItem = live;
        if (!itemDraftHasLocalChanges(state.editDraft)) {
            fillInputsFromDraft(state.editDraft);
            setStatus(state.editDraft?.status ?? live?.status ?? '');
        }
        renderConflictBanner();
    }

    function hideEditor() {
        currentItem = null;
        currentStatus = '';
        baseStatus = '';
        isCreating = false;
        createBaseline = null;
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
        modalSession?.deactivate();
        modalSession = null;
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
        const type = getVisibleCategories().find(category => Number(category.id) === categoryId)?.type;
        const dueDate = type === 'list_due_date' ? (itemDateInput?.value || '') : '';
        const body = new URLSearchParams({
            category_id: String(categoryId),
            name,
            barcode: type === 'list_quantity' ? (itemBarcodeInput?.value || '') : '',
            quantity: type === 'list_quantity' ? (itemQuantityInput?.value || '') : '',
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
        const activeCategory = categoryId !== null
            ? getVisibleCategories().find(category => Number(category.id) === Number(categoryId))
            : null;
        const targetType = activeCategory?.type === 'list_quantity' ? 'list_quantity' : 'list_due_date';
        const candidateCategories = getVisibleCategories().filter(category => category.type === targetType);
        if (candidateCategories.length === 0) {
            setMessage(t(targetType === 'list_quantity' ? 'quick_add.no_quantity_category' : 'quick_add.no_due_category'), true);
            return;
        }

        const selectedCategory = candidateCategories.find(category => Number(category.id) === Number(categoryId)) || candidateCategories[0];
        const resolvedDueDate = targetType === 'list_due_date' ? dueDate : '';
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
            due_date: resolvedDueDate,
            status: '',
            baseContent: {},
            baseRevision: 0,
        };

        if (itemCategoryInput) {
            itemCategoryInput.replaceChildren(...candidateCategories.map(category => new Option(category.name, String(category.id))));
            itemCategoryInput.value = String(selectedCategory.id);
        }
        if (itemTitleInput) itemTitleInput.value = '';
        if (itemQuantityInput) itemQuantityInput.value = '';
        if (itemBarcodeInput) itemBarcodeInput.value = '';
        if (itemDateInput) itemDateInput.value = resolvedDueDate;
        if (itemTimeInput) itemTimeInput.value = '';
        if (itemPriorityInput) itemPriorityInput.value = '';
        if (itemNoteInput) itemNoteInput.value = '';
        if (itemCategorySection) itemCategorySection.hidden = false;
        applyTypeSections(targetType);
        if (itemStatusSection) itemStatusSection.hidden = true;
        if (itemSaveBtn) itemSaveBtn.hidden = true;
        if (itemCreateBtn) {
            itemCreateBtn.hidden = false;
            itemCreateBtn.disabled = false;
        }
        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        createBaseline = createInputSnapshot();
        openEditorModal(t('todo.create'), () => itemEditorFallback());
    }

    // Praesentiert den bereits in state.editDraft stehenden Draft im Editor —
    // gemeinsam genutzt von openItemEdit (frischer Draft) und
    // restorePersistedDraft (ueberlebender Draft aus einem frueheren Tab-Leben).
    function showEditorUi(item) {
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
                    const updated = getItemById(id) || canonical;
                    // Nur die Revisions-Basis auf den Toggle nachziehen (kein
                    // afterSaveAttempt hier — das wuerde wegen state.editingId
                    // !== null nichts tun und den Draft mit veralteter
                    // baseRevision zurücklassen, wodurch der naechste Save
                    // faelschlich in einen 409-Rebase liefe).
                    const draft = activeDraft();
                    if (draft && !draft.conflict) rebaseItemDraft(draft, updated);
                    currentItem = updated;
                    Object.assign(item, updated);
                    doneBtn.classList.toggle('is-active', updated.done === 1);
                    renderConflictBanner();
                };
                doneBtn.classList.toggle('is-active', item.done === 1);
            }
        }

        fillInputsFromDraft(state.editDraft || item);
        if (itemCategorySection) itemCategorySection.hidden = true;
        applyTypeSections(item.category_type);
        if (itemCreateBtn) itemCreateBtn.hidden = true;
        if (itemSaveBtn) {
            itemSaveBtn.hidden = false;
            itemSaveBtn.disabled = false;
        }

        setStatus(state.editDraft?.status ?? item.status ?? '');
        renderConflictBanner();

        if (itemEditorEl) itemEditorEl.hidden = false;
        appEl?.classList.add('item-editor-open');
        openEditorModal(item.name || t('ui.edit'), () => itemEditorFallback(item.id));
    }

    function openItemEdit(item) {
        isCreating = false;
        currentItem = item;
        clearBanners();
        beginDraft(item);
        showEditorUi(item);
    }

    // AC #63: ein unbestaetigter Draft fuer Mengen-/Terminlisten-Items ueberlebt
    // Reload/Navigation im selben Tab — der Vollbild-Editor oeffnet sich beim
    // Boot automatisch wieder, statt den Entwurf stillschweigend zu verlieren.
    function restorePersistedDraft() {
        if (state.editingId !== null || currentItem) return false;
        const snapshot = loadDraftSnapshot();
        if (!snapshot) return false;

        const snapshotType = snapshot.item?.category_type;
        if (snapshotType !== 'list_quantity' && snapshotType !== 'list_due_date') return false;

        let item = getItemById(snapshot.editingId);
        if (!item) {
            if (!snapshot.item) {
                clearDraftSnapshot();
                return false;
            }
            item = { ...snapshot.item, server_deleted: 1 };
        }

        isCreating = false;
        currentItem = item;
        clearBanners();
        const draftBase = snapshot.item || item;
        state.editingId = item.id;
        state.editDraft = wrapDraftForPersistence(
            ensureDraftBase(snapshot.draft, draftBase),
            item.id,
            draftBase,
            changedDraft => updateCardDirtyBadge(item.id, changedDraft)
        );
        baseStatus = item.status || '';

        showEditorUi(item);
        return true;
    }

    // Nach einem abgeschlossenen expliziten Save:
    // bei offenem Konflikt bleibt der Editor bewusst offen, damit die
    // Aufloesung (Banner) nicht uebergangen wird — sonst schliessen.
    // Nicht schliessen, solange ein Save nicht wirklich sauber durch ist —
    // itemDraftHasLocalChanges() ist nach einem erfolgreichen Save immer
    // false (afterSaveAttempt setzt einen frischen, unveraenderten Draft
    // auf die kanonische Fassung auf); bei einem fehlgeschlagenen Save
    // (Validierung, Netzwerk) bleiben die lokalen Werte dagegen abweichend
    // stehen, und der Nutzer sieht die Fehlermeldung mit offenem Editor.
    function finishEditorSession() {
        if (currentItem?.server_deleted === 1) return;
        if (activeDraft()?.conflict) return;
        if (itemDraftHasLocalChanges(state.editDraft)) return;
        resetDraftState();
        renderItems();
        hideEditor();
    }

    async function closeItemEditor() {
        if (isCreating) {
            if (isCreateDirty() && !window.confirm(t('todo.discard_confirm'))) return;
            // Create-Draft ist reiner Speicherzustand — den persistierten
            // Inline-Entwurf eines anderen Items darf er nicht mitloeschen.
            state.editDraft = emptyDraft();
            hideEditor();
            return;
        }
        if (currentItem) {
            syncDraftFromInputs();
            if (currentItem.server_deleted === 1 || activeDraft()?.conflict) {
                renderConflictBanner();
                return;
            }
            if (isDirty()) {
                if (!window.confirm(t('todo.discard_confirm'))) return;
                resetDraftState();
                renderItems();
                hideEditor();
                return;
            }
            finishEditorSession();
            return;
        }
        hideEditor();
    }

    [itemTitleInput, itemBarcodeInput, itemQuantityInput, itemDateInput, itemTimeInput, itemPriorityInput, itemNoteInput].forEach(input => {
        input?.addEventListener('input', () => syncDraftFromInputs());
        input?.addEventListener('change', () => syncDraftFromInputs());
    });
    itemCreateBtn?.addEventListener('click', () => void createItem());
    itemSaveBtn?.addEventListener('click', async () => {
        if (!itemSaveBtn.disabled) {
            itemSaveBtn.disabled = true;
            try {
                await saveEdit();
                finishEditorSession();
            } finally {
                itemSaveBtn.disabled = false;
            }
        }
    });

    return { openItemCreate, openItemEdit, closeItemEditor, restorePersistedDraft, refreshFromState };
}
