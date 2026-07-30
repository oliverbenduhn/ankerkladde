const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

test('Offline-Queue und Konflikthinweise sind pro Tab getrennt', async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Der Zwei-Tab-Nachweis läuft im mobilen Projekt.');
  const pageA = await context.newPage();
  await login(pageA);
  await pageA.getByRole('button', { name: /^Einkauf/ }).first().click();
  const name = `QA Tab Queue ${Date.now()}`;
  const categories = await (await pageA.request.get('/api.php?action=categories_list')).json();
  const shopping = categories.categories.find(category => category.type === 'list_quantity');
  const response = await pageA.request.post('/api.php?action=quick_add', {
    headers: { 'X-CSRF-Token': await csrfToken(pageA) },
    form: { active_category_id: String(shopping.id), input: name },
  });
  expect(response.status()).toBe(201);
  const id = Number((await response.json()).id);
  await pageA.reload();
  await pageA.getByRole('button', { name: /^Einkauf/ }).first().click();
  await expect(itemCard(pageA, id)).toBeVisible();

  const pageB = await context.newPage();
  await pageB.goto('/index.php', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
  await pageB.getByRole('button', { name: /^Einkauf/ }).first().click();

  await context.setOffline(true);
  await itemCard(pageA, id).locator('input.toggle').click();
  await expect(itemCard(pageA, id).locator('.item-sync-badge-offline')).toBeVisible();
  await expect(itemCard(pageB, id).locator('.item-sync-badge-offline')).toHaveCount(0);

  const [keysA, keysB] = await Promise.all([
    pageA.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ankerkladde-offline-queue:'))),
    pageB.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ankerkladde-offline-queue:'))),
  ]);
  expect(keysA).toEqual(keysB);
  const tabIdA = await pageA.evaluate(() => sessionStorage.getItem('ankerkladde-tab-id'));
  const tabIdB = await pageB.evaluate(() => sessionStorage.getItem('ankerkladde-tab-id'));
  expect(tabIdA).not.toBe(tabIdB);
  const queueValues = await pageB.evaluate(() => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith('ankerkladde-offline-queue:'))
  ));
  const ownQueue = Object.entries(queueValues).find(([key]) => key.endsWith(`:${tabIdB}`));
  expect(ownQueue).toBeUndefined();

  await context.setOffline(false);
  await pageA.close();
  await pageB.close();
});
