import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, TEST_SESSION_SECRET, TEST_SITE_PASSWORD } from './e2e/constants';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  // CI builds the frontend as its own step, so the server here just starts
  // node directly; locally `npm start` builds first so a single command works.
  webServer: {
    command: isCI ? 'node server.js' : 'npm start',
    url: BASE_URL,
    // A port collision should fail the run loudly, not silently test
    // whatever unrelated (or stale) server already happens to be listening.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      SITE_PASSWORD: TEST_SITE_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
    },
  },
});
