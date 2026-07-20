// Single source of truth for the e2e run's local server address and test-only
// credentials, shared by playwright.config.ts and the specs/setup that need to
// authenticate. The default stays fixed for CI; a maintainer can choose a
// different local port when another project already owns 4173. These values
// only ever reach a Playwright-managed local server process, never a real
// deployment, so they are obviously-fake strings rather than anything
// resembling a real secret.

const configuredPort = process.env.WHOISLEUTH_E2E_PORT?.trim();
const parsedPort = configuredPort ? Number(configuredPort) : 4173;
if (!Number.isSafeInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65_535) {
  throw new Error('WHOISLEUTH_E2E_PORT must be an integer from 1024 through 65535.');
}

export const PORT = parsedPort;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const TEST_SITE_PASSWORD = 'e2e-not-a-real-secret';
export const TEST_SESSION_SECRET = 'e2e-not-a-real-session-signing-secret';
