import { t } from './i18n.js';
import { api } from './api.js';
import { buildNoteConflictVersion } from './conflict-ui.js';
import { clearNoteDraft, loadNoteDraft, saveNoteDraft } from './note-draft-persistence.js';
import { NOTE_SAVE_DEBOUNCE_MS, state } from './state.js';
import { appEl, noteEditorBody, noteEditorEl, noteSaveStatus, noteTitleInput, noteToolbar } from './ui.js';
import { activateModal, sanitizeItemField, sanitizeItemPayload } from './utils.js';

export function createEditorController(deps) {
    const {
        cacheCurrentCategoryItems,
        navigation,
        setNoteSaveTimer,
        getNoteSaveTimer,
        setTiptapEditor,
        getTiptapEditor,
    } = deps;

    let activeDraft = null;
    let saveInFlight = false;
    let applyingContent = false;
    let conflictElement = null;
    let modalSession = null;

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

    function setNoteSaveStatus(text, busy = false) {
        if (!noteSaveStatus) return;
        noteSaveStatus.textContent = text;
        noteSaveStatus.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function createDraft(item) {
        return {
            itemId: Number(item.id),
            baseRevision: Number(item.revision),
            baseName: item.name || '',
            baseContent: item.content || '',
            baseUpdatedAt: item.updated_at || '',
            title: item.name || '',
            content: item.content || '',
            dirty: false,
            requestId: '',
            conflict: null,
        };
    }

    function captureActiveDraft(markDirty = true) {
        if (!activeDraft) return;
        const editor = getTiptapEditor();
        activeDraft.title = sanitizeItemField('name', noteTitleInput?.value || 'Ohne Titel') || 'Ohne Titel';
        activeDraft.content = sanitizeItemField('content', editor?.getHTML() || activeDraft.content || '');
        if (markDirty) activeDraft.dirty = true;
        saveNoteDraft(activeDraft);
    }

    function updateCanonicalItem(item) {
        const localItem = deps.getItemById(item.id);
        if (localItem) Object.assign(localItem, item);
        cacheCurrentCategoryItems();
    }

    function setEditorContent(title, content) {
        if (noteTitleInput) noteTitleInput.value = title || '';
        const editor = getTiptapEditor();
        if (!editor) return;
        applyingContent = true;
        editor.commands.setContent(content || '', false);
        applyingContent = false;
    }

    function ensureConflictElement() {
        if (conflictElement || !noteEditorEl) return conflictElement;
        conflictElement = document.createElement('section');
        conflictElement.className = 'note-content-conflict';
        conflictElement.hidden = true;
        noteEditorEl.appendChild(conflictElement);
        return conflictElement;
    }

    function renderConflict() {
        const element = ensureConflictElement();
        if (!element) return;
        const conflict = activeDraft?.conflict;
        element.replaceChildren();
        element.hidden = !conflict;
        if (noteEditorBody) noteEditorBody.hidden = Boolean(conflict);
        if (noteToolbar) noteToolbar.hidden = Boolean(conflict);
        if (noteTitleInput) noteTitleInput.disabled = Boolean(conflict);
        if (!conflict) return;

        const intro = document.createElement('p');
        intro.className = 'note-conflict-intro';
        intro.textContent = 'Diese Notiz wurde parallel geändert. Wähle bewusst eine Fassung.';
        const versions = document.createElement('div');
        versions.className = 'note-conflict-versions';
        versions.append(
            buildNoteConflictVersion({
                className: 'note-conflict-version-local',
                label: 'Meine Fassung',
                version: conflict.local,
                actionLabel: 'Meine behalten',
                onAction: resolveWithLocalVersion,
                includeTitle: true,
            }),
            buildNoteConflictVersion({
                className: 'note-conflict-version-server',
                label: 'Server-Version',
                version: conflict.server,
                actionLabel: 'Server-Version übernehmen',
                onAction: acceptServerVersion,
                includeTitle: true,
            })
        );
        element.append(intro, versions);
    }

    function acceptSuccessfulSave(item, sentTitle, sentContent) {
        updateCanonicalItem(item);
        if (!activeDraft) return;
        activeDraft.baseRevision = Number(item.revision);
        activeDraft.baseName = item.name || sentTitle;
        activeDraft.baseContent = item.content || sentContent;
        activeDraft.baseUpdatedAt = item.updated_at || '';
        activeDraft.requestId = '';
        const changedWhileSaving = activeDraft.title !== sentTitle || activeDraft.content !== sentContent;
        activeDraft.dirty = changedWhileSaving;
        activeDraft.conflict = null;
        if (changedWhileSaving) {
            saveNoteDraft(activeDraft);
            scheduleNoteSave();
        } else {
            clearNoteDraft(activeDraft.itemId);
        }
        setNoteSaveStatus(t('editor.saved'));
        renderConflict();
    }

    async function performSave() {
        if (!activeDraft || activeDraft.conflict || !activeDraft.dirty || saveInFlight) return;
        const itemId = activeDraft.itemId;
        const sentTitle = activeDraft.title;
        const sentContent = activeDraft.content;
        const expectedRevision = Number(activeDraft.baseRevision);
        if (expectedRevision < 1) {
            setNoteSaveStatus(t('error.revision_required'));
            return;
        }

        saveInFlight = true;
        try {
            const result = await api('update', {
                method: 'POST',
                body: new URLSearchParams(sanitizeItemPayload({
                    id: String(itemId),
                    expected_revision: String(expectedRevision),
                    name: sentTitle,
                    content: sentContent,
                })),
                ...(activeDraft.requestId ? { idempotencyKey: activeDraft.requestId } : {}),
            });
            acceptSuccessfulSave(result.item, sentTitle, sentContent);
        } catch (error) {
            if (!activeDraft || activeDraft.itemId !== itemId) return;
            activeDraft.requestId = error.idempotencyKey || activeDraft.requestId || '';
            const current = error?.payload?.item;
            if (Number(error?.status) === 409 && current) {
                updateCanonicalItem(current);
                if ((current.name || '') === sentTitle && (current.content || '') === sentContent) {
                    acceptSuccessfulSave(current, sentTitle, sentContent);
                    return;
                }

                const serverContentUnchanged = (current.name || '') === activeDraft.baseName
                    && (current.content || '') === activeDraft.baseContent;
                if (serverContentUnchanged) {
                    activeDraft.baseRevision = Number(current.revision);
                    activeDraft.baseUpdatedAt = current.updated_at || '';
                    saveNoteDraft(activeDraft);
                    window.setTimeout(() => void performSave(), 0);
                    return;
                }

                activeDraft.requestId = '';
                activeDraft.conflict = {
                    local: {
                        title: sentTitle,
                        content: sentContent,
                        updatedAt: new Date().toISOString(),
                    },
                    server: {
                        title: current.name || '',
                        content: current.content || '',
                        updatedAt: current.updated_at || '',
                        revision: Number(current.revision),
                        item: current,
                    },
                };
                saveNoteDraft(activeDraft);
                setNoteSaveStatus('Konflikt');
                renderConflict();
                return;
            }

            saveNoteDraft(activeDraft);
            setNoteSaveStatus(error?.isNetworkError ? 'Offline vorgemerkt' : '❌ Fehler beim Speichern');
        } finally {
            saveInFlight = false;
        }

        if (activeDraft?.dirty && !activeDraft.conflict && Number(activeDraft.baseRevision) !== expectedRevision) {
            await performSave();
        }
    }

    function scheduleNoteSave() {
        if (!activeDraft || activeDraft.conflict) return;
        captureActiveDraft(true);
        clearTimeout(getNoteSaveTimer());
        setNoteSaveStatus(t('editor.saving'), true);
        setNoteSaveTimer(setTimeout(() => void performSave(), NOTE_SAVE_DEBOUNCE_MS));
    }

    async function resolveWithLocalVersion() {
        const conflict = activeDraft?.conflict;
        if (!activeDraft || !conflict) return;
        setNoteSaveStatus(t('editor.saving'), true);
        try {
            const result = await api('update', {
                method: 'POST',
                body: new URLSearchParams(sanitizeItemPayload({
                    id: String(activeDraft.itemId),
                    expected_revision: String(conflict.server.revision),
                    name: conflict.local.title,
                    content: conflict.local.content,
                })),
                ...(activeDraft.requestId ? { idempotencyKey: activeDraft.requestId } : {}),
            });
            setEditorContent(conflict.local.title, conflict.local.content);
            activeDraft.title = conflict.local.title;
            activeDraft.content = conflict.local.content;
            acceptSuccessfulSave(result.item, conflict.local.title, conflict.local.content);
        } catch (error) {
            activeDraft.requestId = error.idempotencyKey || activeDraft.requestId || '';
            if (Number(error?.status) === 409 && error.payload?.item) {
                const current = error.payload.item;
                updateCanonicalItem(current);
                activeDraft.conflict.server = {
                    title: current.name || '',
                    content: current.content || '',
                    updatedAt: current.updated_at || '',
                    revision: Number(current.revision),
                    item: current,
                };
            }
            saveNoteDraft(activeDraft);
            setNoteSaveStatus(error?.isNetworkError ? 'Offline vorgemerkt' : '❌ Konflikt bleibt bestehen');
            renderConflict();
        }
    }

    function acceptServerVersion() {
        const conflict = activeDraft?.conflict;
        if (!activeDraft || !conflict) return;
        const server = conflict.server;
        updateCanonicalItem(server.item);
        setEditorContent(server.title, server.content);
        activeDraft = createDraft(server.item);
        clearNoteDraft(server.item.id);
        setNoteSaveStatus(t('editor.saved'));
        renderConflict();
    }

    function reconcileServerItem(item) {
        if (!activeDraft || Number(activeDraft.itemId) !== Number(item?.id)) return;
        captureActiveDraft(false);
        updateCanonicalItem(item);

        if (activeDraft.conflict) {
            activeDraft.conflict.server = {
                title: item.name || '',
                content: item.content || '',
                updatedAt: item.updated_at || '',
                revision: Number(item.revision),
                item,
            };
            saveNoteDraft(activeDraft);
            renderConflict();
            return;
        }

        if (!activeDraft.dirty) {
            activeDraft = createDraft(item);
            setEditorContent(activeDraft.title, activeDraft.content);
            clearNoteDraft(activeDraft.itemId);
            setNoteSaveStatus('');
            return;
        }

        if ((item.name || '') === activeDraft.title && (item.content || '') === activeDraft.content) {
            activeDraft = createDraft(item);
            clearNoteDraft(activeDraft.itemId);
            setNoteSaveStatus(t('editor.saved'));
            return;
        }

        const serverContentUnchanged = (item.name || '') === activeDraft.baseName
            && (item.content || '') === activeDraft.baseContent;
        if (serverContentUnchanged) {
            activeDraft.baseRevision = Number(item.revision);
            activeDraft.baseUpdatedAt = item.updated_at || '';
            saveNoteDraft(activeDraft);
            return;
        }

        activeDraft.conflict = {
            local: {
                title: activeDraft.title,
                content: activeDraft.content,
                updatedAt: new Date().toISOString(),
            },
            server: {
                title: item.name || '',
                content: item.content || '',
                updatedAt: item.updated_at || '',
                revision: Number(item.revision),
                item,
            },
        };
        saveNoteDraft(activeDraft);
        setNoteSaveStatus('Konflikt');
        renderConflict();
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
        activeDraft = loadNoteDraft(item.id) || createDraft(item);
        if (noteTitleInput) noteTitleInput.value = activeDraft.title;
        if (noteEditorEl) noteEditorEl.hidden = false;
        appEl.classList.add('note-editor-open');

        const { Editor, StarterKit, Link } = await waitForTipTap();
        if (noteEditorBody) noteEditorBody.innerHTML = '';
        const editor = new Editor({
            element: noteEditorBody,
            content: activeDraft.content || '',
            extensions: [
                StarterKit.configure({}),
                Link.configure({ openOnClick: false }),
            ],
            onUpdate: () => {
                updateNoteToolbar();
                if (!applyingContent) scheduleNoteSave();
            },
            onSelectionUpdate: updateNoteToolbar,
        });
        setTiptapEditor(editor);
        updateNoteToolbar();
        renderConflict();
        setNoteSaveStatus(activeDraft.conflict ? 'Konflikt' : (activeDraft.dirty ? 'Lokal geändert' : ''));
        if (noteEditorEl) {
            noteEditorEl.setAttribute('aria-label', activeDraft.title || t('ui.open_note'));
            modalSession = activateModal(noteEditorEl, {
                initialFocus: noteTitleInput,
                onEscape: () => navigation.navigateBackOrReplace({ screen: 'list' }),
                additionalBackground: [appEl.querySelector('#listSwipeStage')],
            });
        }
        if (activeDraft.dirty && !activeDraft.conflict) scheduleNoteSave();
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
        if (activeDraft && !activeDraft.conflict) {
            captureActiveDraft(false);
            if (activeDraft.dirty) await performSave();
        }
        destroyTipTap();
        activeDraft = null;
        state.noteEditorId = null;
        appEl.classList.remove('note-editor-open');
        if (noteEditorEl) noteEditorEl.hidden = true;
        modalSession?.deactivate();
        modalSession = null;
        if (conflictElement) conflictElement.hidden = true;
        if (noteEditorBody) noteEditorBody.hidden = false;
        if (noteToolbar) noteToolbar.hidden = false;
        if (noteTitleInput) noteTitleInput.disabled = false;
    }

    function handleToolbarClick(event) {
        const button = event.target.closest('button[data-cmd]');
        const editor = getTiptapEditor();
        if (!button || !editor || activeDraft?.conflict) return;
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
                if (url === '') chain.unsetLink().run();
                else chain.setLink({ href: url }).run();
                break;
            }
        }
        updateNoteToolbar();
    }

    window.addEventListener('online', () => {
        if (activeDraft?.dirty && !activeDraft.conflict) void performSave();
    });

    return {
        closeNoteEditor,
        handleToolbarClick,
        openNoteEditor,
        openNoteEditorWithNavigation,
        reconcileServerItem,
        scheduleNoteSave,
    };
}
