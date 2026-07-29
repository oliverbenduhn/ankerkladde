import { userId } from './state.js';

const SKETCH_DRAFTS_KEY = `ankerkladde-sketch-drafts:${userId}`;

function loadDrafts() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(SKETCH_DRAFTS_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function sketchDraftKey({ mode, itemId, date }) {
    return mode === 'daily' ? `daily:${date}` : `item:${Number(itemId)}`;
}

export function loadSketchDraft(key) {
    const draft = loadDrafts()[key];
    return draft && typeof draft === 'object' ? draft : null;
}

export function saveSketchDraft(key, draft) {
    try {
        const drafts = loadDrafts();
        drafts[key] = draft;
        sessionStorage.setItem(SKETCH_DRAFTS_KEY, JSON.stringify(drafts));
    } catch {
        // Die aktive Editor-Closure behaelt die Szene weiterhin im Speicher.
    }
}

export function clearSketchDraft(key) {
    try {
        const drafts = loadDrafts();
        delete drafts[key];
        if (Object.keys(drafts).length === 0) {
            sessionStorage.removeItem(SKETCH_DRAFTS_KEY);
        } else {
            sessionStorage.setItem(SKETCH_DRAFTS_KEY, JSON.stringify(drafts));
        }
    } catch {
        // Kein Absturz, falls sessionStorage nicht verfuegbar ist.
    }
}
