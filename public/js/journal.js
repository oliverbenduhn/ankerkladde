import { api, normalizeItem } from './api.js';
import { buildAgendaItem, loadAgenda } from './today-view.js';
import { buildNoteConflictVersion } from './conflict-ui.js';
import { NOTE_SAVE_DEBOUNCE_MS, readLocalPrefs, saveLocalPrefs, state } from './state.js';
import {
    agendaAddBtn,
    appEl,
    itemInput,
    journalAgendaBody,
    journalAgendaCollapseBtn,
    journalBackBtn,
    journalAnytimeList,
    journalDateHeading,
    journalDatePicker,
    journalDatePickerBtn,
    journalEditorBody,
    journalFormatBtn,
    journalNextBtn,
    journalPreviousBtn,
    journalSaveStatus,
    journalScheduledList,
    journalSketchCard,
    journalSketchOpenBtn,
    journalSketchPreviewBtn,
    journalSketchStatus,
    journalTodayBtn,
    journalToolbar,
} from './ui.js';
import { sanitizeItemField } from './utils.js';
import { t } from './i18n.js';
import { clearJournalDraft, loadJournalDraft, saveJournalDraft } from './journal-draft-persistence.js';

// ponytail: Parchment-Original zeigt im collapsed mode die nächsten 2 timed
// Items; wenn keine timed Items mehr offen sind, rückt die any-time-Liste nach.
// Hardcoded 2 — Original-Wert; PATCH wenn Parchment-Doku eine andere Zahl nennt.
const COLLAPSED_SCHEDULED_LIMIT = 2;

let sketchEditorModulePromise = null;
function loadSketchEditor() {
    if (!sketchEditorModulePromise) {
        sketchEditorModulePromise = import('./sketch-editor.js');
    }
    return sketchEditorModulePromise;
}

// Opens the daily-sketch editor and resolves once the user dismisses the
// overlay (the editor removes .sketch-editor-overlay from the DOM on close).
async function openDailySketchEditor(date) {
    const { openSketchEditorDaily } = await loadSketchEditor();
    await openSketchEditorDaily(date);
}

function serverDateIso(isoDate) {
    if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        return state.serverToday || '';
    }
    return isoDate;
}

function shiftDate(isoDate, days) {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateHeading(isoDate) {
    const locale = document.documentElement.lang === 'en' ? 'en-US' : 'de-DE';
    const options = {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
    };
    return new Intl.DateTimeFormat(locale, options).format(new Date(`${isoDate}T12:00:00`));
}

export function createJournalController(deps) {
    const {
        navigation,
        openSourceItem,
        renderCategoryTabs,
        setMessage,
        updateHeaders,
    } = deps;
    let toggleHandler = async () => { throw new Error('journal toggle handler not yet wired'); };
    function setToggleHandler(handler) {
        toggleHandler = handler;
    }
    let editor = null;
    let saveTimer = null;
    let dirty = false;
    let currentItem = null;
    let pendingSave = Promise.resolve();
    let journalDraft = null;
    let conflictElement = null;
    let applyingContent = false;
    let editorGeneration = 0;
    let returnCategoryId = null;
    let lastAgendaItems = [];
    let agendaCollapsed = Boolean(readLocalPrefs().agenda_collapsed);
    // ponytail: data-collapsed synchron beim Boot setzen, damit der erste
    // Frame den persistierten Wert zeigt. Ohne diesen Schritt rendert
    // index.php ohne Attribut, das CSS schaltet dadurch den Default-
    // Spalten-Layout an, und renderAgenda() korrigiert erst nach dem
    // Agenda-API-Call. Mobile flackert sichtbar.
    if (journalAgendaBody) {
        journalAgendaBody.dataset.collapsed = agendaCollapsed ? 'true' : 'false';
    }
    if (journalAgendaCollapseBtn) {
        journalAgendaCollapseBtn.setAttribute('aria-expanded', agendaCollapsed ? 'false' : 'true');
    }

    function waitForTipTap() {
        return new Promise(resolve => {
            if (window.TipTap) {
                resolve(window.TipTap);
                return;
            }
            window.addEventListener('tiptap-ready', () => resolve(window.TipTap), { once: true });
        });
    }

    function setSaveStatus(text) {
        if (journalSaveStatus) journalSaveStatus.textContent = text;
    }

    function setToolbarOpen(open) {
        if (journalToolbar) journalToolbar.hidden = !open;
        if (journalFormatBtn) journalFormatBtn.setAttribute('aria-expanded', String(open));
    }

    function updateToolbar() {
        if (!editor || !journalToolbar) return;
        journalToolbar.querySelectorAll('button[data-cmd]').forEach(button => {
            const command = button.dataset.cmd;
            const level = button.dataset.level ? Number(button.dataset.level) : undefined;
            const active = command === 'heading' && level
                ? editor.isActive('heading', { level })
                : !['undo', 'redo'].includes(command) && editor.isActive(command);
            button.classList.toggle('is-active', active);
        });
    }

    function createJournalDraft(date, item) {
        return {
            date,
            itemId: Number(item?.id) || null,
            baseRevision: Number(item?.revision) || 0,
            baseContent: item?.content || '',
            baseUpdatedAt: item?.updated_at || '',
            content: item?.content || '',
            dirty: false,
            requestId: '',
            conflict: null,
        };
    }

    function captureJournalDraft(markDirty = true) {
        if (!journalDraft || !editor) return;
        journalDraft.content = sanitizeItemField('content', editor.getHTML());
        if (markDirty) {
            journalDraft.dirty = true;
            dirty = true;
        }
        saveJournalDraft(journalDraft);
    }

    function setJournalEditorContent(content) {
        if (!editor) return;
        applyingContent = true;
        editor.commands.setContent(content || '', false);
        applyingContent = false;
    }

    function ensureJournalConflictElement() {
        if (conflictElement || !journalEditorBody) return conflictElement;
        conflictElement = document.createElement('section');
        conflictElement.className = 'journal-text-conflict';
        conflictElement.hidden = true;
        journalEditorBody.closest('.journal-note-card')?.appendChild(conflictElement);
        return conflictElement;
    }

    function renderJournalConflict() {
        const element = ensureJournalConflictElement();
        if (!element) return;
        const conflict = journalDraft?.conflict;
        element.replaceChildren();
        element.hidden = !conflict;
        if (journalEditorBody) journalEditorBody.hidden = Boolean(conflict);
        if (journalToolbar) journalToolbar.hidden = true;
        if (journalFormatBtn) journalFormatBtn.disabled = Boolean(conflict);
        if (!conflict) return;
        const intro = document.createElement('p');
        intro.className = 'note-conflict-intro';
        intro.textContent = 'Der Text dieser Tagesnotiz wurde parallel geändert.';
        const versions = document.createElement('div');
        versions.className = 'note-conflict-versions';
        versions.append(
            buildNoteConflictVersion({
                className: 'journal-conflict-version-local',
                label: 'Meine Fassung',
                version: conflict.local,
                actionLabel: 'Meine behalten',
                onAction: resolveJournalWithLocal,
                headingTag: 'h4',
            }),
            buildNoteConflictVersion({
                className: 'journal-conflict-version-server',
                label: 'Server-Version',
                version: conflict.server,
                actionLabel: 'Server-Version übernehmen',
                onAction: acceptJournalServer,
                headingTag: 'h4',
            })
        );
        element.append(intro, versions);
    }

    function acceptJournalSave(item, sentContent) {
        if (!journalDraft) return;
        currentItem = item || currentItem;
        state.journalItemId = Number(item?.id) || null;
        journalDraft.itemId = state.journalItemId;
        journalDraft.baseRevision = Number(item?.revision) || journalDraft.baseRevision;
        journalDraft.baseContent = item?.content ?? sentContent;
        journalDraft.baseUpdatedAt = item?.updated_at || '';
        journalDraft.requestId = '';
        journalDraft.conflict = null;
        const currentContent = editor ? sanitizeItemField('content', editor.getHTML()) : sentContent;
        journalDraft.content = currentContent;
        journalDraft.dirty = currentContent !== sentContent;
        dirty = journalDraft.dirty;
        if (dirty) saveJournalDraft(journalDraft);
        else clearJournalDraft(journalDraft.date);
        renderJournalConflict();
        setSaveStatus(t('journal.saved'));
        renderSketchCard();
    }

    async function saveCurrentContent() {
        if (!dirty || !editor || !state.journalDate || journalDraft?.conflict) return;
        captureJournalDraft(false);
        const date = state.journalDate;
        const html = journalDraft?.content || '';
        const expectedRevision = Number(journalDraft?.baseRevision) || 0;
        dirty = false;
        if (journalDraft) journalDraft.dirty = false;
        setSaveStatus('...');

        pendingSave = pendingSave.catch(() => {}).then(async () => {
            try {
                const payload = await api('journal_save', {
                    method: 'POST',
                    body: new URLSearchParams({
                        date,
                        content: html,
                        base_content: journalDraft?.baseContent || '',
                        expected_revision: String(expectedRevision),
                    }),
                    ...(journalDraft?.requestId ? { idempotencyKey: journalDraft.requestId } : {}),
                });
                if (state.journalDate === date) acceptJournalSave(payload.item, html);
            } catch (error) {
                if (state.journalDate !== date || !journalDraft) throw error;
                journalDraft.requestId = error.idempotencyKey || journalDraft.requestId || '';
                const server = error?.payload?.item;
                if (Number(error?.status) === 409 && server) {
                    currentItem = server;
                    state.journalItemId = Number(server.id) || null;
                    if ((server.content || '') === html) {
                        acceptJournalSave(server, html);
                        return;
                    }
                    if ((server.content || '') === journalDraft.baseContent) {
                        journalDraft.baseRevision = Number(server.revision);
                        journalDraft.baseUpdatedAt = server.updated_at || '';
                        journalDraft.dirty = true;
                        dirty = true;
                        saveJournalDraft(journalDraft);
                        window.setTimeout(() => void saveCurrentContent(), 0);
                        return;
                    }
                    journalDraft.requestId = '';
                    journalDraft.dirty = true;
                    dirty = true;
                    journalDraft.conflict = {
                        local: { content: html, updatedAt: new Date().toISOString() },
                        server: {
                            content: server.content || '',
                            updatedAt: server.updated_at || '',
                            revision: Number(server.revision),
                            item: server,
                        },
                    };
                    saveJournalDraft(journalDraft);
                    setSaveStatus('Konflikt');
                    renderJournalConflict();
                    return;
                }
                journalDraft.dirty = true;
                dirty = true;
                saveJournalDraft(journalDraft);
                setSaveStatus(error?.isNetworkError ? 'Offline vorgemerkt' : t('journal.save_error'));
                throw error;
            }
        });

        await pendingSave;
    }

    function scheduleSave() {
        if (journalDraft?.conflict || applyingContent) return;
        captureJournalDraft(true);
        clearTimeout(saveTimer);
        setSaveStatus('...');
        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            void saveCurrentContent().catch(error => {
                console.error('[Journal] Save failed:', error);
            });
        }, NOTE_SAVE_DEBOUNCE_MS);
    }

    async function resolveJournalWithLocal() {
        const conflict = journalDraft?.conflict;
        if (!journalDraft || !conflict) return;
        try {
            const payload = await api('journal_save', {
                method: 'POST',
                body: new URLSearchParams({
                    date: journalDraft.date,
                    content: conflict.local.content,
                    base_content: conflict.server.content,
                    expected_revision: String(conflict.server.revision),
                }),
                ...(journalDraft.requestId ? { idempotencyKey: journalDraft.requestId } : {}),
            });
            setJournalEditorContent(conflict.local.content);
            journalDraft.content = conflict.local.content;
            acceptJournalSave(payload.item, conflict.local.content);
        } catch (error) {
            journalDraft.requestId = error.idempotencyKey || journalDraft.requestId || '';
            if (Number(error?.status) === 409 && error.payload?.item) {
                const server = error.payload.item;
                currentItem = server;
                journalDraft.conflict.server = {
                    content: server.content || '',
                    updatedAt: server.updated_at || '',
                    revision: Number(server.revision),
                    item: server,
                };
            }
            saveJournalDraft(journalDraft);
            setSaveStatus(error?.isNetworkError ? 'Offline vorgemerkt' : t('journal.save_error'));
            renderJournalConflict();
        }
    }

    function acceptJournalServer() {
        const conflict = journalDraft?.conflict;
        if (!journalDraft || !conflict) return;
        currentItem = conflict.server.item;
        state.journalItemId = Number(currentItem?.id) || null;
        setJournalEditorContent(conflict.server.content);
        journalDraft = createJournalDraft(journalDraft.date, currentItem);
        dirty = false;
        clearJournalDraft(journalDraft.date);
        renderJournalConflict();
        setSaveStatus(t('journal.saved'));
        renderSketchCard();
    }

    async function flushCurrentContent() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (dirty) {
            await saveCurrentContent();
        }
        await pendingSave;
    }

    async function destroyEditor({ flush = true } = {}) {
        if (flush) {
            await flushCurrentContent();
        } else {
            clearTimeout(saveTimer);
            saveTimer = null;
            await pendingSave.catch(() => {});
        }
        if (editor) {
            editor.destroy();
            editor = null;
        }
        if (journalEditorBody) journalEditorBody.replaceChildren();
        dirty = false;
        journalDraft = null;
        currentItem = null;
        state.journalItemId = null;
        setToolbarOpen(false);
        if (conflictElement) conflictElement.hidden = true;
        if (journalEditorBody) journalEditorBody.hidden = false;
        if (journalFormatBtn) journalFormatBtn.disabled = false;
    }

    function updateDateUi(date) {
        // Map the three absolute day segments relative to the server's date.
        const today = serverDateIso(state.serverToday);
        if (journalDatePicker) journalDatePicker.value = date;
        if (journalDateHeading) journalDateHeading.textContent = formatDateHeading(date);
        const targets = new Map([
            [journalPreviousBtn, today ? shiftDate(today, -1) : ''],
            [journalTodayBtn, today],
            [journalNextBtn, today ? shiftDate(today, 1) : ''],
        ]);
        targets.forEach((target, button) => button?.setAttribute('aria-pressed', String(target !== '' && date === target)));
    }

    function renderAgenda(items) {
        lastAgendaItems = items;
        const anytime = document.createDocumentFragment();
        const scheduled = document.createDocumentFragment();
        const buildWithHandlers = (sourceItem, handlerToggle, handlerOpen) => {
            const node = buildAgendaItem(sourceItem, handlerOpen);
            const checkbox = node.querySelector('.agenda-item-checkbox');
            const body = node.querySelector('.agenda-item-body');
            if (checkbox) {
                checkbox.addEventListener('click', event => {
                    event.stopPropagation();
                    void handlerToggle(sourceItem);
                });
            }
            if (body) {
                body.addEventListener('click', () => handlerOpen(sourceItem));
            }
            return node;
        };
        const onToggle = (item, entry) => {
            void toggleHandler(item.id, true, item).then(() => {
                entry.classList.add('is-done');
                // ponytail: nach toggle neu laden, damit die Any-Time-Spalte
                // auftaucht, sobald keine scheduled Items mehr offen sind.
                void reloadAgenda();
            }).catch(error => {
                setMessage(error instanceof Error ? error.message : t('agenda.toggle_failed'), true);
            });
        };
        const onOpen = item => {
            void flushCurrentContent()
                .then(() => openSourceItem(item.category_id, item.id))
                .catch(error => {
                    setMessage(error instanceof Error ? error.message : t('agenda.open_failed'), true);
                });
        };
        const scheduledItems = items.filter(item => item.agenda_group === 'scheduled');
        const anytimeItems = items.filter(item => item.agenda_group !== 'scheduled');
        // ponytail: collapsed = max N pro Gruppe. Parchment: scheduled zeigt die
        // nächsten 2 timed, anytime rückt erst nach wenn scheduled leer ist und
        // wird ebenfalls auf 2 begrenzt, sonst scrollt die Spalte.
        const visibleScheduled = agendaCollapsed
            ? scheduledItems.slice(0, COLLAPSED_SCHEDULED_LIMIT)
            : scheduledItems;
        const anytimeSuppressed = agendaCollapsed && visibleScheduled.length > 0 && anytimeItems.length > 0;
        const visibleAnytime = agendaCollapsed
            ? anytimeItems.slice(0, COLLAPSED_SCHEDULED_LIMIT)
            : anytimeItems;
        items.forEach(item => {
            const isScheduled = item.agenda_group === 'scheduled';
            if (isScheduled) {
                if (agendaCollapsed && !visibleScheduled.includes(item)) return;
            } else if (agendaCollapsed && !visibleAnytime.includes(item)) {
                return;
            }
            const node = buildWithHandlers(item, () => onToggle(item, node), () => onOpen(item));
            (isScheduled ? scheduled : anytime).appendChild(node);
        });
        journalAnytimeList?.replaceChildren(anytime);
        journalScheduledList?.replaceChildren(scheduled);
        if (journalAgendaBody) {
            journalAgendaBody.dataset.collapsed = agendaCollapsed ? 'true' : 'false';
        }
        const anytimeColumn = journalAnytimeList?.closest('.journal-agenda-column');
        if (anytimeColumn) {
            anytimeColumn.dataset.suppressed = anytimeSuppressed ? 'true' : 'false';
        }
        if (journalAgendaCollapseBtn) {
            journalAgendaCollapseBtn.textContent = agendaCollapsed ? t('agenda.expand') : t('agenda.collapse');
            journalAgendaCollapseBtn.setAttribute('aria-expanded', agendaCollapsed ? 'false' : 'true');
            journalAgendaCollapseBtn.hidden = items.length === 0;
        }
    }

    async function renderSketchCard() {
        if (!journalSketchCard) return;
        const date = state.journalDate;
        if (!date) {
            journalSketchCard.hidden = true;
            return;
        }
        const hasSketch = Number(currentItem?.has_sketch) === 1;
        journalSketchCard.hidden = !hasSketch;
        if (journalSketchOpenBtn) {
            journalSketchOpenBtn.setAttribute('aria-label', t(hasSketch ? 'journal.sketch.open' : 'journal.sketch.add'));
            journalSketchOpenBtn.disabled = false;
        }
        if (journalSketchStatus) {
            journalSketchStatus.textContent = '';
        }
    }

    async function openDay(date = null, { focus = false } = {}) {
        const requestedDate = date === null || date === 'today'
            ? (state.serverToday || 'today')
            : date;
        const resolvedDate = requestedDate === 'today' ? null : requestedDate;
        if (state.screen !== 'journal') {
            const currentCategory = state.categories.find(category => Number(category.id) === Number(state.categoryId));
            if (currentCategory?.type !== 'daily_notes') {
                returnCategoryId = Number(currentCategory?.id) || null;
            }
        }
        if (resolvedDate !== null && resolvedDate === state.journalDate && editor) {
            if (focus) editor.chain().focus().run();
            return;
        }
        await flushCurrentContent();
        const url = resolvedDate
            ? `journal&date=${encodeURIComponent(resolvedDate)}`
            : 'journal';
        const [payload, agendaPayload] = await Promise.all([
            api(url),
            loadAgenda(resolvedDate || undefined),
        ]);
        await destroyEditor({ flush: false });
        if (typeof payload.today === 'string' && payload.today !== '') {
            state.serverToday = payload.today;
        }
        state.screen = 'journal';
        state.journalDate = payload.date;
        state.journalItemId = Number(payload.item?.id) || null;
        state.categoryId = Number(payload.category.id);
        currentItem = payload.item || null;
        journalDraft = loadJournalDraft(payload.date) || createJournalDraft(payload.date, currentItem);
        dirty = journalDraft.dirty === true;
        updateDateUi(payload.date);
        renderAgenda(Array.isArray(agendaPayload.items) ? agendaPayload.items : []);
        renderCategoryTabs();
        updateHeaders();

        const { Editor, StarterKit, Link } = await waitForTipTap();
        if (state.screen !== 'journal' || state.journalDate !== payload.date) return;
        if (journalEditorBody) journalEditorBody.replaceChildren();
        editorGeneration += 1;
        if (journalEditorBody) journalEditorBody.dataset.editorGeneration = String(editorGeneration);
        editor = new Editor({
            element: journalEditorBody,
            extensions: [StarterKit, Link.configure({ openOnClick: false })],
            content: journalDraft.content || '',
            editorProps: { attributes: { 'aria-label': t('journal.note_title') } },
            onUpdate: () => {
                updateToolbar();
                if (!applyingContent) scheduleSave();
            },
            onSelectionUpdate: updateToolbar,
        });
        updateToolbar();
        renderJournalConflict();
        setSaveStatus(journalDraft.conflict ? 'Konflikt' : (journalDraft.dirty ? 'Lokal geändert' : ''));
        if (journalDraft.dirty && !journalDraft.conflict) scheduleSave();
        if (focus) {
            window.requestAnimationFrame(() => {
                if (state.screen === 'journal' && editor) editor.chain().focus().run();
            });
        }
        renderSketchCard();
    }

    async function reloadAgenda() {
        if (state.screen !== 'journal' || !state.journalDate) return;
        try {
            const agenda = await loadAgenda(state.journalDate);
            renderAgenda(Array.isArray(agenda.items) ? agenda.items : []);
        } catch (error) {
            // Keep current agenda visible on transient failures.
            console.warn('[Journal] Agenda refresh failed:', error);
        }
    }

    async function refreshCurrentDay() {
        const date = state.journalDate;
        if (state.screen !== 'journal' || !date || !journalDraft) return false;
        try {
            const [payload, agenda] = await Promise.all([
                api(`journal&date=${encodeURIComponent(date)}`),
                loadAgenda(date),
            ]);
            if (state.screen !== 'journal' || state.journalDate !== date) return false;
            renderAgenda(Array.isArray(agenda.items) ? agenda.items : []);
            captureJournalDraft(false);

            const server = payload.item || null;
            currentItem = server;
            state.journalItemId = Number(server?.id) || null;
            const serverContent = server?.content || '';
            const serverRevision = Number(server?.revision) || 0;

            if (journalDraft.conflict) {
                journalDraft.conflict.server = {
                    content: serverContent,
                    updatedAt: server?.updated_at || '',
                    revision: serverRevision,
                    item: server,
                };
            } else if (!journalDraft.dirty) {
                journalDraft = createJournalDraft(date, server);
                dirty = false;
                setJournalEditorContent(serverContent);
                clearJournalDraft(date);
                setSaveStatus('');
            } else if (server && serverContent === journalDraft.content) {
                acceptJournalSave(server, journalDraft.content);
            } else if (serverContent === journalDraft.baseContent) {
                journalDraft.baseRevision = serverRevision;
                journalDraft.baseUpdatedAt = server?.updated_at || '';
                saveJournalDraft(journalDraft);
            } else {
                journalDraft.conflict = {
                    local: {
                        content: journalDraft.content,
                        updatedAt: new Date().toISOString(),
                    },
                    server: {
                        content: serverContent,
                        updatedAt: server?.updated_at || '',
                        revision: serverRevision,
                        item: server,
                    },
                };
                saveJournalDraft(journalDraft);
                setSaveStatus('Konflikt');
            }
            renderJournalConflict();
            renderSketchCard();
            return true;
        } catch {
            return false;
        }
    }

    async function navigateTo(date) {
        if (!date || date === state.journalDate) return;
        await openDay(date);
        navigation.replaceCurrentHistoryState({ screen: 'journal', date });
    }

    async function closeJournal() {
        const targetCategoryId = returnCategoryId;
        await destroyEditor();
        state.journalDate = null;
        state.journalItemId = null;
        if (targetCategoryId !== null) {
            state.categoryId = targetCategoryId;
        }
        returnCategoryId = null;
    }

    function handleToolbarClick(event) {
        const button = event.target.closest('button[data-cmd]');
        if (!button || !editor || journalDraft?.conflict) return;
        const command = button.dataset.cmd;
        const level = button.dataset.level ? Number(button.dataset.level) : undefined;
        const chain = editor.chain().focus();
        switch (command) {
            case 'heading': chain.toggleHeading({ level }).run(); break;
            case 'bold': chain.toggleBold().run(); break;
            case 'italic': chain.toggleItalic().run(); break;
            case 'strike': chain.toggleStrike().run(); break;
            case 'bulletList': chain.toggleBulletList().run(); break;
            case 'orderedList': chain.toggleOrderedList().run(); break;
            case 'blockquote': chain.toggleBlockquote().run(); break;
            case 'codeBlock': chain.toggleCodeBlock().run(); break;
            case 'undo': chain.undo().run(); break;
            case 'redo': chain.redo().run(); break;
            case 'link': {
                const previous = editor.isActive('link') ? editor.getAttributes('link').href : '';
                const url = window.prompt('URL:', previous);
                if (url === null) break;
                if (url === '') chain.unsetLink().run();
                else chain.setLink({ href: url }).run();
                break;
            }
        }
        updateToolbar();
    }

    journalBackBtn?.addEventListener('click', () => navigation.navigateBackOrReplace({ screen: 'list', categoryId: returnCategoryId }));
    journalPreviousBtn?.addEventListener('click', () => void navigateTo(shiftDate(state.serverToday || state.journalDate || '', -1)).catch(error => setMessage(error.message, true)));
    journalTodayBtn?.addEventListener('click', () => void navigateTo(state.serverToday || 'today').catch(error => setMessage(error.message, true)));
    journalNextBtn?.addEventListener('click', () => void navigateTo(shiftDate(state.serverToday || state.journalDate || '', 1)).catch(error => setMessage(error.message, true)));
    journalDatePicker?.addEventListener('change', event => void navigateTo(event.target.value).catch(error => setMessage(error.message, true)));
    journalDatePickerBtn?.addEventListener('click', () => {
        if (typeof journalDatePicker?.showPicker === 'function') journalDatePicker.showPicker();
        else journalDatePicker?.focus();
    });
    agendaAddBtn?.addEventListener('click', () => {
        appEl?.classList.toggle('quick-add-open');
        if (appEl?.classList.contains('quick-add-open')) itemInput?.focus();
    });
    journalFormatBtn?.addEventListener('click', () => setToolbarOpen(journalToolbar?.hidden !== false));
    journalToolbar?.addEventListener('click', handleToolbarClick);
    journalAgendaCollapseBtn?.addEventListener('click', () => {
        agendaCollapsed = !agendaCollapsed;
        saveLocalPrefs({ agenda_collapsed: agendaCollapsed });
        renderAgenda(lastAgendaItems);
    });
    const handleSketchOpen = () => {
        if (journalSketchOpenBtn?.disabled || journalSketchPreviewBtn?.disabled) return;
        const date = state.journalDate;
        if (!date) return;
        journalSketchOpenBtn.disabled = true;
        if (journalSketchPreviewBtn) journalSketchPreviewBtn.disabled = true;
        if (journalSketchStatus) {
            journalSketchStatus.textContent = t('journal.sketch.loading');
        }
        void openDailySketchEditor(date)
            .then(async () => {
                if (state.screen !== 'journal' || state.journalDate !== date) return;
                // Re-fetch the day so `has_sketch`/`journalItemId` reflect the
                // final server state without forcing a full editor re-init.
                try {
                    const payload = await api(
                        `journal&date=${encodeURIComponent(date)}`
                    );
                    currentItem = payload.item || null;
                    state.journalItemId = Number(payload.item?.id) || null;
                    renderSketchCard();
                } catch (error) {
                    setMessage(error instanceof Error ? error.message : t('agenda.open_failed'), true);
                }
            })
            .catch(error => {
                setMessage(error instanceof Error ? error.message : t('agenda.open_failed'), true);
            })
            .finally(() => {
                if (journalSketchOpenBtn) journalSketchOpenBtn.disabled = false;
                if (journalSketchPreviewBtn) journalSketchPreviewBtn.disabled = false;
            });
    };
    journalSketchOpenBtn?.addEventListener('click', handleSketchOpen);
    journalSketchPreviewBtn?.addEventListener('click', handleSketchOpen);
    window.addEventListener('online', () => {
        if (dirty && !journalDraft?.conflict) void saveCurrentContent();
    });

    return { closeJournal, openDay, refreshCurrentDay, reloadAgenda, setToggleHandler };
}
