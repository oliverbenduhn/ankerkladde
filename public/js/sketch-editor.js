// Sketch-Editor: lazy Excalidraw-Loader für Zeichnungen (Issue #41).
// Wird erst geöffnet, wenn der Nutzer aktiv eine Skizze öffnet.
// Beim App-Start oder Tagesansicht-Öffnen wird Excalidraw NICHT geladen.

import { api } from './api.js?v=5.1.21';
import { t } from './i18n.js?v=5.1.21';

const EXCALIDRAW_MODULE = 'https://esm.sh/@excalidraw/excalidraw@0.17.3?deps=react@18.2.0,react-dom@18.2.0';
const REACT_MODULE = 'https://esm.sh/react@18.2.0';
const REACT_DOM_MODULE = 'https://esm.sh/react-dom@18.2.0/client';

let excalidrawPromise = null;
let activeOverlay = null;

async function ensureExcalidraw() {
    if (excalidrawPromise) return excalidrawPromise;
    excalidrawPromise = (async () => {
        const [React, ReactDOM, ExcalidrawModule] = await Promise.all([
            import(/* @vite-ignore */ REACT_MODULE),
            import(/* @vite-ignore */ REACT_DOM_MODULE),
            import(/* @vite-ignore */ EXCALIDRAW_MODULE),
        ]);
        return { React, ReactDOM, Excalidraw: ExcalidrawModule.Excalidraw };
    })();
    return excalidrawPromise;
}

function showEditorError(overlay, message) {
    const note = document.createElement('p');
    note.className = 'sketch-editor-error';
    note.textContent = message;
    overlay.appendChild(note);
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

    shell.append(header, host);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    return { overlay, shell, header, status, closeBtn, host };
}

async function saveScene(itemId, scene, onStatus) {
    onStatus(t('editor.saving'));
    await api('sketch_save', { item_id: itemId, scene: JSON.stringify(scene) });
    onStatus(t('editor.saved'));
}

async function loadScene(itemId) {
    const payload = await api(`sketch_load&item_id=${encodeURIComponent(itemId)}`);
    if (payload && payload.scene && typeof payload.scene === 'object') {
        return payload.scene;
    }
    return { elements: [], appState: {} };
}

let saveTimer = null;
let pendingScene = null;
let lastError = null;

export async function openSketchEditor(item) {
    if (activeOverlay) {
        activeOverlay.remove();
        activeOverlay = null;
    }
    const itemId = Number(item?.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
        return;
    }

    const refs = buildOverlay();
    activeOverlay = refs.overlay;
    refs.status.textContent = t('editor.loading');

    let bundle;
    try {
        bundle = await ensureExcalidraw();
    } catch (error) {
        refs.status.textContent = '';
        showEditorError(refs.overlay, t('sketch.editor_load_failed'));
        lastError = error;
        return;
    }

    let initialScene;
    try {
        initialScene = await loadScene(itemId);
    } catch (error) {
        refs.status.textContent = '';
        showEditorError(refs.overlay, error?.message || 'Sketch konnte nicht geladen werden.');
        lastError = error;
        return;
    }

    const { React, ReactDOM, Excalidraw } = bundle;
    const root = ReactDOM.createRoot(refs.host);

    const flushSave = async () => {
        if (!pendingScene) return;
        const scene = pendingScene;
        pendingScene = null;
        saveTimer = null;
        try {
            await saveScene(itemId, scene, text => {
                refs.status.textContent = text;
            });
        } catch (error) {
            lastError = error;
            refs.status.textContent = t('editor.save_error');
            // Restore pending scene so the next change retries.
            pendingScene = scene;
        }
    };

    const queueSave = scene => {
        pendingScene = scene;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            flushSave().catch(err => {
                lastError = err;
                refs.status.textContent = t('editor.save_error');
            });
        }, 800);
    };

    const onChange = (elements, appState) => {
        const scene = { elements: elements ?? [], appState: appState ?? {} };
        queueSave(scene);
    };

    const handleClose = async () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        try {
            await flushSave();
        } catch (error) {
            // block close if save failed (Spec: block close on sketch-save failure)
            refs.status.textContent = t('editor.save_error');
            return;
        }
        root.unmount();
        refs.overlay.remove();
        if (activeOverlay === refs.overlay) activeOverlay = null;
    };

    refs.closeBtn.addEventListener('click', handleClose);

    root.render(
        React.createElement(Excalidraw, {
            initialData: initialScene,
            onChange,
            UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
        })
    );

    refs.status.textContent = '';
}