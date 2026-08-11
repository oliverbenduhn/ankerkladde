const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

async function openShopping(page) {
  await page.getByRole('button', { name: /^Einkauf/ }).first().click();
}

async function quickAdd(page, name) {
  const responsePromise = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
  await page.locator('#itemInput').fill(name);
  await page.locator('#itemInput').press('Enter');
  const body = await (await responsePromise).json();
  await expect(itemCard(page, body.id)).toBeVisible();
  return body.id;
}

async function secondContext(browser, pageA) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  await openShopping(page);
  return { context, page };
}

async function openMenu(page, id) {
  await itemCard(page, id).locator('.btn-item-menu').click();
}

async function startEdit(page, id) {
  await openMenu(page, id);
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.locator('#itemEditor')).toBeVisible();
}

async function saveEditor(page) {
  await page.locator('#itemSaveBtn').click();
}

async function triggerOnlineRefresh(page) {
  const responsePromise = page.waitForResponse(r => r.url().includes('action=list&category_id='));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await responsePromise;
}

test.describe('FLOW 9 — Löschkonflikte ohne Datenverlust (Issue #66)', () => {
  test('parallele Änderung bleibt sichtbar und kann bewusst trotzdem gelöscht werden', async ({ page, browser }) => {
    await login(page);
    await openShopping(page);
    const original = `QA Flow9 Delete ${Date.now()}`;
    const id = await quickAdd(page, original);
    const { context, page: pageB } = await secondContext(browser, page);

    await startEdit(pageB, id);
    const serverName = `${original} Serverfassung`;
    await pageB.locator('#itemTitleInput').fill(serverName);
    await saveEditor(pageB);
    await expect(itemCard(pageB, id)).toContainText(serverName);

    const conflictResponse = page.waitForResponse(r => r.url().includes('action=delete') && r.status() === 409);
    await openMenu(page, id);
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await conflictResponse;

    await expect(itemCard(page, id)).toContainText(serverName);
    await expect(itemCard(page, id).locator('.item-sync-badge-conflict')).toBeVisible();
    await openMenu(page, id);
    const forceDelete = page.getByRole('button', { name: 'Trotzdem löschen', exact: true });
    await expect(forceDelete).toBeVisible();
    const forceDeleteResponse = page.waitForResponse(r => r.url().includes('action=delete') && r.status() === 200);
    await forceDelete.click();
    await expect(itemCard(page, id)).toHaveCount(0);
    await forceDeleteResponse;

    await context.close();
  });

  test('lokaler Entwurf überlebt Serverlöschung und Reload und kann als neuer Eintrag wiederhergestellt werden', async ({ page, browser }) => {
    await login(page);
    await openShopping(page);
    const original = `QA Flow9 Restore ${Date.now()}`;
    const id = await quickAdd(page, original);
    const { context, page: pageB } = await secondContext(browser, page);

    await startEdit(page, id);
    const draftName = `${original} lokaler Entwurf`;
    await page.locator('#itemTitleInput').fill(draftName);

    await openMenu(pageB, id);
    const deleteResponse = pageB.waitForResponse(r => r.url().includes('action=delete') && r.status() === 200);
    await pageB.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(itemCard(pageB, id)).toHaveCount(0);
    await deleteResponse;
    await triggerOnlineRefresh(page);

    await page.reload();
    await expect(page.locator('#itemEditor')).toBeVisible();
    await expect(page.locator('#itemTitleInput')).toHaveValue(draftName);
    await expect(page.locator('#itemEditorBody')).toContainText('Server-Löschung erkannt');
    await page.getByRole('button', { name: 'Als neuen Eintrag wiederherstellen' }).click();
    await expect(page.locator('.item-card').filter({ hasText: draftName })).toBeVisible();
    await expect(itemCard(page, id)).toHaveCount(0);

    await context.close();
  });

  test('bei Serverlöschung kann nur der betroffene lokale Entwurf verworfen werden', async ({ page, browser }) => {
    await login(page);
    await openShopping(page);
    const original = `QA Flow9 Discard ${Date.now()}`;
    const id = await quickAdd(page, original);
    const { context, page: pageB } = await secondContext(browser, page);

    await startEdit(page, id);
    await page.locator('#itemTitleInput').fill(`${original} lokal`);
    await openMenu(pageB, id);
    const deleteResponse = pageB.waitForResponse(r => r.url().includes('action=delete') && r.status() === 200);
    await pageB.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(itemCard(pageB, id)).toHaveCount(0);
    await deleteResponse;
    await triggerOnlineRefresh(page);

    await expect(page.locator('#itemEditorBody')).toContainText('Server-Löschung erkannt');
    await page.getByRole('button', { name: 'Löschung übernehmen' }).click();
    await expect(itemCard(page, id)).toHaveCount(0);
    await page.reload();
    await openShopping(page);
    await expect(itemCard(page, id)).toHaveCount(0);

    await context.close();
  });
});
