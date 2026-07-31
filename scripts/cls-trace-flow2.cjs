// Instrumentierung für den Journal-Boot-Shift (Flow 2).
// Hooked journalView.hidden (synchroner Setter → echter Verursacher-Stack)
// und beobachtet Klassen/Attribute von #app und main.list-area.
'use strict';

const { chromium, devices } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4181';
const USERNAME = process.env.PW_USER || 'playwright-user';
const PASSWORD = process.env.PW_PASS || 'playwright-pass';
const PROJECT = process.env.PROJECT || 'desktop';

const initScript = () => {
  window.__log = [];
  const push = (kind, detail, stack) => window.__log.push({
    t: Math.round(performance.now()), kind, detail,
    stack: (stack || '').split('\n').slice(1, 6).map(s => s.trim()).join(' | '),
  });

  // Prototyp-Hook ab document_start: ES-Module laufen vor DOMContentLoaded,
  // ein Instanz-Hook käme zu spät und verpasst die frühen Sets.
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  Object.defineProperty(HTMLElement.prototype, 'hidden', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) {
      if (this.id === 'journalView' || this.id === 'listSwipeStage') {
        push(`${this.id}.hidden=`, String(v), new Error().stack);
      }
      desc.set.call(this, v);
    },
  });

  const install = () => {
    const el = document.getElementById('journalView');
    if (!el) return false;
    const app = document.getElementById('app');
    const listArea = document.querySelector('main.list-area');
    new MutationObserver(muts => {
      for (const m of muts) {
        push('attr:' + (m.target.id || m.target.className.split(' ')[0]),
          `${m.attributeName}="${m.target.getAttribute(m.attributeName)}"`, '');
      }
    }).observe(document.documentElement, {
      attributes: true, subtree: true,
      attributeFilter: ['class', 'hidden', 'style', 'data-collapsed', 'data-mode', 'data-layout'],
    });

    const rect = () => {
      const r = listArea && listArea.getBoundingClientRect();
      const j = el.getBoundingClientRect();
      return `list-area=${r ? Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.y) : '-'} journalView=${Math.round(j.width)}x${Math.round(j.height)}@${Math.round(j.y)} appCls=${app ? app.className : '-'}`;
    };
    let last = '';
    setInterval(() => { const s = rect(); if (s !== last) { last = s; push('geom', s, ''); } }, 16);
    return true;
  };

  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
};

(async () => {
  const pixel = devices['Pixel 7'];
  const browser = await chromium.launch();
  const context = await browser.newContext(
    PROJECT === 'mobile' ? { ...pixel, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } },
  );
  await context.addInitScript(initScript);
  const page = await context.newPage();

  await page.goto(BASE + '/login.php', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Benutzername').fill(USERNAME);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/index\.php/),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
  await page.locator('#sectionTabs .section-tab').first().waitFor();
  await page.locator('#journalBtn').click();
  await page.waitForURL(/screen=journal/);
  await page.locator('#journalAgendaBody').waitFor();
  await page.waitForTimeout(800);

  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => page.reload({ waitUntil: 'domcontentloaded' }));
  await page.locator('#journalAgendaBody').waitFor();
  await page.waitForTimeout(2000);

  const log = await page.evaluate(() => window.__log);
  for (const e of log) {
    if (e.kind === 'geom') console.log(`  ${String(e.t).padStart(5)}ms  ${e.detail}`);
    else console.log(`* ${String(e.t).padStart(5)}ms  ${e.kind} ${e.detail}${e.stack ? '\n        ← ' + e.stack : ''}`);
  }
  await browser.close();
})().catch(err => { console.error(err); process.exit(2); });
