const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

function localIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

test.describe('Journal', () => {
  test('creates on first edit, reloads content and destroys the editor between days', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page).toHaveURL(new RegExp(`screen=journal.*date=${localIso()}`));
    await expect(page.locator('#journalView')).toBeVisible();
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso());
    await expect(page.locator('#journalNextBtn')).toBeDisabled();

    const editor = page.locator('#journalEditorBody .tiptap');
    const body = `Journal Happy Path ${Date.now()}`;
    await expect(editor).toBeVisible();
    await editor.fill(body);
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');

    await page.reload();
    await expect(page.locator('#journalView')).toBeVisible();
    await expect(page.locator('#journalEditorBody .tiptap')).toContainText(body);

    const oldEditor = await page.locator('#journalEditorBody .tiptap').elementHandle();
    const generation = await page.locator('#journalEditorBody').getAttribute('data-editor-generation');
    await page.locator('#journalPreviousBtn').click();
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso(-1));
    await expect(page.locator('#journalEditorBody .tiptap')).toHaveText('');
    await expect.poll(() => oldEditor.evaluate(element => element.isConnected)).toBe(false);
    await expect(page.locator('#journalEditorBody')).not.toHaveAttribute('data-editor-generation', generation);

    await page.locator('#journalNextBtn').click();
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso());
    await expect(page.locator('#journalEditorBody .tiptap')).toContainText(body);
    await expect(page.locator('#journalNextBtn')).toBeDisabled();

    await page.locator('#journalDatePicker').fill(localIso(-2));
    await page.locator('#journalDatePicker').dispatchEvent('change');
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso(-2));
    await page.locator('#journalDateHeading').click();
    await expect(page.locator('#journalDatePicker')).toHaveValue(localIso());
  });
});
