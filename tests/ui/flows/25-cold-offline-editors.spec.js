const { test, expect } = require('@playwright/test');
const { login, csrfToken, snap, touchTargetsBelowMin } = require('../helpers/ux');

test.use({ serviceWorkers: 'allow' });

// Failure modes: incomplete precache, uncached lazy editor imports, or styles
// which worked online but disappear when the HTTP cache is empty.
test('installieren → kalter Offline-Start → Notiz und Zeichnung erstmals bearbeiten', async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Install before the app is mounted, so its intentional controllerchange
  // reload cannot race the fixture setup or the offline reload below.
  await page.goto('/login.php');
  await page.evaluate(async () => {
    const style = new URL(document.querySelector('link[href*="style.css"]').href);
    await navigator.serviceWorker.register(`sw.js?v=${style.searchParams.get('v')}`);
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await login(page);
  const csrf = await csrfToken(page);
  const fixtures = [];
  for (const type of ['notes', 'drawings']) {
    const name = `Offline ${type} ${Date.now()}`;
    const categoryResponse = await page.request.post('/api.php?action=categories_create', {
      headers: { 'X-CSRF-Token': csrf }, form: { name, type, icon: 'notizen' },
    });
    expect(categoryResponse.status()).toBe(201);
    const category = (await categoryResponse.json()).category;
    const itemResponse = await page.request.post('/api.php?action=add', {
      headers: { 'X-CSRF-Token': csrf }, form: { name, category_id: String(category.id) },
    });
    expect(itemResponse.status()).toBe(201);
    fixtures.push({ ...category, itemId: (await itemResponse.json()).id });
  }
  await page.reload();
  for (const category of fixtures) {
    await page.getByRole('button', { name: category.name, exact: true }).click();
    await expect(page.locator(`.item-card[data-item-id="${category.itemId}"]`)).toBeVisible();
  }
  // Synchronise data without loading either lazy editor online.
  await page.evaluate(async (id) => {
    const response = await fetch(`api.php?action=sketch_load&item_id=${id}`);
    if (!response.ok) throw new Error('Scene sync failed');
    await response.json();
  }, fixtures[1].itemId);
  await page.reload();
  await expect(page.locator(`.item-card[data-item-id="${fixtures[1].itemId}"]`)).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: fixtures[0].name, exact: true }).click();
  await page.locator(`.item-card[data-item-id="${fixtures[0].itemId}"]`).click();
  const editor = page.locator('#noteEditor .tiptap');
  await expect(editor).toBeVisible();
  await editor.fill('Offline geschrieben');
  await expect(editor).toContainText('Offline geschrieben');
  await snap(page, testInfo, 'offline-note');
  await page.locator('#noteEditorBack').click();
  await page.getByRole('button', { name: fixtures[1].name, exact: true }).click();
  await page.locator(`.item-card[data-item-id="${fixtures[1].itemId}"]`).click();
  const canvas = page.locator('.sketch-editor-host canvas.interactive');
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  await page.locator('.sketch-editor-host input[type="radio"][aria-label="Draw"]').click({ force: true });
  const box = await canvas.boundingBox();
  // Draw in the free canvas, clear of Excalidraw's desktop properties panel.
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 50, { steps: 8 });
  await page.mouse.up();
  await snap(page, testInfo, 'offline-sketch');
  if (testInfo.project.name === 'mobile') {
    expect(await touchTargetsBelowMin(page, { selectors: '.sketch-editor-close' })).toEqual([]);
  }
  await page.locator('.sketch-editor-close').click();
  await expect(page.locator('.sketch-editor-overlay')).toHaveCount(0);
  await expect(page.locator('#list')).toBeVisible();
  await page.locator(`.item-card[data-item-id="${fixtures[1].itemId}"]`).click();
  await expect(canvas).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Speichern wiederholen' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Speichern wiederholen' }).click();
  await expect(page.locator('.sketch-editor-status')).toHaveText('Gespeichert');
  await page.locator('.sketch-editor-close').click();
  await expect(page.locator('.sketch-editor-overlay')).toHaveCount(0);
  const saved = await page.request.get(`/api.php?action=sketch_load&item_id=${fixtures[1].itemId}`);
  expect(saved.status()).toBe(200);
  expect((await saved.json()).scene.elements.length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await context.setOffline(true);
  await page.goto('/index.php?unvisited-offline-fallback=1');
  await expect(page.getByRole('heading', { name: 'Gerade offline' })).toBeVisible();
  await expect(page.locator('.offline-panel')).toHaveCSS('display', 'grid');
  await expect.poll(() => page.locator('.offline-brand').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
});
