const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

// FLOW 19c — Tages-Skizze-Karte Sichtbarkeit (Issue #43)
//
// Spec #43 verlangt: "Ohne Skizze erscheint nur eine kleine Aktion; mit
// Skizze eine kompakte einklappbare Karte mit 'Skizze oeffnen' und ohne
// Thumbnail." Wir pruefen das via #journalSketchCard.hidden-Attribut.
// Server liefert has_sketch pro Datum; Client-Logik (journal.js:511) setzt
// das hidden-Flag entsprechend.
test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);

test.describe('FLOW 19c — Tages-Skizze-Karte Sichtbarkeit (#43)', () => {

    test('Ohne Skizze: Karte hidden, mit Skizze: Karte sichtbar', async ({ page }, testInfo) => {
        await login(page, { testInfo });
        const csrf = await csrfToken(page);
        const dateEmpty = '2032-10-11';
        const dateWithSketch = '2032-10-12';

        // Vorzustand: beide Daten ohne Skizze, dann nur dateWithSketch befuellen
        for (const date of [dateEmpty, dateWithSketch]) {
            const before = await (await page.request.get(`/api.php?action=journal&date=${date}`)).json();
            if (before.item) {
                const delResp = await page.request.post('/api.php?action=delete', {
                    headers: { 'X-CSRF-Token': csrf, 'X-Idempotency-Key': `f19c-cleanup-${date}` },
                    form: { id: String(before.item.id), expected_revision: String(before.item.revision || 1) },
                });
                // 200 oder 404 beide ok
                expect([200, 404]).toContain(delResp.status());
            }
        }

        // Skizze fuer dateWithSketch anlegen (legt Tagesnotiz an, falls keine da)
        const saveResp = await page.request.post('/api.php?action=sketch_save_daily', {
            headers: { 'X-CSRF-Token': csrf, 'X-Idempotency-Key': `f19c-daily-${dateWithSketch}` },
            form: {
                date: dateWithSketch,
                scene: JSON.stringify({
                    elements: [{ id: 'd', type: 'rectangle', x: 1, y: 1, width: 10, height: 10 }],
                    appState: {},
                }),
                expected_revision: '0',
            },
        });
        const saveBody = await saveResp.text();
        expect([200, 201], `sketch_save_daily status=${saveResp.status()} body=${saveBody.slice(0, 200)}`).toContain(saveResp.status());

        // 1. Datum OHNE Skizze -> #journalSketchCard.hidden = true
        await page.goto(`/index.php?screen=journal&date=${dateEmpty}`);
        await expect(page.locator('#journalView')).toBeVisible();
        await expect.poll(async () => {
            return await page.locator('#journalSketchCard').evaluate(el => el.hidden);
        }, { timeout: 5_000 }).toBe(true);

        // 2. Datum MIT Skizze -> #journalSketchCard.hidden = false
        await page.goto(`/index.php?screen=journal&date=${dateWithSketch}`);
        await expect(page.locator('#journalView')).toBeVisible();
        await expect.poll(async () => {
            return await page.locator('#journalSketchCard').evaluate(el => el.hidden);
        }, { timeout: 5_000 }).toBe(false);

        // 3. "Skizze oeffnen"-Button sichtbar (aria-label wechselt, aber Button selbst bleibt)
        await expect(page.locator('#journalSketchOpenBtn')).toBeVisible();
    });
});
