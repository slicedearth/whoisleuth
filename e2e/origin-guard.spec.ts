import { expect, test } from '@playwright/test';
import { BASE_URL } from './constants';
import { ALLOWED_ORIGIN, installNetworkGuard, isAllowedRequestOrigin } from './fixtures';

// Exercises the predicate every spec's automatic network guard
// (fixtures.ts's networkAndConsoleGuard) relies on, so a change that
// weakens or removes the origin check gets caught here even in a run where
// no test happens to make an off-origin request.
test.describe('network origin guard', () => {
  test('allows the local test server origin and rejects everything else', () => {
    expect(ALLOWED_ORIGIN).toBe(BASE_URL);

    expect(isAllowedRequestOrigin(`${ALLOWED_ORIGIN}/`)).toBe(true);
    expect(isAllowedRequestOrigin(`${ALLOWED_ORIGIN}/api/login`)).toBe(true);

    expect(isAllowedRequestOrigin('http://127.0.0.1:9999/')).toBe(false);
    expect(isAllowedRequestOrigin('https://example.com/')).toBe(false);
    expect(isAllowedRequestOrigin('https://attacker.example/track')).toBe(false);
    expect(isAllowedRequestOrigin('not a url')).toBe(false);
  });

  // The predicate test above only proves isAllowedRequestOrigin's return
  // value - it says nothing about whether the browser request behind an
  // off-origin URL is actually stopped. A rejected fetch alone doesn't prove
  // that either: `example.invalid` is RFC 2606-reserved and will never
  // resolve, so a DNS failure would reject the same fetch with the same
  // generic "Failed to fetch" message even if the route guard did nothing at
  // all. This drives installNetworkGuard (the same function fixtures.ts's
  // automatic guard uses) directly against a real page, waits for the
  // page's own `requestfailed` event for this exact URL, and asserts its
  // failure reason is specifically ERR_BLOCKED_BY_CLIENT - the error Chrome
  // reports only when a request is stopped by client-side interception
  // (route.abort('blockedbyclient')), not by DNS resolution or any other
  // network-level failure. The abort happens at Playwright's
  // request-interception layer, before any DNS lookup or network egress is
  // even attempted, so this never reaches the internet regardless of what
  // the target host is.
  test('an off-origin browser request is actually aborted, not just flagged', async ({ browser }) => {
    const context = await browser.newContext();
    const guard = await installNetworkGuard(context);
    const offOriginUrl = 'https://example.invalid/off-origin-probe';

    try {
      const page = await context.newPage();
      await page.goto('about:blank');

      const requestFailedPromise = page.waitForEvent('requestfailed', (req) => req.url() === offOriginUrl);

      const [failedRequest, outcome] = await Promise.all([
        requestFailedPromise,
        page.evaluate(async (url) => {
          try {
            await fetch(url);
            return 'resolved';
          } catch (error) {
            return `rejected:${error instanceof Error ? error.message : String(error)}`;
          }
        }, offOriginUrl),
      ]);

      expect(outcome.startsWith('rejected:'), `expected the fetch to be aborted, got: ${outcome}`).toBe(true);
      expect(failedRequest.url()).toBe(offOriginUrl);
      expect(failedRequest.failure()?.errorText).toContain('ERR_BLOCKED_BY_CLIENT');
      expect(guard.offOriginRequests).toEqual([`GET ${offOriginUrl}`]);
    } finally {
      await guard.dispose();
      await context.close();
    }
  });
});
