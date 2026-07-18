// Sketch-Editor: lazy Excalidraw-Loader für Zeichnungen (Issue #41, #42).
// Wird erst geöffnet, wenn der Nutzer aktiv eine Skizze öffnet.
// Beim App-Start oder Tagesansicht-Öffnen wird Excalidraw NICHT geladen.
// Editor-Fehler bleiben auf das Overlay begrenzt; App-Navigation bleibt
// unabhängig lauffähig (AC #4).

import { api } from './api.js?v=5.1.25';
import { t } from './i18n.js?v=5.1.25';

const EXCALIDRAW_MODULE = 'https://esm.sh/@excalidraw/excalidraw@0.17.3?deps=react@18.2.0,react-dom@18.2.0';
const REACT_MODULE = 'https://esm.sh/react@18.2.0';
const REACT_DOM_MODULE = 'https://esm.sh/react-dom@18.2.0/client';
const EXCALIDRAW_ASSET_PATH = 'https://esm.sh/@excalidraw/excalidraw@0.17.3/dist/prod/';

let excalidrawPromise = null;

async function ensureExcalidraw() {
    if (excalidrawPromise) return excalidrawPromise;
    excalidrawPromise = (async () => {
        window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
        const [React, ReactDOM, ExcalidrawModule] = await Promise.all([
            import(/* @vite-ignore */ REACT_MODULE),
            import(/* @vite-ignore */ REACT_DOM_MODULE),
            import(/* @vite-ignore */ EXCALIDRAW_MODULE),
        ]);
        return { React, ReactDOM, Excalidraw: ExcalidrawModule.Excalidraw };
    })();
    return excalidrawPromise;
}

function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'sketch-editor-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('sketch.open'));

    const shell = document.createElement('div');
    shell.className = 'sketch-editor-shell';

    const header = document.createElement('header');
    header.className = 'sketch-editor-header';

    const status = document.createElement('span');
    status.className = 'sketch-editor-status';
    status.textContent = '';
    header.appendChild(status);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sketch-editor-close';
    closeBtn.setAttribute('aria-label', t('sketch.close'));
    closeBtn.textContent = '\u00d7';
    header.appendChild(closeBtn);

    const host = document.createElement('div');
    host.className = 'sketch-editor-host';

    const footer = document.createElement('div');
    footer.className = 'sketch-editor-footer';
    footer.hidden = true;

    shell.append(header, host, footer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    return { overlay, shell, header, status, closeBtn, host, footer };
}

function showFatal(footer, message, retryHandler, discardHandler) {
    footer.replaceChildren();
    footer.hidden = false;

    const note = document.createElement('p');
    note.className = 'sketch-editor-error';
    note.textContent = message;
    footer.appendChild(note);

    if (typeof retryHandler === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'sketch-editor-btn sketch-editor-btn-retry';
        retryBtn.textContent = t('sketch.retry_save');
        retryBtn.addEventListener('click', () => {
            footer.hidden = true;
            retryHandler();
        });
        footer.appendChild(retryBtn);
    }

    if (typeof discardHandler === 'function') {
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'sketch-editor-btn sketch-editor-btn-discard';
        discardBtn.textContent = t('sketch.discard_changes');
        discardBtn.addEventListener('click', () => {
            footer.hidden = true;
            discardHandler();
        });
        footer.appendChild(discardBtn);
    }
}

async function saveScene(itemId, scene, onStatus) {
    onStatus(t('editor.saving'));
    await api('sketch_save', {
        method: 'POST',
        body: new URLSearchParams({ item_id: String(itemId), scene: JSON.stringify(scene) }),
    });
    onStatus(t('editor.saved'));
}

async function saveSceneDaily(date, scene, onStatus) {
    onStatus(t('editor.saving'));
    const payload = await api('sketch_save_daily', {
        method: 'POST',
        body: new URLSearchParams({ date, scene: JSON.stringify(scene) }),
    });
    onStatus(t('editor.saved'));
    return payload;
}

async function loadScene(itemId) {
    const payload = await api(`sketch_load&item_id=${encodeURIComponent(itemId)}`);
    if (payload && payload.scene && typeof payload.scene === 'object') {
        return payload.scene;
    }
    return { elements: [], appState: {} };
}

// Daily-mode save: emits the new item id once the row exists; subsequent
// saves reuse that item via `saveScene(itemId, …)`. The caller (journal.js)
// re-reads the journal payload after the editor closes to refresh `has_sketch`.
async function loadSceneDaily(date) {
    const payload = await api(
        `journal&date=${encodeURIComponent(date)}`
    );
    const item = payload.item;
    if (item && Number.isInteger(Number(item.id)) && Number(item.has_sketch) === 1) {
        const scenePayload = await api(
            `sketch_load&item_id=${encodeURIComponent(Number(item.id))}`
        );
        if (scenePayload && scenePayload.scene && typeof scenePayload.scene === 'object') {
            return { itemId: Number(item.id), scene: scenePayload.scene };
        }
    }
    const itemId = item && Number.isInteger(Number(item.id)) ? Number(item.id) : 0;
    return { itemId, scene: { elements: [], appState: {} } };
}

// Each openSketchEditor call gets its own state via closure (Issue #42:
// prevent cross-item race when opening the editor twice in quick succession).
// `mode === 'daily'` swaps save/load to sketch_save_daily/journal; otherwise
// the editor operates on an existing item via sketch_save/sketch_load.
async function openSketchEditorImpl({ item, date, mode }) {
    let itemId = Number(item?.id);
    const isDaily = mode === 'daily';
    if (!isDaily && (!Number.isInteger(itemId) || itemId <= 0)) {
        return;
    }

    const doSave = async (targetItemId, scene, onStatus) => {
        if (isDaily) {
            return saveSceneDaily(date, scene, onStatus);
        }
        return saveScene(targetItemId, scene, onStatus);
    };

    const doLoad = async () => {
        if (isDaily) {
            const { itemId: resolvedId, scene } = await loadSceneDaily(date);
            if (resolvedId > 0) itemId = resolvedId;
            return scene;
        }
        return loadScene(itemId);
    };

    const refs = buildOverlay();
    refs.status.textContent = t('editor.loading');
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });

    // Closure-scoped editor state.
    let root = null;
    let pendingScene = null;
    let saveTimer = null;
    let saveInFlight = null;
    let unmounted = false;
    let blockingError = false; // true while Retry/Discard footer is shown for a save failure

    const isOpen = () => !unmounted && document.body.contains(refs.overlay);

    const safeUnmount = (finish = true) => {
        if (unmounted) return;
        unmounted = true;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        try { root?.unmount(); } catch (_e) { /* root might not exist yet */ }
        refs.overlay.remove();
        if (finish) resolveClosed();
    };

    const reportFatal = (message, retryHandler, discardHandler) => {
        if (!isOpen()) return;
        refs.status.textContent = '';
        showFatal(refs.footer, message, retryHandler, discardHandler);
    };

    // Show retry/discard for a failed save. `retrySave` flushes again, `discard`
    // throws away the unsaved scene and closes the editor.
    const onSaveError = () => {
        if (!isOpen()) return;
        blockingError = true;
        refs.status.textContent = t('editor.save_error');
        showFatal(
            refs.footer,
            t('editor.save_error'),
            () => { blockingError = false; void flushSave(); },
            () => { pendingScene = null; safeUnmount(); }
        );
    };

    const flushSave = async () => {
        if (!pendingScene) return;
        const scene = pendingScene;
        pendingScene = null;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveInFlight = (async () => {
            try {
                await doSave(itemId, scene, text => {
                    if (isOpen()) refs.status.textContent = text;
                });
                blockingError = false;
                if (isOpen()) refs.footer.hidden = true;
            } catch (_error) {
                // Surface in UI, then rethrow so handleClose knows to block.
                pendingScene = scene;
                onSaveError();
                throw _error;
            } finally {
                saveInFlight = null;
            }
        })();
        return saveInFlight;
    };

    const queueSave = scene => {
        pendingScene = scene;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            flushSave().catch(() => { /* error already surfaced via onSaveError */ });
        }, 800);
    };

    const onChange = (elements, appState) => {
        queueSave({ elements: elements ?? [], appState: appState ?? {} });
    };

    const handleClose = async () => {
        if (blockingError) {
            // Save failed: require Retry/Discard to leave the editor (AC #3).
            return;
        }
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (saveInFlight) {
            try { await saveInFlight; } catch (_e) { /* surfaced below */ }
        }
        try {
            await flushSave();
        } catch (_error) {
            // flushSave already rendered Retry/Discard buttons. Keep overlay.
            return;
        }
        if (saveInFlight) {
            // Edge case: a new save started between flushSave and this check.
            // Wait for it so the server reflects the final state.
            try { await saveInFlight; } catch (_e) {
                onSaveError();
                return;
            }
        }
        safeUnmount();
    };

    // ---- Async setup ----
    let bundle;
    try {
        bundle = await ensureExcalidraw();
    } catch (_error) {
        reportFatal(
            t('sketch.editor_load_failed'),
            async () => {
                excalidrawPromise = null;
                safeUnmount(false);
                await openSketchEditorImpl({ item, date, mode });
                resolveClosed();
            },
            () => { safeUnmount(); }
        );
        return closed;
    }

    let initialScene;
    try {
        initialScene = await doLoad();
    } catch (error) {
        reportFatal(
            error?.message || t('sketch.editor_load_failed'),
            async () => {
                safeUnmount(false);
                await openSketchEditorImpl({ item, date, mode });
                resolveClosed();
            },
            () => { safeUnmount(); }
        );
        return closed;
    }

    const { React, ReactDOM, Excalidraw } = bundle;
    try {
        root = ReactDOM.createRoot(refs.host);
        root.render(
            React.createElement(Excalidraw, {
                initialData: initialScene,
                onChange,
                UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
            })
        );
    } catch (_error) {
        reportFatal(
            t('sketch.editor_load_failed'),
            async () => {
                safeUnmount(false);
                await openSketchEditorImpl({ item, date, mode });
                resolveClosed();
            },
            () => { safeUnmount(); }
        );
        return closed;
    }

    refs.closeBtn.addEventListener('click', handleClose);
    refs.status.textContent = '';
    return closed;
}

export function openSketchEditor(item) {
    return openSketchEditorImpl({ item, mode: 'item' });
}

export function openSketchEditorDaily(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return Promise.resolve();
    }
    return openSketchEditorImpl({ date, mode: 'daily' });
}
