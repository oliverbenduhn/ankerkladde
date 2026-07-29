// Lazy Excalidraw editor with revision-safe, tab-local scene drafts.

import { api } from './api.js';
import { t } from './i18n.js';
import {
    clearSketchDraft,
    loadSketchDraft,
    saveSketchDraft,
    sketchDraftKey,
} from './sketch-draft-persistence.js';

const EXCALIDRAW_MODULE = 'https://esm.sh/@excalidraw/excalidraw@0.17.3?deps=react@18.2.0,react-dom@18.2.0';
const REACT_MODULE = 'https://esm.sh/react@18.2.0';
const REACT_DOM_MODULE = 'https://esm.sh/react-dom@18.2.0/client';
const EXCALIDRAW_ASSET_PATH = 'https://unpkg.com/@excalidraw/excalidraw@0.17.3/dist/';

let excalidrawPromise = null;
let activeSketchRefresh = null;

export async function refreshOpenSketchEditor() {
    return activeSketchRefresh ? activeSketchRefresh() : false;
}

async function ensureExcalidraw() {
    if (excalidrawPromise) return excalidrawPromise;
    excalidrawPromise = (async () => {
        window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
        const [React, ReactDOM, ExcalidrawModule] = await Promise.all([
            import(/* @vite-ignore */ REACT_MODULE),
            import(/* @vite-ignore */ REACT_DOM_MODULE),
            import(/* @vite-ignore */ EXCALIDRAW_MODULE),
        ]);
        const defaultExport = ExcalidrawModule.default;
        return {
            React,
            ReactDOM,
            Excalidraw: ExcalidrawModule.Excalidraw
                || defaultExport?.Excalidraw
                || defaultExport?.default,
        };
    })();
    return excalidrawPromise;
}

function emptyScene() {
    return { elements: [], appState: {} };
}

function asScene(scene) {
    return scene && typeof scene === 'object' && Array.isArray(scene.elements)
        ? scene
        : emptyScene();
}

function sceneFingerprint(scene) {
    const normalized = asScene(scene);
    return JSON.stringify({
        elements: normalized.elements,
        viewBackgroundColor: normalized.appState?.viewBackgroundColor || '',
    });
}

function scenesEqual(left, right) {
    return sceneFingerprint(left) === sceneFingerprint(right);
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
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sketch-editor-close';
    closeBtn.setAttribute('aria-label', t('sketch.close'));
    closeBtn.textContent = '\u00d7';
    header.append(status, closeBtn);

    const host = document.createElement('div');
    host.className = 'sketch-editor-host';
    const footer = document.createElement('div');
    footer.className = 'sketch-editor-footer';
    footer.hidden = true;
    shell.append(header, host, footer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    return { overlay, shell, status, closeBtn, host, footer };
}

function showSaveError(footer, retryHandler, discardHandler) {
    footer.replaceChildren();
    footer.hidden = false;
    const note = document.createElement('p');
    note.className = 'sketch-editor-error';
    note.textContent = t('editor.save_error');
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'sketch-editor-btn sketch-editor-btn-retry';
    retryBtn.textContent = t('sketch.retry_save');
    retryBtn.addEventListener('click', () => {
        footer.hidden = true;
        retryHandler();
    });
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'sketch-editor-btn sketch-editor-btn-discard';
    discardBtn.textContent = t('sketch.discard_changes');
    discardBtn.addEventListener('click', discardHandler);
    footer.append(note, retryBtn, discardBtn);
}

function formatTimestamp(value) {
    const parsed = new Date(value || '');
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

async function loadItemScene(itemId) {
    const payload = await api(`sketch_load&item_id=${encodeURIComponent(itemId)}`);
    return {
        item: payload.item,
        scene: asScene(payload.scene),
    };
}

async function loadDailyScene(date) {
    const payload = await api(`journal&date=${encodeURIComponent(date)}`);
    const item = payload.item || null;
    if (!item || Number(item.has_sketch) !== 1) {
        return { item, scene: emptyScene() };
    }
    const scenePayload = await api(`sketch_load&item_id=${encodeURIComponent(Number(item.id))}`);
    return { item, scene: asScene(scenePayload.scene) };
}

async function saveDraftScene(draft) {
    const body = new URLSearchParams({
        scene: JSON.stringify(draft.scene),
        base_scene: draft.baseScene?.elements?.length ? JSON.stringify(draft.baseScene) : '',
        expected_revision: String(draft.baseRevision),
    });
    if (draft.mode === 'daily') {
        body.set('date', draft.date);
        return api('sketch_save_daily', {
            method: 'POST',
            body,
            ...(draft.requestId ? { idempotencyKey: draft.requestId } : {}),
        });
    }
    body.set('item_id', String(draft.itemId));
    return api('sketch_save', {
        method: 'POST',
        body,
        ...(draft.requestId ? { idempotencyKey: draft.requestId } : {}),
    });
}

function createDraft({ mode, itemId, date, item, scene }) {
    return {
        mode,
        itemId: Number(item?.id) || Number(itemId) || null,
        date: date || '',
        baseRevision: Number(item?.revision) || 0,
        baseScene: asScene(scene),
        baseUpdatedAt: item?.updated_at || '',
        scene: asScene(scene),
        localUpdatedAt: '',
        dirty: false,
        requestId: '',
        conflict: null,
    };
}

async function openSketchEditorImpl({ item, date, mode }) {
    let itemId = Number(item?.id);
    const isDaily = mode === 'daily';
    if (!isDaily && (!Number.isInteger(itemId) || itemId <= 0)) return;

    const refs = buildOverlay();
    refs.status.textContent = t('editor.loading');
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    let roots = [];
    let pendingScene = null;
    let saveTimer = null;
    let saveInFlight = null;
    let unmounted = false;
    let blockingSaveError = false;
    let draft = null;
    let draftKey = '';
    let bundle = null;
    let userInteracted = false;
    let excalidrawApi = null;

    const isOpen = () => !unmounted && document.body.contains(refs.overlay);

    const unmountRoots = () => {
        roots.forEach(root => {
            try { root.unmount(); } catch {}
        });
        roots = [];
    };

    const safeUnmount = () => {
        if (unmounted) return;
        unmounted = true;
        if (saveTimer) clearTimeout(saveTimer);
        if (activeSketchRefresh === refreshFromServer) activeSketchRefresh = null;
        unmountRoots();
        refs.overlay.remove();
        resolveClosed();
    };

    const persistDraft = () => {
        if (draftKey && draft) saveSketchDraft(draftKey, draft);
    };

    const acceptCanonical = (payload, sentScene) => {
        const canonicalItem = payload?.item || draft?.conflict?.server?.item || null;
        const canonicalScene = asScene(payload?.scene ?? sentScene);
        draft.itemId = Number(canonicalItem?.id) || draft.itemId;
        draft.baseRevision = Number(canonicalItem?.revision) || draft.baseRevision;
        draft.baseScene = canonicalScene;
        draft.baseUpdatedAt = canonicalItem?.updated_at || '';
        draft.requestId = '';
        draft.conflict = null;
        const hasNewerLocalScene = pendingScene && !scenesEqual(pendingScene, sentScene);
        if (hasNewerLocalScene) {
            draft.scene = pendingScene;
            draft.dirty = true;
            persistDraft();
        } else {
            draft.scene = canonicalScene;
            draft.dirty = false;
            pendingScene = null;
            clearSketchDraft(draftKey);
        }
        refs.status.textContent = t('editor.saved');
    };

    const renderPreview = (host, scene) => {
        const root = bundle.ReactDOM.createRoot(host);
        roots.push(root);
        root.render(bundle.React.createElement(bundle.Excalidraw, {
            initialData: asScene(scene),
            viewModeEnabled: true,
            zenModeEnabled: true,
            UIOptions: {
                canvasActions: {
                    changeViewBackgroundColor: false,
                    clearCanvas: false,
                    export: false,
                    loadScene: false,
                    saveAsImage: false,
                    saveToActiveFile: false,
                    toggleTheme: false,
                },
            },
        }));
    };

    const buildConflictVersion = (className, label, version, actionLabel, action) => {
        const section = document.createElement('section');
        section.className = `sketch-conflict-version ${className}`;
        const heading = document.createElement('h3');
        heading.textContent = label;
        const timestamp = document.createElement('p');
        timestamp.className = 'sketch-conflict-timestamp';
        timestamp.textContent = formatTimestamp(version.updatedAt);
        const preview = document.createElement('div');
        preview.className = 'sketch-conflict-preview';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sketch-editor-btn sketch-editor-btn-retry';
        button.textContent = actionLabel;
        button.addEventListener('click', () => void action());
        section.append(heading, timestamp, preview, button);
        window.setTimeout(() => {
            if (isOpen()) renderPreview(preview, version.scene);
        }, 0);
        return section;
    };

    const renderConflict = () => {
        if (!draft?.conflict || !bundle || !isOpen()) return;
        blockingSaveError = false;
        unmountRoots();
        refs.host.hidden = true;
        refs.footer.hidden = true;
        refs.shell.querySelector('.sketch-conflict')?.remove();
        const conflict = document.createElement('section');
        conflict.className = 'sketch-conflict';
        const intro = document.createElement('p');
        intro.className = 'sketch-conflict-intro';
        intro.textContent = t('sketch.conflict_intro');
        const versions = document.createElement('div');
        versions.className = 'sketch-conflict-versions';
        versions.append(
            buildConflictVersion(
                'sketch-conflict-version-local',
                t('sketch.conflict_local'),
                draft.conflict.local,
                t('sketch.conflict_keep_local'),
                async () => {
                    const conflictSnapshot = draft.conflict;
                    draft.baseRevision = Number(conflictSnapshot.server.revision);
                    draft.baseScene = asScene(conflictSnapshot.server.scene);
                    draft.baseUpdatedAt = conflictSnapshot.server.updatedAt || '';
                    draft.scene = asScene(conflictSnapshot.local.scene);
                    draft.conflict = null;
                    draft.dirty = true;
                    draft.requestId = '';
                    persistDraft();
                    try {
                        const payload = await saveDraftScene(draft);
                        acceptCanonical(payload, draft.scene);
                        safeUnmount();
                    } catch (error) {
                        handleSaveFailure(error, draft.scene);
                    }
                }
            ),
            buildConflictVersion(
                'sketch-conflict-version-server',
                t('sketch.conflict_server'),
                draft.conflict.server,
                t('sketch.conflict_accept_server'),
                () => {
                    clearSketchDraft(draftKey);
                    safeUnmount();
                }
            )
        );
        conflict.append(intro, versions);
        refs.shell.insertBefore(conflict, refs.footer);
        refs.status.textContent = t('sketch.conflict_status');
    };

    const handleSaveFailure = (error, sentScene) => {
        draft.requestId = error?.idempotencyKey || draft.requestId || '';
        const serverItem = error?.payload?.item;
        if (Number(error?.status) === 409 && serverItem) {
            const serverScene = asScene(error.payload.scene);
            if (scenesEqual(serverScene, sentScene)) {
                acceptCanonical(error.payload, serverScene);
                return;
            }
            draft.requestId = '';
            draft.dirty = true;
            draft.conflict = {
                local: {
                    scene: asScene(sentScene),
                    updatedAt: draft.localUpdatedAt || new Date().toISOString(),
                },
                server: {
                    scene: serverScene,
                    updatedAt: serverItem.updated_at || '',
                    revision: Number(serverItem.revision),
                    item: serverItem,
                },
            };
            persistDraft();
            renderConflict();
            return;
        }
        draft.dirty = true;
        persistDraft();
        blockingSaveError = true;
        refs.status.textContent = error?.isNetworkError
            ? t('sketch.offline_queued')
            : t('editor.save_error');
        showSaveError(
            refs.footer,
            () => {
                blockingSaveError = false;
                void flushSave();
            },
            () => {
                clearSketchDraft(draftKey);
                safeUnmount();
            }
        );
    };

    const flushSave = async () => {
        if (saveInFlight) {
            try {
                await saveInFlight;
            } catch {
                return;
            }
        }
        if (!draft?.dirty || draft.conflict || !pendingScene) return;
        const sentScene = asScene(pendingScene);
        pendingScene = null;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        refs.status.textContent = t('editor.saving');
        saveInFlight = (async () => {
            try {
                const payload = await saveDraftScene({ ...draft, scene: sentScene });
                acceptCanonical(payload, sentScene);
            } catch (error) {
                const latestLocalScene = pendingScene || sentScene;
                pendingScene = latestLocalScene;
                handleSaveFailure(error, latestLocalScene);
                throw error;
            } finally {
                saveInFlight = null;
            }
        })();
        return saveInFlight;
    };

    const queueSave = scene => {
        const candidate = asScene(scene);
        if (!draft || scenesEqual(candidate, draft.scene)) return;
        draft.scene = candidate;
        draft.localUpdatedAt = new Date().toISOString();
        draft.dirty = true;
        draft.requestId = '';
        draft.conflict = null;
        pendingScene = candidate;
        persistDraft();
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            void flushSave().catch(() => {});
        }, 800);
    };

    const handleClose = async () => {
        if (draft?.conflict) {
            safeUnmount();
            return;
        }
        if (blockingSaveError) return;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (saveInFlight) {
            try { await saveInFlight; } catch { return; }
        }
        if (draft?.dirty && pendingScene) {
            try { await flushSave(); } catch { return; }
        }
        safeUnmount();
    };

    const refreshFromServer = async () => {
        if (!draft || !bundle || !isOpen()) return false;
        if (saveInFlight) {
            try { await saveInFlight; } catch {}
        }
        const canonical = isDaily
            ? await loadDailyScene(date)
            : await loadItemScene(itemId);
        if (!isOpen()) return false;
        const serverScene = asScene(canonical.scene);
        const serverItem = canonical.item || null;

        if (draft.conflict) {
            draft.conflict.server = {
                scene: serverScene,
                updatedAt: serverItem?.updated_at || '',
                revision: Number(serverItem?.revision) || 0,
                item: serverItem,
            };
            persistDraft();
            renderConflict();
            return true;
        }

        if (draft.dirty) {
            if (scenesEqual(serverScene, draft.scene)) {
                acceptCanonical(canonical, serverScene);
            } else if (scenesEqual(serverScene, draft.baseScene)) {
                draft.baseRevision = Number(serverItem?.revision) || 0;
                draft.baseUpdatedAt = serverItem?.updated_at || '';
                persistDraft();
            } else {
                draft.conflict = {
                    local: {
                        scene: asScene(draft.scene),
                        updatedAt: draft.localUpdatedAt || new Date().toISOString(),
                    },
                    server: {
                        scene: serverScene,
                        updatedAt: serverItem?.updated_at || '',
                        revision: Number(serverItem?.revision) || 0,
                        item: serverItem,
                    },
                };
                persistDraft();
                renderConflict();
            }
            return true;
        }

        draft.itemId = Number(serverItem?.id) || draft.itemId;
        draft.baseRevision = Number(serverItem?.revision) || 0;
        draft.baseScene = serverScene;
        draft.baseUpdatedAt = serverItem?.updated_at || '';
        draft.scene = serverScene;
        pendingScene = null;
        clearSketchDraft(draftKey);
        excalidrawApi?.updateScene({
            elements: serverScene.elements,
            appState: serverScene.appState,
        });
        return true;
    };

    refs.closeBtn.addEventListener('click', () => void handleClose());

    try {
        bundle = await ensureExcalidraw();
        const canonical = isDaily
            ? await loadDailyScene(date)
            : await loadItemScene(itemId);
        itemId = Number(canonical.item?.id) || itemId;
        draftKey = sketchDraftKey({ mode, itemId, date });
        const persisted = loadSketchDraft(draftKey);
        draft = persisted || createDraft({
            mode,
            itemId,
            date,
            item: canonical.item,
            scene: canonical.scene,
        });
        activeSketchRefresh = refreshFromServer;

        if (persisted?.conflict) {
            draft.conflict.server = {
                scene: canonical.scene,
                updatedAt: canonical.item?.updated_at || '',
                revision: Number(canonical.item?.revision) || 0,
                item: canonical.item,
            };
            persistDraft();
            renderConflict();
            return closed;
        }

        if (persisted?.dirty) {
            pendingScene = asScene(persisted.scene);
        } else {
            draft = createDraft({ mode, itemId, date, item: canonical.item, scene: canonical.scene });
        }
        const initialScene = asScene(draft.scene);
        const root = bundle.ReactDOM.createRoot(refs.host);
        roots.push(root);
        refs.host.addEventListener('pointerdown', () => {
            userInteracted = true;
        }, { capture: true });
        refs.host.addEventListener('keydown', () => {
            userInteracted = true;
        }, { capture: true });
        root.render(bundle.React.createElement(bundle.Excalidraw, {
            initialData: initialScene,
            excalidrawAPI: apiInstance => { excalidrawApi = apiInstance; },
            onChange: (elements, appState) => {
                if (!userInteracted) return;
                queueSave({ elements: elements ?? [], appState: appState ?? {} });
            },
            UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
        }));
        refs.status.textContent = draft.dirty ? t('sketch.local_changed') : '';
        if (draft.dirty && pendingScene) {
            saveTimer = window.setTimeout(() => {
                void flushSave().catch(() => {});
            }, 0);
        }
    } catch (error) {
        refs.status.textContent = '';
        refs.footer.replaceChildren();
        refs.footer.hidden = false;
        const note = document.createElement('p');
        note.className = 'sketch-editor-error';
        note.textContent = error?.message || t('sketch.editor_load_failed');
        refs.footer.appendChild(note);
    }

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
