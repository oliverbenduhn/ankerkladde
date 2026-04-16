import { api } from './api.js';
import { NOTE_SAVE_DEBOUNCE_MS, state } from './state.js';
import { appEl, noteEditorBody, noteEditorEl, noteSaveStatus, noteTitleInput, noteToolbar } from './ui.js';

export function createEditorController(deps) {
    const {
        cacheCurrentCategoryItems,
        navigation,
        setNoteSaveTimer,
        getNoteSaveTimer,
        setTiptapEditor,
        getTiptapEditor,
    } = deps;

    let ydoc = null;
    let provider = null;

    async function waitForTipTap() {
        return new Promise(resolve => {
            if (window.TipTap) {
                resolve(window.TipTap);
                return;
            }

            window.addEventListener('tiptap-ready', () => resolve(window.TipTap), { once: true });
        });
    }

    function destroyTipTap() {
        const editor = getTiptapEditor();
        if (editor) {
            editor.destroy();
            setTiptapEditor(null);
        }
    }

    function setNoteSaveStatus(text) {
        if (noteSaveStatus) noteSaveStatus.textContent = text;
    }

    async function saveNoteContent(id, title, htmlContent) {
        // Conflict detection: check if note was modified elsewhere
        const currentItem = deps.getItemById(id);
        if (currentItem && state.noteEditorUpdatedAt && currentItem.updated_at !== state.noteEditorUpdatedAt) {
            setNoteSaveStatus('⚠️ Notiz wurde woanders geändert. Nicht gespeichert.');
            console.warn('[Note] Conflict detected: updated_at mismatch. Local:', state.noteEditorUpdatedAt, 'Server:', currentItem.updated_at);
            return;
        }

        await api('update', {
            method: 'POST',
            body: new URLSearchParams({ id: String(id), name: title || 'Ohne Titel', content: htmlContent }),
        });
        const item = deps.getItemById(id);
        if (item) {
            item.name = title || 'Ohne Titel';
            item.content = htmlContent;
        }
        cacheCurrentCategoryItems();
        setNoteSaveStatus('Gespeichert');
    }

    function scheduleNoteSave() {
        clearTimeout(getNoteSaveTimer());
        setNoteSaveStatus('...');
        setNoteSaveTimer(setTimeout(() => {
            const editor = getTiptapEditor();
            if (state.noteEditorId === null || !editor) return;
            void saveNoteContent(state.noteEditorId, noteTitleInput?.value || '', editor.getHTML());
        }, NOTE_SAVE_DEBOUNCE_MS));
    }

    function updateNoteToolbar() {
        const editor = getTiptapEditor();
        if (!editor || !noteToolbar) return;

        noteToolbar.querySelectorAll('button[data-cmd]').forEach(button => {
            const cmd = button.dataset.cmd;
            const level = button.dataset.level ? Number(button.dataset.level) : undefined;
            let active = false;

            if (cmd === 'heading' && level) {
                active = editor.isActive('heading', { level });
            } else if (cmd === 'link') {
                active = editor.isActive('link');
            } else if (cmd !== 'undo' && cmd !== 'redo') {
                active = editor.isActive(cmd);
            }

            button.classList.toggle('is-active', active);
        });
    }

    async function openNoteEditor(item) {
        await closeNoteEditor();

        state.noteEditorId = item.id;
        state.noteEditorUpdatedAt = item.updated_at || '';
        if (noteTitleInput) noteTitleInput.value = item.name || '';
        if (noteEditorEl) noteEditorEl.hidden = false;
        appEl.classList.add('note-editor-open');

        const { Editor, StarterKit, Link, Y, WebsocketProvider, Collaboration, CollaborationCursor } = await waitForTipTap();
        if (noteEditorBody) noteEditorBody.innerHTML = '';

        ydoc = new Y.Doc();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        provider = new WebsocketProvider(wsUrl, `yjs/note/${item.id}`, ydoc);

        const randId = Math.floor(Math.random() * 10000);
        const userName = `Gast-${randId}`;
        const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;

        const editor = new Editor({
            element: noteEditorBody,
            extensions: [
                StarterKit.configure({
                    history: false,
                }),
                Link.configure({ openOnClick: false }),
                Collaboration.configure({
                    document: ydoc,
                }),
                CollaborationCursor.configure({
                    provider: provider,
                    user: {
                        name: userName,
                        color: userColor,
                    },
                }),
            ],
            onUpdate: () => {
                updateNoteToolbar();
                scheduleNoteSave();
            },
            onSelectionUpdate: updateNoteToolbar,
        });

        // Initialize content if Yjs document is empty after sync
        provider.on('synced', () => {
            if (item.content && (editor.getHTML() === '<p></p>' || editor.getHTML() === '')) {
                editor.commands.setContent(item.content, false);
            }
        });

        setTiptapEditor(editor);
        updateNoteToolbar();
        setNoteSaveStatus('');
    }

    async function openNoteEditorWithNavigation(item) {
        await openNoteEditor(item);
        if (state.noteEditorId !== null) {
            navigation.pushHistoryState({
                screen: 'note',
                noteId: state.noteEditorId,
                categoryId: state.categoryId,
            });
        }
    }

    async function closeNoteEditor() {
        clearTimeout(getNoteSaveTimer());
        setNoteSaveTimer(null);

        const editor = getTiptapEditor();
        if (editor && state.noteEditorId !== null) {
            await saveNoteContent(state.noteEditorId, noteTitleInput?.value || '', editor.getHTML());
        }

        destroyTipTap();
        
        if (provider) {
            provider.destroy();
            provider = null;
        }
        if (ydoc) {
            ydoc.destroy();
            ydoc = null;
        }

        state.noteEditorId = null;
        state.noteEditorUpdatedAt = '';
        appEl.classList.remove('note-editor-open');
        if (noteEditorEl) noteEditorEl.hidden = true;
    }

    function handleToolbarClick(event) {
        const button = event.target.closest('button[data-cmd]');
        const editor = getTiptapEditor();
        if (!button || !editor) return;

        const cmd = button.dataset.cmd;
        const level = button.dataset.level ? Number(button.dataset.level) : undefined;
        const chain = editor.chain().focus();

        switch (cmd) {
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
                const url = prompt('URL:', previous);
                if (url === null) break;
                if (url === '') {
                    chain.unsetLink().run();
                    break;
                }
                chain.setLink({ href: url }).run();
                break;
            }
        }

        updateNoteToolbar();
    }

    return {
        closeNoteEditor,
        handleToolbarClick,
        openNoteEditor,
        openNoteEditorWithNavigation,
        scheduleNoteSave,
    };
}
