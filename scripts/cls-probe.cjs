// Deterministischer CLS-Probe für den First-Run-Flow.
// Reproduziert Flow 1 (login → einkauf → quick-add → toggle done),
// misst CLS aus PerformanceObserver(layout-shift) und gibt für jeden
// Layout-Shift die DOM-Quellen (Selektor + vorher Rect → nachher Rect)
// aus, damit der Verursacher zugeordnet werden kann.
'use strict';

const path = require('path');
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const USERNAME = process.env.PW_USER || 'playwright-user';
const PASSWORD = process.env.PW_PASS || 'playwright-pass';
const PROJECT = process.env.PROJECT || 'desktop';
const RUNS = Number(process.env.RUNS || 5);
const THRESHOLD = Number(process.env.CLS_THRESHOLD || 0.1);

const desktopViewport = { width: 1280, height: 900 };
const pixel = devices['Pixel 7'];

function pickDevice(project) {
  if (project === 'mobile') {
    return { ...pixel, hasTouch: true, isMobile: true };
  }
  return { viewport: desktopViewport };
}

const initScript = () => {
  window.__cls = { value: 0, entries: [] };
  try {
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        const sources = (e.sources || []).map(s => {
          let node = s.node;
          let chain = [];
          while (node && node.nodeType === 1 && chain.length < 6) {
            let id = node.id ? `#${node.id}` : '';
            let cls = node.classList && node.classList.length
              ? '.' + Array.from(node.classList).slice(0, 3).join('.')
              : '';
            chain.unshift(`${node.tagName.toLowerCase()}${id}${cls}`);
            node = node.parentElement;
          }
          const prev = s.previousRect;
          const curr = s.currentRect;
          return {
            chain: chain.join(' > '),
            tag: s.node && s.node.tagName ? s.node.tagName.toLowerCase() : null,
            id: s.node && s.node.id ? s.node.id : null,
            prev: prev ? { x: Math.round(prev.x), y: Math.round(prev.y), w: Math.round(prev.width), h: Math.round(prev.height) } : null,
            curr: curr ? { x: Math.round(curr.x), y: Math.round(curr.y), w: Math.round(curr.width), h: Math.round(curr.height) } : null,
          };
        });
        window.__cls.value += e.value;
        window.__cls.entries.push({ value: e.value, time: Math.round(e.startTime), sources });
      }
    });
    obs.observe({ type: 'layout-shift', buffered: true });
  } catch (err) {}
};

async function loginFlow(page) {
  await page.goto(BASE + '/login.php', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Benutzername').fill(USERNAME);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/index\.php/),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
  await page.locator('#sectionTabs .section-tab').first().waitFor();

  const einkauf = page.getByRole('button', { name: /^Einkauf/ }).first();
  await einkauf.click();

  const name = `QA Probe ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const input = page.locator('#itemInput');
  const respPromise = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
  await input.fill(`${name} !2`);
  await input.press('Enter');
  await respPromise;

  const card = page.locator('.item-card').filter({ hasText: name });
  await card.waitFor();
  await card.locator('input.toggle').first().click();
  await page.waitForTimeout(500); // warte, bis Mutation abgeklungen
}

async function probeAll() {
  const browser = await chromium.launch();
  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const context = await browser.newContext({ ...pickDevice(PROJECT) });
    await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('  [console.error]', msg.text());
    });
    try {
      await loginFlow(page);
      const cls = await page.evaluate(() => window.__cls);
      const extra = await page.evaluate(() => {
        const btn = document.getElementById('clearDoneBtn');
        const tabs = document.getElementById('sectionTabs');
        const sb = document.getElementById('scanAddBtn');
        const sbRect = sb ? sb.getBoundingClientRect() : null;
        const tabsRect = tabs ? tabs.getBoundingClientRect() : null;
        const btnRect = btn ? btn.getBoundingClientRect() : null;
        return {
          clearDone: btn ? { hidden: btn.hidden, disabled: btn.disabled, display: window.getComputedStyle(btn).display, rect: btnRect && { w: Math.round(btnRect.width), h: Math.round(btnRect.height) } } : null,
          tabs: tabs ? { className: tabs.className, rect: tabsRect && { w: Math.round(tabsRect.width), h: Math.round(tabsRect.height), n: tabs.children.length } } : null,
          scanAdd: sb ? { hidden: sb.hidden, display: window.getComputedStyle(sb).display, rect: sbRect && { x: Math.round(sbRect.x), y: Math.round(sbRect.y), w: Math.round(sbRect.width), h: Math.round(sbRect.height) } } : null,
        };
      });
      results.push({ run: i, cls, extra });
    } catch (err) {
      results.push({ run: i, error: err.message });
    } finally {
      await context.close();
    }
  }
  await browser.close();
  return results;
}

(async () => {
  const results = await probeAll();
  let max = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`run ${r.run}: ERROR ${r.error}`);
      continue;
    }
    console.log(`run ${r.run}: CLS=${r.cls.value.toFixed(4)} (${r.cls.entries.length} entries)`);
    if (r.extra) {
      console.log(`  final: clearDone[${r.extra.clearDone?.display}/${r.extra.clearDone?.rect?.w}x${r.extra.clearDone?.rect?.h}] tabs[n=${r.extra.tabs?.rect?.n},is-scrollable=${r.extra.tabs?.className?.includes('is-scrollable')}] scanAdd[x=${r.extra.scanAdd?.rect?.x},hidden=${r.extra.scanAdd?.hidden}]`);
    }
    for (const e of r.cls.entries) {
      console.log(`  +${e.value.toFixed(4)} @ ${e.time}ms`);
      for (const s of e.sources) {
        const prev = s.prev ? `${s.prev.w}x${s.prev.h}@${s.prev.x},${s.prev.y}` : 'none';
        const curr = s.curr ? `${s.curr.w}x${s.curr.h}@${s.curr.x},${s.curr.y}` : 'none';
        console.log(`    · ${s.chain}`);
        console.log(`      prev: ${prev}  →  curr: ${curr}`);
      }
    }
    if (r.cls.value > max) max = r.cls.value;
  }
  console.log(`\n${PROJECT} max-CLS over ${RUNS} runs: ${max.toFixed(4)} (threshold ${THRESHOLD})`);
  if (max > THRESHOLD) {
    console.log('FAIL');
    process.exit(1);
  } else {
    console.log('PASS');
  }
})().catch(err => {
  console.error(err);
  process.exit(2);
});
