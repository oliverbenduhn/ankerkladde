const { test, expect } = require('@playwright/test');
const { login, snap } = require('../helpers/ux');

async function goToEinkauf(page) {
  await page.getByRole('button', { name: /^Einkauf/ }).first().click();
}

function itemCard(page, id) {
  return page.locator(`.item-card[data-item-id="${id}"]`);
}

async function quickAdd(page, name) {
  const input = page.locator('#itemInput');
  await expect(input).toBeVisible();
  const respPromise = page.waitForResponse(
    r => r.url().includes('action=quick_add') && r.status() === 201,
    { timeout: 30_000 }
  );
  await input.fill(name);
  await input.press('Enter');
  const resp = await respPromise;
  const body = await resp.json();
  const card = itemCard(page, body.id);
  await expect(card).toBeVisible();
  return { card, id: body.id };
}

async function openEditMode(page, id) {
  await itemCard(page, id).locator('.btn-item-menu').click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(page.locator('#itemEditor')).toBeVisible();
}

test.describe('FLOW 6 — Item-Sync-Zustand & Entwurf-Persistenz (Issue #63)', () => {
  // Alle drei Tests teilen denselben playwright-user-Account; parallele
  // Mutationen (quick_add/toggle) auf demselben Account fuehren sonst zu
  // flackernden Interferenzen zwischen den Faellen dieser Datei.
  test.describe.configure({ mode: 'serial' });

  test('Entwurf ist ab erster Eingabe geschützt und übersteht Reload', async ({ page }, testInfo) => {
    await login(page);
    await goToEinkauf(page);

    const itemName = `QA Flow6 Draft ${Date.now()}`;
    const { id } = await quickAdd(page, itemName);

    await openEditMode(page, id);
    const nameInput = page.locator('#itemTitleInput');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(`${itemName} bearbeitet`);

    // AC #63: "Lokal geändert" ab der ersten Eingabe sichtbar.
    await expect(itemCard(page, id).locator('.item-sync-badge-dirty')).toHaveText('Lokal geändert');
    await snap(page, testInfo, '1-dirty-before-reload');

    // Reload OHNE zu speichern — Entwurf darf nicht verloren gehen (AC #63):
    // der Vollbild-Editor oeffnet sich beim Boot automatisch wieder.
    await page.reload();

    const restoredInput = page.locator('#itemTitleInput');
    await expect(page.locator('#itemEditor')).toBeVisible();
    await expect(restoredInput).toHaveValue(`${itemName} bearbeitet`);
    await expect(itemCard(page, id).locator('.item-sync-badge-dirty')).toBeVisible();
    await snap(page, testInfo, '2-restored-after-reload');

    // Speichern entfernt den Entwurf-Snapshot und schliesst den Editor.
    await page.locator('#itemSaveBtn').click();
    await expect(page.locator('#itemEditor')).toBeHidden();
    await expect(itemCard(page, id).locator('.item-sync-badge-dirty')).toHaveCount(0);
    await expect(itemCard(page, id)).toContainText(`${itemName} bearbeitet`);

    await page.reload();
    await page.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await expect(page.locator('#itemEditor')).toBeHidden();
    await snap(page, testInfo, '3-no-draft-after-save');
  });

  test('Dirty-Abbrechen fragt nach und verwirft ohne automatisch zu speichern', async ({ page }) => {
    await login(page);
    await goToEinkauf(page);

    const originalName = `QA Flow6 Abbrechen ${Date.now()}`;
    const discardedName = `${originalName} verworfen`;
    const { id } = await quickAdd(page, originalName);
    await openEditMode(page, id);

    let updateRequests = 0;
    page.on('request', request => {
      if (request.url().includes('action=update')) updateRequests += 1;
    });

    const dialogMessages = [];
    let discardConfirmed = false;
    page.on('dialog', async dialog => {
      dialogMessages.push(dialog.message());
      if (discardConfirmed) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    await page.locator('#itemTitleInput').fill(discardedName);
    const cancelButton = page.getByRole('button', { name: 'Abbrechen', exact: true });
    await cancelButton.click();

    await expect(page.locator('#itemEditor')).toBeVisible();
    await expect(page.locator('#itemTitleInput')).toHaveValue(discardedName);
    expect(dialogMessages).toEqual(['Ungespeicherte Änderungen verwerfen?']);
    expect(updateRequests).toBe(0);

    discardConfirmed = true;
    await cancelButton.click();
    await expect(page.locator('#itemEditor')).toBeHidden();
    await expect(itemCard(page, id)).toContainText(originalName);
    await expect(itemCard(page, id)).not.toContainText(discardedName);
    await expect(itemCard(page, id).locator('.item-sync-badge-dirty')).toHaveCount(0);
    expect(dialogMessages).toEqual([
      'Ungespeicherte Änderungen verwerfen?',
      'Ungespeicherte Änderungen verwerfen?',
    ]);
    expect(updateRequests).toBe(0);

    const categories = await (await page.request.get('/api.php?action=categories_list')).json();
    const shopping = categories.categories.find(category => category.type === 'list_quantity');
    const list = await (await page.request.get(`/api.php?action=list&category_id=${shopping.id}`)).json();
    expect(list.items.find(item => Number(item.id) === id)?.name).toBe(originalName);
  });

  test('Offline vorgemerkt: Badge erscheint offline und verschwindet nach Reconnect', async ({ page, context }, testInfo) => {
    await login(page);
    await goToEinkauf(page);

    const itemName = `QA Flow6 Offline ${Date.now()}`;
    const { card } = await quickAdd(page, itemName);

    await context.setOffline(true);
    await card.locator('input.toggle').click();

    await expect(card.locator('.item-sync-badge-offline')).toHaveText('Offline vorgemerkt');
    await snap(page, testInfo, '1-offline-badge');

    await context.setOffline(false);
    await expect(card.locator('.item-sync-badge-offline')).toHaveCount(0, { timeout: 15_000 });
    await snap(page, testInfo, '2-synced-after-reconnect');
  });

  test('Zwei Tabs: ein unbestätigter Entwurf ist nicht im anderen Tab sichtbar', async ({ context }, testInfo) => {
    const pageA = await context.newPage();
    await login(pageA);
    await goToEinkauf(pageA);

    const itemName = `QA Flow6 TwoTabs ${Date.now()}`;
    const { id } = await quickAdd(pageA, itemName);
    await openEditMode(pageA, id);
    await pageA.locator('#itemTitleInput').fill(`${itemName} nur in Tab A`);
    await expect(itemCard(pageA, id).locator('.item-sync-badge-dirty')).toBeVisible();
    await snap(pageA, testInfo, '1-tab-a-dirty');

    // Tab B: gleiche eingeloggte Session (Cookies werden vom Context geteilt),
    // aber sessionStorage ist pro Tab isoliert — kein fremder Entwurf sichtbar.
    const pageB = await context.newPage();
    await pageB.goto('/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await goToEinkauf(pageB);

    const cardB = itemCard(pageB, id);
    await expect(cardB).toBeVisible();
    await expect(pageB.locator('#itemEditor')).toBeHidden();
    await expect(cardB.locator('.item-sync-badge-dirty')).toHaveCount(0);
    await snap(pageB, testInfo, '2-tab-b-no-foreign-draft');

    await pageA.close();
    await pageB.close();
  });
});
