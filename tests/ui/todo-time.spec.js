const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('normal todo list renders and edits a due time', async ({ page }) => {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();

  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const categories = await (await page.request.get('/api.php?action=categories_list')).json();
  const category = categories.categories.find(entry => entry.type === 'list_due_date');
  const name = `Todo mit Uhrzeit ${Date.now()}`;
  const response = await page.request.post('/api.php?action=add', {
    headers: { 'X-CSRF-Token': csrf },
    form: {
      category_id: String(category.id),
      name,
      due_date: '2026-07-19',
      due_time: '08:15',
      priority: '2',
    },
  });
  expect(response.status()).toBe(201);

  await page.reload();
  await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
  await page.getByRole('button', { name: category.name, exact: true }).click();
  const card = page.locator('#list .item-card').filter({ hasText: name });
  await expect(card).toContainText('08:15');
  await expect(card).toContainText('!2');
  await card.getByRole('button', { name: `${name} bearbeiten` }).click();
  await expect(page.locator('#todoEditor')).toBeVisible();
  await expect(page.locator('#todoTimeInput')).toHaveValue('08:15');
  await expect(page.locator('#todoPriorityInput')).toHaveValue('2');
  await page.locator('#todoTimeInput').fill('09:45');
  await page.locator('#todoPriorityInput').selectOption('3');
  await page.locator('#todoEditorBack').click();
  await expect(card).toContainText('09:45');
  await expect(card).toContainText('!3');

  const list = await (await page.request.get(`/api.php?action=list&category_id=${category.id}`)).json();
  const saved = list.items.find(item => item.name === name);
  expect(saved.due_time).toBe('09:45');
  expect(saved.priority).toBe('3');
});
