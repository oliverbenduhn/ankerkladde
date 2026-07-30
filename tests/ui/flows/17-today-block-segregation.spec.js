const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

// FLOW 17 — Tagesansicht Spalten-Zugehörigkeit (Issue #34)
//
// Die kanonische Tagesansicht fasst die ursprünglich drei vertikalen Blöcke aus
// #34 in zwei Spalten zusammen: links "Ohne Uhrzeit" mit Überfälligem zuerst,
// rechts "Terminiert" nach Uhrzeit aufsteigend.
//
// Dieser Test legt drei deterministische Items an:
//   - eines HEUTE mit Uhrzeit (23:59)         -> "Terminiert"   / data-agenda-group="scheduled"
//   - eines HEUTE ohne Uhrzeit                -> "Ohne Uhrzeit" / data-agenda-group="anytime_today"
//   - eines ÜBERFÄLLIG (gestern, ohne Zeit)   -> "Ohne Uhrzeit" / data-agenda-group="overdue"
//
// und assertiert Spalten-Zuordnung sowie Reihenfolge in der gerenderten DOM-Struktur.
test.describe('FLOW 17 — Tagesansicht Spalten-Zugehörigkeit (#34)', () => {
  test('Items mit/ohne due_time landen in den richtigen Agenda-Spalten', async ({ page }) => {
    const csrf = await (async () => {
      await login(page);
      return await csrfToken(page);
    })();

    const cats = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCat = cats.categories.find(c => c.type === 'list_due_date');
    expect(dueCat, 'mindestens eine list_due_date-Kategorie erwartet').toBeTruthy();

    // Heute-Datum deterministisch vom Europe/Berlin-Server-Cutoff übernehmen.
    const todayPayload = await (await page.request.get('/api.php?action=today')).json();
    const todayIso = todayPayload.today;
    expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const yesterdayDate = new Date(`${todayIso}T12:00:00Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    // Spätmöglichste Uhrzeit, weil vergangene due_time-Werte für heute gemäß
    // Spec (325da4b) aus der Terminiert-Spalte ausgeblendet werden.
    const futureTime = '23:59';
    const stamp = Date.now();
    const nameScheduled = `QA F17 Terminiert ${stamp}`;
    const nameAnytime = `QA F17 Irgendwann ${stamp}`;
    const nameOverdue = `QA F17 Ueberfaellig ${stamp}`;

    // Items via add() anlegen — Server akzeptiert leere Strings für due_time.
    // Hier bewusst der direkte Endpoint, nicht quick_add, weil wir spezifische
    // due_time-Werte setzen müssen, die der Parser nicht zwingend so herstellt.
    async function addItem(name, dueDate, dueTime) {
      const body = { category_id: String(dueCat.id), name };
      if (dueDate) body.due_date = dueDate;
      if (dueTime) body.due_time = dueTime;
      const resp = await page.request.post('/api.php?action=add', {
        headers: { 'X-CSRF-Token': csrf },
        form: body,
      });
      const text = await resp.text();
      expect(resp.status(), `add für ${name} (date=${dueDate} time=${dueTime}) -> ${resp.status()}\nbody=${text.slice(0, 300)}`).toBe(201);
    }

    await addItem(nameScheduled, todayIso, futureTime);
    await addItem(nameAnytime, todayIso, '');
    await addItem(nameOverdue, yesterday, '');

    // Heute-View öffnen
    await page.locator('#journalBtn').click();
    await expect(page).toHaveURL(/screen=journal/);

    // Agenda ggf. ausklappen (Default ist collapsed in manchen Flows)
    const agenda = page.locator('#journalAgendaBody');
    if (await agenda.getAttribute('data-collapsed') === 'true') {
      await page.locator('#journalAgendaCollapseBtn').click();
      await expect(agenda).toHaveAttribute('data-collapsed', 'false');
    }

    // Pro Item: data-agenda-group muss der Spec entsprechen
    const scheduled = page.locator('#journalScheduledList .agenda-item').filter({ hasText: nameScheduled });
    const anytime = page.locator('#journalAnytimeList .agenda-item').filter({ hasText: nameAnytime });
    const overdue = page.locator('#journalAnytimeList .agenda-item.is-overdue').filter({ hasText: nameOverdue });

    await expect(scheduled).toHaveCount(1);
    await expect(scheduled).toHaveAttribute('data-agenda-group', 'scheduled');
    await expect(anytime).toHaveCount(1);
    await expect(anytime).toHaveAttribute('data-agenda-group', 'anytime_today');
    await expect(overdue).toHaveCount(1);
    await expect(overdue).toHaveAttribute('data-agenda-group', 'overdue');

    // Die Tagesansicht hat gemäß ADR-0005 zwei Spalten: links "Ohne Uhrzeit",
    // rechts "Terminiert".
    const headingOrder = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(
            '#journalAgendaBody section[aria-labelledby]'
        ));
        return blocks.map(s => {
            const heading = document.getElementById(s.getAttribute('aria-labelledby'));
            return (heading?.textContent || '').trim();
        });
    });
    expect(headingOrder).toEqual(['Ohne Uhrzeit', 'Terminiert']);

    // Innerhalb der linken Spalte bleibt die fachliche Reihenfolge aus #34
    // erhalten: Überfälliges steht vor heutigen Items ohne Uhrzeit.
    const anytimeGroups = await page.locator(
      '#journalAnytimeList .agenda-item'
    ).evaluateAll((entries, names) => entries
      .filter(entry => names.some(name => entry.textContent?.includes(name)))
      .map(entry => entry.dataset.agendaGroup), [nameOverdue, nameAnytime]);
    expect(anytimeGroups).toEqual(['overdue', 'anytime_today']);
  });
});
