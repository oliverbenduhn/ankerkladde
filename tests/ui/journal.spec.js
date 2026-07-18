const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
  await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
}

function shiftIso(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe('Journal', () => {
  test('navigates absolute days without history spam and keeps formatting accessible', async ({ page }) => {
    await login(page);

    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);
    await expect(page.locator('#journalView')).toBeVisible();
    await expect(page.locator('#appHeader')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Zurück zu den Listen' })).toBeVisible();
    await expect(page.locator('#journalDatePickerBtn')).toBeVisible();
    await expect(page.locator('.journal-navigation .btn-settings')).toBeVisible();
    await expect(page.locator('#journalSketchCard')).toBeHidden();
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
    await expect(page.locator('#journalDateHeading')).not.toContainText(String(Number(currentYear) - 1));
    await expect(page.locator('.journal-nav-btn[aria-pressed="true"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Zurück zu den Listen' }).click();
    await expect(page.locator('#journalView')).toBeHidden();
    await expect(page).not.toHaveURL(/screen=journal/);
  });

  test('keeps the current day intact when the target day fails to load', async ({ page }) => {
    await login(page);
    await page.locator('#journalBtn').click();
    await expect(page.locator('#journalView')).toBeVisible();

    const picker = page.locator('#journalDatePicker');
    const today = await picker.inputValue();
    const yesterday = shiftIso(today, -1);
    const editor = page.locator('#journalEditorBody .tiptap');
    const editorHandle = await editor.elementHandle();

    await page.route(`**/api.php?action=today&date=${yesterday}`, route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Testfehler' }),
    }));
    await page.locator('#journalPreviousBtn').click();

    await expect(picker).toHaveValue(today);
    await expect(editor).toBeVisible();
    await expect.poll(() => editorHandle.evaluate(element => element.isConnected)).toBe(true);
  });

  test('shows the selected agenda in two columns without mobile overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
    const categories = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCategory = categories.categories.find(category => category.type === 'list_due_date');
    const todayPayload = await (await page.request.get('/api.php?action=today')).json();
    const tomorrow = shiftIso(todayPayload.today, 1);
    const suffix = Date.now();
    const anytimeName = `Sehr lange Aufgabe ohne Uhrzeit für den mobilen Umbruch ${suffix}`;
    const scheduledName = `Termin ${suffix}`;

    const anytimeResponse = await page.request.post('/api.php?action=add', {
      headers: { 'X-CSRF-Token': csrf },
      form: { category_id: String(dueCategory.id), name: anytimeName, due_date: tomorrow },
    });
    expect(anytimeResponse.status()).toBe(201);
    const scheduledResponse = await page.request.post('/api.php?action=quick_add', {
      headers: { 'X-CSRF-Token': csrf },
      form: { active_category_id: String(dueCategory.id), input: `${scheduledName} morgen 08:15` },
    });
    expect(scheduledResponse.status()).toBe(201);

    await page.locator('#journalBtn').click();
    await page.locator('#journalNextBtn').click();

    const anytimeColumn = page.locator('#journalAnytimeList');
    const scheduledColumn = page.locator('#journalScheduledList');
    await expect(anytimeColumn).toContainText(anytimeName);
    await expect(scheduledColumn).toContainText(scheduledName);
    await expect(anytimeColumn.locator('[data-agenda-group="scheduled"]')).toHaveCount(0);
    await expect(scheduledColumn.locator('[data-agenda-group="scheduled"]')).toHaveCount(1);

    const [leftBox, rightBox] = await Promise.all([anytimeColumn.boundingBox(), scheduledColumn.boundingBox()]);
    expect(leftBox.x).toBeLessThan(rightBox.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const nameBox = await anytimeColumn.locator('.agenda-item-name').boundingBox();
    expect(nameBox.height).toBeGreaterThan(20);
    const columnWidths = await page.locator('.journal-agenda-column').evaluateAll(columns => columns.map(column => column.getBoundingClientRect().width));
    expect(columnWidths[0]).toBeGreaterThan(columnWidths[1]);
    await expect(page.locator('#agendaAddBtn')).toBeVisible();
    await page.locator('#agendaAddBtn').click();
    await expect(page.locator('#inputArea')).toBeVisible();
    await expect(page.locator('#itemInput')).toBeFocused();
  });

  test('blocks the PWA back exit when saving fails', async ({ page }) => {
    await login(page);
    await page.locator('#journalBtn').click();

    await page.route('**/api.php?action=journal_save', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Testfehler' }),
    }));
    const editor = page.locator('#journalEditorBody .tiptap');
    const body = `Ungespeichert ${Date.now()}`;
    await editor.fill(body);
    await page.goBack();

    await expect(page.locator('#journalView')).toBeVisible();
    await expect(page).toHaveURL(/screen=journal/);
    await expect(editor).toContainText(body);
    await expect(page.locator('#journalSaveStatus')).toContainText('Fehler');
  });
});
