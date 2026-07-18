import { api, normalizeItem } from './api.js?v=5.1.22';
import { buildAgendaItem, loadAgenda } from './today-view.js?v=5.1.22';
import { NOTE_SAVE_DEBOUNCE_MS, state } from './state.js?v=5.1.22';
import {
    journalBackBtn,
    journalAnytimeList,
    journalDateHeading,
    journalDatePicker,
    journalEditorBody,
    journalFormatBtn,
    journalNextBtn,
    journalPreviousBtn,
    journalSaveStatus,
    journalScheduledList,
    journalTodayBtn,
    journalToolbar,
} from './ui.js?v=5.1.22';
import { sanitizeItemField } from './utils.js?v=5.1.22';
import { t } from './i18n.js?v=5.1.22';

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

function formatDateHeading(isoDate, todayIso) {
    const locale = document.documentElement.lang === 'en' ? 'en-US' : 'de-DE';
    const options = {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
    };
    if (isoDate.slice(0, 4) !== todayIso.slice(0, 4)) {
        options.year = 'numeric';
    }
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
        // ponytail: aria-pressed as a 3-button screen-segment map; revisit if more segments appear.
        const today = serverDateIso(state.serverToday);
        if (journalDatePicker) journalDatePicker.value = date;
        if (journalDateHeading) journalDateHeading.textContent = formatDateHeading(date, today || date);
        const targets = new Map([
            [journalPreviousBtn, today ? shiftDate(today, -1) : ''],
            [journalTodayBtn, today],
            [journalNextBtn, today ? shiftDate(today, 1) : ''],
        ]);
        targets.forEach((target, button) => button?.setAttribute('aria-pressed', String(target !== '' && date === target)));
    }

    function renderAgenda(items) {
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
        items.forEach(item => {
            const node = buildWithHandlers(item, () => onToggle(item, node), () => onOpen(item));
            const target = item.agenda_group === 'scheduled' ? scheduled : anytime;
            target.appendChild(node);
        });
        journalAnytimeList?.replaceChildren(anytime);
        journalScheduledList?.replaceChildren(scheduled);
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
        if (focus) editor.chain().focus().run();
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
    journalFormatBtn?.addEventListener('click', () => setToolbarOpen(journalToolbar?.hidden !== false));
    journalToolbar?.addEventListener('click', handleToolbarClick);

    return { closeJournal, openDay, reloadAgenda, setToggleHandler };
}