import { userId } from './state.js';

const JOURNAL_DRAFT_KEY = `ankerkladde-journal-text-draft:${userId}`;

export function loadJournalDraft(date = null) {
    try {
        const draft = JSON.parse(sessionStorage.getItem(JOURNAL_DRAFT_KEY) || 'null');
        if (!draft || typeof draft.date !== 'string') return null;
        if (date !== null && draft.date !== date) return null;
        return draft;
    } catch {
        return null;
    }
}

export function saveJournalDraft(draft) {
    try {
        sessionStorage.setItem(JOURNAL_DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // Der aktive Editor behaelt die Fassung im Speicher.
    }
}

export function clearJournalDraft(date = null) {
    if (date !== null) {
        const current = loadJournalDraft();
        if (current && current.date !== date) return;
    }
    sessionStorage.removeItem(JOURNAL_DRAFT_KEY);
}
