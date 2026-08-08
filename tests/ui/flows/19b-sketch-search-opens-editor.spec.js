const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

// FLOW 19b — Zeichnungen-Suche oeffnet Editor (Issue #42)
//
// Spec #42 verlangt: "Ein Suchtreffer nach dem Zeichnungsnamen oeffnet
// direkt den Zeichnungseditor". Wir oeffnen die Such-Bar, tippen den Namen,
// klicken das Ergebnis, und erwarten, dass der Sketch-Editor-Mount erscheint.
test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);

test.describe('FLOW 19b — Zeichnungen-Suche oeffnet Editor (#42)', () => {

    test('Suchtreffer auf Zeichnungsname oeffnet den Sketch-Editor', async ({ page }) => {
        await login(page);
        const csrf = await csrfToken(page);
        const stamp = Date.now();

        // Setup: Zeichnungs-Kategorie + Item mit bekannter Szene
        const catResp = await page.request.post('/api.php?action=categories_create', {
            headers: { 'X-CSRF-Token': csrf },
            form: { name: `F19b Zeichnungen ${stamp}`, type: 'drawings', icon: 'notizen' },
        });
        expect(catResp.status()).toBe(201);
        const category = (await catResp.json()).category;
        const itemResp = await page.request.post('/api.php?action=add', {
            headers: { 'X-CSRF-Token': csrf },
            form: { category_id: String(category.id), name: `F19b Skizze Suche ${stamp}` },
        });
        expect(itemResp.status()).toBe(201);
        const itemId = Number((await itemResp.json()).id);
        // Save mit zwei Elementen, damit die Szene nicht leer ist
        const saveResp = await page.request.post('/api.php?action=sketch_save', {
            headers: { 'X-CSRF-Token': csrf, 'X-Idempotency-Key': `f19b-seed-${itemId}` },
            form: {
                item_id: String(itemId),
                scene: JSON.stringify({
                    elements: [
                        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 30, height: 30 },
                        { id: 'b', type: 'ellipse', x: 50, y: 50, width: 30, height: 30 },
                    ],
                    appState: {},
                }),
                expected_revision: '1',
            },
        });
        expect(saveResp.status()).toBe(200);

        // Such-Bar oeffnen + Namen tippen + Enter
        await page.locator('#searchBtn').click();
        await expect(page.locator('#searchBar')).toBeVisible();
        await page.locator('#searchInput').fill(`F19b Skizze Suche ${stamp}`);
        await page.locator('#searchInput').press('Enter');

        // Suchergebnis muss das Item enthalten
        const result = page.locator('.search-result, [class*="search-result"]').filter({
            hasText: `F19b Skizze Suche ${stamp}`,
        }).first();
        await expect(result).toBeVisible({ timeout: 5_000 });

        // Klick auf den Treffer oeffnet den Editor (lazy via esm.sh)
        await result.click();

        // Editor-Mount-Container muss erscheinen — das ist schneller als das
        // Excalidraw-Canvas selbst, weil der Overlay zuerst gerendert wird.
        const overlay = page.locator('.sketch-editor-overlay');
        await expect(overlay).toBeVisible({ timeout: 10_000 });

        // Der Editor ist bereits waehrend des Lazy-Loads ein vollwertiger
        // Dialog und muss sich ohne Kamera-/Netzwerk-Wartezeit schließen lassen.
        const closeButton = page.locator('.sketch-editor-close');
        await expect(overlay).toHaveAttribute('role', 'dialog');
        await expect(overlay).toHaveAttribute('aria-modal', 'true');
        await expect(closeButton).toBeFocused();
        expect(await page.locator('#app').evaluate(element => element.inert)).toBe(true);
        await page.keyboard.press('Shift+Tab');
        expect(await overlay.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0);
        expect(await page.locator('#app').evaluate(element => element.inert)).toBe(false);
        await expect(page.locator('#searchBar')).toBeVisible();
        await expect(page.locator('#searchInput')).toBeFocused();
    });
});
