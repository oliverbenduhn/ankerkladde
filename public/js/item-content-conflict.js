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
