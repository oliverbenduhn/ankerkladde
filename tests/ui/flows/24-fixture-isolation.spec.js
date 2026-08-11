const { test, expect } = require('@playwright/test');
const { csrfToken, login } = require('../helpers/ux');

test.describe.serial('FLOW 24 — Testdaten-Isolation', () => {
  const leakedItem = 'QA Fixture darf nicht aus dem Vortest stammen';

  test('Vortest verändert Daten und letzte Kategorie', async ({ page }) => {
    await login(page);
    const categories = await page.request.get('/api.php?action=categories_list');
    const { categories: list } = await categories.json();
    const shopping = list.find(category => category.name === 'Einkauf');
    const response = await page.request.post('/api.php?action=add', {
      headers: { 'X-CSRF-Token': await csrfToken(page) },
      form: { category_id: String(shopping.id), name: leakedItem },
    });
    expect(response.status()).toBe(201);
    await page.reload();
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();
    await expect(page.locator('.item-card').filter({ hasText: leakedItem })).toBeVisible();
    await page.getByRole('button', { name: 'Privat', exact: true }).click();
    await expect(page.locator('#categoryTitle')).toHaveText('Privat');
  });

  test('Folgetest startet wieder mit unverändertem Demo-Bestand', async ({ page }) => {
    await login(page);
    await expect(page.locator('#categoryTitle')).toHaveText('Einkauf');
    await expect(page.locator('.item-card').filter({ hasText: leakedItem })).toHaveCount(0);
    await expect(page.locator('.item-card').filter({ hasText: 'Milch' })).toBeVisible();
  });
});
