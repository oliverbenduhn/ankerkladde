import test from 'node:test';
import assert from 'node:assert/strict';
import {
    initItemDraftBase,
    itemContentSnapshot,
    resolveItemConflict,
} from '../public/js/item-content-conflict.js';

function makeDraft(overrides = {}) {
    const base = { name: 'Milch', quantity: '1', barcode: '', due_date: '', due_time: '', priority: '', content: '', status: '' };
    return {
        ...base,
        baseContent: itemContentSnapshot(base),
        baseRevision: 1,
        requestId: '',
        conflict: null,
        ...overrides,
    };
}

function makeServerItem(overrides = {}) {
    return { name: 'Milch', quantity: '1', barcode: '', due_date: '', due_time: '', priority: '', content: '', status: '', revision: 2, updated_at: '2026-08-11T10:00:00Z', ...overrides };
}

test('resolveItemConflict: keine lokalen Aenderungen -> replace', () => {
    const draft = makeDraft();
    const serverItem = makeServerItem({ name: 'Butter' });
    const decision = resolveItemConflict(draft, serverItem);
    assert.equal(decision.type, 'replace');
});

test('resolveItemConflict: Server deckt sich mit Draft-Inhalt -> rebase', () => {
    const draft = makeDraft({ name: 'Butter' });
    const serverItem = makeServerItem({ name: 'Butter', quantity: '1' });
    const decision = resolveItemConflict(draft, serverItem);
    assert.equal(decision.type, 'rebase');
});

test('resolveItemConflict: Server-Inhalt unveraendert, nur Revision/Reihenfolge -> rebase-quiet', () => {
    const draft = makeDraft({ name: 'Butter' });
    // Inhaltlich identisch zur Basis (Milch) - nur Revision ist weitergesprungen,
    // z.B. weil sich Reihenfolge oder Attachment am Server geaendert haben.
    const serverItem = makeServerItem({ name: 'Milch', revision: 3 });
    const decision = resolveItemConflict(draft, serverItem);
    assert.equal(decision.type, 'rebase-quiet');
});

test('resolveItemConflict: echte inhaltliche Abweichung -> conflict mit lokaler und Server-Fassung', () => {
    const draft = makeDraft({ name: 'Butter' });
    const serverItem = makeServerItem({ name: 'Käse' });
    const decision = resolveItemConflict(draft, serverItem);
    assert.equal(decision.type, 'conflict');
    assert.equal(decision.conflict.local.name, 'Butter');
    assert.equal(decision.conflict.server.name, 'Käse');
    assert.equal(decision.conflict.server.revision, 2);
    assert.equal(decision.conflict.server.item, serverItem);
});

test('initItemDraftBase: setzt fehlende Basisfelder', () => {
    const item = makeServerItem({ revision: 5 });
    const draft = { name: 'Milch' };
    initItemDraftBase(draft, item);
    assert.equal(draft.baseRevision, 5);
    assert.deepEqual(draft.baseContent, itemContentSnapshot(item));
    assert.equal(draft.requestId, '');
    assert.equal(draft.conflict, null);
});

test('initItemDraftBase: ueberschreibt vorhandene Basisfelder nicht', () => {
    const item = makeServerItem({ revision: 5 });
    const draft = { baseRevision: 1, baseContent: { name: 'bestehend' }, requestId: 'abc', conflict: { local: {}, server: {} } };
    initItemDraftBase(draft, item);
    assert.equal(draft.baseRevision, 1);
    assert.deepEqual(draft.baseContent, { name: 'bestehend' });
    assert.equal(draft.requestId, 'abc');
    assert.ok(draft.conflict);
});
