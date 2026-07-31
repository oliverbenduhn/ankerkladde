const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

async function openCategory(page, name) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
}

async function quickAdd(page, categoryName, name) {
  await openCategory(page, categoryName);
  const responsePromise = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
  await page.locator('#itemInput').fill(name);
  await page.locator('#itemInput').press('Enter');
  const body = await (await responsePromise).json();
  await expect(itemCard(page, body.id)).toBeVisible();
  return body.id;
}

async function secondContext(browser, pageA, categoryName) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  await openCategory(page, categoryName);
  return { context, page };
}

async function categoryByType(page, type) {
  const response = await page.request.get('/api.php?action=categories_list');
  const body = await response.json();
  const category = body.categories.find(entry => entry.type === type);
  expect(category, `Kategorie vom Typ ${type} fehlt`).toBeTruthy();
  return category;
}

async function categoriesByType(page, type) {
  const response = await page.request.get('/api.php?action=categories_list');
  const body = await response.json();
  const categories = body.categories.filter(entry => entry.type === type);
  if (categories.length >= 2) return categories;

  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const created = await page.request.post('/api.php?action=categories_create', {
    headers: {
      'X-CSRF-Token': csrf,
      'X-Idempotency-Key': `flow8-category-${Date.now()}`,
    },
    form: { name: `QA Move Ziel ${Date.now()}`, type },
  });
  expect(created.status()).toBe(201);
  categories.push((await created.json()).category);
  await page.reload();
  await expect(page.locator('.section-tab').first()).toBeVisible();
  return categories;
}

async function openItemMenu(page, id) {
  await itemCard(page, id).locator('.btn-item-menu').click();
}

test.describe('FLOW 8 — Statusänderungen unabhängig synchronisieren (Issue #65)', () => {
  test('identisches Erledigt-Ziel ist in zwei Browser-Kontexten idempotent', async ({ page, browser }) => {
    await login(page);
    const category = await categoryByType(page, 'list_quantity');
    const id = await quickAdd(page, category.name, `QA Flow8 Identisch ${Date.now()}`);
    const { context, page: pageB } = await secondContext(browser, page, category.name);

    const requestB = pageB.waitForRequest(r => r.url().includes('action=toggle'));
    await itemCard(pageB, id).locator('input.toggle').click();
    await expect(itemCard(pageB, id)).toHaveClass(/\bdone\b/);

    const requestA = page.waitForRequest(r => r.url().includes('action=toggle'));
    const responsePromise = page.waitForResponse(r => r.url().includes('action=toggle'));
    await itemCard(page, id).locator('input.toggle').click();
    expect((await responsePromise).status()).toBe(200);
    expect((await requestA).headers()['x-idempotency-key']).not.toBe((await requestB).headers()['x-idempotency-key']);
    await expect(itemCard(page, id)).toHaveClass(/\bdone\b/);
    await expect(itemCard(page, id).locator('.item-sync-badge-conflict')).toHaveCount(0);

    await context.close();
  });

  test('unabhängige Inhaltsänderung wird mit stabiler Request-ID rebased', async ({ page, browser }) => {
    await login(page);
    const category = await categoryByType(page, 'list_quantity');
    const originalName = `QA Flow8 Rebase ${Date.now()}`;
    const id = await quickAdd(page, category.name, originalName);
    const { context, page: pageB } = await secondContext(browser, page, category.name);

    await itemCard(pageB, id).locator('.btn-item-menu').click();
    await pageB.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const changedName = `${originalName} Serverinhalt`;
    await pageB.locator('#itemTitleInput').fill(changedName);
    await pageB.locator('#itemSaveBtn').click();
    await expect(itemCard(pageB, id)).toContainText(changedName);

    const requests = [];
    const statuses = [];
    page.on('request', request => {
      if (request.url().includes('action=toggle')) requests.push(request.headers()['x-idempotency-key']);
    });
    page.on('response', response => {
      if (response.url().includes('action=toggle')) statuses.push(response.status());
    });

    await itemCard(page, id).locator('input.toggle').click();
    await expect.poll(() => statuses).toEqual([409, 200]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBeTruthy();
    expect(requests[1]).toBe(requests[0]);
    await expect(itemCard(page, id)).toContainText(changedName);
    await expect(itemCard(page, id)).toHaveClass(/\bdone\b/);

    await context.close();
  });

  test('abweichender Workflow-Status zeigt Serverzustand und kurze Wiederholungsmeldung', async ({ page, browser }) => {
    await login(page);
    const category = await categoryByType(page, 'list_due_date');
    const name = `QA Flow8 Konflikt ${Date.now()}`;
    const id = await quickAdd(page, category.name, name);
    const { context, page: pageB } = await secondContext(browser, page, category.name);

    await itemCard(pageB, id).getByRole('button', { name: /Status: Offen/ }).click();
    await expect(itemCard(pageB, id).getByRole('button', { name: /Status: In Arbeit/ })).toBeVisible();
    await itemCard(pageB, id).getByRole('button', { name: /Status: In Arbeit/ }).click();
    await expect(itemCard(pageB, id).getByRole('button', { name: /Status: Wartet/ })).toBeVisible();

    const conflictResponse = page.waitForResponse(r => r.url().includes('action=status') && r.status() === 409);
    await itemCard(page, id).getByRole('button', { name: /Status: Offen/ }).click();
    await conflictResponse;
    await expect(itemCard(page, id).getByRole('button', { name: /Status: Wartet/ })).toBeVisible();
    await expect(page.locator('#message')).toContainText('erneut');

    await context.close();
  });

  test('mehrere Offline-Statusziele behalten den ursprünglichen Basiszustand beim Rebase', async ({ page, browser }) => {
    await login(page);
    const category = await categoryByType(page, 'list_due_date');
    const originalName = `QA Flow8 Offline-Rebase ${Date.now()}`;
    const id = await quickAdd(page, category.name, originalName);
    const { context, page: pageB } = await secondContext(browser, page, category.name);

    await page.route('**/api.php?action=status', route => route.abort('internetdisconnected'));
    await itemCard(page, id).getByRole('button', { name: /Status: Offen/ }).click();
    await expect(itemCard(page, id).getByRole('button', { name: /Status: In Arbeit/ })).toBeVisible();
    await itemCard(page, id).getByRole('button', { name: /Status: In Arbeit/ }).click();
    await expect(itemCard(page, id).getByRole('button', { name: /Status: Wartet/ })).toBeVisible();

    await openItemMenu(pageB, id);
    await pageB.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const changedName = `${originalName} Serverinhalt`;
    await pageB.locator('#itemTitleInput').fill(changedName);
    await pageB.locator('#itemSaveBtn').click();
    await expect(pageB.locator('#message')).toContainText('gespeichert');
    await pageB.locator('#itemEditorBack').click();
    await expect(pageB.locator('#itemEditor')).toBeHidden();

    const statuses = [];
    page.on('response', response => {
      if (response.url().includes('action=status')) statuses.push(response.status());
    });
    await page.unroute('**/api.php?action=status');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect.poll(() => statuses).toEqual([409, 200]);
    await expect(itemCard(page, id)).toContainText(changedName);
    await expect(itemCard(page, id).getByRole('button', { name: /Status: Wartet/ })).toBeVisible();
    await expect(itemCard(page, id).locator('.item-sync-badge-conflict')).toHaveCount(0);

    await context.close();
  });

  test('identisches Pin-Ziel ist in zwei Browser-Kontexten idempotent', async ({ page, browser }) => {
    await login(page);
    const category = await categoryByType(page, 'list_quantity');
    const id = await quickAdd(page, category.name, `QA Flow8 Pin ${Date.now()}`);
    const { context, page: pageB } = await secondContext(browser, page, category.name);

    await openItemMenu(pageB, id);
    await pageB.getByRole('button', { name: 'Anheften', exact: true }).click();
    await expect(itemCard(pageB, id)).toHaveClass(/\bis-pinned\b/);

    const responsePromise = page.waitForResponse(r => r.url().includes('action=pin'));
    await openItemMenu(page, id);
    await page.getByRole('button', { name: 'Anheften', exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(itemCard(page, id)).toHaveClass(/\bis-pinned\b/);
    await expect(itemCard(page, id).locator('.item-sync-badge-conflict')).toHaveCount(0);

    await context.close();
  });

  test('Erledigt im Todo-Editor übernimmt die kanonische Revision für den nächsten Save', async ({ page }) => {
    await login(page);
    const category = await categoryByType(page, 'list_due_date');
    const originalName = `QA Flow8 Editor-Revision ${Date.now()}`;
    const id = await quickAdd(page, category.name, originalName);

    await openItemMenu(page, id);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const firstName = `${originalName} vor Erledigt`;
    await page.locator('#itemTitleInput').fill(firstName);
    await page.locator('#itemDoneBtn').click();
    await expect(page.locator('#itemDoneBtn')).toHaveClass(/\bis-active\b/);

    const finalName = `${originalName} nach Erledigt`;
    await page.locator('#itemTitleInput').fill(finalName);
    await page.locator('#itemSaveBtn').click();
    await expect(page.locator('#message')).toContainText('gespeichert');
    await page.locator('#itemEditorBack').click();
    await expect(page.locator('#itemEditor')).toBeHidden();
    await expect(itemCard(page, id)).toContainText(finalName);
  });

  test('Verschieben wird nach unabhängiger Inhaltsänderung mit stabiler Request-ID rebased', async ({ page, browser }) => {
    await login(page);
    const categories = await categoriesByType(page, 'list_quantity');
    const [source, target] = categories;
    const originalName = `QA Flow8 Move ${Date.now()}`;
    const id = await quickAdd(page, source.name, originalName);
    const { context, page: pageB } = await secondContext(browser, page, source.name);

    await openItemMenu(pageB, id);
    await pageB.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const changedName = `${originalName} Serverinhalt`;
    await pageB.locator('#itemTitleInput').fill(changedName);
    await pageB.locator('#itemSaveBtn').click();
    await expect(itemCard(pageB, id)).toContainText(changedName);

    const requests = [];
    const statuses = [];
    page.on('request', request => {
      if (request.url().includes('action=move')) requests.push(request.headers()['x-idempotency-key']);
    });
    page.on('response', response => {
      if (response.url().includes('action=move')) statuses.push(response.status());
    });

    await openItemMenu(page, id);
    await page.getByRole('button', { name: 'Verschieben', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: target.name, exact: true }).click();
    await expect.poll(() => statuses).toEqual([409, 200]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBeTruthy();
    expect(requests[1]).toBe(requests[0]);
    await expect(itemCard(page, id)).toHaveCount(0);

    await openCategory(page, target.name);
    await expect(itemCard(page, id)).toContainText(changedName);

    await context.close();
  });
});
