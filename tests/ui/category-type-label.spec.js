const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('shows the drawings category type as Zeichnungen', async ({ page }) => {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();

  await page.goto('/settings.php');
  await expect(page).toHaveURL(/index\.php\?screen=settings/);
  const drawingsOption = page.locator('#settingsDialogContent select[name="type"] option[value="drawings"]');
  await expect(drawingsOption).toHaveText('Zeichnungen');
});
