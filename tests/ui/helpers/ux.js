const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', 'screenshots', 'flows');

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function flowName(testInfo, suffix) {
  const file = (testInfo.file || 'flow').replace(/.*\//, '').replace(/\.spec\.[cm]?[jt]sx?$/, '');
  const idx = String(testInfo.testIndex || 0).padStart(2, '0');
  const title = (testInfo.title || 'case').replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  return `${file}.${idx}-${title}-${suffix}.png`;
}

async function snap(page, testInfo, suffix) {
  ensureScreenshotDir();
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, flowName(testInfo, suffix)), fullPage: false });
  } catch (e) {
    // never fail a test on screenshot
  }
}

async function login(page, { username = 'playwright-user', password = 'playwright-pass' } = {}) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL(/index\.php/);
  await page.waitForLoadState('load');
  await page.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
}

function csrfToken(page) {
  return page.locator('meta[name="csrf-token"]').getAttribute('content');
}

async function touchTargetsBelowMin(page, { min = 44 } = {}) {
  // Audit helper: returns list of visible interactive elements with width or height < min
  return await page.evaluate(({ min }) => {
    const selectors = 'button, a, input, select, textarea, [role="button"], [role="link"]';
    const issues = [];
    for (const el of Array.from(document.querySelectorAll(selectors))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const tooSmall = rect.width < min || rect.height < min;
      if (tooSmall) {
        issues.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          text: (el.textContent || '').trim().slice(0, 40),
          aria: el.getAttribute('aria-label') || null,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }
    return issues;
  }, { min });
}

function attachClsListener(page) {
  // Expose Cumulative-Layout-Shift via PerformanceObserver on a window flag
  page.addInitScript(() => {
    window.__clsValue = 0;
    window.__clsEntries = [];
    try {
      const obs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) {
            window.__clsValue += e.value;
            window.__clsEntries.push({ value: e.value, time: e.startTime });
          }
        }
      });
      obs.observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* old browser */ }
  });
}

async function readCls(page) {
  return await page.evaluate(() => ({ value: window.__clsValue || 0, entries: window.__clsEntries || [] }));
}

module.exports = { snap, login, csrfToken, touchTargetsBelowMin, attachClsListener, readCls, SCREENSHOT_DIR };
