const { test, expect } = require('@playwright/test');
const { login, snap, csrfToken } = require('../helpers/ux');

test('Sprache wechseln → beschriftete Werkzeuge entdecken → englische Fehlermeldung', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/settings.php');
  await page.locator('[data-settings-panel="language"] > summary').click();
  await page.locator('select[name="language"]').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/index.php');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open day view', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    const more = page.locator('.header-more > summary');
    await expect(more).toHaveAccessibleName('More actions');
    await expect(more).toHaveText('More');
    await more.click();
    for (const [id, text] of [['layoutToggleBtn', 'Layout'], ['tabsToggleBtn', 'Categories'], ['scanShoppingBtn', 'Scan'], ['magicBtn', 'AI']]) {
      await expect(page.locator(`#${id} .header-action-text`)).toBeVisible();
      await expect(page.locator(`#${id} .header-action-text`)).toHaveText(text);
    }
    await snap(page, testInfo, 'named-mobile-tools');
  }
  const response = await page.request.post('/api.php?action=add', {
    headers: { 'X-CSRF-Token': await csrfToken(page) }, form: { name: '' },
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error).toBe('Please enter an item name.');
  await snap(page, testInfo, 'english-app');
});
