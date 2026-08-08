const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/ux');

async function quickAddContext(page) {
  await login(page);
  const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const categories = await (await page.request.get('/api.php?action=categories_list')).json();
  const dueCategory = categories.categories.find(category => category.type === 'list_due_date');
  expect(dueCategory).toBeTruthy();
  return { csrf, dueCategory };
}

test.describe('Quick-Add Default-Datum API', () => {
  test('verwendet default_due_date für Eingaben ohne Datumsangabe', async ({ page }) => {
    const { csrf, dueCategory } = await quickAddContext(page);
    const name = `Quick-Add Default ${Date.now()}`;
    const response = await page.request.post('/api.php?action=quick_add', {
      headers: { 'X-CSRF-Token': csrf },
      form: {
        active_category_id: String(dueCategory.id),
        input: name,
        default_due_date: '2026-07-21',
      },
    });
    expect(response.status()).toBe(201);

    const list = await (await page.request.get(`/api.php?action=list&category_id=${dueCategory.id}`)).json();
    expect(list.items.find(item => item.name === name)).toMatchObject({ due_date: '2026-07-21' });
  });

  test('lehnt ein ungültiges default_due_date ab', async ({ page }) => {
    const { csrf, dueCategory } = await quickAddContext(page);
    const response = await page.request.post('/api.php?action=quick_add', {
      headers: { 'X-CSRF-Token': csrf },
      form: {
        active_category_id: String(dueCategory.id),
        input: `Quick-Add Ungültig ${Date.now()}`,
        default_due_date: '2026-02-30',
      },
    });

    expect(response.status()).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error_key: 'quick_add.invalid_default_due_date',
      can_escalate_to_ai: false,
    });
  });

  test('lässt eine explizite Datumsangabe den Default überschreiben', async ({ page }) => {
    const { csrf, dueCategory } = await quickAddContext(page);
    const today = await (await page.request.get('/api.php?action=today')).json();
    const name = `Quick-Add Explizit ${Date.now()}`;
    const response = await page.request.post('/api.php?action=quick_add', {
      headers: { 'X-CSRF-Token': csrf },
      form: {
        active_category_id: String(dueCategory.id),
        input: `${name} heute`,
        default_due_date: '2026-07-21',
      },
    });
    expect(response.status()).toBe(201);

    const payload = await response.json();
    expect(payload.parsed).toMatchObject({ name, due_date: today.today });
  });
});
