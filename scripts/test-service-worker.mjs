import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(fail = false) {
  const events = {}, added = [];
  let skipped = 0;
  const cache = { add: async (url) => {
    added.push(url);
    if (fail && String(url).includes('offline.html')) throw new Error('unavailable');
  }, match: async () => new Response('cached') };
  const self = {
    registration: { scope: 'https://app.example/sub/' }, location: { origin: 'https://app.example' },
    addEventListener: (name, callback) => { events[name] = callback; },
    skipWaiting: async () => { skipped++; },
  };
  vm.runInNewContext(source, {
    self, URL, Request, Response, Map, Set, TextDecoder, Uint8Array,
    console: { log() {}, warn() {} },
    caches: { open: async () => cache },
    fetch: async (url) => String(url).includes('manifest.json')
      ? new Response(JSON.stringify(['font.woff2']))
      : String(url).includes('app-shell-assets.json')
        ? new Response(JSON.stringify(['js/settings.js', 'styles/notes.css']))
        : Promise.reject(new Error('offline')),
  });
  return { events, added, skipped: () => skipped };
}

test('failed critical precache rejects installation without skipWaiting', async () => {
  const w = worker(true);
  let completion;
  w.events.install({ waitUntil(promise) { completion = promise; } });
  await assert.rejects(completion, /assets failed/);
  assert.equal(w.skipped(), 0);
});

test('complete module manifest is versioned and installed before activation', async () => {
  const w = worker();
  let completion;
  w.events.install({ waitUntil(promise) { completion = promise; } });
  await completion;
  assert.equal(w.skipped(), 1);
  assert.ok(w.added.some(url => /\/sub\/js\/settings.js\?v=/.test(url)));
  assert.ok(w.added.some(url => /\/sub\/styles\/notes.css\?v=/.test(url)));
});

test('subdirectory CSS, JS and vendor fonts use precache while offline', async () => {
  const w = worker();
  for (const path of ['style.css', 'styles/notes.css', 'js/settings.js', 'vendor/editors/font.woff2', 'icon.php?size=192', 'ui-sprite.php?v=old#icon-pencil']) {
    let response;
    w.events.fetch({ request: new Request(`https://app.example/sub/${path}`), respondWith(promise) { response = promise; } });
    assert.ok(response, `${path} must be handled`);
    assert.equal(await (await response).text(), 'cached');
  }
});
