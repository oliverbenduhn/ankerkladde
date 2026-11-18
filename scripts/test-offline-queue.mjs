import assert from 'node:assert/strict';
import test from 'node:test';

let data = new Map();
let refuseConflict = false;
globalThis.window = Object.assign(new EventTarget(), { name: '' });
globalThis.document = { querySelector: () => ({ content: 'test', getAttribute: () => 'test' }), getElementById: () => null };
function storage() {
    const entries = new Map();
    return {
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key),
    };
}
Object.defineProperty(globalThis, 'sessionStorage', { value: storage() });
Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
        if (refuseConflict && key.includes('offline-conflicts')) throw new DOMException('Full', 'QuotaExceededError');
        data.set(key, value);
    },
    removeItem: key => data.delete(key),
} });

const queue = await import('../public/js/offline-queue.js');

test('flush preserves new and coalesced entries across reload without sending twice', async () => {
    queue.enqueueAction('toggle', { id: '1', done: '1' }, 'old');
    const response = Promise.withResolvers();
    const first = queue.flushQueue(() => response.promise);
    queue.enqueueAction('toggle', { id: '1', done: '0' }, 'new');
    queue.enqueueAction('add', { name: 'Milch' }, 'add');
    assert.equal(await queue.flushQueue(() => assert.fail('concurrent flush')), false);
    response.resolve();
    await first;
    const reloaded = await import('../public/js/offline-queue.js?reload=1');
    const sent = [];
    await reloaded.flushQueue(async (_, options) => sent.push(options.idempotencyKey));
    assert.deepEqual(sent, ['new', 'add']);
    assert.equal(reloaded.getPendingCount(), 0);
});

test('full store and quota errors retain both existing conflicts and pending actions', async () => {
    data = new Map();
    const error = Object.assign(new Error('Conflict'), { status: 409 });
    const reject = async () => { throw error; };
    queue.enqueueAction('add', { name: 'Milch' }, 'pending');
    for (let id = 0; id < 50; id++) assert.equal(queue.addConflict('toggle', { id }, error), true);
    const saved = queue.getConflicts();
    let warnings = 0;
    const warn = () => warnings++;
    assert.equal(await queue.flushQueue(reject, undefined, warn), false);
    assert.deepEqual(queue.getConflicts(), saved);
    queue.clearConflicts();
    refuseConflict = true;
    try {
        assert.equal(await queue.flushQueue(reject, undefined, warn), false);
    } finally {
        refuseConflict = false;
    }
    const reloaded = await import('../public/js/offline-queue.js?reload=2');
    assert.equal(warnings, 2);
    assert.equal(reloaded.getPendingCount(), 1);
    assert.equal(await reloaded.flushQueue(reject), true);
    assert.equal(reloaded.getPendingCount(), 0);
    assert.equal(reloaded.getConflicts()[0].payload.name, 'Milch');
});
