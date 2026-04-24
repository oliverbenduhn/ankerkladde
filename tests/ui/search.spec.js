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
    await expect(page.locator('#list .item-card').first()).toBeVisible();

    await page.getByRole('button', { name: 'Suchen' }).click();
    await expect(page.locator('#searchInput')).toBeVisible();
    await page.locator('#searchInput').fill('Monatsbericht');

    const result = page.locator('.search-result').filter({ hasText: 'Monatsbericht einreichen' });
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.locator('#todoEditor')).toBeVisible();
    await expect(page.locator('#todoTitleInput')).toHaveValue('Monatsbericht einreichen');
  });
});
