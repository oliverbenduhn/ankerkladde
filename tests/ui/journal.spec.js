const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

function shiftIso(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe('Journal', () => {
  test('navigates absolute days without history spam and keeps formatting accessible', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page).toHaveURL(/screen=journal/);
    await expect(page.locator('#journalView')).toBeVisible();
    const picker = page.locator('#journalDatePicker');
    const today = await picker.inputValue();
    const yesterday = shiftIso(today, -1);
    const tomorrow = shiftIso(today, 1);
    const currentYear = today.slice(0, 4);
    const previousYearDate = `${Number(currentYear) - 1}-01-02`;
    await expect(page.locator('#journalDateHeading')).not.toContainText(currentYear);
    await expect(page.locator('#journalPreviousBtn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#journalTodayBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#journalNextBtn')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#journalNextBtn')).toBeEnabled();
    await expect(page.locator('#journalToolbar')).toBeHidden();
    await expect(page.locator('#journalFormatBtn')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#journalFormatBtn').click();
    await expect(page.locator('#journalToolbar')).toBeVisible();
    await expect(page.locator('#journalFormatBtn')).toHaveAttribute('aria-expanded', 'true');

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
    const historyIndex = await page.evaluate(() => history.state.appIndex);
    await page.locator('#journalPreviousBtn').click();
    await expect(picker).toHaveValue(yesterday);
    await expect(page.locator('#journalEditorBody .tiptap')).toHaveText('');
    await expect.poll(() => oldEditor.evaluate(element => element.isConnected)).toBe(false);
    await expect(page.locator('#journalEditorBody')).not.toHaveAttribute('data-editor-generation', generation);
    await expect(page.locator('#journalPreviousBtn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => history.state.appIndex)).toBe(historyIndex);

    await page.locator('#journalNextBtn').click();
    await expect(picker).toHaveValue(tomorrow);
    await expect(page.locator('#journalNextBtn')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#journalTodayBtn').click();
    await expect(picker).toHaveValue(today);
    await expect(page.locator('#journalEditorBody .tiptap')).toContainText(body);

    await picker.fill(previousYearDate);
    await picker.dispatchEvent('change');
    await expect(picker).toHaveValue(previousYearDate);
    await expect(page.locator('#journalDateHeading')).toContainText(String(Number(currentYear) - 1));
    await expect(page.locator('.journal-nav-btn[aria-pressed="true"]')).toHaveCount(0);

    await page.locator('#journalBackBtn').click();
    await expect(page.locator('#journalView')).toBeHidden();
    await expect(page).not.toHaveURL(/screen=journal/);
  });

  test('keeps the current day intact when the target day fails to load', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Journal' }).click();
    await expect(page.locator('#journalView')).toBeVisible();

    const picker = page.locator('#journalDatePicker');
    const today = await picker.inputValue();
    const yesterday = shiftIso(today, -1);
    const editor = page.locator('#journalEditorBody .tiptap');
    const editorHandle = await editor.elementHandle();

    await page.route(`**/api.php?action=journal&date=${yesterday}`, route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Testfehler' }),
    }));
    await page.locator('#journalPreviousBtn').click();

    await expect(picker).toHaveValue(today);
    await expect(editor).toBeVisible();
    await expect.poll(() => editorHandle.evaluate(element => element.isConnected)).toBe(true);
  });

  test('blocks the PWA back exit when saving fails', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Journal' }).click();

    await page.route('**/api.php?action=journal_save', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Testfehler' }),
    }));
    const editor = page.locator('#journalEditorBody .tiptap');
    const body = `Ungespeichert ${Date.now()}`;
    await editor.fill(body);
    await page.locator('#journalBackBtn').click();

    await expect(page.locator('#journalView')).toBeVisible();
    await expect(page).toHaveURL(/screen=journal/);
    await expect(editor).toContainText(body);
    await expect(page.locator('#journalSaveStatus')).toContainText('Fehler');
  });
});
