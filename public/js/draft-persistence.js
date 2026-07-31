import { userId } from './state.js';
import { safeJsonParse } from './safe-json.js';

// ponytail: sessionStorage ist pro Tab isoliert (kein zusaetzliches
// Tab-ID-Schema noetig) und ueberlebt Reload/Navigation innerhalb
// desselben Tabs, aber nicht das Schliessen — Schutzumfang gemass
// AC #63 fuer unbestaetigte Entwuerfe.
const DRAFT_KEY = `ankerkladde-edit-draft:${userId}`;

export function saveDraftSnapshot(editingId, draft, item = null, serverDeleted = false) {
    try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ editingId, draft, item, serverDeleted }));
    } catch {
        // sessionStorage kann in seltenen Faellen (privater Modus, voll) fehlschlagen;
        // der Entwurf bleibt dann nur im Speicher erhalten, kein Absturz.
    }
}

export function loadDraftSnapshot() {
    const parsed = safeJsonParse(sessionStorage.getItem(DRAFT_KEY), null);
    if (!parsed || typeof parsed !== 'object' || !parsed.draft) return null;
    return parsed;
}

export function clearDraftSnapshot() {
    try {
        sessionStorage.removeItem(DRAFT_KEY);
    } catch {
        // no-op
    }
}

export function markDraftServerDeleted() {
    const snapshot = loadDraftSnapshot();
    if (!snapshot) return;
    saveDraftSnapshot(snapshot.editingId, snapshot.draft, snapshot.item, true);
}

// Jede Feldaenderung am Entwurf persistiert sofort - Schutz ab der ersten
// Eingabe, ohne dass jeder einzelne input-Handler explizit speichern muss.
export function wrapDraftForPersistence(draft, editingId, item = null, onChange = null) {
    saveDraftSnapshot(editingId, draft, item);
    return new Proxy(draft, {
        set(target, prop, value) {
            target[prop] = value;
            const snapshot = loadDraftSnapshot();
            saveDraftSnapshot(editingId, target, item || snapshot?.item, snapshot?.serverDeleted === true);
            onChange?.(target);
            return true;
        },
    });
}
