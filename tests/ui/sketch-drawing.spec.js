const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('drawing editor accepts a stroke and persists it', async ({ page }) => {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();

  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const suffix = Date.now();
  const categoryResponse = await page.request.post('/api.php?action=categories_create', {
    headers: { 'X-CSRF-Token': csrf },
    form: { name: `Zeichnungen ${suffix}`, type: 'drawings', icon: 'notizen' },
  });
  expect(categoryResponse.status()).toBe(201);
  const category = (await categoryResponse.json()).category;
  const itemResponse = await page.request.post('/api.php?action=add', {
    headers: { 'X-CSRF-Token': csrf },
    form: { category_id: String(category.id), name: `Skizze ${suffix}` },
  });
  expect(itemResponse.status()).toBe(201);
  const itemId = (await itemResponse.json()).id;

  await page.reload();
  await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await page.locator(`.item-card[data-item-id="${itemId}"]`).click();

  const canvas = page.locator('.sketch-editor-host canvas.interactive');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const drawTool = page.locator('.sketch-editor-host input[type="radio"][aria-label="Draw"]');
  await expect(drawTool).toBeAttached();
  await drawTool.click({ force: true });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 550, box.y + 500, { steps: 8 });
  await page.mouse.up();
  await page.locator('.sketch-editor-close').click();
  await expect(page.locator('.sketch-editor-overlay')).toHaveCount(0);

  const sceneResponse = await page.request.get(`/api.php?action=sketch&item_id=${itemId}`);
  expect(sceneResponse.ok()).toBeTruthy();
  const scene = (await sceneResponse.json()).scene;
  expect(scene.elements.length).toBeGreaterThan(0);
});
