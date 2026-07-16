const { test, expect } = require('@playwright/test');

test('attachment categories describe the immediate upload action', async ({ page }) => {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();

  await page.getByRole('button', { name: 'Bilder', exact: true }).click();
  await expect(page.getByLabel('Titel optional')).toBeVisible();
  await expect(page.getByText('Bild hochladen', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Dateien', exact: true }).click();
  await expect(page.getByLabel('Titel optional')).toBeVisible();
  await expect(page.getByText('Lokale Datei', { exact: true })).toBeVisible();
  await expect(page.getByText('Datei hochladen', { exact: true })).toBeVisible();
});
