// Deterministischer CLS-Probe für Flow 2 (Tagesansicht / Agenda).
// Reproduziert 02-today-agenda.spec.js Schritt für Schritt, misst CLS aus
// PerformanceObserver(layout-shift) und ordnet jeden Shift sowohl seinen
// DOM-Quellen (Selektor + vorher-Rect → nachher-Rect) als auch dem
// Flow-Schritt zu, in dem er auftrat.
'use strict';

const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4181';
const USERNAME = process.env.PW_USER || 'playwright-user';
const PASSWORD = process.env.PW_PASS || 'playwright-pass';
const PROJECT = process.env.PROJECT || 'desktop';
const RUNS = Number(process.env.RUNS || 3);
const THRESHOLD = Number(process.env.CLS_THRESHOLD || 0.15);

const desktopViewport = { width: 1280, height: 900 };
const pixel = devices['Pixel 7'];

function pickDevice(project) {
  if (project === 'mobile') return { ...pixel, hasTouch: true, isMobile: true };
  return { viewport: desktopViewport };
}

const initScript = () => {
  window.__cls = { value: 0, entries: [], marks: [] };
  window.__mark = label => {
    window.__cls.marks.push({ label, time: Math.round(performance.now()) });
  };
  try {
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        const sources = (e.sources || []).map(s => {
          let node = s.node;
          const chain = [];
          while (node && node.nodeType === 1 && chain.length < 6) {
            const id = node.id ? `#${node.id}` : '';
            const cls = node.classList && node.classList.length
              ? '.' + Array.from(node.classList).slice(0, 3).join('.')
              : '';
            chain.unshift(`${node.tagName.toLowerCase()}${id}${cls}`);
            node = node.parentElement;
          }
          const prev = s.previousRect;
          const curr = s.currentRect;
          const r = v => (v ? { x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.width), h: Math.round(v.height) } : null);
          return { chain: chain.join(' > '), prev: r(prev), curr: r(curr) };
        });
        window.__cls.value += e.value;
        window.__cls.entries.push({ value: e.value, time: Math.round(e.startTime), sources });
      }
    });
    obs.observe({ type: 'layout-shift', buffered: true });
  } catch (err) { /* older browser */ }
};

const mark = (page, label) => page
  .evaluate(l => window.__mark && window.__mark(l), label)
  .catch(() => {}); // Navigation kann den Kontext zerstoeren; Marker ist dann egal

async function flow2(page) {
  await page.goto(BASE + '/login.php', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Benutzername').fill(USERNAME);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/index\.php/),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
  await page.locator('#sectionTabs .section-tab').first().waitFor();
  await mark(page, 'app-ready');

  // MINIMAL=1: kleinstes Szenario — Journal öffnen, neu laden, messen.
  if (process.env.MINIMAL === '1') {
    await page.locator('#journalBtn').click();
    await page.waitForURL(/screen=journal/);
    await page.locator('#journalAgendaBody').waitFor();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#journalAgendaBody').waitFor();
    await page.waitForTimeout(1500);
    await mark(page, 'nach-reload');
    return;
  }

  // Setup via API (wie im Spec)
  const csrf = await page.evaluate(() => document.querySelector('meta[name="csrf-token"]')?.content || '');
  const cats = await (await page.request.get(BASE + '/api.php?action=categories_list')).json();
  const dueCat = cats.categories.find(c => c.type === 'list_due_date');
  if (!dueCat) throw new Error('keine list_due_date-Kategorie');
  const name = `QA Probe2 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const resp = await page.request.post(BASE + '/api.php?action=quick_add', {
    headers: { 'X-CSRF-Token': csrf },
    form: { active_category_id: String(dueCat.id), input: `${name} heute` },
  });
  if (resp.status() !== 201) throw new Error('quick_add status ' + resp.status());

  await mark(page, 'vor-journalBtn');
  await page.locator('#journalBtn').click();
  await page.waitForURL(/screen=journal/);
  const agenda = page.locator('#journalAgendaBody');
  await agenda.waitFor();
  await page.waitForTimeout(1200);
  await mark(page, 'journal-offen');

  await page.locator('#journalAgendaCollapseBtn').click();
  await page.waitForTimeout(600);
  await mark(page, 'agenda-eingeklappt');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#journalAgendaBody').waitFor();
  await page.waitForTimeout(1200);
  await mark(page, 'nach-reload');

  await page.locator('#journalAgendaCollapseBtn').click();
  await page.waitForTimeout(600);
  await mark(page, 'agenda-ausgeklappt');

  const scheduled = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
  const anytime = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: name });
  const group = (await scheduled.count()) ? scheduled : anytime;
  await group.first().waitFor();

  await group.first().locator('.agenda-item-body').click();
  await page.waitForURL(/index\.php/);
  await page.waitForTimeout(1200);
  await mark(page, 'deeplink-ziel');

  await page.locator('#journalBtn').click();
  await page.waitForURL(/screen=journal/);
  await page.waitForTimeout(1200);
  await mark(page, 'zurueck-im-journal');

  const agenda2 = page.locator('#journalAgendaBody');
  if (await agenda2.getAttribute('data-collapsed') === 'true') {
    await page.locator('#journalAgendaCollapseBtn').click();
    await page.waitForTimeout(600);
  }
  const g2s = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
  const g2a = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: name });
  const group2 = (await g2s.count()) ? g2s : g2a;
  await group2.first().waitFor();
  await group2.first().locator('.agenda-item-checkbox').click();
  await page.waitForTimeout(1200);
  await mark(page, 'nach-toggle');
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const context = await browser.newContext({ ...pickDevice(PROJECT) });
    await context.addInitScript(initScript);
    const page = await context.newPage();
    try {
      await flow2(page);
      results.push({ run: i, cls: await page.evaluate(() => window.__cls) });
    } catch (err) {
      results.push({ run: i, error: err.message });
    } finally {
      await context.close();
    }
  }
  await browser.close();

  let max = 0;
  for (const r of results) {
    if (r.error) { console.log(`run ${r.run}: ERROR ${r.error}`); continue; }
    console.log(`\nrun ${r.run}: CLS=${r.cls.value.toFixed(4)} (${r.cls.entries.length} entries)`);
    const stepOf = t => {
      let label = '(vor erstem Mark)';
      for (const m of r.cls.marks) if (m.time <= t) label = `nach "${m.label}"`;
      return label;
    };
    // Aggregat pro Schritt
    const perStep = new Map();
    for (const e of r.cls.entries) {
      const k = stepOf(e.time);
      perStep.set(k, (perStep.get(k) || 0) + e.value);
    }
    console.log('  Summe je Schritt:');
    for (const [k, v] of perStep) console.log(`    ${v.toFixed(4)}  ${k}`);
    console.log('  Top-Shifts:');
    for (const e of [...r.cls.entries].sort((a, b) => b.value - a.value).slice(0, 8)) {
      console.log(`  +${e.value.toFixed(4)} @ ${e.time}ms  ${stepOf(e.time)}`);
      for (const s of e.sources.slice(0, 3)) {
        const f = v => (v ? `${v.w}x${v.h}@${v.x},${v.y}` : 'none');
        console.log(`    · ${s.chain}`);
        console.log(`      prev: ${f(s.prev)}  →  curr: ${f(s.curr)}`);
      }
    }
    if (r.cls.value > max) max = r.cls.value;
  }
  console.log(`\n${PROJECT} max-CLS über ${RUNS} runs: ${max.toFixed(4)} (Schwelle ${THRESHOLD})`);
  console.log(max > THRESHOLD ? 'FAIL' : 'PASS');
  process.exit(max > THRESHOLD ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
