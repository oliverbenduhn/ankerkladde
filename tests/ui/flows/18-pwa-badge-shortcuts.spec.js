const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

// FLOW 18 — PWA-Badge + Manifest-Shortcuts (Issue #35)
//
// Spec #35 verlangt:
//   1. navigator.setAppBadge(n) wird beim App-Start mit der Anzahl offener
//      Heute-Todos aufgerufen (gestubbte Badging API).
//   2. Badging API fehlt -> stiller Fallback, kein Throw.
//   3. Manifest enthaelt zwei Shortcuts "Heute" und "Neue Notiz" mit den
//      richtigen URLs.
//   4. "Neue Notiz" -> ?focus=editor fuehrt zu TipTap-Editor-Fokus.

test.describe('FLOW 18 — PWA-Badge + Manifest-Shortcuts (#35)', () => {

    test('Manifest-Shortcuts: Heute und Neue Notiz mit korrekten URLs', async ({ request, baseURL }) => {
        const resp = await request.get('/manifest.php');
        expect(resp.status()).toBe(200);
        const manifest = await resp.json();
        expect(Array.isArray(manifest.shortcuts)).toBe(true);

        const today = manifest.shortcuts.find(s => /Heute|Today/.test(s.name) || /Heute|Today/.test(s.short_name));
        const newNote = manifest.shortcuts.find(s => /Neue Notiz|New Note/.test(s.name) || /Neue Notiz|New Note/.test(s.short_name));

        expect(today, 'Heute-Shortcut fehlt im Manifest').toBeTruthy();
        expect(newNote, 'Neue-Notiz-Shortcut fehlt im Manifest').toBeTruthy();

        // URL muss auf den erwarteten Screen zeigen
        expect(today.url).toMatch(/[?&]screen=today/);
        // ?focus=editor ist der Pfad, der den Editor-Fokus nach Navigation ausloest
        expect(newNote.url).toMatch(/[?&]screen=journal/);
        expect(newNote.url).toMatch(/[?&]focus=editor/);
    });

    test('Badge: setAppBadge wird mit Anzahl offener Heute-Items aufgerufen', async ({ page, baseURL }) => {
        // Badging API stubben BEVOR die App-Skripte laufen.
        await page.addInitScript(() => {
            window.__badgeCalls = [];
            Object.defineProperty(navigator, 'setAppBadge', {
                configurable: true,
                value: async (count) => {
                    window.__badgeCalls.push({ method: 'setAppBadge', count });
                },
            });
            Object.defineProperty(navigator, 'clearAppBadge', {
                configurable: true,
                value: async () => { window.__badgeCalls.push({ method: 'clearAppBadge' }); },
            });
        });

        await login(page);

        // Server-Cutoff-Date lesen (Europe/Berlin), damit Test nicht von der
        // Browser-Zeitzone abhaengt.
        const todayPayload = await (await page.request.get('/api.php?action=today')).json();
        const todayIso = todayPayload.today;
        const csrf = await csrfToken(page);
        const cats = await (await page.request.get('/api.php?action=categories_list')).json();
        const dueCat = cats.categories.find(c => c.type === 'list_due_date');
        expect(dueCat).toBeTruthy();

        // Vorzustand zaehlen
        const before = await page.request.get('/api.php?action=today&date=' + todayIso);
        const beforeItems = (await before.json()).items || [];
        const beforeCount = beforeItems.length;

        // Drei neue Heute-Items (ohne Uhrzeit -> anytime_today, sind offen sichtbar)
        const stamp = Date.now();
        for (let i = 0; i < 3; i += 1) {
            const addResp = await page.request.post('/api.php?action=add', {
                headers: { 'X-CSRF-Token': csrf },
                form: { category_id: String(dueCat.id), name: `QA F18 Badge ${stamp} ${i}`, due_date: todayIso },
            });
            expect(addResp.status()).toBe(201);
        }

        // App neu laden, damit initApp() läuft und das Badge mit dem aktuellen
        // Stand setzt.
        await page.reload();

        // Bis zu 5s warten, bis der Badge-Aufruf ankommt (Async nach initApp)
        await expect.poll(async () => {
            return await page.evaluate(() => (window.__badgeCalls || []).map(c => c.count || null));
        }, { timeout: 5000 }).toEqual(expect.arrayContaining([expect.any(Number)]));

        // Letzter setAppBadge-Call muss die neue Anzahl enthalten
        const lastSet = await page.evaluate(() => {
            const calls = window.__badgeCalls || [];
            return calls.filter(c => c.method === 'setAppBadge').pop();
        });
        expect(lastSet, 'mindestens ein setAppBadge-Aufruf erwartet').toBeTruthy();
        // Server-Stand nach Reload: vorher + 3
        const after = await (await page.request.get('/api.php?action=today&date=' + todayIso)).json();
        const afterCount = (after.items || []).length;
        expect(lastSet.count).toBe(afterCount);
        expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 3);
    });

    test('Badge: stille Fallback wenn Badging API fehlt', async ({ page }) => {
        // Badging API komplett entfernen.
        await page.addInitScript(() => {
            try {
                Object.defineProperty(navigator, 'setAppBadge', { configurable: true, get: () => undefined });
                Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, get: () => undefined });
            } catch (e) { /* noop */ }
        });
        let pageError = null;
        page.on('pageerror', err => { pageError = err; });

        await login(page);
        // Wenn die App ohne Badging API hochkommt, ohne dass ein pageerror feuert,
        // ist der stille Fallback ok.
        await page.waitForTimeout(500);
        expect(pageError, `unerwarteter pageerror: ${pageError && pageError.message}`).toBeNull();
    });

    test('Neue-Notiz-Shortcut: ?focus=editor fokussiert den TipTap-Editor', async ({ page }) => {
        await login(page);
        // Direkt mit der Journal-URL + focus=editor aufrufen, genau wie der
        // Manifest-Shortcut sie produziert.
        await page.goto('/index.php?screen=journal&date=today&focus=editor');
        // Journal-View muss offen sein
        await expect(page.locator('#journalView')).toBeVisible();
        // TipTap-Editor (contenteditable im Journal) muss erscheinen.
        // Der Editor wird dynamisch geladen — bis zu 5s warten.
        const editor = page.locator('#journalView [contenteditable="true"]');
        await expect(editor).toBeVisible({ timeout: 5_000 });
        // Fokus muss innerhalb von 2s auf das Editor-Element wechseln.
        await expect.poll(async () => {
            return await page.evaluate(() => {
                const el = document.activeElement;
                if (!el) return false;
                return !!el.closest('#journalView')
                    && el.getAttribute('contenteditable') === 'true';
            });
        }, { timeout: 2_000, intervals: [100, 200, 500] }).toBe(true);
    });
});
