const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '';

module.exports = defineConfig({
  testDir: './tests/ui',
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Die Flow-Tests prüfen die App-UI, nicht den Service-Worker-Lebenszyklus.
    // controllerchange lädt produktiv bewusst die Seite neu und würde laufende
    // Interaktionen dadurch zufällig abbrechen.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: {
    command: './scripts/ui-test-server.sh',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
      },
      testMatch: /flows\//,
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /flows\//,
    },
  ],
});
