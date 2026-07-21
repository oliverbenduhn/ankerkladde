import { api, normalizeItem } from './api.js?v=5.1.28';
import { buildAgendaItem, loadAgenda } from './today-view.js?v=5.1.28';
import { NOTE_SAVE_DEBOUNCE_MS, state } from './state.js?v=5.1.28';
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
} from './ui.js?v=5.1.28';
import { sanitizeItemField } from './utils.js?v=5.1.28';
import { t } from './i18n.js?v=5.1.28';

// ponytail: Parchment-Original zeigt im collapsed mode die nächsten 2 timed
// Items; wenn keine timed Items mehr offen sind, rückt die any-time-Liste nach.
// Hardcoded 2 — Original-Wert; PATCH wenn Parchment-Doku eine andere Zahl nennt.
const COLLAPSED_SCHEDULED_LIMIT = 2;

let sketchEditorModulePromise = null;
function loadSketchEditor() {
    if (!sketchEditorModulePromise) {
        sketchEditorModulePromise = import('./sketch-editor.js?v=5.1.28');
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
    let editorGeneration = 0;
    let returnCategoryId = null;
    let lastAgendaItems = [];
    // ponytail: Default collapsed = true entspricht dem Parchment-Original.
    let agendaCollapsed = true;

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

    async function saveCurrentContent() {
        if (!dirty || !editor || !state.journalDate) return;
        const date = state.journalDate;
        const html = sanitizeItemField('content', editor.getHTML());
        dirty = false;
        setSaveStatus('...');

        pendingSave = pendingSave.catch(() => {}).then(async () => {
            try {
                const payload = await api('journal_save', {
                    method: 'POST',
                    body: new URLSearchParams({ date, content: html }),
                });
                if (state.journalDate === date) {
                    currentItem = payload.item || currentItem;
                    state.journalItemId = Number(payload.item?.id) || null;
                    setSaveStatus(t('journal.saved'));
                }
            } catch (error) {
                if (state.journalDate === date) {
                    dirty = true;
                    setSaveStatus(t('journal.save_error'));
                }
                throw error;
            }
        });

        await pendingSave;
    }

    function scheduleSave() {
        dirty = true;
        clearTimeout(saveTimer);
        setSaveStatus('...');
        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            void saveCurrentContent().catch(error => {
                console.error('[Journal] Save failed:', error);
            });
        }, NOTE_SAVE_DEBOUNCE_MS);
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
        currentItem = null;
        state.journalItemId = null;
        setToolbarOpen(false);
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
            void toggleHandler(item.id, true).then(() => {
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
            content: currentItem?.content || '',
            editorProps: { attributes: { 'aria-label': t('journal.note_title') } },
            onUpdate: () => {
                updateToolbar();
                scheduleSave();
            },
            onSelectionUpdate: updateToolbar,
        });
        updateToolbar();
        setSaveStatus('');
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
        if (!button || !editor) return;
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

    return { closeJournal, openDay, reloadAgenda, setToggleHandler };
}
