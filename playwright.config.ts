import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, TEST_SESSION_SECRET, TEST_SITE_PASSWORD } from './e2e/constants';

const isCI = Boolean(process.env.CI);
const useExistingBuild = isCI || process.env.WHOISLEUTH_E2E_USE_BUILD === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],
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
  // node directly. Local standalone runs still build automatically; the full
  // verification pyramid can reuse its explicit build instead of rebuilding.
  webServer: {
    command: useExistingBuild ? 'node server.mts' : 'npm start',
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
