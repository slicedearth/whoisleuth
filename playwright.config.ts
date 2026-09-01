import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, TEST_SESSION_SECRET, TEST_SITE_PASSWORD } from './e2e/constants';
import { playwrightRunArtifacts } from './tools/playwright-run-artifacts.mts';

const isCI = Boolean(process.env.CI);
const useExistingBuild = isCI || process.env.WHOISLEUTH_E2E_USE_BUILD === '1';
const performanceAuthoritySpecs = /(?:console-loading|deferred-interactions)\.spec\.ts/u;
const performanceAuthority = process.env.WHOISLEUTH_E2E_PERFORMANCE_FIRST === '1';
const artifacts = playwrightRunArtifacts();

const chromiumProject = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'], storageState: artifacts.authFile },
  dependencies: ['setup'],
  // Machine timing is an isolated authority lane. Functional shards retain
  // deterministic readiness and layout assertions without inheriting runtime
  // ceilings from a runner that is also executing hundreds of browser cases.
  testIgnore: performanceAuthoritySpecs,
};

const performanceAuthorityProject = {
  name: 'performance-authority',
  testMatch: performanceAuthoritySpecs,
  use: { ...devices['Desktop Chrome'], storageState: artifacts.authFile },
  dependencies: ['setup'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  outputDir: artifacts.testResults,
  reporter: isCI
    ? [
        ['list'],
        ['json', { outputFile: artifacts.jsonResults }],
        ['html', { outputFolder: artifacts.htmlReport, open: 'never' }],
      ]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    chromiumProject,
    ...(performanceAuthority ? [performanceAuthorityProject] : []),
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
