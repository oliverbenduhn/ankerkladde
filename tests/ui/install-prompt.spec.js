const { test, expect } = require('@playwright/test');

async function dispatchInstallPrompt(page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => {};
    window.dispatchEvent(event);
  });
}

test('offers installation only after the first saved item', async ({ page }) => {
  await page.goto('/login.php');
  await expect(page.locator('#installBanner')).toHaveCount(0);

  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();

  const categoryName = `Install-Test ${Date.now()}`;
  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  const settingsFrame = page.frameLocator('#settingsFrame');
  await settingsFrame.locator('details[data-settings-panel="new-category"] > summary').click();
  await settingsFrame.locator('input[name="name"]').fill(categoryName);
  await settingsFrame.getByRole('button', { name: 'Kategorie anlegen' }).click();
  await page.goto('/index.php');
  await page.getByRole('button', { name: categoryName, exact: true }).click();
  await expect(page.locator('#list .empty-state')).toBeVisible();

  const banner = page.locator('#installBanner');
  await dispatchInstallPrompt(page);
  await expect(banner).toBeHidden();

  await page.getByLabel('Artikel...').fill('Erster Eintrag');
  await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
  await expect(banner).toBeVisible();
});
