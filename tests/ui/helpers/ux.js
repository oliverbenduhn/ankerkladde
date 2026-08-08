const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test } = require('@playwright/test');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', '..', 'screenshots', 'flows');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const resetFixtures = new Set();

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function flowName(testInfo, suffix) {
  const file = (testInfo.file || 'flow').replace(/.*\//, '').replace(/\.spec\.[cm]?[jt]sx?$/, '');
  const project = (testInfo.project?.name || 'browser').replace(/[^a-z0-9-]+/gi, '-');
  const idx = String(testInfo.testIndex || 0).padStart(2, '0');
  const title = (testInfo.title || 'case').replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  return `${file}.${project}.${idx}-${title}-${suffix}.png`;
}

async function snap(page, testInfo, suffix) {
  ensureScreenshotDir();
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, flowName(testInfo, suffix)), fullPage: false });
  } catch (e) {
    // never fail a test on screenshot
  }
}

// ponytail: Per-Worker-User, damit parallele Flow-Worker (#74) sich nicht
// gegenseitig Vorbedingungen wegraeumen (Slot-User siehe
// scripts/ui-test-server.sh). Der Slot kommt aus parallelIndex (0 .. workers-1);
// workerIndex zaehlt bei jedem Worker-Neustart hoch und liefe aus den
// angelegten Usern heraus. Slot 0 = playwright-user, Slot n = playwright-user-n.
//
// testInfo wird bewusst selbst besorgt statt vom Aufrufer erwartet: sonst muss
// jede einzelne login()-Stelle daran denken, und eine vergessene faellt still
// auf den geteilten User zurueck — genau die Fehlerquelle aus #74.
const DEFAULT_TEST_USER = 'playwright-user';

function workerUsername(fallbackUsername, testInfo) {
  // Ein bewusst uebergebener Nutzer (z. B. der Admin) bleibt unangetastet.
  if (fallbackUsername !== DEFAULT_TEST_USER) {
    return fallbackUsername;
  }
  let info = testInfo;
  if (!info) {
    try {
      info = test.info();
    } catch (e) {
      return fallbackUsername; // ausserhalb eines laufenden Tests
    }
  }
  const workerCount = Number(process.env.PW_WORKER_COUNT || 1);
  const slot = info && typeof info.parallelIndex === 'number' ? info.parallelIndex : 0;
  if (workerCount > 1 && slot > 0) {
    return `playwright-user-${slot}`;
  }
  return fallbackUsername;
}

function resetWorkerFixture(username, testInfo) {
  const info = testInfo || test.info();
  const resetKey = `${info.testId || info.title}:${info.retry || 0}:${username}`;
  if (resetFixtures.has(resetKey)) return;

  const port = process.env.PLAYWRIGHT_PORT || '4173';
  const dataDir = process.env.EINKAUF_UI_TEST_DATA_DIR || path.join(REPO_ROOT, '.tmp', `ui-test-data-${port}`);
  const env = {
    ...process.env,
    EINKAUF_DATA_DIR: dataDir,
    EINKAUF_UI_TEST_USER: username,
  };
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      execFileSync('php', ['scripts/reset-ui-test-user.php'], {
        cwd: REPO_ROOT,
        env,
        stdio: 'pipe',
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      if (!/database is locked/i.test(output) || attempt === 7) throw error;
      // SQLite erlaubt genau einen Writer. Bei parallel gestarteten Workern
      // warten wir kurz und starten die vollständige, atomare Rücksetzung neu.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
  resetFixtures.add(resetKey);
}

async function login(page, opts = {}) {
  const { username = 'playwright-user', password = 'playwright-pass', testInfo } = opts;
  const resolvedUsername = workerUsername(username, testInfo);
  if (username === DEFAULT_TEST_USER) resetWorkerFixture(resolvedUsername, testInfo);
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill(resolvedUsername);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL(/index\.php/);
  await page.waitForLoadState('load');
  await page.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
}

function csrfToken(page) {
  return page.locator('meta[name="csrf-token"]').getAttribute('content');
}

async function touchTargetsBelowMin(page, {
  min = 44,
  selectors = 'button, a, input, select, textarea, label[for], label:has(input:not([type="hidden"])), [role="button"], [role="link"]',
} = {}) {
  // Audit helper: returns list of visible interactive elements with width or height < min
  return await page.evaluate(({ min, selectors }) => {
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
  }, { min, selectors });
}

async function interactionBlockers(page, { selectors = [] } = {}) {
  return await page.evaluate(({ selectors }) => {
    const describe = element => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
      const id = element.id ? `#${element.id}` : '';
      const classes = Array.from(element.classList || []).slice(0, 2);
      return `${element.tagName.toLowerCase()}${id}${classes.length ? `.${classes.join('.')}` : ''}`;
    };
    const roundedRect = rect => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    const issues = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        if (rect.width === 0 || rect.height === 0 || element.disabled) continue;

        if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.top < -1 || rect.bottom > window.innerHeight + 1) {
          issues.push({ selector, element: describe(element), reason: 'outside-viewport', rect: roundedRect(rect) });
          continue;
        }

        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
        const topElement = document.elementFromPoint(x, y);
        if (topElement && topElement !== element && !element.contains(topElement) && !topElement.contains(element)) {
          issues.push({
            selector,
            element: describe(element),
            reason: 'covered',
            blocker: describe(topElement),
            rect: roundedRect(rect),
          });
        }
      }
    }
    return issues;
  }, { selectors });
}

function attachClsListener(page) {
  // Expose Cumulative-Layout-Shift via PerformanceObserver on a window flag
  return page.addInitScript(() => {
    window.__clsValue = 0;
    window.__clsTotal = 0;
    window.__clsEntries = [];
    window.__clsMarks = [];
    let sessionValue = 0;
    let sessionStart = 0;
    let previousEntryTime = 0;

    const describeNode = node => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
      const parts = [];
      let current = node;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        const id = current.id ? `#${current.id}` : '';
        const classes = Array.from(current.classList || []).slice(0, 2);
        parts.unshift(`${current.tagName.toLowerCase()}${id}${classes.length ? `.${classes.join('.')}` : ''}`);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const roundedRect = rect => rect ? {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    } : null;

    window.__markCls = label => {
      window.__clsMarks.push({ label, time: Math.round(performance.now()), value: window.__clsValue });
    };
    window.__resetCls = label => {
      window.__clsValue = 0;
      window.__clsTotal = 0;
      window.__clsEntries = [];
      window.__clsMarks = [{ label, time: Math.round(performance.now()), value: 0 }];
      sessionValue = 0;
      sessionStart = 0;
      previousEntryTime = 0;
    };

    try {
      const obs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) {
            if (previousEntryTime === 0 || (e.startTime - previousEntryTime <= 1000 && e.startTime - sessionStart <= 5000)) {
              sessionValue += e.value;
            } else {
              sessionValue = e.value;
              sessionStart = e.startTime;
            }
            if (sessionStart === 0) sessionStart = e.startTime;
            previousEntryTime = e.startTime;
            window.__clsValue = Math.max(window.__clsValue, sessionValue);
            window.__clsTotal += e.value;
            window.__clsEntries.push({
              value: e.value,
              time: Math.round(e.startTime),
              sources: Array.from(e.sources || []).map(source => ({
                node: describeNode(source.node),
                previousRect: roundedRect(source.previousRect),
                currentRect: roundedRect(source.currentRect),
              })),
            });
          }
        }
      });
      obs.observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* old browser */ }
  });
}

async function readCls(page) {
  return await page.evaluate(() => ({
    value: window.__clsValue || 0,
    total: window.__clsTotal || 0,
    entries: window.__clsEntries || [],
    marks: window.__clsMarks || [],
  }));
}

async function markCls(page, label) {
  await page.evaluate(label => window.__markCls?.(label), label);
}

async function resetCls(page, label = 'reset') {
  await page.evaluate(label => window.__resetCls?.(label), label);
}

module.exports = {
  snap,
  login,
  csrfToken,
  touchTargetsBelowMin,
  interactionBlockers,
  attachClsListener,
  readCls,
  markCls,
  resetCls,
  SCREENSHOT_DIR,
};
