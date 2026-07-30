const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

async function goToEinkauf(page) {
  await page.getByRole('button', { name: /^Einkauf/ }).first().click();
}

async function quickAdd(page, name) {
  const categories = await (await page.request.get('/api.php?action=categories_list')).json();
  const shopping = categories.categories.find(category => category.type === 'list_quantity');
  const response = await page.request.post('/api.php?action=quick_add', {
    headers: { 'X-CSRF-Token': await csrfToken(page) },
    form: { active_category_id: String(shopping.id), input: name },
  });
  expect(response.status()).toBe(201);
  const id = Number((await response.json()).id);
  await page.reload();
  await goToEinkauf(page);
  await expect(itemCard(page, id)).toBeVisible();
  return id;
}

async function edit(page, id, value) {
  await itemCard(page, id).locator('.btn-item-menu').click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await itemCard(page, id).locator('.edit-name-input').fill(value);
}

test.describe('FLOW 15 — Allgemeine Inline-Inhaltskonflikte', () => {
  test('409 zeigt beide Fassungen; lokale Auflösung behält die Request-ID', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der Zwei-Tab-Nachweis läuft im mobilen Projekt.');
    await login(page);
    await goToEinkauf(page);
    const original = `QA Inline Conflict ${Date.now()}`;
    const id = await quickAdd(page, original);
    await edit(page, id, `${original} lokal`);

    const pageB = await context.newPage();
        await pageB.goto('/index.php', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
    await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await goToEinkauf(pageB);
    await edit(pageB, id, `${original} server`);
    await itemCard(pageB, id).getByRole('button', { name: `${original} speichern` }).click();
    await expect(itemCard(pageB, id)).toContainText(`${original} server`);

    const requestIds = [];
    page.on('request', request => {
      if (request.url().includes('action=update')) {
        requestIds.push(request.headers()['x-idempotency-key']);
      }
    });
    await itemCard(page, id).getByRole('button', { name: `${original} speichern` }).click();
    const conflict = itemCard(page, id).locator('.item-content-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict.locator('.item-content-conflict-version-local')).toContainText(`${original} lokal`);
    await expect(conflict.locator('.item-content-conflict-version-server')).toContainText(`${original} server`);

    await conflict.getByRole('button', { name: 'Meine Fassung behalten', exact: true }).click();
    await expect(itemCard(page, id).locator('.item-edit-fields')).toHaveCount(0);
    await expect(itemCard(page, id)).toContainText(`${original} lokal`);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    await pageB.close();
  });

  test('Server-Version übernehmen verwirft nur den betroffenen Draft', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der Zwei-Tab-Nachweis läuft im mobilen Projekt.');
    await login(page);
    await goToEinkauf(page);
    const original = `QA Inline Server ${Date.now()}`;
    const id = await quickAdd(page, original);
    await edit(page, id, `${original} lokal verwerfen`);

    const pageB = await context.newPage();
        await pageB.goto('/index.php', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
    await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await goToEinkauf(pageB);
    await edit(pageB, id, `${original} kanonisch`);
    await itemCard(pageB, id).getByRole('button', { name: `${original} speichern` }).click();
    await itemCard(page, id).getByRole('button', { name: `${original} speichern` }).click();

    const conflict = itemCard(page, id).locator('.item-content-conflict');
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Server-Version übernehmen', exact: true }).click();
    await expect(itemCard(page, id).locator('.item-edit-fields')).toHaveCount(0);
    await expect(itemCard(page, id)).toContainText(`${original} kanonisch`);
    await pageB.close();
  });
});
