const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/login.php');
  await page.getByLabel('Benutzername').fill('playwright-user');
  await page.getByLabel('Passwort').fill('playwright-pass');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/index\.php/);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test.describe('Heute', () => {
  test('renders the agenda read-only and deep-links to the source item', async ({ page }) => {
    await login(page);

    const csrf = await page.locator('meta[name="csrf-token"]').getAttribute('content');
    const categoryPayload = await (await page.request.get('/api.php?action=categories_list')).json();
    const dueCategories = categoryPayload.categories.filter(category => category.type === 'list_due_date');
    expect(dueCategories.length).toBeGreaterThanOrEqual(2);

    const initialToday = await (await page.request.get('/api.php?action=today')).json();
    const today = initialToday.today;
    const suffix = Date.now();
    const names = {
      overdue: `Agenda überfällig ${suffix}`,
      scheduledEarly: `Agenda früh ${suffix}`,
      scheduledLate: `Agenda spät ${suffix}`,
      anytimeFirst: `Agenda irgendwann eins ${suffix}`,
      anytimeSecond: `Agenda irgendwann zwei ${suffix}`,
      future: `Agenda morgen ${suffix}`,
      done: `Agenda erledigt ${suffix}`,
      undated: `Agenda ohne Datum ${suffix}`,
    };

    async function add(categoryId, name, dueDate = '') {
      const response = await page.request.post('/api.php?action=add', {
        headers: { 'X-CSRF-Token': csrf },
        form: { category_id: String(categoryId), name, due_date: dueDate },
      });
      expect(response.status()).toBe(201);
      return response.json();
    }

    async function quickAdd(categoryId, input) {
      const response = await page.request.post('/api.php?action=quick_add', {
        headers: { 'X-CSRF-Token': csrf },
        form: { active_category_id: String(categoryId), input },
      });
      expect(response.status()).toBe(201);
      return response.json();
    }

    const overdue = await add(dueCategories[1].id, names.overdue, shiftDate(today, -1));
    await quickAdd(dueCategories[0].id, `${names.scheduledLate} heute 14:30`);
    await quickAdd(dueCategories[1].id, `${names.scheduledEarly} heute 08:15`);
    await add(dueCategories[0].id, names.anytimeSecond, today);
    await add(dueCategories[0].id, names.anytimeFirst, today);
    await add(dueCategories[0].id, names.future, shiftDate(today, 1));
    await add(dueCategories[0].id, names.undated);
    const completed = await add(dueCategories[0].id, names.done, today);
    const toggle = await page.request.post('/api.php?action=toggle', {
      headers: { 'X-CSRF-Token': csrf },
      form: { id: String(completed.id), done: '1' },
    });
    expect(toggle.status()).toBe(200);

    await page.getByRole('button', { name: 'Heute', exact: true }).click();
    await expect(page).toHaveURL(/screen=today/);
    await expect(page.locator('#categoryTitle')).toHaveText('Heute');
    await expect(page.locator('.today-section-heading')).toHaveText(['Überfällig', 'Terminiert', 'Irgendwann heute']);

    const overdueEntry = page.locator('.today-item').filter({ hasText: names.overdue });
    const scheduledEarlyEntry = page.locator('.today-item').filter({ hasText: names.scheduledEarly });
    const anytimeEntry = page.locator('.today-item').filter({ hasText: names.anytimeFirst });
    await expect(overdueEntry).toContainText(dueCategories[1].name);
    await expect(scheduledEarlyEntry).toContainText(dueCategories[1].name);
    await expect(scheduledEarlyEntry).toContainText('08:15 Uhr');
    await expect(anytimeEntry).toContainText(dueCategories[0].name);
    await expect(overdueEntry).toContainText('seit ');

    const renderedNames = await page.locator('.today-item-name').allTextContents();
    expect(renderedNames.indexOf(names.overdue)).toBeLessThan(renderedNames.indexOf(names.scheduledEarly));
    expect(renderedNames.indexOf(names.scheduledEarly)).toBeLessThan(renderedNames.indexOf(names.scheduledLate));
    expect(renderedNames.indexOf(names.scheduledLate)).toBeLessThan(renderedNames.indexOf(names.anytimeFirst));
    expect(renderedNames.indexOf(names.anytimeFirst)).toBeLessThan(renderedNames.indexOf(names.anytimeSecond));
    await expect(overdueEntry).toHaveAttribute('data-agenda-group', 'overdue');
    await expect(scheduledEarlyEntry).toHaveAttribute('data-agenda-group', 'scheduled');
    await expect(anytimeEntry).toHaveAttribute('data-agenda-group', 'anytime_today');
    await expect(page.locator('#list .toggle')).toHaveCount(0);
    await expect(page.getByText(names.future)).toHaveCount(0);
    await expect(page.getByText(names.done)).toHaveCount(0);
    await expect(page.getByText(names.undated)).toHaveCount(0);

    await overdueEntry.getByRole('button').click();
    await expect(page.getByRole('button', { name: dueCategories[1].name, exact: true })).toHaveAttribute('aria-current', 'page');
    const sourceItem = page.locator(`.item-card[data-item-id="${overdue.id}"]`);
    await expect(sourceItem).toHaveClass(/is-deep-link-highlight/);
    await expect(sourceItem).not.toHaveClass(/is-deep-link-highlight/, { timeout: 2500 });
  });
});
