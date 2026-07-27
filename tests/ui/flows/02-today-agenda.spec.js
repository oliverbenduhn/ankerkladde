const { test, expect } = require('@playwright/test');
const { login, snap, attachClsListener, readCls, csrfToken } = require('../helpers/ux');

test.describe('FLOW 2 — Tagesansicht (Heute / Agenda)', () => {
  test('quick-add mit due → heute öffnen → agenda zeigt item → deep-link', async ({ page }, testInfo) => {
    attachClsListener(page);
    await login(page);
    await snap(page, testInfo, '1-app-ready');

    // Setup: Item via API (schneller als UI) in einer list_due_date-Kategorie anlegen
    const csrf = await csrfToken(page);
    const cats = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCat = cats.categories.find(c => c.type === 'list_due_date');
    expect(dueCat, 'mindestens eine list_due_date-Kategorie erwartet').toBeTruthy();

    // Quick-Add in der ersten due-Kategorie
    const name = `QA Flow2 Termin ${Date.now()}`;
    const quickResp = await page.request.post('/api.php?action=quick_add', {
      headers: { 'X-CSRF-Token': csrf },
      form: { active_category_id: String(dueCat.id), input: `${name} heute` },
    });
    expect(quickResp.status()).toBe(201);
    const quickBody = await quickResp.json();
    // quick_add gibt evtl. wrapped response; ID kann auf verschiedenen Feldern liegen
    const createdId = quickBody.id || quickBody.item?.id || quickBody.parsed?.id;
    expect(createdId, `createdId muss gesetzt sein, body=${JSON.stringify(quickBody).slice(0,200)}`).toBeTruthy();

    // Heute-View (Journal) öffnen
    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);
    // UX-Fund: Agenda ist beim Aufruf eingeklappt → User muss "Mehr anzeigen" klicken
    const agenda = page.locator('#journalAgendaBody');
    if (await agenda.getAttribute('data-collapsed') === 'true') {
      await page.locator('#journalAgendaCollapseBtn').click();
      await expect(agenda).toHaveAttribute('data-collapsed', 'false');
    }
    await snap(page, testInfo, '2-journal-open');

    // Item muss in einer der beiden Agenda-Spalten auftauchen (Anytime oder Scheduled)
    const anytime = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: name });
    const scheduled = page.locator('#journalScheduledList .agenda-item').filter({ hasText: name });
    const group = (await scheduled.count()) ? scheduled : anytime;
    await expect(group.first()).toBeVisible();
    await expect(group.first()).toHaveAttribute('data-agenda-group', /(anytime_today|scheduled)/);

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
    await expect(page.getByText(name)).toHaveCount(0);
    await snap(page, testInfo, '4-toggled-from-agenda');

    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value}`).toBeLessThan(0.15);
  });
});