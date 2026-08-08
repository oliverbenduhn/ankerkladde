const { test, expect } = require('@playwright/test');
const { login, snap, attachClsListener, readCls } = require('../helpers/ux');

test.describe('FLOW 2 — Tagesansicht (Heute / Agenda)', () => {
  test('quick-add mit due → heute öffnen → agenda zeigt item → deep-link', async ({ page }, testInfo) => {
    await attachClsListener(page);
    await login(page);
    await snap(page, testInfo, '1-app-ready');

    // Tagesansicht öffnen und den Termin wie ein Nutzer über Quick-Add anlegen.
    const name = `QA Flow2 Termin ${Date.now()}`;
    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);
    await page.locator('#agendaAddBtn').click();
    await expect(page.locator('#inputArea')).toBeVisible();
    await expect(page.locator('#itemInput')).toBeFocused();
    const quickResponse = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
    await page.locator('#itemInput').fill(name);
    await page.locator('#itemInput').press('Enter');
    await quickResponse;
    await expect(page.locator('#message')).toContainText('Artikel hinzugefügt.');

    // Der zentrale Erfolg muss vor sekundären Collapse-Interaktionen sichtbar
    // sein. So zeigt ein Fehler direkt auf die Journal-Datumsübergabe.
    const anytime = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: name });
    const scheduled = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
    const group = (await scheduled.count()) ? scheduled : anytime;
    await expect(group.first()).toBeVisible();
    await expect(group.first()).toHaveAttribute('data-agenda-group', /(anytime_today|scheduled)/);

    // Die Collapse-Präferenz muss sichtbar reagieren und einen Reload überleben.
    const agenda = page.locator('#journalAgendaBody');
    await expect(agenda).toHaveAttribute('data-collapsed', 'false');
    await expect(page.locator('#journalAgendaCollapseBtn')).toBeVisible();
    await page.locator('#journalAgendaCollapseBtn').click();
    await expect(agenda).toHaveAttribute('data-collapsed', 'true');
    await page.reload();
    await expect(page.locator('#journalAgendaBody')).toHaveAttribute('data-collapsed', 'true');
    await page.locator('#journalAgendaCollapseBtn').click();
    await expect(agenda).toHaveAttribute('data-collapsed', 'false');
    await snap(page, testInfo, '2-journal-open');

    // Deep-Link: Klick auf Body → Quellkategorie (Highlighting wird im today.spec.js getestet)
    await group.locator('.agenda-item-body').click();
    await expect(page).toHaveURL(/index\.php/);
    await snap(page, testInfo, '3-deeplink-target');

    // Toggle aus Agenda: zurück zu Heute, Checkbox klicken
    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);
    // Agenda u.U. wieder eingeklappt (Default collapsed)
    const agenda2 = page.locator('#journalAgendaBody');
    if (await agenda2.getAttribute('data-collapsed') === 'true') {
      await page.locator('#journalAgendaCollapseBtn').click();
    }
    const scheduled2 = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
    const anytime2 = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: name });
    const group2 = (await scheduled2.count()) ? scheduled2 : anytime2;
    await expect(group2.first()).toBeVisible();
    await group2.first().locator('.agenda-item-checkbox').click();
    await expect(page.locator('.agenda-item').filter({ hasText: name })).toHaveCount(0);
    await snap(page, testInfo, '4-toggled-from-agenda');

    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value}`).toBeLessThan(0.15);
  });

  // Regression (#44): beim Boot auf der Tagesansicht setzte renderItems() ueber
  // hideKanban() die Liste wieder sichtbar, obwohl das Journal den Screen
  // besitzt. Das schob die Agenda aus dem Viewport und wieder zurueck (CLS > 1).
  test('reload auf der Tagesansicht blendet die Liste nie ein', async ({ page }) => {
    await login(page);
    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);
    await page.locator('#journalAgendaBody').waitFor();

    // Recorder gilt erst ab dem naechsten Dokument, also ab dem Reload.
    // Pro Frame samplen: das Fehlfenster war ~47ms (≈3 Frames) und damit sicher
    // sichtbar. samples zaehlt mit, damit ein nicht gestarteter Recorder nicht
    // faelschlich als "keine Verletzung" durchgeht.
    await page.addInitScript(() => {
      window.__stageProbe = { hits: [], samples: 0 };
      const sample = () => {
        window.__stageProbe.samples += 1;
        const app = document.getElementById('app');
        const stage = document.getElementById('listSwipeStage');
        if (app?.classList.contains('journal-view') && stage && !stage.hidden) {
          window.__stageProbe.hits.push(Math.round(performance.now()));
        }
        window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);
    });

    await page.reload();
    await page.locator('#journalAgendaBody').waitFor();
    await page.waitForTimeout(1500);

    const probe = await page.evaluate(() => window.__stageProbe);
    expect(probe.samples, 'Recorder muss gelaufen sein').toBeGreaterThan(30);
    expect(probe.hits, `listSwipeStage war sichtbar bei ${JSON.stringify(probe.hits)}ms`).toEqual([]);
  });

  test('Termin hinzufügen lässt sich sichtbar abbrechen', async ({ page }) => {
    await login(page);
    await page.locator('#journalBtn').click();

    await page.locator('#agendaAddBtn').click();
    await page.locator('#itemInput').fill('Nicht speichern');

    const cancelButton = page.getByRole('button', { name: 'Abbrechen', exact: true });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    await expect(page.locator('#inputArea')).toBeHidden();
    await expect(page.locator('#itemInput')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Artikel hinzufügen', exact: true })).toBeVisible();

    await page.locator('#agendaAddBtn').click();
    await page.locator('#itemInput').fill('Auch nicht speichern');
    await page.locator('#itemInput').press('Escape');

    await expect(page.locator('#inputArea')).toBeHidden();
    await expect(page.locator('#itemInput')).toHaveValue('');
    await expect(page.locator('#agendaAddBtn')).toBeFocused();
  });

  test('leeres Quick-Add legt keinen Datumseintrag an', async ({ page }) => {
    await login(page);
    await page.locator('#journalBtn').click();
    await page.locator('#agendaAddBtn').click();

    let quickAddRequests = 0;
    page.on('request', request => {
      if (request.url().includes('action=quick_add')) quickAddRequests += 1;
    });

    await page.locator('#itemInput').press('Enter');
    await page.waitForTimeout(300);

    expect(quickAddRequests).toBe(0);
    await expect(page.locator('#inputArea')).toBeVisible();
    await expect(page.locator('#itemInput')).toBeFocused();
  });

  test('Termin kann ohne Quick-Add-Syntax mit Details angelegt werden', async ({ page }) => {
    await login(page);
    const categories = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCategory = categories.categories.find(category => category.type === 'list_due_date');
    expect(dueCategory).toBeTruthy();

    await page.getByRole('button', { name: dueCategory.name, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mit Details hinzufügen', exact: true })).toBeVisible();

    const todayPayload = await (await page.request.get('/api.php?action=today')).json();
    await page.locator('#journalBtn').click();
    await page.locator('#agendaAddBtn').click();
    await page.getByRole('button', { name: 'Mit Details hinzufügen', exact: true }).click();

    await expect(page.locator('#itemEditor')).toBeVisible();
    await expect(page.locator('#itemCategoryInput')).toHaveValue(String(dueCategory.id));
    await expect(page.locator('#itemDateInput')).toHaveValue(todayPayload.today);

    const name = `Termin mit Details ${Date.now()}`;
    await page.locator('#itemTitleInput').fill(name);
    await page.locator('#itemTimeInput').fill('23:30');
    await page.locator('#itemPriorityInput').selectOption('1');
    await page.locator('#itemNoteInput').fill('Ohne Quick-Add-Syntax angelegt');

    const createResponse = page.waitForResponse(response => response.url().includes('action=add') && response.status() === 201);
    await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const created = await (await createResponse).json();

    await expect(page.locator('#itemEditor')).toBeHidden();
    const listPayload = await (await page.request.get(`/api.php?action=list&category_id=${dueCategory.id}`)).json();
    const savedItem = listPayload.items.find(item => Number(item.id) === Number(created.id));
    expect(savedItem).toMatchObject({
      name,
      due_date: todayPayload.today,
      due_time: '23:30',
      priority: '1',
      content: 'Ohne Quick-Add-Syntax angelegt',
    });
    if (await page.locator('#journalAgendaBody').getAttribute('data-collapsed') === 'true') {
      await page.locator('#journalAgendaCollapseBtn').click();
    }
    const agendaItem = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
    await expect(agendaItem).toBeVisible();
    await expect(agendaItem).toContainText('23:30 Uhr');
  });
});
