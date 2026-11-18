const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
  await page.waitForFunction(() => history.state?.appManaged === true);
}

test('settings open as one lazily loaded native dialog without iframe', async ({ page }) => {
  let fragmentRequests = 0;
  page.on('request', request => {
    if (request.url().includes('settings.php?fragment=1')) fragmentRequests += 1;
  });

  await login(page);
  await expect(page.locator('#settingsFrame')).toHaveCount(0);
  await expect(page.locator('#settingsDialog')).not.toHaveAttribute('open', '');

  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Erscheinungsbild')).toBeVisible();
  await expect(page).toHaveURL(/screen=settings/);
  expect(fragmentRequests).toBe(1);

  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  await expect(dialog).toBeVisible();
  expect(fragmentRequests).toBe(1);
});

test('settings ignores a late successful response after Back', async ({ page }) => {
  await login(page);
  const dialog = page.locator('#settingsDialog');
  const received = Promise.withResolvers();
  await page.route('**/settings.php?fragment=1*', route => received.resolve(route), { times: 1 });
  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  const request = await received.promise;
  await expect(page).toHaveURL(/screen=settings/);
  await page.goBack();
  await expect(page).not.toHaveURL(/screen=settings/);
  await request.fulfill({ response: await request.fetch() });
  await expect(dialog.getByText('Erscheinungsbild', { exact: false })).toBeAttached();
  await expect(dialog).toBeHidden();
});

test('settings offers a focused retry button on failure', async ({ page }) => {
  await login(page);
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await page.route('**/settings.php?fragment=1*', route => route.fulfill({ status: 503 }), { times: 1 });
  await page.getByRole('link', { name: 'Einstellungen' }).first().click();
  const retry = dialog.getByRole('button', { name: 'Erneut versuchen' });
  await expect(retry).toBeFocused();
  await retry.click();
  await expect(dialog.getByText('Erscheinungsbild')).toBeVisible();
});

test('category names autosave on blur and update the app without reload', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Einstellungen' }).first().click();

  const settings = page.locator('#settingsDialogContent');
  const originalName = `Autosave ${Date.now()}`;
  const renamed = `${originalName} neu`;
  await settings.locator('details[data-settings-panel="new-category"] > summary').click();
  await settings.locator('input[name="name"]').fill(originalName);
  await settings.getByRole('button', { name: 'Kategorie anlegen' }).click();
  await expect(settings.locator('.settings-flash')).toContainText('Kategorie erstellt');

  const categoriesPanel = settings.locator('details[data-settings-panel="categories"]');
  if (!(await categoriesPanel.evaluate(panel => panel.open))) {
    await categoriesPanel.locator(':scope > summary').click();
  }
  const row = settings.locator('form.settings-category-row', { hasText: originalName });
  await row.locator('summary.settings-category-summary').click();
  await row.locator('input[name="category_name"]').fill(renamed);
  await row.locator('input[name="category_name"]').press('Tab');

  await expect(settings.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });
  await expect(page.locator('#sectionTabs')).toContainText(renamed);
});
