const { test, expect } = require('@playwright/test');
const { login, snap, touchTargetsBelowMin } = require('../helpers/ux');

test.describe('FLOW 4 — Quick-Add → AI-Eskalation', () => {
  test('mehrdeutiges Datum → quick-add feedback → AI-Button → Magic Bar', async ({ page }, testInfo) => {
    await login(page);
    await page.getByRole('button', { name: /^Einkauf/ }).first().click();
    await snap(page, testInfo, '1-einkauf');

    const input = page.locator('#itemInput');
    const ambiguous = `QA Flow4 Termin ${Date.now()} heute morgen`;
    await input.fill(ambiguous);
    await input.press('Enter');

    // Erwartung: Parser erkennt Konflikt, Feedback zeigt "mehrere Datumsangaben"
    const feedback = page.locator('#quickAddFeedback');
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText(/mehrere Datumsangaben/i);
    await snap(page, testInfo, '2-feedback-shown');

    // Eskalations-Button muss erscheinen UND mindestens 44×44 sein (WCAG touch target)
    const aiBtn = page.locator('#quickAddAiBtn');
    await expect(aiBtn).toBeVisible();
    const aiBox = await aiBtn.boundingBox();
    expect(aiBox, 'AI-Button muss Bounding-Box haben').toBeTruthy();
    // Tatsächliche Höhe ausgeben, damit der Audit-Wert sichtbar bleibt
    expect(aiBox.height, `AI-Button-Höhe ${aiBox.height}px < 44px (WCAG)`).toBeGreaterThanOrEqual(44);
    expect(aiBox.width, `AI-Button-Breite ${aiBox.width}px < 44px`).toBeGreaterThanOrEqual(44);

    // Klick öffnet Magic Bar und füllt Input
    await aiBtn.click();
    const magic = page.locator('#magicBar');
    await expect(magic).toBeVisible();
    await expect(page.locator('#magicInput')).toHaveValue(ambiguous);
    await snap(page, testInfo, '3-magic-open');

    // Magic Bar-Buttons müssen Touch-Mindestmaß erfüllen
    const tooSmall = await touchTargetsBelowMin(page, { min: 44 });
    expect(tooSmall, JSON.stringify(tooSmall, null, 2)).toEqual([]);

    // Schließen via X
    await page.locator('#magicClose').click();
    await expect(magic).toBeHidden();
  });
});