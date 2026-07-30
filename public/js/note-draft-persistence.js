import { userId } from './state.js';

const NOTE_DRAFT_KEY = `ankerkladde-note-draft:${userId}`;

export function loadNoteDraft(itemId = null) {
    try {
        const draft = JSON.parse(sessionStorage.getItem(NOTE_DRAFT_KEY) || 'null');
        if (!draft || !Number.isInteger(Number(draft.itemId))) return null;
        if (itemId !== null && Number(draft.itemId) !== Number(itemId)) return null;
        return draft;
    } catch {
        return null;
    }
}

export function saveNoteDraft(draft) {
    try {
        sessionStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // Der aktive Editor behaelt die Fassung im Speicher, wenn
        // sessionStorage ausnahmsweise nicht verfuegbar oder voll ist.
    }
}

export function clearNoteDraft(itemId = null) {
    if (itemId !== null) {
        const current = loadNoteDraft();
        if (current && Number(current.itemId) !== Number(itemId)) return;
    }
    sessionStorage.removeItem(NOTE_DRAFT_KEY);
}
