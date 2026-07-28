import { userId } from './state.js';

// ponytail: sessionStorage ist von Natur aus pro Tab isoliert (kein
// zusaetzliches Tab-ID-Schema noetig) und ueberlebt Reload/Navigation
// innerhalb desselben Tabs, aber nicht das Schliessen des Tabs - genau der
// Schutzumfang, den Spec AC #63 fuer unbestaetigte Entwuerfe fordert.
const DRAFT_KEY = `ankerkladde-edit-draft:${userId}`;

export function saveDraftSnapshot(editingId, draft) {
    try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ editingId, draft }));
    } catch {
        // sessionStorage kann in seltenen Faellen (privater Modus, voll) fehlschlagen;
        // der Entwurf bleibt dann nur im Speicher erhalten, kein Absturz.
    }
}

export function loadDraftSnapshot() {
    try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.draft) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearDraftSnapshot() {
    try {
        sessionStorage.removeItem(DRAFT_KEY);
    } catch {
        // no-op
    }
}

// Jede Feldaenderung am Entwurf persistiert sofort - Schutz ab der ersten
// Eingabe, ohne dass jeder einzelne input-Handler explizit speichern muss.
export function wrapDraftForPersistence(draft, editingId) {
    saveDraftSnapshot(editingId, draft);
    return new Proxy(draft, {
        set(target, prop, value) {
            target[prop] = value;
            saveDraftSnapshot(editingId, target);
            return true;
        },
    });
}
