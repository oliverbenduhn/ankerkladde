const { test, expect } = require('@playwright/test');
const { login, csrfToken } = require('../helpers/ux');

// FLOW 17 — Tagesansicht Block-Zugehörigkeit (Issue #34)
//
// Spec #34 verlangt: in der Heute-Sicht erscheinen Items mit `due_time` im Block
// "Terminiert" (nach Uhrzeit aufsteigend), Items ohne `due_time` im Block
// "Irgendwann heute" (nach sort_order). Überfällige Items stehen darüber.
//
// Dieser Test legt drei deterministische Items an:
//   - eines HEUTE mit Uhrzeit (09:30)         -> "Terminiert"   / data-agenda-group="scheduled"
//   - eines HEUTE ohne Uhrzeit                -> "Irgendwann"   / data-agenda-group="anytime_today"
//   - eines ÜBERFÄLLIG (gestern, ohne Zeit)   -> "Überfällig"   / data-agenda-group="overdue"
//
// und assertiert die Zuordnung in der gerenderten DOM-Struktur.
test.describe('FLOW 17 — Tagesansicht Block-Zugehörigkeit (#34)', () => {
  test('Items mit/ohne due_time landen in den richtigen Agenda-Blöcken', async ({ page }, testInfo) => {
    const csrf = await (async () => {
      await login(page);
      return await csrfToken(page);
    })();

    const cats = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCat = cats.categories.find(c => c.type === 'list_due_date');
    expect(dueCat, 'mindestens eine list_due_date-Kategorie erwartet').toBeTruthy();

    // Heute-Datum deterministisch (Europe/Berlin-Server-Cutoff)
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    // Uhrzeit bewusst morgen früh, damit sie in jedem Zeitzonen-Cutoff
    // garantiert in der Zukunft liegt. Vergangene due_time-Werte werden
    // auf heute per Spec (325da4b) aus der Terminiert-Spalte ausgeblendet.
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

    // Zusatz-Assert: Reihenfolge der Block-Container im DOM.
    // Spec #34: Überfällig → Terminiert → Ohne Uhrzeit.
    // Die Heute-View rendert die Block-Container als <section>-Elemente
    // mit aria-labelledby auf den jeweiligen h4. Wir nehmen die
    // Container-Reihenfolge über die h4-Reihenfolge (stabil in beiden Views).
    const headingOrder = await page.evaluate(() => {
        // Reihenfolge der Block-Heading-Texte wie im DOM gerendert
        // (jedes Block hat genau ein h4). data-Block-Zuordnung liest der Test
        // bereits über data-agenda-group; hier prüfen wir nur die Reihenfolge.
        const blocks = Array.from(document.querySelectorAll(
            '#journalAgendaBody section[aria-labelledby]'
        ));
        return blocks.map(s => {
            const heading = document.getElementById(s.getAttribute('aria-labelledby'));
            return (heading?.textContent || '').trim();
        });
    });
    expect(headingOrder).toEqual(['Überfällig', 'Terminiert', 'Ohne Uhrzeit']);
  });
});
