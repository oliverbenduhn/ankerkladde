const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

test.describe('Search', () => {
  test('opens the exact todo result in the editor', async ({ page }) => {
    await login(page);
    await expect(page.locator('.section-tab').first()).toBeVisible();
    const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
    const categories = await (await page.request.get('/api.php?action=categories_list')).json();
    const category = categories.categories.find(entry => entry.type === 'list_due_date');
    const title = `Suchbares Todo ${Date.now()}`;
    const created = await page.request.post('/api.php?action=add', {
      headers: { 'X-CSRF-Token': csrf },
      form: { category_id: String(category.id), name: title, due_date: '2026-07-19' },
    });
    expect(created.status()).toBe(201);
    await page.reload();
    await expect(page.locator('.section-tab').first()).toBeVisible();

    await page.getByRole('button', { name: 'Suchen' }).click();
    await expect(page.locator('#searchInput')).toBeVisible();
    await page.locator('#searchInput').fill(title);

    const result = page.locator('.search-result').filter({ hasText: title });
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.locator('#todoEditor')).toBeVisible();
    await expect(page.locator('#todoTitleInput')).toHaveValue(title);
  });
});
