import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PORT, TEST_SESSION_SECRET, TEST_SITE_PASSWORD } from './e2e/constants.ts';
import { resolvePlaywrightExecutionContract } from './tools/playwright-execution-contract.mts';
import { playwrightRunArtifacts } from './tools/playwright-run-artifacts.mts';
import { assertFrontendBuildIntegrity } from './tools/frontend-build-integrity.mts';

const execution = resolvePlaywrightExecutionContract();
if (execution.useExistingBuild) assertFrontendBuildIntegrity();
const artifacts = playwrightRunArtifacts();
const chromiumProject = {
  name: execution.functionalProject.name,
  use: { ...devices['Desktop Chrome'], storageState: artifacts.authFile },
  dependencies: [...execution.functionalProject.dependencies],
  // Repeated performance observations run in an isolated lane. Its specs
  // still enforce readiness, transfer and layout contracts; neither lane
  // treats one host's elapsed time as a universal acceptance threshold.
  testIgnore: execution.functionalProject.excludedSpecs,
};
const performanceAuthorityProject = {
  name: execution.performanceProject.name,
  testMatch: execution.performanceProject.matchedSpecs,
  use: { ...devices['Desktop Chrome'], storageState: artifacts.authFile },
  dependencies: [...execution.performanceProject.dependencies],
  workers: execution.performanceProject.workers,
  fullyParallel: execution.performanceProject.fullyParallel,
  retries: execution.performanceProject.retries,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: execution.forbidOnly,
  failOnFlakyTests: execution.failOnFlakyTests,
  retries: execution.retries,
  workers: execution.workers,
  outputDir: artifacts.testResults,
  reporter: execution.hosted
    ? [
        ['list'],
        ['json', { outputFile: artifacts.jsonResults }],
        ['html', { outputFolder: artifacts.htmlReport, open: 'never' }],
      ]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: execution.trace,
    screenshot: execution.screenshot,
    video: 'off',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    chromiumProject,
    ...(execution.includePerformanceAuthority ? [performanceAuthorityProject] : []),
  ],
  // CI builds the frontend as its own step, so the server here just starts
  // node directly. Local standalone runs still build automatically; the full
  // verification pyramid can reuse its explicit build instead of rebuilding.
  webServer: {
    command: execution.useExistingBuild ? 'node server.mts' : 'npm start',
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
