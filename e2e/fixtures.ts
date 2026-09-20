import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext, ConsoleMessage, Page, Route } from '@playwright/test';
import {
  PLAYWRIGHT_AUTOMATIC_GUARD_OPTIONS,
  PLAYWRIGHT_NETWORK_GUARD_ROUTE_PATTERN,
  isInjectedBrowserLayoutDiagnostic,
  isCancelledSessionPageDiagnostic,
  isNativePreloadTimingDiagnostic,
  isPolicyFixtureDiagnostic,
} from '../tools/playwright-execution-contract.mts';
import { ALLOWED_ORIGIN } from './constants.ts';

// The one origin every browser-initiated request is allowed to reach.
// Exported (and kept as a pure, dependency-free predicate) so the guard
// logic itself can be exercised directly - see origin-guard.spec.ts - rather
// than only ever being proven correct by the absence of a failure.
export { ALLOWED_ORIGIN };

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

  await context.route(PLAYWRIGHT_NETWORK_GUARD_ROUTE_PATTERN, handler);

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
  // A fixture-owned loopback server may replace the primary static server.
  // The automatic guard still admits exactly one origin, never public hosts.
  networkGuardOrigin: string;
  // Opt-in, defaults to false: only the Bulk analysis specifications'
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
  // Only the native policy-enforcement fixture deliberately generates CSP errors.
  allowExpectedPolicyFixtureDiagnostics?: boolean;
};

type Fixtures = {
  networkAndConsoleGuard: void;
};

type GuardOptions = Options & { browserName: string };

export async function installBrowserGuards(browser: Browser, options: GuardOptions) {
  const { networkGuardOrigin, browserName, allowExpectedBulkLookup400Noise,
    allowExpectedLookup429Noise, allowExpectedLookup504Noise, allowExpectedLogout500Noise,
    allowExpectedPolicyFixtureDiagnostics = false } = options;
  const origin = new URL(networkGuardOrigin);
  if (origin.origin !== networkGuardOrigin || origin.protocol !== 'http:'
    || origin.hostname !== '127.0.0.1' || !origin.port) throw new Error('Browser fixtures require one exact loopback origin.');
  const offOriginRequests: string[] = [], consoleIssues: string[] = [], diagnostics: string[] = [];
  const contexts = new Map<BrowserContext, Promise<() => Promise<void>>>();
  let diagnosticCount = 0;
  const diagnostic = (text: string) => { diagnosticCount++; if (diagnostics.length < 8) diagnostics.push(text); };
  const attach = async (context: BrowserContext) => {
    if (contexts.has(context)) return;
    const pending = (async () => {
      const guard = await installNetworkGuard(context, networkGuardOrigin);
      let closed = false;
      context.once('close', () => { closed = true; });
      const pages = new Map<Page, () => void>();
      const onPage = (page: Page) => {
        if (pages.has(page)) return;
        let cancelledSession = false, navigated = false;
        const completedScripts = new Set<string>();
        const successfulScripts = new Set<string>();
        const pendingErrors: Error[] = [];
        const pendingNativeWarnings: { text: string; url: string }[] = [];
        const onResponse = (response: import('@playwright/test').Response) => {
          if (response.status() === 200 && response.request().resourceType() === 'script'
            && response.url().startsWith(networkGuardOrigin + '/_app/immutable/')) successfulScripts.add(response.url());
        };
        const onFinished = (request: import('@playwright/test').Request) => {
          if (successfulScripts.has(request.url())) completedScripts.add(request.url());
        };
        const onFailed = (request: import('@playwright/test').Request) => {
          if (request.url() === networkGuardOrigin + '/api/session'
            && /cancelled|canceled|aborted|interrupted/iu.test(request.failure()?.errorText ?? '')) cancelledSession = true;
        };
        const onNavigation = (frame: import('@playwright/test').Frame) => { if (frame === page.mainFrame()) navigated = true; };
        const onConsole = (message: ConsoleMessage) => {
          const type = message.type();
          if (type !== 'error' && type !== 'warning') return;
          const text = message.text(), url = message.location().url;
          if (isInjectedBrowserLayoutDiagnostic(browserName, type, text, url)) { diagnostic(text); return; }
          if (browserName === 'webkit' && type === 'warning') { pendingNativeWarnings.push({ text, url }); return; }
          if (allowExpectedPolicyFixtureDiagnostics && isPolicyFixtureDiagnostic(browserName, type, text, url, page.url(), networkGuardOrigin)) { diagnostic(text); return; }
          if (type === 'error' && ((isLookupEndpointUrl(url, networkGuardOrigin)
            && ((allowExpectedBulkLookup400Noise && CHROME_HTTP_400_NOISE_RE.test(text))
              || (allowExpectedLookup429Noise && CHROME_HTTP_429_NOISE_RE.test(text))
              || (allowExpectedLookup504Noise && CHROME_HTTP_504_NOISE_RE.test(text))))
            || (allowExpectedLogout500Noise && isLogoutEndpointUrl(url, networkGuardOrigin) && CHROME_HTTP_500_NOISE_RE.test(text)))) return;
          consoleIssues.push(`console.${type}: ${text}`);
        };
        const onError = (error: Error) => { pendingErrors.push(error); };
        page.on('console', onConsole); page.on('pageerror', onError);
        page.on('requestfailed', onFailed); page.on('framenavigated', onNavigation);
        page.on('response', onResponse); page.on('requestfinished', onFinished);
        pages.set(page, () => {
          page.off('console', onConsole); page.off('pageerror', onError);
          page.off('requestfailed', onFailed); page.off('framenavigated', onNavigation);
          page.off('response', onResponse); page.off('requestfinished', onFinished);
          // The native warning can precede requestfinished in the protocol.
          // Require a completed response at teardown, not event arrival order.
          for (const { text, url } of pendingNativeWarnings) {
            if (isNativePreloadTimingDiagnostic(browserName, 'warning', text, url, networkGuardOrigin, completedScripts)) diagnostic(text);
            else consoleIssues.push(`console.warning: ${text}`);
          }
          for (const error of pendingErrors) {
            // Browser events can arrive in either order. Classify only after
            // recording this same page's cancelled session request and navigation.
            if (isCancelledSessionPageDiagnostic(browserName, error.message, networkGuardOrigin, cancelledSession, navigated)) diagnostic(error.message);
            else consoleIssues.push(`pageerror: ${error.message}`);
          }
        });
      };
      context.on('page', onPage);
      for (const page of context.pages()) onPage(page);
      return async () => {
        context.off('page', onPage);
        for (const dispose of pages.values()) dispose();
        if (!closed) await guard.dispose();
        offOriginRequests.push(...guard.offOriginRequests);
      };
    })();
    contexts.set(context, pending);
    await pending;
  };
  // One test owns this worker's browser at a time. Intercept creation before
  // returning a context, including browser.newPage's internally owned context.
  // Existing contexts and every later popup also receive the same guards.
  const original = browser.newContext;
  browser.newContext = async function (options) {
    const context = await original.call(this, { ...options, serviceWorkers: 'block' });
    try { await attach(context); return context; }
    catch (error) { await context.close(); throw error; }
  };
  try { for (const context of browser.contexts()) await attach(context); }
  catch (error) { browser.newContext = original; throw error; }
  return {
    offOriginRequests, consoleIssues, diagnostics,
    get diagnosticCount() { return diagnosticCount; },
    async dispose() {
      browser.newContext = original;
      for (const pending of contexts.values()) await (await pending)();
    },
  };
}

// Automatic at browser scope: every context and page is guarded before a test
// can use it, without requiring an extra helper at each new-page call site.
export const test = base.extend<Options & Fixtures>({
  // The default context is created before the automatic guard. Later contexts
  // receive the same policy from installBrowserGuards before they are returned.
  serviceWorkers: 'block',
  networkGuardOrigin: [ALLOWED_ORIGIN, { option: true }],
  allowExpectedBulkLookup400Noise: [false, { option: true }],
  allowExpectedLookup429Noise: [false, { option: true }],
  allowExpectedLookup504Noise: [false, { option: true }],
  allowExpectedLogout500Noise: [false, { option: true }],
  allowExpectedPolicyFixtureDiagnostics: [false, { option: true }],
  networkAndConsoleGuard: [
    async ({ browser, context, browserName, networkGuardOrigin, allowExpectedBulkLookup400Noise,
      allowExpectedLookup429Noise, allowExpectedLookup504Noise, allowExpectedLogout500Noise, allowExpectedPolicyFixtureDiagnostics }, use, testInfo) => {
      // Depend on the default context so guard failures are recorded before
      // its trace-retention decision, including failures detected at teardown.
      void context;
      const guard = await installBrowserGuards(browser, { browserName, networkGuardOrigin, allowExpectedBulkLookup400Noise,
        allowExpectedLookup429Noise, allowExpectedLookup504Noise, allowExpectedLogout500Noise,
        allowExpectedPolicyFixtureDiagnostics: allowExpectedPolicyFixtureDiagnostics ?? false });
      try { await use(); } finally { await guard.dispose(); }
      if (guard.diagnostics.length) await testInfo.attach('browser-engine-diagnostics', {
        body: JSON.stringify({ count: guard.diagnosticCount, samples: guard.diagnostics }), contentType: 'application/json',
      });
      expect(guard.offOriginRequests, 'requests must stay within the local test server origin').toEqual([]);
      expect(guard.consoleIssues, 'no console errors/warnings or uncaught page errors').toEqual([]);
    },
    PLAYWRIGHT_AUTOMATIC_GUARD_OPTIONS,
  ],
});

export { expect };
