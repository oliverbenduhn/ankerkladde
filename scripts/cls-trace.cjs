// Hochfrequentes Sampling des clearDoneBtn um den 0x0-Moment einzukreisen
'use strict';

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4210';
const USERNAME = process.env.PW_USER || 'playwright-user';
const PASSWORD = process.env.PW_PASS || 'playwright-pass';

const initScript = () => {
  window.__samples = [];
  let lastSig = null;
  function tick() {
    const btn = document.getElementById('clearDoneBtn');
    const app = document.getElementById('app');
    if (!btn || !app) return;
    const r = btn.getBoundingClientRect();
    const sig = JSON.stringify({
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
      hidden: btn.hidden,
      disabled: btn.disabled,
      disp: window.getComputedStyle(btn).display,
      vis: window.getComputedStyle(btn).visibility,
      cls: btn.className,
      appMode: app.dataset.mode || '',
      appCls: app.className,
    });
    if (sig !== lastSig) {
      lastSig = sig;
      window.__samples.push({ t: performance.now(), sig });
    }
  }
  setInterval(tick, 4);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(initScript);
  const page = await context.newPage();

  await page.goto(BASE + '/login.php', { waitUntil: 'load' });
  await page.getByLabel('Benutzername').fill(USERNAME);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/index\.php/),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
  await page.locator('#sectionTabs .section-tab').first().waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__samples = []; });

  const einkauf = page.getByRole('button', { name: /^Einkauf/ }).first();
  await einkauf.click();
  await page.waitForTimeout(1500);

  const samples = await page.evaluate(() => window.__samples);
  console.log('samples:', samples.length);
  for (const s of samples) {
    const p = JSON.parse(s.sig);
    console.log(`  ${s.t.toFixed(1)}ms disp=${p.disp} v=${p.vis} size=${p.w}x${p.h}@${p.x},${p.y} hidden=${p.hidden} disabled=${p.disabled} cls=${p.cls} appMode=${p.appMode} appCls=${p.appCls}`);
  }
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
