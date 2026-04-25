#!/usr/bin/env node
// Playwright-Script: Produktvorstellung Screenshots für Ankerkladde
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8099';
const OUT  = path.join(__dirname, '..', 'screenshots');

const REGULAR_USER = process.env.EINKAUF_REGULAR_USER || 'playwright-user';
const REGULAR_PASS = process.env.EINKAUF_REGULAR_PASS || 'playwright-pass';
const ADMIN_USER   = process.env.EINKAUF_ADMIN_USER   || 'playwright-admin';
const ADMIN_PASS   = process.env.EINKAUF_ADMIN_PASS   || 'playwright-pass';

// Mobile: 360×780 @2x (Elemente wirken größer)
const VIEWPORT_MOBILE  = { width: 360, height: 780 };
// Desktop: 1280×800
const VIEWPORT_DESKTOP = { width: 1280, height: 800 };

fs.mkdirSync(OUT, { recursive: true });

// Tester-Preferences vor jedem Lauf zurücksetzen
execSync(`php "${path.join(__dirname, 'reset-tester-prefs.php')}"`);
console.log('Preferences zurückgesetzt.');

async function login(page, username = REGULAR_USER, password = REGULAR_PASS) {
    await page.goto(`${BASE}/login.php`);
    await page.waitForTimeout(400);
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    // Warten bis Login-Formular verschwindet
    await page.waitForFunction(() => !document.querySelector('input[name="password"]'), { timeout: 10000 });
    // Warten bis section-tabs erscheinen, dann 2s für vollständige Initialisierung
    await page.waitForSelector('.section-tab', { timeout: 10000 });
    await page.waitForTimeout(2200);
}

async function loginAsAdmin(page) {
    await page.context().clearCookies();
    await page.goto(`${BASE}/login.php`);
    await page.waitForTimeout(400);
    await page.fill('input[name="username"]', ADMIN_USER);
    await page.fill('input[name="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
}

async function shot(page, name) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png`);
}

// Wartet auf ProseMirror und injiziert Demo-Inhalt falls leer
async function ensureNoteContent(page) {
    // Warten bis ProseMirror erscheint
    await page.waitForSelector('.ProseMirror', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const isEmpty = await page.evaluate(() => {
        const pm = document.querySelector('.ProseMirror');
        if (!pm) return true;
        const text = pm.innerText?.trim() || '';
        return text === '' || text === '\n';
    });

    if (isEmpty) {
        await page.evaluate(() => {
            const pm = document.querySelector('.ProseMirror');
            if (!pm) return;
            pm.innerHTML = `
                <h2>Kroatien – Ideen</h2>
                <ul>
                    <li>Dubrovnik &amp; Altstadt</li>
                    <li>Insel Hvar – Bootstour</li>
                    <li>Nationalpark Plitvicer Seen</li>
                </ul>
                <p>Flüge am besten <strong>Ende Juni</strong> buchen, vor dem Schulferienstart. Budget: ca. 1.500 € p.&nbsp;P.</p>
            `;
        });
        await page.waitForTimeout(300);
    }
}

async function waitForItems(page) {
    await page.waitForFunction(
        () => {
            const list = document.getElementById('list');
            return list && list.querySelectorAll('li').length > 0;
        },
        { timeout: 5000 }
    ).catch(() => {});
    await page.waitForTimeout(400);
}

// Klickt Tab per Kategorie-Name (section-tab oder mehr-menu)
async function clickTab(page, nameRegex) {
    // Direkt sichtbarer Tab?
    const direct = page.locator('.section-tab').filter({ hasText: nameRegex }).first();
    if (await direct.count() > 0) {
        try {
            await direct.click({ timeout: 3000 });
            await waitForItems(page);
            return true;
        } catch (_) { /* Tab nicht klickbar, versuche Mehr-Menü */ }
    }
    // Im Mehr-Menü?
    const mehrBtn = page.locator('.mehr-btn').first();
    if (await mehrBtn.count() > 0) {
        try {
            await mehrBtn.click({ timeout: 3000 });
            await page.waitForTimeout(350);
            const item = page.locator('.mehr-item').filter({ hasText: nameRegex }).first();
            if (await item.count() > 0) {
                await item.click({ timeout: 3000 });
                await waitForItems(page);
                return true;
            }
        } catch (_) { /* ignore */ }
        await page.keyboard.press('Escape');
    }
    return false;
}

(async () => {
    const browser = await chromium.launch({ headless: true });

    // ===== MOBILE =====
    {
        const ctx = await browser.newContext({ viewport: VIEWPORT_MOBILE, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        console.log('📱 Mobile Screenshots (Pixel 7 Pro 412×892)...');

        // 01 Login
        await page.goto(`${BASE}/login.php`);
        await page.waitForTimeout(500);
        await shot(page, 'mobile-01-login');

        await login(page);

        // 02 Einkaufsliste
        await shot(page, 'mobile-02-einkauf');

        // 03 Einkaufen-Modus (ohne Kategorienleiste)
        const toShopBtn = page.locator('.btn-mode-toggle[data-nav="einkaufen"]').first();
        if (await toShopBtn.count() > 0) {
            await toShopBtn.click();
            await page.waitForTimeout(500);
            // Kategorienleiste ausblenden (shopping-only header)
            await page.locator('.app-header.shopping-only .btn-tabs-toggle').click({ force: true });
            await page.waitForTimeout(400);
            await shot(page, 'mobile-03-einkaufen-modus');
            // Kategorienleiste wieder einblenden, zurück zu Liste
            await page.locator('.app-header.shopping-only .btn-tabs-toggle').click({ force: true });
            await page.waitForTimeout(200);
            const toListBtn = page.locator('.btn-mode-toggle[data-nav="liste"]').first();
            await toListBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        // 04 Privat (Fälligkeiten)
        await clickTab(page, /privat/i);
        await shot(page, 'mobile-04-privat-todos');

        // 05 Arbeit
        await clickTab(page, /arbeit/i);
        await shot(page, 'mobile-05-arbeit-todos');

        // 06 Notizen (Liste der Notizen)
        await clickTab(page, /notiz/i);
        await shot(page, 'mobile-06-notizen');

        // 07 Notiz öffnen (erste Notiz anklicken)
        await clickTab(page, /notiz/i);
        const firstNoteItem = page.locator('li .item-name, li .note-preview, #list li').first();
        if (await firstNoteItem.count() > 0) {
            try {
                await firstNoteItem.click({ timeout: 3000 });
                await ensureNoteContent(page);
                await shot(page, 'mobile-07-notiz-offen');
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            } catch (_) { /* skip */ }
        }

        // 08 Bilder
        await clickTab(page, /bild/i);
        await page.waitForTimeout(800);
        await shot(page, 'mobile-08-bilder');

        // 09 Links (ggf. im Mehr-Menü)
        await clickTab(page, /links/i);
        await shot(page, 'mobile-09-links');

        // 10 Suche — Seite neu laden, dann Einkauf öffnen und suchen
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('input[name="password"]'), { timeout: 10000 });
        await page.waitForTimeout(1200);
        const searchBtn = page.locator('#searchBtn').first();
        if (await searchBtn.count() > 0) {
            await searchBtn.click();
            await page.waitForTimeout(400);
            await page.fill('#searchInput', 'Pasta');
            await page.waitForTimeout(900);
            await shot(page, 'mobile-10-suche');
        }

        // 11 Admin (als Admin-User einloggen)
        await loginAsAdmin(page);
        await page.goto(`${BASE}/admin.php`);
        await page.waitForTimeout(1000);
        await shot(page, 'mobile-11-admin');

        // 12 Settings – Themes-Panel
        await page.goto(`${BASE}/settings.php`);
        await page.waitForSelector('details[data-settings-panel="appearance"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        await page.evaluate(() => {
            const d = document.querySelector('details[data-settings-panel="appearance"]');
            if (d) { d.open = true; d.scrollIntoView({ behavior: 'instant', block: 'start' }); }
        });
        await page.waitForTimeout(500);
        await shot(page, 'mobile-12-settings-themes');

        await ctx.close();
    }

    // ===== DESKTOP =====
    {
        // Preferences vor Desktop-Session zurücksetzen
        execSync(`php "${path.join(__dirname, 'reset-tester-prefs.php')}"`);

        const ctx = await browser.newContext({ viewport: VIEWPORT_DESKTOP, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        console.log('\n🖥️  Desktop Screenshots (1440×900)...');

        await login(page);

        // 01 Einkaufsliste
        await shot(page, 'desktop-01-einkauf');

        // 02 Einkaufen-Modus
        const toShopBtn = page.locator('.btn-mode-toggle[data-nav="einkaufen"]').first();
        if (await toShopBtn.count() > 0) {
            await toShopBtn.click();
            await page.waitForTimeout(500);
            // Kategorienleiste ausblenden
            await page.locator('.app-header.shopping-only .btn-tabs-toggle').click({ force: true });
            await page.waitForTimeout(400);
            await shot(page, 'desktop-02-einkaufen-modus');
            // Kategorienleiste wieder einblenden, zurück zu Liste
            await page.locator('.app-header.shopping-only .btn-tabs-toggle').click({ force: true });
            await page.waitForTimeout(200);
            const toListBtn = page.locator('.btn-mode-toggle[data-nav="liste"]').first();
            await toListBtn.click({ force: true });
            await page.waitForTimeout(500);
        }

        // 03 Privat
        await clickTab(page, /privat/i);
        await shot(page, 'desktop-03-privat');

        // 04 Notizen
        await clickTab(page, /notiz/i);
        await shot(page, 'desktop-04-notizen');

        // 05 Notiz offen
        const firstNote = page.locator('#list li').first();
        if (await firstNote.count() > 0) {
            try {
                await firstNote.click({ timeout: 3000 });
                await ensureNoteContent(page);
                await shot(page, 'desktop-05-notiz-offen');
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            } catch (_) { /* skip */ }
        }

        // 06 Bilder
        await clickTab(page, /bild/i);
        await page.waitForTimeout(800);
        await shot(page, 'desktop-06-bilder');

        // 07 Links
        await clickTab(page, /links/i);
        await shot(page, 'desktop-07-links');

        // 08 Suche
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('input[name="password"]'), { timeout: 10000 });
        await page.waitForTimeout(1200);
        const searchBtn = page.locator('#searchBtn').first();
        if (await searchBtn.count() > 0) {
            await searchBtn.click();
            await page.waitForTimeout(400);
            await page.fill('#searchInput', 'Pasta');
            await page.waitForTimeout(900);
            await shot(page, 'desktop-08-suche');
        }

        // 09 Settings – Themes-Panel
        await page.goto(`${BASE}/settings.php`);
        await page.waitForSelector('details[data-settings-panel="appearance"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        await page.evaluate(() => {
            const d = document.querySelector('details[data-settings-panel="appearance"]');
            if (d) { d.open = true; d.scrollIntoView({ behavior: 'instant', block: 'start' }); }
        });
        await page.waitForTimeout(500);
        await shot(page, 'desktop-09-settings-themes');

        // 10 Admin (als Admin-User einloggen)
        await loginAsAdmin(page);
        await page.goto(`${BASE}/admin.php`);
        await page.waitForTimeout(1000);
        await shot(page, 'desktop-10-admin');

        await ctx.close();
    }

    await browser.close();
    console.log(`\nAlle Screenshots gespeichert in: ${OUT}`);
    console.log(`Anzahl: ${fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length} Dateien`);
})();
