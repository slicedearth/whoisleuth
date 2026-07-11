// Single source of truth for the e2e run's local server address and
// test-only credentials, shared by playwright.config.ts and the specs/setup
// that need to authenticate. These values only ever reach a Playwright-
// managed local server process - never a real deployment - so they're
// obviously-fake strings rather than anything resembling a real secret.

export const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const TEST_SITE_PASSWORD = 'e2e-not-a-real-secret';
export const TEST_SESSION_SECRET = 'e2e-not-a-real-session-signing-secret';
