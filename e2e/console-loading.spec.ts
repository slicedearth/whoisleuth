import { expect, test } from './fixtures';
import type { CDPSession, Page, TestInfo } from '@playwright/test';

type ConsoleRoute = Readonly<{
  path: '/lookup' | '/monitor';
  heading: 'Lookup' | 'Monitor';
  readyControl: 'lookup-input' | 'monitor-inbox';
  budget: Readonly<{
    encodedTransferBytes: number;
    usableMs: number;
    longTaskTotalMs: number;
  }>;
}>;

type RuntimeProbe = Readonly<{
  longTaskCount: number;
  longTaskTotalMs: number;
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

const routes: readonly ConsoleRoute[] = Object.freeze([
  Object.freeze({
    path: '/lookup',
    heading: 'Lookup',
    readyControl: 'lookup-input',
    budget: Object.freeze({
      encodedTransferBytes: 3_000_000,
      usableMs: 8_000,
      longTaskTotalMs: 3_000,
    }),
  }),
  Object.freeze({
    path: '/monitor',
    heading: 'Monitor',
    readyControl: 'monitor-inbox',
    budget: Object.freeze({
      encodedTransferBytes: 3_500_000,
      usableMs: 8_000,
      longTaskTotalMs: 3_000,
    }),
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
      __whoisleuthLongTasks?: { count: number; totalMs: number };
    };
    scope.__whoisleuthLongTasks = { count: 0, totalMs: 0 };
    if (typeof PerformanceObserver === 'undefined'
      || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
    const observer = new PerformanceObserver((list) => {
      const probe = scope.__whoisleuthLongTasks;
      if (!probe) return;
      for (const entry of list.getEntries()) {
        probe.count += 1;
        probe.totalMs += entry.duration;
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  });
}

async function browserRuntimeProbe(page: Page): Promise<RuntimeProbe> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthLongTasks?: { count: number; totalMs: number };
    };
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      longTaskCount: scope.__whoisleuthLongTasks?.count ?? 0,
      longTaskTotalMs: Math.round((scope.__whoisleuthLongTasks?.totalMs ?? 0) * 100) / 100,
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
): Promise<ConsoleLoadingMeasurement> {
  await installMainThreadProbe(page);
  const session = await page.context().newCDPSession(page);
  const transfer = attachTransferProbe(session);
  await session.send('Network.enable');
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: route.heading, exact: true }).waitFor();
    const readyControl = route.readyControl === 'lookup-input'
      ? page.getByRole('textbox', { name: 'Domain, IP address, ASN, or domain list' })
      : page.getByRole('tab', { name: /^Inbox\b/u });
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
        'Timing ceilings are broad regression tripwires rather than performance targets or guarantees.',
      ]),
    });
    await testInfo.attach(`console-loading-${route.path.slice(1)}.json`, {
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
  test(`authenticated cold load for ${route.path} stays inside its measured regression budget`, async ({ page }, testInfo) => {
    const measurement = await measureConsoleRoute(page, route, testInfo);
    expect(measurement.completedRequestCount, 'the CDP transfer probe must observe the cold route load').toBeGreaterThan(5);
    expect(measurement.encodedTransferBytes).toBeGreaterThan(100_000);
    expect(measurement.encodedTransferBytes).toBeLessThanOrEqual(route.budget.encodedTransferBytes);
    expect(measurement.usableMs).toBeGreaterThan(0);
    expect(measurement.usableMs).toBeLessThanOrEqual(route.budget.usableMs);
    expect(measurement.longTaskTotalMs).toBeLessThanOrEqual(route.budget.longTaskTotalMs);
  });
}
