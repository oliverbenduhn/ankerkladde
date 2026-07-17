const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

function localIso() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

test.describe('PWA badge and shortcuts', () => {
  test('sets the startup badge to the exact open Today count', async ({ page }) => {
    await page.addInitScript(() => {
      window.__appBadgeCalls = [];
      Object.defineProperty(navigator, 'setAppBadge', {
        configurable: true,
        value: async count => { window.__appBadgeCalls.push(count); },
      });
    });

    await login(page);
    const today = await (await page.request.get('/api.php?action=today')).json();

    await expect.poll(() => page.evaluate(() => window.__appBadgeCalls.at(-1))).toBe(today.items.length);
  });

  test('silently ignores an unavailable badge implementation', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'setAppBadge', {
        configurable: true,
        value: async () => { throw new Error('Badging unavailable'); },
      });
    });

    await login(page);
    await expect(page.locator('#app')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('publishes the Today and focused new-note shortcuts', async ({ page }) => {
    await login(page);
    const response = await page.request.get('/manifest.php');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();

    expect(manifest.shortcuts).toEqual(expect.arrayContaining([
      { name: 'Heute', short_name: 'Heute', url: '/?screen=today' },
      { name: 'Neue Notiz', short_name: 'Neue Notiz', url: '/?screen=journal&date=today&focus=editor' },
      { name: 'Barcode scannen', short_name: 'Scanner', url: '/?screen=scanner&scanner_action=add' },
      { name: 'Einstellungen', short_name: 'Einstellungen', url: '/?screen=settings&tab=app' },
      { name: 'Suchen', short_name: 'Suchen', url: '/?screen=search' },
    ]));

    const todayShortcut = manifest.shortcuts.find(s => s.name === 'Heute');
    await page.goto(todayShortcut.url);
    await expect(page).toHaveURL(/screen=today/);
    await expect(page.locator('#categoryTitle')).toHaveText('Heute');

    await page.goto(manifest.shortcuts[1].url);
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso());
    await expect(page.locator('#journalEditorBody .tiptap')).toBeFocused();
  });
});
