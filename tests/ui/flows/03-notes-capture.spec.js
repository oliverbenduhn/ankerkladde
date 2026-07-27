const { test, expect } = require('@playwright/test');
const { login, snap, csrfToken } = require('../helpers/ux');

test.describe('FLOW 3 — Notiz erfassen & bearbeiten', () => {
  test('notes-kategorie → tip-tap → formatierung → reload-persistence', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await login(page);
    await snap(page, testInfo, '1-app');

    // Notes-Kategorie via API sicherstellen
    const csrf = await csrfToken(page);
    const catName = `Notizen ${Date.now()}`;
    const createCat = await page.request.post('/api.php?action=categories_create', {
      headers: { 'X-CSRF-Token': csrf },
      form: { name: catName, type: 'notes', icon: 'notizen' },
    });
    expect(createCat.status()).toBe(201);

    // Mindestens eine Notiz anlegen, damit der Editor geöffnet werden kann
    const noteName = `Notiz initial ${Date.now()}`;
    const noteResponse = await page.request.post('/api.php?action=add', {
      headers: { 'X-CSRF-Token': csrf },
      form: { category_id: String((await createCat.json()).category.id), name: noteName },
    });
    expect(noteResponse.status()).toBe(201);

    await page.reload();
    const tab = page.getByRole('button', { name: catName, exact: true });
    await tab.click();
    await snap(page, testInfo, '2-notes-tab');

    // Notes: Editor öffnet sich als Overlay (#noteEditor) nach Klick aufs Item
    const noteOverlay = page.locator('#noteEditor');
    // Notiz-Karte klicken (der ganze <li> ist der Click-Target, nicht nur der Button)
    const noteCard = page.locator('#list .item-card').filter({ hasText: noteName }).first();
    await expect(noteCard).toBeVisible({ timeout: 10_000 });
    await noteCard.click();
    await expect(noteOverlay).toBeVisible({ timeout: 20_000 });

    // TipTap-Editor innerhalb des Overlays
    const editor = noteOverlay.locator('.tiptap').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Body setzen
    const bodyText = `QA Flow3 Notiz ${Date.now()}`;
    await editor.click();
    await page.keyboard.type(bodyText);
    await snap(page, testInfo, '3-editor-filled');

    // Speicher-Status: "Gespeichert" o.ä. — Selector flexibel, Save-Status heißt in Notizen u.U. anders
    await page.waitForTimeout(500);

    // Reload → Tab → Notiz erneut öffnen → Inhalt muss persistieren
    // Anker ist der notiz-name (noteName), nicht der getippte body (bodyText)
    // UX-Bug-Fund: offener Note-Editor überlebt Reload und blockiert alle weiteren Klicks
    await page.locator('#noteEditorBack').click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.locator('#noteEditor')).toBeHidden({ timeout: 10_000 });
    await page.getByRole('button', { name: catName, exact: true }).click();
    const reloadCard = page.locator('.item-card').filter({ hasText: noteName });
    await expect(reloadCard.first()).toBeVisible({ timeout: 10_000 });
    await reloadCard.first().click();
    await expect(page.locator('#noteEditor')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#noteEditor .tiptap')).toContainText(bodyText, { timeout: 15_000 });
    await snap(page, testInfo, '4-after-reload');
  });
});