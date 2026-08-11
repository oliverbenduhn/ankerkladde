export const ITEM_CONTENT_FIELDS = [
    'name',
    'barcode',
    'quantity',
    'due_date',
    'due_time',
    'priority',
    'content',
    'status',
];

function value(source, field) {
    return String(source?.[field] ?? '');
}

export function itemContentSnapshot(source) {
    return Object.fromEntries(ITEM_CONTENT_FIELDS.map(field => [field, value(source, field)]));
}

export function itemDraftHasLocalChanges(draft) {
    if (!draft) return false;
    const base = draft.baseContent || {};
    return ITEM_CONTENT_FIELDS.some(field => value(draft, field) !== value(base, field));
}

export function serverContentMatchesDraftBase(serverItem, draft) {
    const base = draft?.baseContent || {};
    return ITEM_CONTENT_FIELDS.every(field => value(serverItem, field) === value(base, field));
}

export function serverContentMatchesDraft(serverItem, draft) {
    return ITEM_CONTENT_FIELDS.every(field => value(serverItem, field) === value(draft, field));
}

export function rebaseItemDraft(draft, serverItem, { replaceLocal = false } = {}) {
    if (!draft || !serverItem) return;
    if (replaceLocal) {
        ITEM_CONTENT_FIELDS.forEach(field => {
            draft[field] = value(serverItem, field);
        });
    }
    draft.baseRevision = Number(serverItem.revision) || draft.baseRevision || 0;
    draft.baseContent = itemContentSnapshot(serverItem);
    draft.baseUpdatedAt = serverItem.updated_at || '';
}

// Setzt die Basisfelder eines frischen Drafts, falls sie noch fehlen -
// gemeinsame Init-Sequenz fuer Vollbild-Editor und Inline-Edit-Karte.
export function initItemDraftBase(draft, item) {
    if (!draft.baseContent || typeof draft.baseContent !== 'object') {
        draft.baseContent = itemContentSnapshot(item);
    }
    if (!Number(draft.baseRevision)) draft.baseRevision = Number(item.revision) || 0;
    if (!('requestId' in draft)) draft.requestId = '';
    if (!('conflict' in draft)) draft.conflict = null;
    return draft;
}

// Zentrale Entscheidung, wie ein Draft auf einen frischen Serverstand
// reagiert: 'replace' (keine lokalen Aenderungen -> Server komplett
// uebernehmen), 'rebase' (Server deckt sich inhaltlich mit dem Draft),
// 'rebase-quiet' (nur Metadaten/Status geaendert, Inhalt unveraendert)
// oder 'conflict' (echte inhaltliche Abweichung). Reine Funktion - der
// Aufrufer wendet die Entscheidung selbst per rebaseItemDraft() an.
export function resolveItemConflict(draft, serverItem) {
    if (!itemDraftHasLocalChanges(draft)) {
        return { type: 'replace' };
    }
    if (serverContentMatchesDraft(serverItem, draft)) {
        return { type: 'rebase' };
    }
    if (serverContentMatchesDraftBase(serverItem, draft)) {
        return { type: 'rebase-quiet' };
    }
    return {
        type: 'conflict',
        conflict: {
            local: itemContentSnapshot(draft),
            server: {
                ...itemContentSnapshot(serverItem),
                revision: Number(serverItem.revision),
                updatedAt: serverItem.updated_at || '',
                item: serverItem,
            },
        },
    };
}
