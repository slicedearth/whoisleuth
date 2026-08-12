import { test as base, expect } from '@playwright/test';
import type { BrowserContext, ConsoleMessage, Route } from '@playwright/test';
import { BASE_URL } from './constants';

// The one origin every browser-initiated request is allowed to reach.
// Exported (and kept as a pure, dependency-free predicate) so the guard
// logic itself can be exercised directly - see origin-guard.spec.ts - rather
// than only ever being proven correct by the absence of a failure.
export const ALLOWED_ORIGIN = new URL(BASE_URL).origin;

export function isAllowedRequestOrigin(url: string, allowedOrigin: string = ALLOWED_ORIGIN): boolean {
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

// Exact origin + exact pathname, not a string prefix - `/api/lookup` as a
// prefix would also match `/api/lookup-other` or `/api/lookup/whatever`.
function isLookupEndpointUrl(url: string, allowedOrigin: string = ALLOWED_ORIGIN): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === allowedOrigin && parsed.pathname === '/api/lookup';
  } catch {
    return false;
  }
}

function isLogoutEndpointUrl(url: string, allowedOrigin: string = ALLOWED_ORIGIN): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === allowedOrigin && parsed.pathname === '/api/logout';
  } catch {
    return false;
  }
}

// Chromium logs a synthetic "Failed to load resource: the server responded
// with a status of 400" console.error for every 400 response, at the
// network-stack/DevTools level, regardless of whether application code
// already caught and handled it. Deliberately scoped to exactly 400 (not
// \d+) and to /api/lookup specifically (checked against the message's own
// location().url via isLookupEndpointUrl below, not just "some request
// happened") - a 404/500, or a 400 from any other endpoint, is still a real
// signal and must still fail.
const CHROME_HTTP_400_NOISE_RE = /^Failed to load resource: the server responded with a status of 400\b/;
const CHROME_HTTP_429_NOISE_RE = /^Failed to load resource: the server responded with a status of 429\b/;
const CHROME_HTTP_504_NOISE_RE = /^Failed to load resource: the server responded with a status of 504\b/;
const CHROME_HTTP_500_NOISE_RE = /^Failed to load resource: the server responded with a status of 500\b/;

// Installs an active request interceptor on a BrowserContext: every request
// is either passed through (allowed origin) or aborted client-side before it
// ever reaches the network (anything else). context.route() - unlike
// page.on('request'), which only observes traffic on one already-open page -
// applies to every page in the context, including popups and pages opened
// later, so this can't be bypassed by opening a new tab/window.
export async function installNetworkGuard(context: BrowserContext, allowedOrigin: string = ALLOWED_ORIGIN) {
  const offOriginRequests: string[] = [];

  const handler = async (route: Route) => {
    const request = route.request();
    if (isAllowedRequestOrigin(request.url(), allowedOrigin)) {
      await route.continue();
      return;
    }
    offOriginRequests.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  };

  await context.route('**/*', handler);

  return {
    offOriginRequests,
    // A timed-out page navigation can leave route callbacks in flight. Remove
    // every test-context route without waiting for those callbacks so fixture
    // teardown does not obscure the original failure or consume another full
    // test timeout after the browser has already begun closing.
    dispose: () => context.unrouteAll({ behavior: 'ignoreErrors' }),
  };
}

type Options = {
  // Opt-in, defaults to false: only bulk-analysis.spec.ts's deliberately
  // invalid-domain scans (see runBulkScan) legitimately produce Chrome's
  // 400-response console noise as expected, handled behavior. Every other
  // spec keeps the guard fully strict.
  allowExpectedBulkLookup400Noise: boolean;
  // Opt-in for the one circuit-breaker UI test that deliberately fulfills an
  // exact local /api/lookup request with 429. Other 429s and endpoints remain
  // console failures.
  allowExpectedLookup429Noise: boolean;
  // Opt-in for the one timeout-presentation test that deliberately fulfills
  // an exact local /api/lookup request with 504.
  allowExpectedLookup504Noise: boolean;
  // Opt-in for the exact failed-sign-out test. Chromium reports the handled
  // fixture 500 at the network layer even though the UI retains the session.
  allowExpectedLogout500Noise: boolean;
};

type Fixtures = {
  networkAndConsoleGuard: void;
};

// Automatic (`auto: true`) so every test built from this `test` gets it for
// free, with no per-spec wiring: aborts (not just flags) any request to an
// origin other than the local Playwright-managed server, and fails the test
// if the browser logs a console error/warning or an uncaught page error.
// This is what actually enforces "no live WHOIS/RDAP/DNS/CT/website
// traffic" - individual specs choosing deterministic, locally-rejected
// input values is necessary but not sufficient without this backstop.
export const test = base.extend<Options & Fixtures>({
  allowExpectedBulkLookup400Noise: [false, { option: true }],
  allowExpectedLookup429Noise: [false, { option: true }],
  allowExpectedLookup504Noise: [false, { option: true }],
  allowExpectedLogout500Noise: [false, { option: true }],

  networkAndConsoleGuard: [
    async ({
      page,
      context,
      allowExpectedBulkLookup400Noise,
      allowExpectedLookup429Noise,
      allowExpectedLookup504Noise,
      allowExpectedLogout500Noise,
    }, use) => {
      const guard = await installNetworkGuard(context);
      const consoleIssues: string[] = [];

      const onConsole = (message: ConsoleMessage) => {
        const type = message.type();
        if (type !== 'error' && type !== 'warning') return;
        const text = message.text();
        if (
          type === 'error' &&
          ((isLookupEndpointUrl(message.location().url)
            && ((allowExpectedBulkLookup400Noise && CHROME_HTTP_400_NOISE_RE.test(text))
              || (allowExpectedLookup429Noise && CHROME_HTTP_429_NOISE_RE.test(text))
              || (allowExpectedLookup504Noise && CHROME_HTTP_504_NOISE_RE.test(text))))
            || (allowExpectedLogout500Noise
              && isLogoutEndpointUrl(message.location().url)
              && CHROME_HTTP_500_NOISE_RE.test(text)))
        ) {
          return;
        }
        consoleIssues.push(`console.${type}: ${text}`);
      };
      const onPageError = (error: Error) => {
        consoleIssues.push(`pageerror: ${error.message}`);
      };

      page.on('console', onConsole);
      page.on('pageerror', onPageError);

      await use();

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      await guard.dispose();

      expect(guard.offOriginRequests, 'requests must stay within the local test server origin').toEqual([]);
      expect(consoleIssues, 'no console errors/warnings or uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
