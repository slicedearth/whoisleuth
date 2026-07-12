import { expect, test as setup } from '@playwright/test';
import { BASE_URL, TEST_SITE_PASSWORD } from './constants';
import { isAllowedRequestOrigin } from './fixtures';

// Authenticates once via the API (not the UI - the login *form* itself is
// covered by the one visible test in auth.spec.ts) and saves the resulting
// session cookie so every other spec can start already signed in, instead of
// each one re-driving the login form and burning /api/login's rate limit.
//
// This runs outside the 'chromium' project, so it doesn't get fixtures.ts's
// automatic per-page network guard - it checks its own single request
// locally instead, deliberately, rather than relying on that shared fixture.
const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ request }) => {
  // maxRedirects: 0 so a redirect can't quietly change where this actually
  // lands - if the server ever redirected this POST elsewhere, the response
  // itself would be the 3xx (failing response.ok() below) rather than this
  // silently following it and asserting on the wrong URL.
  const response = await request.post('/api/login', {
    data: { password: TEST_SITE_PASSWORD },
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect(response.ok()).toBeTruthy();
  expect(isAllowedRequestOrigin(response.url())).toBe(true);
  expect(response.url()).toBe(`${BASE_URL}/api/login`);
  await request.storageState({ path: authFile });
});
