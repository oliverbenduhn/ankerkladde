const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

async function secondContext(browser, pageA) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

async function createAttachment(page, suffix = Date.now()) {
  const csrf = await csrfToken(page);
  const categoryResponse = await page.request.post('/api.php?action=categories_create', {
    headers: { 'X-CSRF-Token': csrf },
    form: { name: `Konfliktdateien ${suffix}`, type: 'files', icon: 'dateien' },
  });
  expect(categoryResponse.status()).toBe(201);
  const category = (await categoryResponse.json()).category;
  const uploadResponse = await page.request.post('/api.php?action=upload', {
    headers: { 'X-CSRF-Token': csrf },
    multipart: {
      category_id: String(category.id),
      name: `Anhang ${suffix}`,
      attachment: {
        name: 'ausgang.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Server-Ausgangsfassung'),
      },
    },
  });
  expect(uploadResponse.status()).toBe(201);
  return { category, itemId: Number((await uploadResponse.json()).id) };
}

async function openCategory(page, category) {
  await page.reload();
  await page.getByRole('button', { name: category.name, exact: true }).click();
}

async function startEdit(page, itemId) {
  const card = itemCard(page, itemId);
  await card.locator('.btn-item-menu').click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(card.locator('.edit-name-input')).toBeVisible();
  return card;
}

async function replaceFile(page, itemId, name, content) {
  const card = itemCard(page, itemId);
  await card.getByLabel('Anhang ersetzen').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await card.getByRole('button', { name: /speichern$/ }).click();
}

async function downloadText(page, itemId) {
  const response = await page.request.get(`/media.php?item_id=${itemId}&download=1`);
  expect(response.status()).toBe(200);
  return response.text();
}

async function triggerOnlineRefresh(page) {
  const responsePromise = page.waitForResponse(response => response.url().includes('action=list&category_id='));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await responsePromise;
}

test.describe('FLOW 14 — Attachment-Ersetzungen revisionssicher (Issue #71)', () => {
  test('erfolgreiche Ersetzung und verlorene Antwort verwenden dieselbe Request-ID genau einmal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Attachment-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createAttachment(page);
    await openCategory(page, category);
    await startEdit(page, itemId);

    let lostRequestId = '';
    let uploadCount = 0;
    await page.route('**/api.php?action=upload', async route => {
      uploadCount += 1;
      const requestId = route.request().headers()['x-idempotency-key'];
      if (uploadCount === 1) {
        lostRequestId = requestId;
        await route.fetch();
        await route.abort();
        return;
      }
      expect(requestId).toBe(lostRequestId);
      await route.continue();
    });

    await replaceFile(page, itemId, 'lokal.txt', 'Lokale bestätigte Fassung');
    await expect(itemCard(page, itemId)).toContainText('lokal.txt');
    await itemCard(page, itemId).getByRole('button', { name: /speichern$/ }).click();
    await expect(itemCard(page, itemId).locator('.item-edit-fields')).toHaveCount(0);

    expect(uploadCount).toBe(2);
    expect(await downloadText(page, itemId)).toBe('Lokale bestätigte Fassung');
    const listResponse = await page.request.get(`/api.php?action=list&category_id=${category.id}`);
    const canonical = (await listResponse.json()).items.find(item => Number(item.id) === itemId);
    expect(Number(canonical.revision)).toBe(2);
  });

  test('konkurrierende Ersetzungen zeigen beide Dateien und bieten beide Inhaltsauflösungen', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Zwei-Kontext-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createAttachment(page);
    const { context, page: pageB } = await secondContext(browser, page);
    await openCategory(page, category);
    await openCategory(pageB, category);

    await startEdit(page, itemId);
    await itemCard(page, itemId).getByLabel('Anhang ersetzen').setInputFiles({
      name: 'lokal-verwerfen.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Lokale Fassung zum Verwerfen'),
    });
    await startEdit(pageB, itemId);
    await replaceFile(pageB, itemId, 'server-a.txt', 'Server-Fassung A');
    await expect(itemCard(pageB, itemId).locator('.item-edit-fields')).toHaveCount(0);

    await itemCard(page, itemId).getByRole('button', { name: /speichern$/ }).click();
    const conflict = itemCard(page, itemId).locator('.attachment-content-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict.locator('.attachment-conflict-version')).toHaveCount(2);
    await expect(conflict.locator('.attachment-conflict-version-local')).toContainText('lokal-verwerfen.txt');
    await expect(conflict.locator('.attachment-conflict-version-server')).toContainText('server-a.txt');
    expect(await downloadText(page, itemId)).toBe('Server-Fassung A');

    await conflict.getByRole('button', { name: 'Server-Datei übernehmen', exact: true }).click();
    await expect(itemCard(page, itemId)).toContainText('server-a.txt');
    expect(await downloadText(page, itemId)).toBe('Server-Fassung A');

    await startEdit(page, itemId);
    await itemCard(page, itemId).getByLabel('Anhang ersetzen').setInputFiles({
      name: 'lokal-gewinnt.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Lokale Gewinnerfassung'),
    });
    await openCategory(pageB, category);
    await startEdit(pageB, itemId);
    await replaceFile(pageB, itemId, 'server-b.txt', 'Server-Fassung B');
    await expect(itemCard(pageB, itemId).locator('.item-edit-fields')).toHaveCount(0);

    const localRequestIds = [];
    page.on('request', request => {
      if (request.url().includes('action=upload')) {
        localRequestIds.push(request.headers()['x-idempotency-key']);
      }
    });
    await itemCard(page, itemId).getByRole('button', { name: /speichern$/ }).click();
    await expect(itemCard(page, itemId).locator('.attachment-content-conflict')).toBeVisible();
    await itemCard(page, itemId).getByRole('button', { name: 'Meine Datei behalten', exact: true }).click();
    await expect(itemCard(page, itemId).locator('.item-edit-fields')).toHaveCount(0);

    expect(localRequestIds).toHaveLength(2);
    expect(localRequestIds[0]).toBe(localRequestIds[1]);
    expect(await downloadText(page, itemId)).toBe('Lokale Gewinnerfassung');
    await context.close();
  });

  test('Serverlöschung bewahrt die lokale Datei bis zur Löschauflösung und kann sie neu anlegen', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Zwei-Kontext-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createAttachment(page);
    const { context, page: pageB } = await secondContext(browser, page);
    await openCategory(page, category);
    await openCategory(pageB, category);

    const card = await startEdit(page, itemId);
    const restoredName = `Wiederhergestellter Anhang ${Date.now()}`;
    await card.locator('.edit-name-input').fill(restoredName);
    await card.getByLabel('Anhang ersetzen').setInputFiles({
      name: 'nach-loeschung.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Lokale Datei nach Serverlöschung'),
    });

    const serverCard = itemCard(pageB, itemId);
    await serverCard.locator('.btn-item-menu').click();
    const stagedDelete = pageB.waitForResponse(
      response => response.url().includes('action=delete') && response.status() === 200,
    );
    await pageB.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(serverCard).toHaveCount(0);
    await stagedDelete;
    await triggerOnlineRefresh(page);

    await expect(itemCard(page, itemId)).toContainText('Server-Löschung erkannt');
    await expect(itemCard(page, itemId)).toContainText('nach-loeschung.txt');
    await itemCard(page, itemId).getByRole('button', { name: 'Als neuen Eintrag wiederherstellen' }).click();
    await expect(itemCard(page, itemId)).toHaveCount(0);
    const restored = page.locator('.item-card').filter({ hasText: restoredName });
    await expect(restored).toBeVisible();
    const newItemId = Number(await restored.getAttribute('data-item-id'));
    expect(newItemId).not.toBe(itemId);
    expect(await downloadText(page, newItemId)).toBe('Lokale Datei nach Serverlöschung');

    await context.close();
  });

  test('Datei, Konflikt und Request-ID überstehen einen Reload', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Reload-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createAttachment(page);
    const { context, page: pageB } = await secondContext(browser, page);
    await openCategory(page, category);
    await openCategory(pageB, category);

    await startEdit(page, itemId);
    await itemCard(page, itemId).getByLabel('Anhang ersetzen').setInputFiles({
      name: 'reload-lokal.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Reloadfeste lokale Datei'),
    });
    await startEdit(pageB, itemId);
    await replaceFile(pageB, itemId, 'reload-server.txt', 'Server vor Reload');

    let originalRequestId = '';
    page.on('request', request => {
      if (request.url().includes('action=upload')) {
        originalRequestId ||= request.headers()['x-idempotency-key'];
      }
    });
    await itemCard(page, itemId).getByRole('button', { name: /speichern$/ }).click();
    await expect(itemCard(page, itemId).locator('.attachment-content-conflict')).toBeVisible();
    expect(originalRequestId).not.toBe('');

    await page.reload();
    await expect(itemCard(page, itemId).locator('.attachment-content-conflict')).toBeVisible();
    await expect(itemCard(page, itemId).locator('.attachment-conflict-version-local')).toContainText('reload-lokal.txt');
    await expect(itemCard(page, itemId).locator('.attachment-conflict-version-server')).toContainText('reload-server.txt');

    const retryRequest = page.waitForRequest(request => request.url().includes('action=upload'));
    await itemCard(page, itemId).getByRole('button', { name: 'Meine Datei behalten', exact: true }).click();
    expect((await retryRequest).headers()['x-idempotency-key']).toBe(originalRequestId);
    await expect(itemCard(page, itemId).locator('.item-edit-fields')).toHaveCount(0);
    expect(await downloadText(page, itemId)).toBe('Reloadfeste lokale Datei');
    await context.close();
  });
});
