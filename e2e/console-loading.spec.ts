import { ALLOWED_ORIGIN, enforcesMachineTimingBudgets, expect, test } from './fixtures';
import type { CDPSession, Page, TestInfo } from '@playwright/test';

type ConsoleRoute = Readonly<{
  path: '/lookup' | '/monitor' | '/cli';
  heading: 'Lookup' | 'Monitor' | 'WHOISleuth CLI';
  readyControl: 'lookup-input' | 'monitor-inbox' | 'cli-search';
  budget: Readonly<{
    encodedTransferBytes: number;
    usableMs: number;
    longTaskTotalMs: number;
    layoutShiftScore: number;
  }>;
}>;

type RuntimeProbe = Readonly<{
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  layoutShiftSupported: boolean;
  layoutShiftCount: number;
  layoutShiftScore: number;
  firstContentfulPaintMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
}>;

type ConsoleLoadingMeasurement = RuntimeProbe & Readonly<{
  schema: 'whoisleuth.console-loading-measurement';
  version: 1;
  mode: 'authenticated_local_chromium_cold_load';
  path: ConsoleRoute['path'];
  budget: ConsoleRoute['budget'];
  encodedTransferBytes: number;
  completedRequestCount: number;
  usableMs: number;
  limitations: readonly string[];
}>;

type ConsoleLoadingSampleSet = Readonly<{
  schema: 'whoisleuth.console-loading-sample-set';
  version: 1;
  mode: 'authenticated_local_chromium_repeated_cold_load';
  path: ConsoleRoute['path'];
  budget: ConsoleRoute['budget'];
  sampleCount: number;
  usableMsMedian: number;
  usableMsMaximum: number;
  longTaskTotalMsMedian: number;
  longTaskTotalMsMaximum: number;
  samples: readonly ConsoleLoadingMeasurement[];
  limitations: readonly string[];
}>;

// Calibrated from repeated isolated and suite-ordered local production-build
// cold loads on 2026-08-24. The maxima include first-route process and browser
// cache variance instead of relying only on warmed suite timings.
// Transfer ceilings add 20% and round up to 64 KiB; readiness and long-task
// ceilings add 50% and round up to 50 ms and 10 ms respectively. Layout
// ceilings add 50% and round up to 0.005, with small zero-observation floors.
const CONSOLE_LOADING_OBSERVED_MAXIMA = Object.freeze({
  '/lookup': Object.freeze({ encodedTransferBytes: 1_979_140, usableMs: 748.7, longTaskTotalMs: 82, layoutShiftScore: 0 }),
  '/monitor': Object.freeze({ encodedTransferBytes: 1_748_707, usableMs: 1_627.7, longTaskTotalMs: 68, layoutShiftScore: 0.0064 }),
  '/cli': Object.freeze({ encodedTransferBytes: 466_249, usableMs: 250.7, longTaskTotalMs: 0, layoutShiftScore: 0.0015 }),
});
// Three samples make the median require two passes against the unchanged
// reviewed budget. One scheduler-affected sample remains permitted, but the
// two-times hard ceiling prevents the median from hiding a severe regression.
const CONSOLE_LOADING_SAMPLE_COUNT = 3;
const CONSOLE_LOADING_TRANSIENT_OUTLIER_MULTIPLIER = 2;

function roundUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function coldLoadBudget(path: keyof typeof CONSOLE_LOADING_OBSERVED_MAXIMA): ConsoleRoute['budget'] {
  const observed = CONSOLE_LOADING_OBSERVED_MAXIMA[path];
  return Object.freeze({
    encodedTransferBytes: roundUp(observed.encodedTransferBytes * 1.2, 64 * 1024),
    usableMs: roundUp(observed.usableMs * 1.5, 50),
    longTaskTotalMs: Math.max(50, roundUp(observed.longTaskTotalMs * 1.5, 10)),
    layoutShiftScore: Math.max(0.01, roundUp(observed.layoutShiftScore * 1.5, 0.005)),
  });
}

const routes: readonly ConsoleRoute[] = Object.freeze([
  Object.freeze({
    path: '/lookup',
    heading: 'Lookup',
    readyControl: 'lookup-input',
    budget: coldLoadBudget('/lookup'),
  }),
  Object.freeze({
    path: '/monitor',
    heading: 'Monitor',
    readyControl: 'monitor-inbox',
    budget: coldLoadBudget('/monitor'),
  }),
  Object.freeze({
    path: '/cli',
    heading: 'WHOISleuth CLI',
    readyControl: 'cli-search',
    budget: coldLoadBudget('/cli'),
  }),
]);

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function attachTransferProbe(session: CDPSession) {
  let encodedTransferBytes = 0;
  let completedRequestCount = 0;
  session.on('Network.loadingFinished', (payload) => {
    const record = payload as Record<string, unknown>;
    const bytes = numberField(record.encodedDataLength);
    if (bytes === null) return;
    encodedTransferBytes += bytes;
    completedRequestCount += 1;
  });
  return () => ({ encodedTransferBytes, completedRequestCount });
}

async function resetConsoleRouteState(page: Page): Promise<void> {
  if (page.url() === ALLOWED_ORIGIN || page.url().startsWith(`${ALLOWED_ORIGIN}/`)) {
    await page.evaluate(() => sessionStorage.clear());
  }
  await page.goto('about:blank');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Network.enable');
    await session.send('Network.clearBrowserCache');
    await session.send('Storage.clearDataForOrigin', {
      origin: ALLOWED_ORIGIN,
      storageTypes: 'appcache,cache_storage,indexeddb,local_storage,service_workers,websql',
    });
  } finally {
    await session.detach();
  }
}

function median(values: readonly number[]): number {
  if (values.length !== CONSOLE_LOADING_SAMPLE_COUNT) {
    throw new TypeError(`Console loading requires exactly ${CONSOLE_LOADING_SAMPLE_COUNT} samples.`);
  }
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
}

async function installMainThreadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthLoadingRuntime?: {
        longTaskSupported: boolean;
        longTaskCount: number;
        longTaskTotalMs: number;
        layoutShiftSupported: boolean;
        layoutShiftCount: number;
        layoutShiftScore: number;
      };
    };
    const probe = scope.__whoisleuthLoadingRuntime = {
      longTaskSupported: false as boolean,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      layoutShiftSupported: false as boolean,
      layoutShiftCount: 0,
      layoutShiftScore: 0,
    };
    if (typeof PerformanceObserver === 'undefined') return;
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      probe.longTaskSupported = true;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTaskCount += 1;
          probe.longTaskTotalMs += entry.duration;
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    }
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      probe.layoutShiftSupported = true;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (shift.hadRecentInput || typeof shift.value !== 'number') continue;
          probe.layoutShiftCount += 1;
          probe.layoutShiftScore += shift.value;
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    }
  });
}

async function browserRuntimeProbe(page: Page): Promise<RuntimeProbe> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthLoadingRuntime?: {
        longTaskSupported: boolean;
        longTaskCount: number;
        longTaskTotalMs: number;
        layoutShiftSupported: boolean;
        layoutShiftCount: number;
        layoutShiftScore: number;
      };
    };
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      longTaskSupported: scope.__whoisleuthLoadingRuntime?.longTaskSupported ?? false,
      longTaskCount: scope.__whoisleuthLoadingRuntime?.longTaskCount ?? 0,
      longTaskTotalMs: Math.round((scope.__whoisleuthLoadingRuntime?.longTaskTotalMs ?? 0) * 100) / 100,
      layoutShiftSupported: scope.__whoisleuthLoadingRuntime?.layoutShiftSupported ?? false,
      layoutShiftCount: scope.__whoisleuthLoadingRuntime?.layoutShiftCount ?? 0,
      layoutShiftScore: Math.round((scope.__whoisleuthLoadingRuntime?.layoutShiftScore ?? 0) * 10_000) / 10_000,
      firstContentfulPaintMs: paint ? Math.round(paint.startTime * 100) / 100 : null,
      domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd * 100) / 100 : null,
      loadEventMs: navigation ? Math.round(navigation.loadEventEnd * 100) / 100 : null,
    };
  });
}

async function measureConsoleRoute(
  page: Page,
  route: ConsoleRoute,
  testInfo: TestInfo,
  sample: number,
): Promise<ConsoleLoadingMeasurement> {
  const session = await page.context().newCDPSession(page);
  const transfer = attachTransferProbe(session);
  await session.send('Network.enable');
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: route.heading, exact: true }).waitFor();
    const readyControl = route.readyControl === 'lookup-input'
      ? page.getByRole('textbox', { name: 'Domain, IP address, ASN, or domain list' })
      : route.readyControl === 'monitor-inbox'
        ? page.getByRole('tab', { name: /^Inbox\b/u })
        : page.getByRole('searchbox', { name: 'Search commands' });
    await readyControl.waitFor();
    await expect(readyControl).toBeEnabled();
    const usableMs = await page.evaluate(() => Math.round(performance.now() * 100) / 100);
    await page.waitForLoadState('networkidle');
    const measurement: ConsoleLoadingMeasurement = Object.freeze({
      schema: 'whoisleuth.console-loading-measurement',
      version: 1,
      mode: 'authenticated_local_chromium_cold_load',
      path: route.path,
      budget: route.budget,
      ...transfer(),
      usableMs,
      ...await browserRuntimeProbe(page),
      limitations: Object.freeze([
        'This is a local production-style server measurement, not production latency.',
        'The desktop Chromium result does not represent mobile hardware or visitor network conditions.',
        'Layout shift excludes entries associated with recent input, matching the browser CLS definition.',
        'Ceilings are reviewed regression limits derived from repeated clean local production-build runs with documented headroom.',
        'Wall-clock and long-task ceilings are enforced only by the single-worker performance-authority project.',
      ]),
    });
    await testInfo.attach(`console-loading-${route.path.slice(1)}-sample-${sample}.json`, {
      body: Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    });
    process.stdout.write(`Console loading measurement: ${JSON.stringify(measurement)}\n`);
    return measurement;
  } finally {
    await session.detach();
  }
}

for (const route of routes) {
  test(`authenticated cold load for ${route.path} preserves deterministic loading contracts`, async ({ page }, testInfo) => {
    await installMainThreadProbe(page);
    const measurements: ConsoleLoadingMeasurement[] = [];
    for (let sample = 1; sample <= CONSOLE_LOADING_SAMPLE_COUNT; sample += 1) {
      await resetConsoleRouteState(page);
      const measurement = await measureConsoleRoute(page, route, testInfo, sample);
      measurements.push(measurement);
      expect(measurement.completedRequestCount, 'the CDP transfer probe must observe the cold route load').toBeGreaterThan(5);
      expect(measurement.encodedTransferBytes).toBeGreaterThan(100_000);
      expect(measurement.encodedTransferBytes).toBeLessThanOrEqual(route.budget.encodedTransferBytes);
      expect(measurement.usableMs).toBeGreaterThan(0);
      expect(measurement.longTaskSupported).toBe(true);
      expect(measurement.layoutShiftSupported).toBe(true);
      expect(measurement.layoutShiftScore).toBeLessThanOrEqual(route.budget.layoutShiftScore);
    }
    const sampleSet: ConsoleLoadingSampleSet = Object.freeze({
      schema: 'whoisleuth.console-loading-sample-set',
      version: 1,
      mode: 'authenticated_local_chromium_repeated_cold_load',
      path: route.path,
      budget: route.budget,
      sampleCount: measurements.length,
      usableMsMedian: median(measurements.map((measurement) => measurement.usableMs)),
      usableMsMaximum: Math.max(...measurements.map((measurement) => measurement.usableMs)),
      longTaskTotalMsMedian: median(measurements.map((measurement) => measurement.longTaskTotalMs)),
      longTaskTotalMsMaximum: Math.max(...measurements.map((measurement) => measurement.longTaskTotalMs)),
      samples: Object.freeze([...measurements]),
      limitations: Object.freeze([
        'The median of three independently cache-cleared, browser-local-state-cleared samples is the machine timing authority.',
        'Samples share one Chromium and local server process; this reduces scheduler noise and is not a first-process cold-start claim.',
        'Every sample remains subject to transfer and layout ceilings, and a two-times timing ceiling rejects severe transient regressions.',
      ]),
    });
    await testInfo.attach(`console-loading-${route.path.slice(1)}-samples.json`, {
      body: Buffer.from(`${JSON.stringify(sampleSet, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    });
    process.stdout.write(`Console loading sample set: ${JSON.stringify(sampleSet)}\n`);
    // Shared hosted runners cannot provide a stable CPU scheduling authority.
    // Transfer and layout gates above remain blocking in every project.
    if (enforcesMachineTimingBudgets(testInfo.project.name)) {
      expect(sampleSet.usableMsMedian).toBeLessThanOrEqual(route.budget.usableMs);
      expect(sampleSet.longTaskTotalMsMedian).toBeLessThanOrEqual(route.budget.longTaskTotalMs);
      expect(sampleSet.usableMsMaximum).toBeLessThanOrEqual(
        route.budget.usableMs * CONSOLE_LOADING_TRANSIENT_OUTLIER_MULTIPLIER,
      );
      expect(sampleSet.longTaskTotalMsMaximum).toBeLessThanOrEqual(
        route.budget.longTaskTotalMs * CONSOLE_LOADING_TRANSIENT_OUTLIER_MULTIPLIER,
      );
    }
  });
}
