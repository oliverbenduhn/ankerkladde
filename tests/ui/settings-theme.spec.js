const { test, expect } = require('@playwright/test');

test.describe('Settings Theme Smoke Test', () => {
  test('theme change works and monochrom buttons keep readable contrast', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.frameLocator('#settingsFrame');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();

    await settingsFrame.getByText('Hell').click();
    await settingsFrame.locator('label').filter({
      has: settingsFrame.locator('input[name="light_theme"][value="monochrom"]'),
    }).click();

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'monochrom');
    await expect(settingsFrame.locator('body')).toHaveAttribute('data-theme', 'monochrom');
    await expect(settingsFrame.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });

    await page.goto('/index.php');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'monochrom');

    const contrast = await page.getByRole('button', { name: 'Artikel hinzufügen' }).evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
      };
    });

    expect(contrast.backgroundColor).toBe('rgb(42, 42, 42)');
    expect(contrast.color).toBe('rgb(255, 255, 255)');
  });

  test('theme mode updates the host app before autosave completes', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.frameLocator('#settingsFrame');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();

    let releaseAutosave;
    const autosaveBlocked = new Promise(resolve => {
      releaseAutosave = resolve;
    });

    await page.route('**/settings.php**', async route => {
      if (route.request().method() === 'POST') {
        await autosaveBlocked;
      }
      await route.continue();
    });

    await settingsFrame.getByText('Dunkel', { exact: true }).click();

    await expect(page.locator('body')).toHaveAttribute('data-theme', /nachtwache|pier|monochrom-dark|grauton-dark/);
    await expect(settingsFrame.locator('body')).toHaveAttribute('data-theme', /nachtwache|pier|monochrom-dark|grauton-dark/);

    releaseAutosave();
    await expect(settingsFrame.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });
  });

  test('settings state stays stable after reload', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.frameLocator('#settingsFrame');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();

    const appearancePanel = settingsFrame.locator('details[data-settings-panel="appearance"]');
    const featuresPanel = settingsFrame.locator('details[data-settings-panel="features"]');
    const categoriesPanel = settingsFrame.locator('details[data-settings-panel="categories"]');
    const newCategoryPanel = settingsFrame.locator('details[data-settings-panel="new-category"]');

    await expect(appearancePanel).toHaveJSProperty('open', true);
    await expect(categoriesPanel).toHaveJSProperty('open', true);

    await settingsFrame.locator('details[data-settings-panel="features"] > summary').click();
    await settingsFrame.locator('details[data-settings-panel="categories"] > summary').click();
    await settingsFrame.locator('details[data-settings-panel="new-category"] > summary').click();

    await expect(featuresPanel).toHaveJSProperty('open', true);
    await expect(categoriesPanel).toHaveJSProperty('open', false);
    await expect(newCategoryPanel).toHaveJSProperty('open', true);

    await page.reload();
    await expect(page).toHaveURL(/view=settings/);
    await expect(page.locator('#app')).toHaveClass(/settings-view/);

    const reloadedFrame = page.frameLocator('#settingsFrame');
    const reloadedAppearancePanel = reloadedFrame.locator('details[data-settings-panel="appearance"]');
    const reloadedFeaturesPanel = reloadedFrame.locator('details[data-settings-panel="features"]');
    const reloadedCategoriesPanel = reloadedFrame.locator('details[data-settings-panel="categories"]');
    const reloadedNewCategoryPanel = reloadedFrame.locator('details[data-settings-panel="new-category"]');

    await expect(reloadedFrame.getByText('Erscheinungsbild')).toBeVisible();
    await expect(reloadedAppearancePanel).toHaveJSProperty('open', true);
    await expect(reloadedFeaturesPanel).toHaveJSProperty('open', true);
    await expect(reloadedCategoriesPanel).toHaveJSProperty('open', false);
    await expect(reloadedNewCategoryPanel).toHaveJSProperty('open', true);
  });

  test('category rows keep their expanded state when settings are reopened', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.frameLocator('#settingsFrame');
    await expect(settingsFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();

    const firstCategory = settingsFrame.locator('form.settings-category-row').first();
    const firstCategoryDetails = firstCategory.locator('details.settings-category-details');
    const firstCategorySummary = firstCategory.locator('summary.settings-category-summary');

    await expect(firstCategoryDetails).toHaveJSProperty('open', false);
    await firstCategorySummary.click();
    await expect(firstCategoryDetails).toHaveJSProperty('open', true);

    await page.goto('/index.php');
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const reopenedFrame = page.frameLocator('#settingsFrame');
    const reopenedFirstCategory = reopenedFrame.locator('form.settings-category-row').first();
    const reopenedFirstCategoryDetails = reopenedFirstCategory.locator('details.settings-category-details');
    const reopenedFirstCategorySummary = reopenedFirstCategory.locator('summary.settings-category-summary');

    await expect(reopenedFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();
    await expect(reopenedFirstCategoryDetails).toHaveJSProperty('open', true);

    await reopenedFirstCategorySummary.click();
    await expect(reopenedFirstCategoryDetails).toHaveJSProperty('open', false);

    await page.reload();

    const reloadedFrame = page.frameLocator('#settingsFrame');
    const reloadedFirstCategoryDetails = reloadedFrame
      .locator('form.settings-category-row')
      .first()
      .locator('details.settings-category-details');

    await expect(reloadedFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();
    await expect(reloadedFirstCategoryDetails).toHaveJSProperty('open', false);
  });
});
