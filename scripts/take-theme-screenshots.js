#!/usr/bin/env node
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '.tmp', 'ui-test-data');
if (!process.env.EINKAUF_DATA_DIR && fs.existsSync(DEFAULT_DATA_DIR)) {
    process.env.EINKAUF_DATA_DIR = DEFAULT_DATA_DIR;
}

const BASE = process.env.SCREENSHOT_BASE
    || process.env.PLAYWRIGHT_BASE_URL
    || `http://${process.env.PLAYWRIGHT_HOST || '127.0.0.1'}:${process.env.PLAYWRIGHT_PORT || '8099'}`;
const OUT = path.join(__dirname, '..', 'screenshots');

const REGULAR_USER = process.env.EINKAUF_REGULAR_USER || 'playwright-user';
const REGULAR_PASS = process.env.EINKAUF_REGULAR_PASS || 'playwright-pass';

const themes = [
    { id: 'hafenblau',    mode: 'light' },
    { id: 'parchment',    mode: 'light' },
    { id: 'meeresgruen',  mode: 'light' },
    { id: 'lavendelsegel',mode: 'light' },
    { id: 'monochrom',    mode: 'light' },
    { id: 'regenbogen',   mode: 'light' },
    { id: 'nachtwache',   mode: 'dark'  },
    { id: 'pier',         mode: 'dark'  },
    { id: 'mangrove',     mode: 'dark'  },
    { id: 'abyssus',      mode: 'dark'  },
    { id: 'monochrom-dark', mode: 'dark' },
    { id: 'grauton-dark', mode: 'dark'  },
];

function applyTheme(theme) {
    execFileSync('php', [path.join(__dirname, 'set-tester-theme.php'), theme.mode, theme.id], {
        stdio: 'ignore',
        env: process.env,
    });
}

(async () => {
    const browser = await chromium.launch({ headless: true });

    for (const theme of themes) {
        applyTheme(theme);
        console.log(`Theme gesetzt: ${theme.id} (${theme.mode})`);

        // Desktop
        {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const page = await ctx.newPage();
            await page.goto(`${BASE}/login.php`);
            await page.waitForTimeout(300);
            await page.fill('input[name="username"]', REGULAR_USER);
            await page.fill('input[name="password"]', REGULAR_PASS);
            await page.click('button[type="submit"]');
            // Admin-Nutzer landet auf admin.php – direkt zu index.php wechseln
            await page.waitForURL('**/{index,admin}.php', { timeout: 10000 });
            if (!page.url().includes('index')) {
                await page.goto(`${BASE}/index.php`);
            }
            await page.waitForSelector('.section-tab', { timeout: 10000 });
            await page.waitForTimeout(1800);
            const file = `theme-desktop-${theme.id}.png`;
            await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
            console.log(`  ✓ ${file}`);
            await ctx.close();
        }
    }

    await browser.close();

    // Preferences zurücksetzen
    execFileSync('php', [path.join(__dirname, 'reset-tester-prefs.php')], {
        stdio: 'ignore',
        env: process.env,
    });
    console.log('Preferences zurückgesetzt.');
})();
