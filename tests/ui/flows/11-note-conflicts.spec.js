const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

async function openNotes(page) {
  await page.getByRole('button', { name: /^Notizen/ }).first().click();
}

async function createNote(page, title, body) {
  await page.locator('#itemInput').fill(title);
  const createResponse = page.waitForResponse(r => r.url().includes('action=add') && r.status() === 201);
  await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
  const created = await (await createResponse).json();
  const editor = page.locator('#noteEditorEl .tiptap');
  await expect(editor).toBeVisible();
  await editor.fill(body);
  await expect(page.locator('#noteSaveStatus')).toHaveText('Gespeichert');
  return created.id;
}

async function openExistingNote(page, id) {
  await page.locator(`.item-card[data-item-id="${id}"]`).click();
  await expect(page.locator('#noteEditor')).toBeVisible();
}

async function secondContext(browser, pageA) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  await openNotes(page);
  return { context, page };
}

test.describe('FLOW 11 — Normale Notizen im gemeinsamen Konfliktmodell (Issue #68)', () => {
  test('abweichende Fassungen überleben Reload und Meine behalten löst gegen die Serverrevision auf', async ({ page, browser }) => {
    await login(page);
    await openNotes(page);
    const originalTitle = `QA Flow11 Mine ${Date.now()}`;
    const id = await createNote(page, originalTitle, 'Gemeinsamer Ausgangstext');
    await page.getByRole('button', { name: 'Zurück' }).click();

    const { context, page: pageB } = await secondContext(browser, page);
    await openExistingNote(page, id);
    await openExistingNote(pageB, id);

    const serverTitle = `${originalTitle} Server`;
    await pageB.locator('#noteTitleInput').fill(serverTitle);
    await pageB.locator('#noteEditorEl .tiptap').fill('Serverfassung der Notiz');
    await expect(pageB.locator('#noteSaveStatus')).toHaveText('Gespeichert');

    const localTitle = `${originalTitle} Lokal`;
    await page.locator('#noteTitleInput').fill(localTitle);
    await page.locator('#noteEditorEl .tiptap').fill('Meine lokale Fassung');
    await expect(page.locator('.note-content-conflict')).toBeVisible();
    await expect(page.locator('.note-conflict-version-local')).toContainText(localTitle);
    await expect(page.locator('.note-conflict-version-local')).toContainText('Meine lokale Fassung');
    await expect(page.locator('.note-conflict-version-server')).toContainText(serverTitle);
    await expect(page.locator('.note-conflict-version-server')).toContainText('Serverfassung der Notiz');

    await page.reload();
    await expect(page.locator('.note-content-conflict')).toBeVisible();
    const resolveResponse = page.waitForResponse(r => r.url().includes('action=update') && r.status() === 200);
    await page.getByRole('button', { name: 'Meine behalten', exact: true }).click();
    await resolveResponse;
    await expect(page.locator('.note-content-conflict')).toBeHidden();
    await expect(page.locator('#noteTitleInput')).toHaveValue(localTitle);
    await expect(page.locator('#noteEditorEl .tiptap')).toContainText('Meine lokale Fassung');

    await context.close();
  });

  test('Server-Version übernehmen verwirft nur den konfliktbehafteten Notizentwurf', async ({ page, browser }) => {
    await login(page);
    await openNotes(page);
    const originalTitle = `QA Flow11 Server ${Date.now()}`;
    const id = await createNote(page, originalTitle, 'Ausgangstext für Serverwahl');
    await page.getByRole('button', { name: 'Zurück' }).click();

    const { context, page: pageB } = await secondContext(browser, page);
    await openExistingNote(page, id);
    await openExistingNote(pageB, id);
    await pageB.locator('#noteEditorEl .tiptap').fill('Kanonische Serverfassung');
    await expect(pageB.locator('#noteSaveStatus')).toHaveText('Gespeichert');

    await page.locator('#noteEditorEl .tiptap').fill('Zu verwerfende lokale Fassung');
    await expect(page.locator('.note-content-conflict')).toBeVisible();
    await page.getByRole('button', { name: 'Server-Version übernehmen', exact: true }).click();
    await expect(page.locator('.note-content-conflict')).toBeHidden();
    await expect(page.locator('#noteEditorEl .tiptap')).toContainText('Kanonische Serverfassung');
    await expect(page.locator('#noteEditorEl .tiptap')).not.toContainText('Zu verwerfende lokale Fassung');

    await page.reload();
    await expect(page.locator('#noteEditorEl .tiptap')).toContainText('Kanonische Serverfassung');

    await context.close();
  });
});
