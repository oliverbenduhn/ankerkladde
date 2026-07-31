const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

test.use({ serviceWorkers: 'block' });

test.describe('FLOW 47 — Agenda initial sichtbar + Collapse-Zustand persistiert', () => {
    test('Journal offen: Agenda ist initial sichtbar und merkt sich den Toggle über Reload', async ({ page }) => {
        await login(page);
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
});
