const { test, expect } = require('@playwright/test');
const { csrfToken, login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });

test.describe('FLOW 47 — Agenda initial sichtbar + Collapse-Zustand persistiert', () => {
    test('Journal offen: Agenda ist initial sichtbar und merkt sich den Toggle über Reload', async ({ page }) => {
        await login(page);
        // Die Agenda-Toggle-Interaktion braucht echte sichtbare Inhalte. Der
        // Test erzeugt seine Vorbedingung selbst, statt auf Daten anderer
        // Flows oder auf das Kalenderdatum des Demo-Seeds zu vertrauen.
        const categories = await page.request.get('/api.php?action=categories_list');
        const { categories: list } = await categories.json();
        const dueCategory = list.find(category => category.type === 'list_due_date');
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
        const addAgendaItem = await page.request.post('/api.php?action=add', {
            headers: { 'X-CSRF-Token': await csrfToken(page) },
            form: {
                category_id: String(dueCategory.id),
                name: `QA Agenda Toggle ${Date.now()}`,
                due_date: today,
            },
        });
        expect(addAgendaItem.status()).toBe(201);
        await page.locator('#journalBtn').click();
        await expect(page).toHaveURL(/screen=journal/);

        // Erstoeffnung: Agenda muss per Default sichtbar sein (data-collapsed="false")
        const agenda = page.locator('#journalAgendaBody');
        await expect(agenda).toHaveAttribute('data-collapsed', 'false');

        // Toggle auf collapsed setzen
        await page.locator('#journalAgendaCollapseBtn').click();
        await expect(agenda).toHaveAttribute('data-collapsed', 'true');

        // Reload: localStorage-Preference muss den Zustand erhalten
        await page.reload();
        await expect(page.locator('#journalAgendaBody')).toHaveAttribute('data-collapsed', 'true');

        // Erneut aufklappen, persistiert
        await page.locator('#journalAgendaCollapseBtn').click();
        await expect(agenda).toHaveAttribute('data-collapsed', 'false');
        await page.reload();
        await expect(page.locator('#journalAgendaBody')).toHaveAttribute('data-collapsed', 'false');
    });

    test('Initial-Render: persistierter false-Zustand ueberschreibt das hartcodierte data-collapsed synchron', async ({ browser }) => {
        // Frischer Browser-Kontext mit leerem LocalStorage → Preference-Default
        // ist agenda_collapsed=false. Wir hooken in das DOM, BEVOR journal.js laeuft,
        // und frieren den initialen data-collapsed-Wert ein. Wenn index.php den
        // Wert weiter hartcodiert und JS erst in renderAgenda() ueberschreibt,
        // sehen wir "true". Erst der echte Boot-Sync liefert "false".
        const context = await browser.newContext();
        await context.addInitScript(() => {
            window.__frozenDataCollapsed = null;
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-collapsed') {
                        const target = mutation.target;
                        if (target && target.id === 'journalAgendaBody' && window.__frozenDataCollapsed === null) {
                            window.__frozenDataCollapsed = target.getAttribute('data-collapsed');
                        }
                    }
                }
            });
            const startObserving = () => {
                const body = document.getElementById('journalAgendaBody');
                if (body) {
                    // Auch den Startwert erfassen, BEVOR journal.js laufen kann.
                    window.__frozenDataCollapsed = body.getAttribute('data-collapsed');
                    observer.observe(body, { attributes: true, attributeFilter: ['data-collapsed'] });
                } else {
                    // DOM noch nicht da → beim naechsten Tick erneut probieren.
                    setTimeout(startObserving, 0);
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', startObserving, { once: true });
            } else {
                startObserving();
            }
        });

        // Login + Direktnavigation in die Journal-View.
        const page = await context.newPage();
        await page.goto('/login.php');
        await page.getByLabel('Benutzername').fill('playwright-user');
        await page.getByLabel('Passwort').fill('playwright-pass');
        await page.getByRole('button', { name: 'Anmelden' }).click();
        await page.waitForURL(/index\.php/);
        await page.locator('#sectionTabs .section-tab').first().waitFor();
        await page.goto('/index.php?screen=journal');

        // Erwartung: der ERSTE Wert, den das DOM jemals fuer data-collapsed hatte,
        // ist der Preference-Default "false". Wenn das hartcodierte "true" aus
        // index.php eine Frame lang sichtbar war, schlaegt dieser Expect fehl.
        const frozen = await page.evaluate(() => window.__frozenDataCollapsed);
        expect(frozen, 'Erster data-collapsed-Wert im DOM (Frame 0)').toBe('false');
        await context.close();
    });
});
