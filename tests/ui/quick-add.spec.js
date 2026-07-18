const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

test.describe('Quick-Add', () => {
  test('adds deterministically and exposes validation with the existing Magic path', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Einkauf' }).click();

    const input = page.locator('#itemInput');
    await expect(input).toHaveAttribute('placeholder', /Schnelleingabe/);
    await expect(input).not.toHaveAttribute('placeholder', /morgen|8:00/);
    await expect(page.locator('#itemSubmitBtn')).toBeHidden();

    const createdName = `Zahnarzt anrufen ${Date.now()}`;
    const responsePromise = page.waitForResponse(response => response.url().includes('action=quick_add') && response.request().method() === 'POST');
    await input.fill(`${createdName} morgen /privat !2`);
    await input.press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const payload = await response.json();
    expect(payload.parsed).toMatchObject({ name: createdName, priority: '2', due_time: '' });
    expect(payload.parsed.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('#categoryTitle')).toHaveText('Privat');
    await expect(page.locator('#list')).toContainText(createdName);

    await input.fill(`Nicht anlegen ${Date.now()} /unbekannt`);
    await input.press('Enter');
    await expect(page.locator('#quickAddFeedback')).toContainText('Kategorie nicht gefunden');
    await expect(page.locator('#quickAddAiBtn')).toBeHidden();

    const ambiguous = `Termin ${Date.now()} heute morgen`;
    await input.fill(ambiguous);
    await input.press('Enter');
    await expect(page.locator('#quickAddFeedback')).toContainText('mehrere Datumsangaben');
    await expect(page.locator('#quickAddAiBtn')).toBeVisible();
    await page.locator('#quickAddAiBtn').click();
    await expect(page.locator('#magicBar')).toBeVisible();
    await expect(page.locator('#magicInput')).toHaveValue(ambiguous);
  });
});
