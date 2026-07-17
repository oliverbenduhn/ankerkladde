import { api } from './api.js?v=4.3.4';
import { NOTE_SAVE_DEBOUNCE_MS, state } from './state.js?v=4.3.4';
import {
    journalDateHeading,
    journalDatePicker,
    journalEditorBody,
    journalNextBtn,
    journalPreviousBtn,
    journalSaveStatus,
    journalTodayBtn,
    journalToolbar,
} from './ui.js?v=4.3.4';
import { sanitizeItemField } from './utils.js?v=4.3.11';

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
    return new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    }).format(new Date(`${isoDate}T12:00:00`));
}

export function createJournalController(deps) {
    const { navigation, renderCategoryTabs, setMessage, updateHeaders } = deps;
    let editor = null;
    let saveTimer = null;
    let dirty = false;
    let currentItem = null;
    let pendingSave = Promise.resolve();
    let editorGeneration = 0;

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
                    setSaveStatus('Gespeichert');
                }
            } catch (error) {
                if (state.journalDate === date) {
                    dirty = true;
                    setSaveStatus('❌ Fehler beim Speichern');
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

    async function destroyEditor({ flush = true } = {}) {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (flush && dirty) {
            await saveCurrentContent();
        }
        await pendingSave.catch(() => {});
        if (editor) {
            editor.destroy();
            editor = null;
        }
        if (journalEditorBody) journalEditorBody.replaceChildren();
        dirty = false;
        currentItem = null;
        state.journalItemId = null;
    }

    function updateDateUi(date) {
        if (journalDatePicker) journalDatePicker.value = date;
        if (journalDateHeading) journalDateHeading.textContent = formatDateHeading(date);
        const today = serverDateIso(state.serverToday);
        if (journalNextBtn) journalNextBtn.disabled = today !== '' && date >= today;
        if (journalTodayBtn) journalTodayBtn.disabled = today !== '' && date === today;
    }

    async function openDay(date = null, { focus = false } = {}) {
        const requestedDate = date === null || date === 'today'
            ? (state.serverToday || 'today')
            : date;
        const resolvedDate = requestedDate === 'today' ? null : requestedDate;
        await destroyEditor();
        const url = resolvedDate
            ? `journal&date=${encodeURIComponent(resolvedDate)}`
            : 'journal';
        const payload = await api(url);
        if (typeof payload.today === 'string' && payload.today !== '') {
            state.serverToday = payload.today;
        }
        state.screen = 'journal';
        state.journalDate = payload.date;
        state.journalItemId = Number(payload.item?.id) || null;
        state.categoryId = Number(payload.category.id);
        currentItem = payload.item || null;
        updateDateUi(payload.date);
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

    async function navigateTo(date) {
        if (!date || date === state.journalDate) return;
        await openDay(date);
        navigation.pushHistoryState({ screen: 'journal', date });
    }

    async function closeJournal() {
        await destroyEditor();
        state.journalDate = null;
        state.journalItemId = null;
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

    journalPreviousBtn?.addEventListener('click', () => {
        const fallback = state.serverToday || state.journalDate || '';
        return void navigateTo(shiftDate(state.journalDate || fallback, -1)).catch(error => setMessage(error.message, true));
    });
    journalTodayBtn?.addEventListener('click', () => void navigateTo(state.serverToday || 'today').catch(error => setMessage(error.message, true)));
    journalNextBtn?.addEventListener('click', () => {
        const fallback = state.serverToday || state.journalDate || '';
        return void navigateTo(shiftDate(state.journalDate || fallback, 1)).catch(error => setMessage(error.message, true));
    });
    journalDatePicker?.addEventListener('change', event => void navigateTo(event.target.value).catch(error => setMessage(error.message, true)));
    journalDateHeading?.addEventListener('click', () => void navigateTo(state.serverToday || 'today').catch(error => setMessage(error.message, true)));
    journalToolbar?.addEventListener('click', handleToolbarClick);

    return { closeJournal, openDay };
}
