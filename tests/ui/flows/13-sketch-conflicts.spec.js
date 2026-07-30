const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

const REMOTE_SCENE_A = {
  elements: [{ id: 'remote-a', type: 'rectangle', x: 20, y: 20, width: 120, height: 80 }],
  appState: { viewBackgroundColor: '#ffffff' },
};
const REMOTE_SCENE_B = {
  elements: [{ id: 'remote-b', type: 'ellipse', x: 40, y: 40, width: 100, height: 100 }],
  appState: { viewBackgroundColor: '#ffffff' },
};

async function secondContext(browser, pageA) {
  const context = await browser.newContext({ baseURL: new URL(pageA.url()).origin, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

async function createDrawing(page) {
  const csrf = await csrfToken(page);
  const suffix = Date.now();
  const categoryResponse = await page.request.post('/api.php?action=categories_create', {
    headers: { 'X-CSRF-Token': csrf },
    form: { name: `Konfliktzeichnungen ${suffix}`, type: 'drawings', icon: 'notizen' },
  });
  expect(categoryResponse.status()).toBe(201);
  const category = (await categoryResponse.json()).category;
  const itemResponse = await page.request.post('/api.php?action=add', {
    headers: { 'X-CSRF-Token': csrf },
    form: { category_id: String(category.id), name: `Konfliktskizze ${suffix}` },
  });
  expect(itemResponse.status()).toBe(201);
  return { category, itemId: Number((await itemResponse.json()).id) };
}

async function openDrawing(page, category, itemId) {
  await page.reload();
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await page.locator(`.item-card[data-item-id="${itemId}"]`).click();
  await expect(page.locator('.sketch-editor-host canvas.interactive')).toBeVisible({ timeout: 25_000 });
}

async function drawStroke(page, offset = 0) {
  const canvas = page.locator('.sketch-editor-host canvas.interactive');
  const drawTool = page.locator('.sketch-editor-host input[type="radio"][aria-label="Draw"]');
  await expect(drawTool).toBeAttached();
  await drawTool.click({ force: true });
  const box = await canvas.boundingBox();
  const startX = box.x + Math.min(box.width - 90, 45 + offset);
  const startY = box.y + Math.min(box.height - 90, 80 + offset);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 55, startY + 45, { steps: 8 });
  await page.mouse.up();
}

async function saveRemoteScene(page, itemId, scene, expectedRevision, key) {
  const response = await page.request.post('/api.php?action=sketch_save', {
    headers: {
      'X-CSRF-Token': await csrfToken(page),
      'X-Idempotency-Key': key,
    },
    form: {
      item_id: String(itemId),
      scene: JSON.stringify(scene),
      expected_revision: String(expectedRevision),
    },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('FLOW 13 — Zeichnungen und Tages-Skizzen verlustfrei (Issue #70)', () => {
  test('Zeichnungskonflikt überlebt Reload und bietet beide gleichwertigen Szenenauflösungen', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Zwei-Kontext-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createDrawing(page);
    const { context, page: pageB } = await secondContext(browser, page);

    await openDrawing(pageB, category, itemId);
    await saveRemoteScene(page, itemId, REMOTE_SCENE_A, 1, `drawing-remote-a-${itemId}`);
    await drawStroke(pageB);

    const conflict = pageB.locator('.sketch-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict.locator('.sketch-conflict-version')).toHaveCount(2);
    await expect(conflict.getByText('Meine Skizze', { exact: true })).toBeVisible();
    await expect(conflict.getByText('Server-Skizze', { exact: true })).toBeVisible();
    await expect(conflict.locator('.sketch-conflict-preview')).toHaveCount(2);
    for (const preview of await conflict.locator('.sketch-conflict-preview').all()) {
      await expect(preview.locator('canvas').first()).toBeVisible();
    }

    await pageB.locator('.sketch-editor-close').click();
    await expect(pageB.locator('.sketch-editor-overlay')).toHaveCount(0);
    await pageB.reload();
    await pageB.getByRole('button', { name: category.name, exact: true }).click();
    await pageB.locator(`.item-card[data-item-id="${itemId}"]`).click();
    await expect(pageB.locator('.sketch-conflict')).toBeVisible();
    await pageB.getByRole('button', { name: 'Server-Skizze übernehmen', exact: true }).click();
    await expect(pageB.locator('.sketch-editor-overlay')).toHaveCount(0);

    let canonical = await page.request.get(`/api.php?action=sketch&item_id=${itemId}`);
    expect((await canonical.json()).scene.elements[0].id).toBe('remote-a');

    await openDrawing(pageB, category, itemId);
    await saveRemoteScene(page, itemId, REMOTE_SCENE_B, 2, `drawing-remote-b-${itemId}`);
    await drawStroke(pageB, 20);
    await expect(pageB.locator('.sketch-conflict')).toBeVisible();
    await pageB.getByRole('button', { name: 'Meine Skizze behalten', exact: true }).click();
    await expect(pageB.locator('.sketch-editor-overlay')).toHaveCount(0);

    canonical = await page.request.get(`/api.php?action=sketch&item_id=${itemId}`);
    const resolvedScene = (await canonical.json()).scene;
    expect(resolvedScene.elements.some(element => element.id === 'remote-b')).toBeFalsy();
    expect(resolvedScene.elements.length).toBeGreaterThan(0);

    await context.close();
  });

  test('lokale Änderungen während eines laufenden Speicherns bleiben vollständig erhalten', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der verlustfreie In-Flight-Nachweis läuft im mobilen Projekt.');
    await login(page);
    const { category, itemId } = await createDrawing(page);
    let firstSaveSeen;
    const firstSaveStarted = new Promise(resolve => { firstSaveSeen = resolve; });
    let firstSaveDone;
    const firstSaveCompleted = new Promise(resolve => { firstSaveDone = resolve; });
    let saveCount = 0;
    let activeSaves = 0;
    let maxConcurrentSaves = 0;
    await page.route('**/api.php?action=sketch_save', async route => {
      saveCount += 1;
      const currentSave = saveCount;
      activeSaves += 1;
      maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaves);
      if (currentSave === 1) {
        firstSaveSeen();
        await new Promise(resolve => setTimeout(resolve, 1_200));
      }
      const response = await route.fetch();
      await route.fulfill({ response });
      activeSaves -= 1;
      if (currentSave === 1) firstSaveDone();
    });

    await openDrawing(page, category, itemId);
    await drawStroke(page);
    await firstSaveStarted;
    await drawStroke(page, 35);

    await firstSaveCompleted;
    await expect.poll(async () => {
      const response = await page.request.get(`/api.php?action=sketch&item_id=${itemId}`);
      return (await response.json()).scene?.elements?.length || 0;
    }, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(saveCount).toBe(2);
    expect(maxConcurrentSaves).toBe(1);
    await expect(page.locator('.sketch-conflict')).toHaveCount(0);
    await page.locator('.sketch-editor-close').click();
  });

  test('paralleles Erstanlegen und unabhängige Text-/Skizzenänderungen werden automatisch zusammengeführt', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Der geforderte Zwei-Kontext-Nachweis läuft im mobilen Projekt.');
    const date = '2032-06-20';
    await login(page);
    await page.goto(`/index.php?screen=journal&date=${date}`);
    await expect(page.locator('#journalEditorBody .tiptap')).toBeVisible();
    const { context, page: pageB } = await secondContext(browser, page);
    await pageB.goto(`/index.php?screen=journal&date=${date}`);
    await expect(pageB.locator('#journalEditorBody .tiptap')).toBeVisible();

    await pageB.locator('#journalSketchOpenBtn').click();
    await expect(pageB.locator('.sketch-editor-host canvas.interactive')).toBeVisible({ timeout: 25_000 });
    await page.locator('#journalEditorBody .tiptap').fill('Text aus Kontext A');
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');
    await drawStroke(pageB);
    await expect(pageB.locator('.sketch-editor-status')).toHaveText('Gespeichert');
    await pageB.locator('.sketch-editor-close').click();

    let journal = await page.request.get(`/api.php?action=journal&date=${date}`);
    let item = (await journal.json()).item;
    expect(item.content).toContain('Text aus Kontext A');
    expect(item.has_sketch).toBe(1);
    expect(item.revision).toBe(2);

    await pageB.locator('#journalSketchOpenBtn').click();
    await expect(pageB.locator('.sketch-editor-host canvas.interactive')).toBeVisible({ timeout: 25_000 });
    await page.locator('#journalEditorBody .tiptap').fill('Unabhängig aktualisierter Text');
    await expect(page.locator('#journalSaveStatus')).toHaveText('Gespeichert');
    await drawStroke(pageB, 25);
    await expect(pageB.locator('.sketch-editor-status')).toHaveText('Gespeichert');
    await expect(pageB.locator('.sketch-conflict')).toHaveCount(0);
    await pageB.locator('.sketch-editor-close').click();

    journal = await page.request.get(`/api.php?action=journal&date=${date}`);
    item = (await journal.json()).item;
    expect(item.content).toContain('Unabhängig aktualisierter Text');
    expect(item.has_sketch).toBe(1);
    expect(item.revision).toBe(4);

    await context.close();
  });
});
