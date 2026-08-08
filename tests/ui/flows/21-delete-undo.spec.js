const { test, expect } = require('@playwright/test');
const { login, snap } = require('../helpers/ux');

test.describe('FLOW 21 — Reversibles Löschen', () => {
  test('Eintrag löschen → Rückgängig → Sammellöschen → Rückgängig → Reload-Persistenz', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await login(page);
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();

    const addItem = async name => {
      const response = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
      await page.locator('#itemInput').fill(name);
      await page.locator('#itemInput').press('Enter');
      const payload = await (await response).json();
      const card = page.locator('.item-card').filter({ hasText: name });
      await expect(card).toBeVisible();
      return { id: Number(payload.id), card };
    };

    const singleName = `QA Undo einzeln ${Date.now()}`;
    const single = await addItem(singleName);
    let singleCard = single.card;
    await singleCard.locator('.btn-item-menu').click();
    const itemMenu = page.getByRole('dialog', { name: new RegExp(`${singleName} Aktionen`) });
    await expect(itemMenu).toBeVisible();
    const stagedDelete = page.waitForResponse(
      r => r.url().includes('action=delete') && r.status() === 200,
      { timeout: 2_000 },
    );
    await itemMenu.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(singleCard).toHaveCount(0);
    const stagedPayload = await (await stagedDelete).json();
    expect(stagedPayload.deletion_id).toBeTruthy();

    const undoButton = page.locator('#message').getByRole('button', { name: 'Rückgängig', exact: true });
    await expect(undoButton).toBeVisible();
    const undoResponse = page.waitForResponse(
      r => r.url().includes('action=undo_delete') && r.status() === 200,
    );
    await undoButton.click();
    const undoPayload = await (await undoResponse).json();
    expect(undoPayload.restored_items.map(item => Number(item.id))).toContain(single.id);
    singleCard = page.locator('.item-card').filter({ hasText: singleName });
    await expect(singleCard).toBeVisible();
    await expect(singleCard).toHaveAttribute('data-item-id', String(single.id));
    await snap(page, testInfo, '1-single-delete-undone');

    const bulkName = `QA Undo gesammelt ${Date.now()}`;
    const bulk = await addItem(bulkName);
    let bulkCard = bulk.card;
    const toggleResponse = page.waitForResponse(
      r => r.url().includes('action=toggle') && r.status() === 200,
    );
    await bulkCard.locator('input.toggle').click();
    await expect(bulkCard).toHaveClass(/\bdone\b/);
    await toggleResponse;
    const stagedClear = page.waitForResponse(
      r => r.url().includes('action=clear') && r.status() === 200,
      { timeout: 2_000 },
    );
    await page.locator('#clearDoneBtn').click();
    await expect(bulkCard).toHaveCount(0);
    const stagedClearPayload = await (await stagedClear).json();
    expect(stagedClearPayload.deletion_id).toBeTruthy();
    await expect(undoButton).toBeVisible();
    const clearUndoResponse = page.waitForResponse(
      r => r.url().includes('action=undo_delete') && r.status() === 200,
    );
    await undoButton.click();
    const clearUndoPayload = await (await clearUndoResponse).json();
    expect(clearUndoPayload.restored_items.map(item => Number(item.id))).toContain(bulk.id);
    bulkCard = page.locator('.item-card').filter({ hasText: bulkName });
    await expect(bulkCard).toBeVisible();
    await expect(bulkCard).toHaveClass(/\bdone\b/);
    await snap(page, testInfo, '2-clear-done-undone');

    await page.reload();
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();
    await expect(page.locator('.item-card').filter({ hasText: singleName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: bulkName })).toBeVisible();
  });

  test('abgebrochener Stage-Request wird nach Reload zuverlässig ausgeführt', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();

    const name = `QA Undo Reload ${Date.now()}`;
    const added = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
    await page.locator('#itemInput').fill(name);
    await page.locator('#itemInput').press('Enter');
    const item = await (await added).json();
    const card = page.locator(`.item-card[data-item-id="${item.id}"]`);
    await expect(card).toBeVisible();

    await page.route('**/api.php?action=delete', route => route.abort('internetdisconnected'));
    await card.locator('.btn-item-menu').click();
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => Object.values(localStorage)
      .some(value => value.includes('"type":"delete"')))).toBe(true);

    await page.unroute('**/api.php?action=delete');
    await page.reload();
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();
    await expect(page.locator(`.item-card[data-item-id="${item.id}"]`)).toHaveCount(0);
  });
});
