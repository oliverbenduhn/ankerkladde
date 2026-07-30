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

async function dragItemBefore(page, draggedId, targetId) {
  const dragged = await itemCard(page, draggedId).boundingBox();
  const target = await itemCard(page, targetId).boundingBox();
  expect(dragged).toBeTruthy();
  expect(target).toBeTruthy();
  await page.mouse.move(dragged.x + dragged.width / 2, dragged.y + dragged.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 8 });
  await page.mouse.up();
}

async function visibleItemIds(page) {
  return page.locator('#list .item-card').evaluateAll(cards => cards.map(card => Number(card.dataset.itemId)));
}

test.describe('FLOW 10 — Atomare Bulk-Änderungen (Issue #67)', () => {
  test('konkurrierendes Hinzufügen verwirft Reorder vollständig und zeigt die Serverreihenfolge', async ({ page, browser }) => {
    await login(page);
    await openShopping(page);
    const first = await quickAdd(page, `QA Flow10 First ${Date.now()}`);
    const second = await quickAdd(page, `QA Flow10 Second ${Date.now()}`);
    const third = await quickAdd(page, `QA Flow10 Third ${Date.now()}`);
    const { context, page: pageB } = await secondContext(browser, page);

    const addedInParallel = await quickAdd(pageB, `QA Flow10 Parallel ${Date.now()}`);
    const conflictResponse = page.waitForResponse(r => r.url().includes('action=reorder') && r.status() === 409);
    await dragItemBefore(page, third, first);
    await conflictResponse;

    await expect(itemCard(page, addedInParallel)).toBeVisible();
    await expect.poll(async () => visibleItemIds(page)).toEqual(await visibleItemIds(pageB));
    await expect(itemCard(page, first)).toBeVisible();
    await expect(itemCard(page, second)).toBeVisible();
    await expect(itemCard(page, third)).toBeVisible();

    await context.close();
  });

  test('offline vorgemerkte Löschung erfasst keine später erledigten Items', async ({ page, browser }) => {
    await login(page);
    await openShopping(page);
    const captured = await quickAdd(page, `QA Flow10 Captured ${Date.now()}`);
    const completedLater = await quickAdd(page, `QA Flow10 Later ${Date.now()}`);
    const { context, page: pageB } = await secondContext(browser, page);

    await itemCard(page, captured).locator('input.toggle').click();
    await expect(itemCard(page, captured)).toHaveClass(/\bdone\b/);

    let capturedClearPayload = null;
    await page.route('**/api.php?action=clear', async route => {
      capturedClearPayload = new URLSearchParams(route.request().postData() || '').get('items');
      await route.abort('internetdisconnected');
    });
    await page.getByRole('button', { name: 'Erledigte löschen' }).click();
    await expect(itemCard(page, captured)).toHaveCount(0);
    await expect.poll(() => capturedClearPayload).not.toBeNull();
    const capturedIds = JSON.parse(capturedClearPayload).map(item => item.id);
    expect(capturedIds).toContain(captured);
    expect(capturedIds).not.toContain(completedLater);

    await itemCard(pageB, completedLater).locator('input.toggle').click();
    await expect(itemCard(pageB, completedLater)).toHaveClass(/\bdone\b/);

    await page.unroute('**/api.php?action=clear');
    const clearResponse = page.waitForResponse(r => r.url().includes('action=clear') && r.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await clearResponse;
    await page.reload();
    await openShopping(page);

    await expect(itemCard(page, captured)).toHaveCount(0);
    await expect(itemCard(page, completedLater)).toBeVisible();
    await expect(itemCard(page, completedLater)).toHaveClass(/\bdone\b/);

    await context.close();
  });
});
