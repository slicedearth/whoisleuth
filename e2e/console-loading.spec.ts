import { performance as hostPerformance } from 'node:perf_hooks';
import { expect, test } from './fixtures';
import type { CDPSession, Locator, Page, TestInfo } from '@playwright/test';
import { CLI_COMMANDS } from '../cli/command-reference.mts';
import {
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_TIMING_POLICY,
  installNavigationReadinessMark,
  performanceMeasurementContext,
  performanceSampleMedian,
  summarizePerformanceTimings,
  readNavigationReadinessMark,
  resetPerformanceSampleState,
  type BrowserReadinessTarget,
  type PerformanceMeasurementContext,
} from './performance-sampling.ts';

type ConsoleRoute = Readonly<{
  path: '/lookup' | '/monitor' | '/cli';
  heading: 'Lookup' | 'Monitor' | 'WHOISleuth CLI';
  readyControl: 'lookup-input' | 'monitor-inbox' | 'cli-search';
  readinessTargets: readonly BrowserReadinessTarget[];
  budget: Readonly<{
    encodedTransferBytes: number;
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
  version: 3;
  mode: 'authenticated_local_chromium_cold_load';
  readinessClock: 'navigation_start_to_animation_frame';
  path: ConsoleRoute['path'];
  budget: ConsoleRoute['budget'];
  timingPolicy: typeof PERFORMANCE_TIMING_POLICY;
  execution: PerformanceMeasurementContext;
  encodedTransferBytes: number;
  completedRequestCount: number;
  usableMs: number;
  hostReadyMs: number;
  limitations: readonly string[];
}>;

type ConsoleLoadingSampleSet = Readonly<{
  schema: 'whoisleuth.console-loading-sample-set';
  version: 3;
  mode: 'authenticated_local_chromium_repeated_cold_load';
  path: ConsoleRoute['path'];
  budget: ConsoleRoute['budget'];
  timingPolicy: typeof PERFORMANCE_TIMING_POLICY;
  execution: PerformanceMeasurementContext;
  sampleCount: number;
  usableMsMedian: number;
  usableMsMaximum: number;
  hostReadyMsMedian: number;
  hostReadyMsMaximum: number;
  longTaskTotalMsMedian: number;
  longTaskTotalMsMaximum: number;
  samples: readonly ConsoleLoadingMeasurement[];
  limitations: readonly string[];
}>;

// Retain the reviewed production-asset and layout regression bounds. Transfer
// ceilings add 20% to the measured asset set and round up to 64 KiB; layout
// ceilings add 50% and round up to 0.005, with a 0.01 floor. These are separate
// from CPU-dependent elapsed time, which is reported without a host-derived
// pass/fail threshold. No transfer or layout ceiling is raised by that policy.
const CONSOLE_LOADING_RESOURCE_BASELINE = Object.freeze({
  '/lookup': Object.freeze({ encodedTransferBytes: 2_125_921, layoutShiftScore: 0 }),
  '/monitor': Object.freeze({ encodedTransferBytes: 1_831_989, layoutShiftScore: 0.0064 }),
  '/cli': Object.freeze({ encodedTransferBytes: 513_272, layoutShiftScore: 0.0015 }),
});
function roundUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function coldLoadBudget(path: keyof typeof CONSOLE_LOADING_RESOURCE_BASELINE): ConsoleRoute['budget'] {
  const observed = CONSOLE_LOADING_RESOURCE_BASELINE[path];
  return Object.freeze({
    encodedTransferBytes: roundUp(observed.encodedTransferBytes * 1.2, 64 * 1024),
    layoutShiftScore: Math.max(0.01, roundUp(observed.layoutShiftScore * 1.5, 0.005)),
  });
}

const routes: readonly ConsoleRoute[] = Object.freeze([
  // Lookup and Monitor render their declared targets only after the protected
  // session and browser-local workspace gates complete in the client. The
  // public CLI route is prerendered, so it also requires its component-owned
  // initialisation signal to exclude enabled but inert static controls.
  Object.freeze({
    path: '/lookup',
    heading: 'Lookup',
    readyControl: 'lookup-input',
    readinessTargets: Object.freeze([
      Object.freeze({ selector: 'h1', exactText: 'Lookup' }),
      Object.freeze({ selector: '#query', requireEnabled: true }),
    ]),
    budget: coldLoadBudget('/lookup'),
  }),
  Object.freeze({
    path: '/monitor',
    heading: 'Monitor',
    readyControl: 'monitor-inbox',
    readinessTargets: Object.freeze([
      Object.freeze({ selector: 'h1', exactText: 'Monitor' }),
      Object.freeze({ selector: '#tab-inbox', requireEnabled: true }),
    ]),
    budget: coldLoadBudget('/monitor'),
  }),
  Object.freeze({
    path: '/cli',
    heading: 'WHOISleuth CLI',
    readyControl: 'cli-search',
    readinessTargets: Object.freeze([
      Object.freeze({ selector: 'h1', exactText: 'WHOISleuth CLI' }),
      Object.freeze({ selector: '.filters input[type="search"]', requireEnabled: true }),
      Object.freeze({ selector: '[data-testid="public-cli-catalogue"][data-client-ready="true"]' }),
    ]),
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

async function verifyCliSearchBehaviour(page: Page, search: Locator): Promise<void> {
  const catalogue = page.getByTestId('public-cli-catalogue');
  const status = catalogue.getByRole('status');
  await search.fill('workflow-plan');
  await expect(status).toHaveText(`Showing 1 of ${CLI_COMMANDS.length} commands.`);
  const command = catalogue.locator('article[data-command="workflow-plan"]');
  await expect(command).toBeVisible();
  await expect(command.locator(':scope > .command-row > button')).toBeEnabled();
  await search.fill('');
  await expect(status).toHaveText(`Showing ${CLI_COMMANDS.length} of ${CLI_COMMANDS.length} commands.`);
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
    const hostStartedAt = hostPerformance.now();
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    const usableMs = await readNavigationReadinessMark(page);
    await page.getByRole('heading', { name: route.heading, exact: true }).waitFor();
    const readyControl = route.readyControl === 'lookup-input'
      ? page.getByRole('textbox', { name: 'Domain, IP address, ASN, or domain list' })
      : route.readyControl === 'monitor-inbox'
        ? page.getByRole('tab', { name: /^Inbox\b/u })
        : page.getByRole('searchbox', { name: 'Search commands' });
    await readyControl.waitFor();
    await expect(readyControl).toBeEnabled();
    if (route.readyControl === 'cli-search') await verifyCliSearchBehaviour(page, readyControl);
    const hostReadyMs = Math.round((hostPerformance.now() - hostStartedAt) * 100) / 100;
    await page.waitForLoadState('networkidle');
    const measurement: ConsoleLoadingMeasurement = Object.freeze({
      schema: 'whoisleuth.console-loading-measurement',
      version: 3,
      mode: 'authenticated_local_chromium_cold_load',
      readinessClock: 'navigation_start_to_animation_frame',
      path: route.path,
      budget: route.budget,
      timingPolicy: PERFORMANCE_TIMING_POLICY,
      execution: performanceMeasurementContext(page, testInfo),
      ...transfer(),
      usableMs,
      hostReadyMs,
      ...await browserRuntimeProbe(page),
      limitations: Object.freeze([
        'This is a local production-style server measurement, not production latency.',
        'The desktop Chromium result does not represent mobile hardware or visitor network conditions.',
        'Usable time is a browser-side navigation mark captured on the first animation frame where the route heading and primary control are ready; prerendered interactive surfaces also require a component-owned client initialisation signal.',
        'Host navigation, command and readiness-assertion duration is excluded from usable time and retained separately as hostReadyMs.',
        'The CLI route additionally proves that its search control changes and restores the rendered command result set after the readiness mark.',
        'Layout shift excludes entries associated with recent input, matching the browser CLS definition.',
        'Transfer and layout ceilings are reviewed resource and presentation regression limits, not elapsed-time targets.',
        'Elapsed time and long-task duration are observations for the recorded execution context, not universal performance guarantees or CI timing thresholds.',
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
    await installNavigationReadinessMark(page, route.readinessTargets);
    const measurements: ConsoleLoadingMeasurement[] = [];
    for (let sample = 1; sample <= PERFORMANCE_SAMPLE_COUNT; sample += 1) {
      await resetPerformanceSampleState(page);
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
      version: 3,
      mode: 'authenticated_local_chromium_repeated_cold_load',
      path: route.path,
      budget: route.budget,
      timingPolicy: PERFORMANCE_TIMING_POLICY,
      execution: performanceMeasurementContext(page, testInfo),
      sampleCount: measurements.length,
      ...summarizePerformanceTimings(measurements),
      hostReadyMsMedian: performanceSampleMedian(measurements.map((measurement) => measurement.hostReadyMs)),
      hostReadyMsMaximum: Math.max(...measurements.map((measurement) => measurement.hostReadyMs)),
      samples: Object.freeze([...measurements]),
      limitations: Object.freeze([
        'Three independently cache-cleared, browser-local-state-cleared samples retain their median and maximum for performance review.',
        'Samples share one Chromium and local server process; this reduces scheduler noise and is not a first-process cold-start claim.',
        'Browser readiness and host navigation/assertion duration remain separate observations; neither is converted into a host-derived acceptance limit.',
        'Compare repeated runs of the same workload under comparable conditions before attributing a timing difference to a code change.',
        'Every sample remains subject to functional readiness, transfer and layout checks, and the bounded test timeout still rejects hangs.',
      ]),
    });
    await testInfo.attach(`console-loading-${route.path.slice(1)}-samples.json`, {
      body: Buffer.from(`${JSON.stringify(sampleSet, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    });
    process.stdout.write(`Console loading sample set: ${JSON.stringify(sampleSet)}\n`);
  });
}
