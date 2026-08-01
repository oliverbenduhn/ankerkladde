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

// Simuliert das native `online`-Ereignis, das laut Spec sofort eine
// Hintergrund-Pruefung der sichtbaren Kategorie ausloest (AC #64) — schneller
// und deterministischer als 30s auf das echte Polling-Intervall zu warten.
async function triggerOnlineRefresh(page) {
  const respPromise = page.waitForResponse(r => r.url().includes('action=list&category_id='));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await respPromise;
}

test.describe('FLOW 7 — Sichtbare Inhalte automatisch aktualisieren (Issue #64)', () => {
  test.describe.configure({ mode: 'serial' });

  test('Automatische Aktualisierung heilt einen verlorenen Push-Hinweis und schützt lokale Bearbeitung', async ({ context }, testInfo) => {
    const pageA = await context.newPage();
    await login(pageA, { testInfo });
    await goToEinkauf(pageA);

    const nameX = `QA Flow7 Edited ${Date.now()}`;
    const nameY = `QA Flow7 Toggled ${Date.now()}`;
    const { id: idX } = await quickAdd(pageA, nameX);
    const { id: idY } = await quickAdd(pageA, nameY);

    // Item X wird lokal bearbeitet (Konflikteinheit soll geschuetzt bleiben).
    await pageA.locator(`.item-card[data-item-id="${idX}"] .btn-item-menu`).click();
    await pageA.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const draftText = `${nameX} lokal veraendert, nicht gespeichert`;
    await pageA.locator('#itemTitleInput').fill(draftText);
    await snap(pageA, testInfo, '1-tab-a-editing-x');

    // Tab B (gleiches Konto, gleicher Context): aendert Item Y auf dem Server,
    // waehrend in dieser Testumgebung kein echter Push (WebSocket) laeuft —
    // die Aenderung ist also zunaechst ein "verlorener Push-Hinweis".
    const pageB = await context.newPage();
    await pageB.goto('/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await goToEinkauf(pageB);
    await itemCard(pageB, idY).locator('input.toggle').click();
    await expect(itemCard(pageB, idY)).toHaveClass(/\bdone\b/);

    // Tab A hat die Aenderung noch nicht gesehen (kein Push, kein Reload).
    await expect(itemCard(pageA, idY)).not.toHaveClass(/\bdone\b/);

    // Heilung: natives online-Ereignis loest sofort eine Hintergrund-Pruefung aus.
    await triggerOnlineRefresh(pageA);
    await snap(pageA, testInfo, '2-tab-a-after-online-refresh');

    // AC: andere sichtbare Aenderung (Item Y) wird uebernommen ...
    await expect(itemCard(pageA, idY)).toHaveClass(/\bdone\b/);
    // ... aber die eigene, noch nicht gespeicherte Bearbeitung von Item X bleibt unangetastet.
    await expect(pageA.locator('#itemTitleInput')).toHaveValue(draftText);

    await pageA.close();
    await pageB.close();
  });

  test('Drosselung: Rückkehr in die App innerhalb von 10s löst keinen zweiten Abruf aus', async ({ page }, testInfo) => {
    test.setTimeout(30_000);
    await login(page, { testInfo });
    await goToEinkauf(page);
    // prefetchAdjacentCategories() laedt Nachbarkategorien im Hintergrund
    // nach (eigener AC, nicht Teil dieses Tests) und Item X wird bereits im
    // Setup geladen — erst abklingen lassen, dann tatsaechlich >=10s
    // verstreichen lassen (App-Start zaehlt als letzter Check), damit die
    // erste Rueckkehr unten wirklich unthrottled ist.
    await page.waitForTimeout(10_500);

    let listRequests = 0;
    page.on('request', req => {
      if (req.url().includes('action=list&category_id=')) listRequests += 1;
    });

    // Erste Rueckkehr in die App nach >=10s: loest einen Refresh aus.
    const firstResp = page.waitForResponse(r => r.url().includes('action=list&category_id='));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await firstResp;
    const countAfterFirst = listRequests;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Zweite Rueckkehr < 10s spaeter: gedrosselt, kein zusaetzlicher Request.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    expect(listRequests).toBe(countAfterFirst);
  });

  test('Geöffneter Editor ohne lokale Eingabe übernimmt Inhalt und Status komponentenbezogen', async ({ context }, testInfo) => {
    const pageA = await context.newPage();
    await login(pageA, { testInfo });
    await goToEinkauf(pageA);
    const originalName = `QA Flow7 Clean Editor ${Date.now()}`;
    const { id } = await quickAdd(pageA, originalName);
    await pageA.locator(`.item-card[data-item-id="${id}"] .btn-item-menu`).click();
    await pageA.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    await expect(itemCard(pageA, id).locator('.item-sync-badge-dirty')).toHaveCount(0);

    const pageB = await context.newPage();
    await pageB.goto('/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await pageB.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
    await goToEinkauf(pageB);
    await pageB.locator(`.item-card[data-item-id="${id}"] .btn-item-menu`).click();
    await pageB.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const serverName = `${originalName} vom Server`;
    await pageB.locator('#itemTitleInput').fill(serverName);
    await pageB.locator('#itemSaveBtn').click();
    await expect(pageB.locator('#itemEditor')).toBeHidden();
    await itemCard(pageB, id).locator('input.toggle').click();

    await triggerOnlineRefresh(pageA);
    await expect(pageA.locator('#itemTitleInput')).toHaveValue(serverName);
    await expect(itemCard(pageA, id).locator('input.toggle')).toBeChecked();
    await expect(itemCard(pageA, id).locator('.item-sync-badge-dirty')).toHaveCount(0);
    await pageA.close();
    await pageB.close();
  });
});
