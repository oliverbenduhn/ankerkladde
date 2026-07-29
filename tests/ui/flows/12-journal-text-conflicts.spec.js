const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

async function openJournalDate(page, date) {
  await page.goto(`/index.php?screen=journal&date=${date}`);
  await expect(page.locator('#journalView')).toBeVisible();
  await expect(page.locator('#journalDatePicker')).toHaveValue(date);
  await expect(page.locator('#journalEditorBody .tiptap')).toBeVisible();
}

async function secondContext(browser, pageA, date) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  await openJournalDate(page, date);
  return { context, page };
}

test.describe('FLOW 12 — Tagesnotiz-Text revisionssicher (Issue #69)', () => {
  test('paralleles Erstanlegen zeigt eingebetteten Vergleich und Server-Version übernehmen', async ({ page, browser }, testInfo) => {
    const date = testInfo.project.name === 'mobile' ? '2032-05-14' : '2032-05-16';
    await login(page);
    await openJournalDate(page, date);
    const { context, page: pageB } = await secondContext(browser, page, date);

    await page.locator('#journalEditorBody .tiptap').fill('Erste kanonische Tagesfassung');
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');

    await pageB.locator('#journalEditorBody .tiptap').fill('Abweichende parallele Tagesfassung');
    await expect(pageB.locator('.journal-text-conflict')).toBeVisible();
    await expect(pageB.locator('.journal-conflict-version-local')).toContainText('Abweichende parallele Tagesfassung');
    await expect(pageB.locator('.journal-conflict-version-server')).toContainText('Erste kanonische Tagesfassung');
    await expect(pageB.locator('.journal-agenda-card')).toBeVisible();

    await pageB.reload();
    await expect(pageB.locator('.journal-text-conflict')).toBeVisible();
    await pageB.getByRole('button', { name: 'Server-Version übernehmen', exact: true }).click();
    await expect(pageB.locator('.journal-text-conflict')).toBeHidden();
    await expect(pageB.locator('#journalEditorBody .tiptap')).toContainText('Erste kanonische Tagesfassung');

    await context.close();
  });

  test('Meine behalten schreibt die lokale Tagesfassung bewusst gegen die aktuelle Revision', async ({ page, browser }, testInfo) => {
    const date = testInfo.project.name === 'mobile' ? '2032-05-15' : '2032-05-17';
    await login(page);
    await openJournalDate(page, date);
    await page.locator('#journalEditorBody .tiptap').fill('Gemeinsamer Ausgangstext');
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');
    const { context, page: pageB } = await secondContext(browser, page, date);

    await page.locator('#journalEditorBody .tiptap').fill('Serveränderung in Tab A');
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');
    await pageB.locator('#journalEditorBody .tiptap').fill('Lokale Änderung in Tab B');
    await expect(pageB.locator('.journal-text-conflict')).toBeVisible();

    const resolveResponse = pageB.waitForResponse(r => r.url().includes('action=journal_save') && r.status() === 200);
    await pageB.getByRole('button', { name: 'Meine behalten', exact: true }).click();
    await resolveResponse;
    await expect(pageB.locator('.journal-text-conflict')).toBeHidden();
    await expect(pageB.locator('#journalEditorBody .tiptap')).toContainText('Lokale Änderung in Tab B');

    await page.reload();
    await expect(page.locator('#journalEditorBody .tiptap')).toContainText('Lokale Änderung in Tab B');

    await context.close();
  });
});
