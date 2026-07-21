const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

test.describe('Notes', () => {
  test('keeps the notes category UI when toggling from view mode back to edit', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Notizen' }).click();
    await expect(page.locator('#categoryTitle')).toHaveText('Notizen');
    await expect(page.locator('#itemInput')).toHaveAttribute('placeholder', 'Titel...');
    await expect(page.locator('#scanShoppingBtn')).toBeHidden();

    const app = page.locator('#app');
    if (await app.evaluate(element => element.dataset.mode) !== 'view') {
      await page.locator('#modeChip').click();
    }
    await expect(app).toHaveAttribute('data-mode', 'view');
    await expect(page.locator('#categoryTitle')).toHaveText('Notizen');

    await page.locator('#modeChip').click();

    await expect(app).toHaveAttribute('data-mode', 'edit');
    await expect(page.locator('#categoryTitle')).toHaveText('Notizen');
    await expect(page.locator('#itemInput')).toHaveAttribute('placeholder', 'Titel...');
    await expect(page.locator('#scanShoppingBtn')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Notizen' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#list .item-card').first()).toHaveClass(/item-type-notes/);
  });

  test('reopens a saved note body when Yjs websocket sync is unavailable', async ({ page }) => {
    await login(page);

    await page.getByRole('button', { name: 'Notizen' }).click();
    await expect(page.locator('#list .item-card').first()).toBeVisible();

    const title = `Playwright Notiz ${Date.now()}`;
    const body = 'Dieser Notiztext muss beim erneuten Öffnen sichtbar bleiben.';

    await page.locator('#itemInput').fill(title);
    await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

    await expect(page.locator('#noteEditor')).toBeVisible();
    await expect(page.locator('#noteTitleInput')).toHaveValue(title);

    const editor = page.locator('#noteEditorEl .tiptap');
    await expect(editor).toBeVisible();
    await editor.fill(body);
    await expect(page.locator('#noteSaveStatus')).toHaveText('Gespeichert');

    await page.getByRole('button', { name: 'Zurück' }).click();
    await expect(page.locator('#noteEditor')).toBeHidden();

    const noteCard = page.locator('#list .item-card').filter({ hasText: title });
    await expect(noteCard).toBeVisible();
    await noteCard.click();

    await expect(page.locator('#noteEditor')).toBeVisible();
    await expect(page.locator('#noteTitleInput')).toHaveValue(title);
    await expect(editor).toContainText(body, { timeout: 3000 });
  });
});
