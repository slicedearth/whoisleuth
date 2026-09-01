import { performance } from 'node:perf_hooks';
import type { Locator, Page, Request, TestInfo } from '@playwright/test';
import { CLI_COMMANDS } from '../cli/command-reference.mts';
import { ALLOWED_ORIGIN, enforcesMachineTimingBudgets, expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import { currentBrandProfileBrowserStore, expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model';
import {
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER,
  performanceSampleMedian,
  resetPerformanceSampleState,
} from './performance-sampling';

type InteractionId =
  | 'cli_command_detail'
  | 'cli_catalogue_filter'
  | 'examples_large_output'
  | 'demo_later_stage'
  | 'monitor_relationships_view'
  | 'brands_portfolio_workbench'
  | 'bulk_cohort_outliers'
  | 'lookup_dns_evidence'
  | 'case_response_packet'
  | 'dashboard_command_palette';

type InteractionBudget = Readonly<{
  assetEncodedTransferBytes: number;
  usableMs: number;
  longTaskTotalMs: number;
  layoutShiftScore: number;
  residualLayoutShiftScore: number;
}>;

type RuntimeProbe = Readonly<{
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  layoutShiftSupported: boolean;
  layoutShiftCount: number;
  layoutShiftScore: number;
  residualLayoutShiftCount: number;
  residualLayoutShiftScore: number;
}>;

type DeferredInteractionMeasurement = Readonly<{
  schema: 'whoisleuth.deferred-interaction-measurement';
  version: 1;
  mode: 'authenticated_local_chromium_production_build';
  interaction: InteractionId;
  path: string;
  budget: InteractionBudget;
  assetEncodedTransferBytes: number;
  completedAssetRequestCount: number;
  usableMs: number;
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  layoutShiftSupported: boolean;
  layoutShiftCount: number;
  layoutShiftScore: number;
  residualLayoutShiftCount: number;
  residualLayoutShiftScore: number;
  investigationRequestCount: number;
  limitations: readonly string[];
}>;

type DeferredInteractionSampleSet = Readonly<{
  schema: 'whoisleuth.deferred-interaction-sample-set';
  version: 1;
  mode: 'authenticated_local_chromium_repeated_interaction';
  interaction: InteractionId;
  path: string;
  budget: InteractionBudget;
  sampleCount: number;
  usableMsMedian: number;
  usableMsMaximum: number;
  longTaskTotalMsMedian: number;
  longTaskTotalMsMaximum: number;
  samples: readonly DeferredInteractionMeasurement[];
  limitations: readonly string[];
}>;

// Calibrated from three clean local production-build runs on 2026-08-24.
// The CLI filter row measures one real keyboard refinement after a prefilled
// multi-result query. That keeps the browser recent-input semantics while
// excluding artificial driver time for a no-delay multi-character sequence.
// The Case response row was remeasured on 2026-08-25 after its module moved
// into the canonical Cases-view preload packet.
// Transfer ceilings add 20% and round up to 1 KiB; readiness and long-task
// ceilings add 50% and round up to 25 ms and 10 ms respectively. Layout
// ceilings add 50% and round up to 0.005. Zero-observation floors preserve a
// small measurement allowance without turning these tripwires into targets.
const INTERACTION_OBSERVED_MAXIMA = Object.freeze({
  cli_command_detail: Object.freeze({ assetEncodedTransferBytes: 0, usableMs: 156.02, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  cli_catalogue_filter: Object.freeze({ assetEncodedTransferBytes: 0, usableMs: 40.42, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  examples_large_output: Object.freeze({ assetEncodedTransferBytes: 7_904, usableMs: 61.65, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  demo_later_stage: Object.freeze({ assetEncodedTransferBytes: 7_955, usableMs: 357.43, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  monitor_relationships_view: Object.freeze({ assetEncodedTransferBytes: 96_533, usableMs: 209.61, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  brands_portfolio_workbench: Object.freeze({ assetEncodedTransferBytes: 10_559, usableMs: 52.37, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  bulk_cohort_outliers: Object.freeze({ assetEncodedTransferBytes: 59_182, usableMs: 127.71, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  lookup_dns_evidence: Object.freeze({ assetEncodedTransferBytes: 68_765, usableMs: 195.37, longTaskTotalMs: 72, layoutShiftScore: 0 }),
  case_response_packet: Object.freeze({ assetEncodedTransferBytes: 0, usableMs: 130.89, longTaskTotalMs: 0, layoutShiftScore: 0 }),
  dashboard_command_palette: Object.freeze({ assetEncodedTransferBytes: 0, usableMs: 118.1, longTaskTotalMs: 0, layoutShiftScore: 0 }),
});

function roundUp(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

function interactionBudget(interaction: InteractionId): InteractionBudget {
  const observed = INTERACTION_OBSERVED_MAXIMA[interaction];
  return Object.freeze({
    assetEncodedTransferBytes: observed.assetEncodedTransferBytes === 0
      ? 0
      : roundUp(observed.assetEncodedTransferBytes * 1.2, 1024),
    usableMs: Math.max(75, roundUp(observed.usableMs * 1.5, 25)),
    longTaskTotalMs: Math.max(50, roundUp(observed.longTaskTotalMs * 1.5, 10)),
    layoutShiftScore: Math.max(0.01, roundUp(observed.layoutShiftScore * 1.5, 0.005)),
    residualLayoutShiftScore: 0.01,
  });
}

const INTERACTION_BUDGETS: Readonly<Record<InteractionId, InteractionBudget>> = Object.freeze(
  Object.fromEntries(Object.keys(INTERACTION_OBSERVED_MAXIMA).map((interaction) => (
    [interaction, interactionBudget(interaction as InteractionId)]
  ))) as Record<InteractionId, InteractionBudget>,
);

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
const CASES_KEY = 'whois-rdap-cases-v1';
const FIXTURE_TIME = '2026-08-23T00:00:00.000Z';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function resetRuntimeProbe(): void {
  const scope = globalThis as typeof globalThis & {
    __whoisleuthDeferredRuntime?: {
      longTaskCount: number;
      longTaskTotalMs: number;
      longTaskSupported: boolean;
      layoutShiftCount: number;
      layoutShiftScore: number;
      layoutShiftSupported: boolean;
      residualLayoutShiftCount: number;
      residualLayoutShiftScore: number;
      residualLayoutShiftActive: boolean;
      observers: PerformanceObserver[];
    };
  };
  for (const observer of scope.__whoisleuthDeferredRuntime?.observers ?? []) observer.disconnect();
  const probe = {
    longTaskSupported: false,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    layoutShiftSupported: false,
    layoutShiftCount: 0,
    layoutShiftScore: 0,
    residualLayoutShiftCount: 0,
    residualLayoutShiftScore: 0,
    residualLayoutShiftActive: false,
    observers: [] as PerformanceObserver[],
  };
  scope.__whoisleuthDeferredRuntime = probe;
  if (typeof PerformanceObserver === 'undefined') return;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    probe.longTaskSupported = true;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longTaskCount += 1;
        probe.longTaskTotalMs += entry.duration;
      }
    });
    probe.observers.push(observer);
    observer.observe({ type: 'longtask', buffered: false });
  }
  if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
    probe.layoutShiftSupported = true;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (typeof shift.value !== 'number') continue;
        if (!shift.hadRecentInput) {
          probe.layoutShiftCount += 1;
          probe.layoutShiftScore += shift.value;
        }
        if (probe.residualLayoutShiftActive) {
          probe.residualLayoutShiftCount += 1;
          probe.residualLayoutShiftScore += shift.value;
        }
      }
    });
    probe.observers.push(observer);
    observer.observe({ type: 'layout-shift', buffered: false });
  }
}

async function readRuntimeProbe(page: Page): Promise<RuntimeProbe> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __whoisleuthDeferredRuntime?: {
        longTaskSupported: boolean;
        longTaskCount: number;
        longTaskTotalMs: number;
        layoutShiftSupported: boolean;
        layoutShiftCount: number;
        layoutShiftScore: number;
        residualLayoutShiftCount: number;
        residualLayoutShiftScore: number;
      };
    };
    return {
      longTaskSupported: scope.__whoisleuthDeferredRuntime?.longTaskSupported ?? false,
      longTaskCount: scope.__whoisleuthDeferredRuntime?.longTaskCount ?? 0,
      longTaskTotalMs: Math.round((scope.__whoisleuthDeferredRuntime?.longTaskTotalMs ?? 0) * 100) / 100,
      layoutShiftSupported: scope.__whoisleuthDeferredRuntime?.layoutShiftSupported ?? false,
      layoutShiftCount: scope.__whoisleuthDeferredRuntime?.layoutShiftCount ?? 0,
      layoutShiftScore: Math.round((scope.__whoisleuthDeferredRuntime?.layoutShiftScore ?? 0) * 10_000) / 10_000,
      residualLayoutShiftCount: scope.__whoisleuthDeferredRuntime?.residualLayoutShiftCount ?? 0,
      residualLayoutShiftScore: Math.round((scope.__whoisleuthDeferredRuntime?.residualLayoutShiftScore ?? 0) * 10_000) / 10_000,
    };
  });
}

function isInvestigationEndpoint(request: Request): boolean {
  const url = new URL(request.url());
  if (url.origin !== ALLOWED_ORIGIN || !url.pathname.startsWith('/api/')) return false;
  return url.pathname !== '/api/session' && url.pathname !== '/api/capabilities';
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

async function beginInteractionProbe(page: Page) {
  await page.addInitScript(resetRuntimeProbe);
  await page.evaluate(resetRuntimeProbe);

  const session = await page.context().newCDPSession(page);
  const pendingAssets = new Set<string>();
  const investigationRequests: string[] = [];
  let assetEncodedTransferBytes = 0;
  let completedAssetRequestCount = 0;
  let active = true;

  const onRequest = (request: Request) => {
    if (!active || !isInvestigationEndpoint(request)) return;
    const url = new URL(request.url());
    investigationRequests.push(`${request.method()} ${url.pathname}`);
  };
  page.on('request', onRequest);

  session.on('Network.responseReceived', (payload) => {
    if (!active) return;
    const record = payload as unknown as Record<string, unknown>;
    const response = record.response as Record<string, unknown> | undefined;
    const url = typeof response?.url === 'string' ? response.url : '';
    const mimeType = typeof response?.mimeType === 'string' ? response.mimeType : '';
    const resourceType = typeof record.type === 'string' ? record.type : '';
    const requestId = typeof record.requestId === 'string' ? record.requestId : '';
    if (!requestId || !url) return;
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === ALLOWED_ORIGIN;
    } catch {
      return;
    }
    if (sameOrigin && (resourceType === 'Script'
      || resourceType === 'Stylesheet'
      || /(?:javascript|css)/iu.test(mimeType))) {
      pendingAssets.add(requestId);
    }
  });
  session.on('Network.loadingFinished', (payload) => {
    if (!active) return;
    const record = payload as unknown as Record<string, unknown>;
    const requestId = typeof record.requestId === 'string' ? record.requestId : '';
    if (!pendingAssets.delete(requestId)) return;
    const bytes = numberField(record.encodedDataLength);
    if (bytes === null) return;
    assetEncodedTransferBytes += bytes;
    completedAssetRequestCount += 1;
  });
  await session.send('Network.enable');

  async function close() {
    if (!active) return null;
    await page.evaluate(async () => {
      const scope = globalThis as typeof globalThis & {
        __whoisleuthDeferredRuntime?: {
          residualLayoutShiftCount: number;
          residualLayoutShiftScore: number;
          residualLayoutShiftActive: boolean;
        };
      };
      const runtime = scope.__whoisleuthDeferredRuntime;
      if (runtime) {
        runtime.residualLayoutShiftCount = 0;
        runtime.residualLayoutShiftScore = 0;
        runtime.residualLayoutShiftActive = true;
      }
      await new Promise<void>((resolve) => {
        let framesRemaining = 8;
        const observeNextFrame = () => {
          framesRemaining -= 1;
          if (framesRemaining === 0) resolve();
          else requestAnimationFrame(observeNextFrame);
        };
        requestAnimationFrame(observeNextFrame);
      });
      if (runtime) runtime.residualLayoutShiftActive = false;
    });
    const runtime = await readRuntimeProbe(page);
    active = false;
    page.off('request', onRequest);
    await session.detach();
    return {
      assetEncodedTransferBytes,
      completedAssetRequestCount,
      runtime,
      investigationRequests,
    };
  }

  async function abort() {
    if (!active) return;
    active = false;
    page.off('request', onRequest);
    await session.detach().catch(() => undefined);
  }

  return { close, abort };
}

type DeferredInteractionOptions = Readonly<{
  page: Page;
  testInfo: TestInfo;
  interaction: InteractionId;
  path: string;
  prepare: (sample: number) => Promise<void>;
  action: () => Promise<void>;
  ready: Locator;
  readyControl?: Locator;
  budget?: InteractionBudget;
  requireAsset?: boolean;
}>;

async function measureDeferredInteractionSample(
  options: DeferredInteractionOptions,
  sample: number,
): Promise<DeferredInteractionMeasurement> {
  const budget = options.budget ?? INTERACTION_BUDGETS[options.interaction];
  await options.page.waitForLoadState('networkidle');
  const probe = await beginInteractionProbe(options.page);
  const startedAt = performance.now();
  try {
    await options.action();
    await expect(options.ready, `${options.interaction} must render its deferred target`).toBeVisible();
    if (options.readyControl) {
      await expect(options.readyControl, `${options.interaction} must expose a usable control`).toBeVisible();
      await expect(options.readyControl).toBeEnabled();
    }
    const usableMs = round(performance.now() - startedAt);
    const captured = await probe.close();
    if (!captured) throw new Error(`The ${options.interaction} measurement probe closed before recording.`);
    const measurement: DeferredInteractionMeasurement = Object.freeze({
      schema: 'whoisleuth.deferred-interaction-measurement',
      version: 1,
      mode: 'authenticated_local_chromium_production_build',
      interaction: options.interaction,
      path: options.path,
      budget,
      assetEncodedTransferBytes: captured.assetEncodedTransferBytes,
      completedAssetRequestCount: captured.completedAssetRequestCount,
      usableMs,
      longTaskSupported: captured.runtime.longTaskSupported,
      longTaskCount: captured.runtime.longTaskCount,
      longTaskTotalMs: captured.runtime.longTaskTotalMs,
      layoutShiftSupported: captured.runtime.layoutShiftSupported,
      layoutShiftCount: captured.runtime.layoutShiftCount,
      layoutShiftScore: captured.runtime.layoutShiftScore,
      residualLayoutShiftCount: captured.runtime.residualLayoutShiftCount,
      residualLayoutShiftScore: captured.runtime.residualLayoutShiftScore,
      investigationRequestCount: captured.investigationRequests.length,
      limitations: Object.freeze([
        'This is a local production-build interaction measurement, not production latency.',
        'The desktop Chromium process does not represent all visitor hardware or network conditions.',
        'Transfer includes same-origin JavaScript and CSS completed after the explicit action.',
        'The Chromium run must expose long-task and layout-shift observers; zero means none were observed.',
        'Layout shift excludes entries associated with recent input, matching the browser CLS definition.',
        'Residual layout shift includes every entry during a short post-readiness stability window.',
        'Ceilings are reviewed regression limits derived from repeated clean local production-build runs with documented headroom.',
        'Wall-clock and long-task ceilings are enforced only by the single-worker performance-authority project.',
      ]),
    });
    const body = Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`, 'utf8');
    expect(body.byteLength, 'the attached measurement must remain bounded').toBeLessThan(16_384);
    await options.testInfo.attach(`deferred-interaction-${options.interaction}-sample-${sample}.json`, {
      body,
      contentType: 'application/json',
    });
    process.stdout.write(`Deferred interaction measurement: ${JSON.stringify(measurement)}\n`);

    if (options.requireAsset === false) {
      expect(measurement.completedAssetRequestCount, 'a preloaded or local interaction must not need another asset').toBe(0);
      expect(measurement.assetEncodedTransferBytes).toBe(0);
    } else {
      expect(measurement.completedAssetRequestCount, 'the deferred action must transfer a JavaScript or CSS asset').toBeGreaterThan(0);
      expect(measurement.assetEncodedTransferBytes).toBeGreaterThan(100);
    }
    expect(measurement.assetEncodedTransferBytes).toBeLessThanOrEqual(budget.assetEncodedTransferBytes);
    expect(measurement.usableMs).toBeGreaterThan(0);
    expect(measurement.longTaskSupported).toBe(true);
    expect(measurement.layoutShiftSupported).toBe(true);
    expect(measurement.layoutShiftScore).toBeLessThanOrEqual(budget.layoutShiftScore);
    expect(measurement.residualLayoutShiftScore).toBeLessThanOrEqual(budget.residualLayoutShiftScore);
    expect(captured.investigationRequests, 'module loading must not start an investigation or collection request').toEqual([]);
    return measurement;
  } catch (cause) {
    await probe.abort();
    throw cause;
  }
}

async function measureDeferredInteraction(options: DeferredInteractionOptions): Promise<DeferredInteractionSampleSet> {
  const budget = options.budget ?? INTERACTION_BUDGETS[options.interaction];
  const measurements: DeferredInteractionMeasurement[] = [];
  for (let sample = 1; sample <= PERFORMANCE_SAMPLE_COUNT; sample += 1) {
    await resetPerformanceSampleState(options.page);
    await options.prepare(sample);
    measurements.push(await measureDeferredInteractionSample(options, sample));
  }
  const sampleSet: DeferredInteractionSampleSet = Object.freeze({
    schema: 'whoisleuth.deferred-interaction-sample-set',
    version: 1,
    mode: 'authenticated_local_chromium_repeated_interaction',
    interaction: options.interaction,
    path: options.path,
    budget,
    sampleCount: measurements.length,
    usableMsMedian: performanceSampleMedian(measurements.map((measurement) => measurement.usableMs)),
    usableMsMaximum: Math.max(...measurements.map((measurement) => measurement.usableMs)),
    longTaskTotalMsMedian: performanceSampleMedian(measurements.map((measurement) => measurement.longTaskTotalMs)),
    longTaskTotalMsMaximum: Math.max(...measurements.map((measurement) => measurement.longTaskTotalMs)),
    samples: Object.freeze([...measurements]),
    limitations: Object.freeze([
      'The median of three independently cache-cleared, browser-local-state-cleared samples is the machine timing authority.',
      'Samples share one Chromium and local server process; this reduces scheduler noise and is not a first-process cold-start claim.',
      'Every sample remains subject to transfer, request and layout ceilings, and a two-times timing ceiling rejects severe transient regressions.',
    ]),
  });
  const body = Buffer.from(`${JSON.stringify(sampleSet, null, 2)}\n`, 'utf8');
  expect(body.byteLength, 'the attached interaction sample set must remain bounded').toBeLessThan(32_768);
  await options.testInfo.attach(`deferred-interaction-${options.interaction}-samples.json`, {
    body,
    contentType: 'application/json',
  });
  process.stdout.write(`Deferred interaction sample set: ${JSON.stringify(sampleSet)}\n`);

  // Shared hosted runners cannot provide a stable CPU scheduling authority.
  // Transfer, request and layout gates remain blocking in every project.
  if (enforcesMachineTimingBudgets(options.testInfo.project.name)) {
    expect(sampleSet.usableMsMedian).toBeLessThanOrEqual(budget.usableMs);
    expect(sampleSet.longTaskTotalMsMedian).toBeLessThanOrEqual(budget.longTaskTotalMs);
    expect(sampleSet.usableMsMaximum).toBeLessThanOrEqual(
      budget.usableMs * PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER,
    );
    expect(sampleSet.longTaskTotalMsMaximum).toBeLessThanOrEqual(
      budget.longTaskTotalMs * PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER,
    );
  }
  return sampleSet;
}

function brandProfileFixture() {
  return {
    id: 'deferred-profile',
    name: 'Deferred workbench fixture',
    officialDomains: ['official.example.test'],
    productNames: ['Example product'],
    tlds: ['test'],
    approvedPartnerDomains: ['partner.example.test'],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  };
}

function lookupResponse(target: string) {
  return {
    query: target,
    inputHostname: target,
    type: 'domain',
    registrableDomain: 'example.test',
    isSubdomain: true,
    availability: {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      domain: 'example.test',
      dnssec: 'unknown',
      dns: {
        status: 'partial',
        source: 'dns',
        scanMode: 'deep',
        complete: false,
        truncated: false,
        records: {
          a: ['192.0.2.10'],
          aaaa: [],
          cname: [],
          ns: ['ns1.example.test'],
          mx: [],
          spf: [],
          dmarc: [],
          caa: [],
          soa: [],
          https: [],
        },
        diagnostics: {
          a: { status: 'success' },
          aaaa: { status: 'success' },
          cname: { status: 'error', error: 'fixture resolver timeout' },
          ns: { status: 'success' },
        },
      },
    },
    rdap: { upstreamStatus: 200, parsed: {} },
    whois: { parsed: {}, chain: [] },
    diagnostics: {
      version: 7,
      rdap: { status: 'complete' },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}

function bulkResponse(target: string) {
  return {
    query: target,
    type: 'domain',
    registrableDomain: target,
    availability: {
      applicable: true,
      domain: target,
      state: 'registered',
      confidence: 'high',
    },
    diagnostics: {
      version: 7,
      rdap: { status: 'complete' },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}

test('measures a deferred public CLI command detail without collection', async ({ page }, testInfo) => {
  const command = page.locator('article[data-command="commands"]');
  const disclosure = command.locator(':scope > .command-row > button');
  const detail = command.locator('.command-detail');

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'cli_command_detail',
    path: '/cli',
    prepare: async () => {
      await page.goto('/cli');
      await expect(detail).toHaveCount(0);
    },
    action: async () => {
      await disclosure.focus();
      await page.keyboard.press('Enter');
    },
    ready: detail,
    readyControl: disclosure,
    requireAsset: false,
  });
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expectNoHorizontalOverflow(page);
});

test('measures request-free local filtering of the public CLI catalogue', async ({ page }, testInfo) => {
  const search = page.getByRole('searchbox', { name: 'Search commands' });
  const workflowPlan = page.locator('article[data-command="workflow-plan"]');
  const filteredStatus = page.getByRole('status').filter({ hasText: `Showing 1 of ${CLI_COMMANDS.length} commands.` });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'cli_catalogue_filter',
    path: '/cli',
    prepare: async () => {
      await page.goto('/cli');
      await search.fill('workflow-');
      await expect(page.getByRole('status')).toContainText(`Showing 2 of ${CLI_COMMANDS.length} commands.`);
      await search.focus();
    },
    action: async () => {
      await page.keyboard.press('p');
    },
    ready: filteredStatus,
    readyControl: workflowPlan.locator(':scope > .command-row > button'),
    requireAsset: false,
  });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('workflow-p');
  await expectNoHorizontalOverflow(page);
});

test('measures a deferred large synthetic public example without collection', async ({ page }, testInfo) => {
  const example = page.locator('article[data-example="case-handoff"]');
  const disclosure = example.locator(':scope > button');
  const output = example.getByRole('textbox', { name: 'Reviewed public Case handoff synthetic output' });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'examples_large_output',
    path: '/examples',
    prepare: async () => {
      await page.goto('/examples');
      await expect(output).toHaveCount(0);
    },
    action: async () => {
      await disclosure.focus();
      await page.keyboard.press('Enter');
    },
    ready: output,
    readyControl: example.getByRole('button', { name: 'Download example' }),
  });
  await expect(disclosure).toBeFocused();
  await expect(output).toHaveValue(/Synthetic reserved-domain example\./u);
  await expectNoHorizontalOverflow(page);
});

test('measures a later fictional demo stage without opening production storage', async ({ page }, testInfo) => {
  const start = page.getByRole('button', { name: 'Begin with Brands' });
  const heading = page.getByRole('heading', { name: 'Define the official identity' });
  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'demo_later_stage',
    path: '/demo',
    prepare: async () => {
      await page.goto('/demo');
      await expect(page.getByRole('heading', { name: 'Choose a focused investigation task' })).toBeVisible();
      await expect(heading).toHaveCount(0);
      expect(await page.evaluate(async () => (await indexedDB.databases())
        .some((database) => database.name === 'whoisleuth-browser-data-v1'))).toBe(false);
    },
    action: () => start.click(),
    ready: heading,
    readyControl: page.getByRole('button', { name: 'Use synthetic profile' }),
  });
  await expect(heading).toBeFocused();
  expect(await page.evaluate(async () => (await indexedDB.databases())
    .some((database) => database.name === 'whoisleuth-browser-data-v1'))).toBe(false);
  await expectNoHorizontalOverflow(page);
});

test('measures navigation to a non-default Monitor view', async ({ page }, testInfo) => {
  const relationshipWorkspace = page.getByRole('region', { name: 'Relationship workspace' });
  const selectedTab = page.getByRole('tab', { name: /^Relationships\b/u });
  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'monitor_relationships_view',
    path: '/monitor',
    prepare: async () => {
      await page.goto('/monitor');
      await expect(relationshipWorkspace).toHaveCount(0);
    },
    action: async () => {
      await selectedTab.click();
    },
    ready: relationshipWorkspace,
    readyControl: selectedTab,
  });
  await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#monitor-view-panel')).toHaveAttribute('aria-labelledby', 'tab-relationships');
  await expect(page).toHaveURL(/\/monitor\?view=relationships$/u);
  await expectNoHorizontalOverflow(page);
});

test('measures a deferred Brand Profile tool with a fictional active profile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const workbench = page.locator('#brand-workbench');
  const heading = page.getByRole('heading', { name: 'Owned-domain comparison' });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'brands_portfolio_workbench',
    path: '/brands',
    prepare: async () => {
      await migrateLegacyBrowserData(page, {
        [PROFILES_KEY]: currentBrandProfileBrowserStore([brandProfileFixture()]),
        [ACTIVE_PROFILE_KEY]: 'deferred-profile',
      }, { clearStorage: true, destination: '/brands' });
      await expect(workbench).toBeEnabled();
      await expect(heading).toHaveCount(0);
    },
    action: async () => {
      await workbench.selectOption('portfolio');
    },
    ready: heading,
    readyControl: workbench,
  });
  await expect(page).toHaveURL(/\/brands\?workbench=portfolio$/u);
  await expectNoHorizontalOverflow(page);
});

test('measures a deferred Bulk cohort-analysis workspace after collection completes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route('**/api/lookup?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('q') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bulkResponse(target)),
    });
  });
  const outlierHeading = page.getByRole('heading', { name: 'Local cohort outliers' });
  const resultViews = page.getByRole('group', { name: 'Bulk result view' });
  const analysisView = resultViews.getByRole('button', { name: 'Analysis', exact: true });
  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'bulk_cohort_outliers',
    path: '/bulk',
    prepare: async () => {
      await page.goto('/bulk');
      await page.locator('#domains').fill(['alpha.test', 'beta.test', 'gamma.test'].join('\n'));
      await page.getByRole('button', { name: 'Scan 3 domains' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Completed 3 of 3 lookups.' })).toBeVisible();
      await expect(page.locator('.results-table tbody tr')).toHaveCount(3);
      await expect(outlierHeading).toHaveCount(0);
    },
    action: async () => {
      await analysisView.click();
      await page.getByRole('button', { name: /Cohort outliers/u }).click();
    },
    ready: outlierHeading,
    readyControl: page.getByRole('button', { name: /Cohort outliers/u }),
  });
  await expect(analysisView).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
});

test('measures a deferred Lookup evidence family from deterministic fixture evidence', async ({ page }, testInfo) => {
  const target = 'evidence.example.test';
  await page.route('**/api/lookup?*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(lookupResponse(target)),
  }));
  const familyToggle = page.locator('#web-evidence > button.family-summary');
  const dnsHeading = page.locator('#evidence-dns .dns-card').getByRole('heading', { name: 'DNS evidence' });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'lookup_dns_evidence',
    path: '/lookup',
    prepare: async () => {
      await page.goto('/lookup');
      await page.locator('#query').fill(target);
      await page.getByRole('button', { name: 'Run lookup' }).click();
      await expect(familyToggle).toBeEnabled();
      await expect(familyToggle).toHaveAttribute('aria-label', 'Expand Web and DNS evidence');
      await expect(dnsHeading).toHaveCount(0);
    },
    action: async () => {
      await familyToggle.focus();
      await page.keyboard.press('Enter');
    },
    ready: dnsHeading,
    readyControl: page.locator('#evidence-dns .dns-card > summary'),
  });
  await expect(familyToggle).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('measures the deferred Case response and packet workspace', async ({ page }, testInfo) => {
  const caseId = 'deferred-response-case';
  const caseHeading = page.locator(`#case-head-${caseId}`);
  const disclosure = page.locator(`#case-response-${caseId}`);
  const summary = disclosure.locator(':scope > summary');
  const advancedPresentation = disclosure.getByRole('button', { name: 'Advanced', exact: true });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'case_response_packet',
    path: '/monitor',
    prepare: async () => {
      await migrateLegacyBrowserData(page, {
        [CASES_KEY]: {
          version: CASE_SCHEMA_VERSION,
          cases: [caseRecord({ id: caseId, domain: 'response.example.test' })],
        },
      }, { clearStorage: true, destination: '/monitor?view=cases' });
      await expect(caseHeading).toBeVisible();
      await caseHeading.click();
      await expect(disclosure).toBeVisible();
      await expect(disclosure.locator('.response-workspace')).toHaveCount(0);
    },
    action: async () => {
      await summary.focus();
      await page.keyboard.press('Enter');
    },
    ready: disclosure.locator('.response-workspace'),
    readyControl: advancedPresentation,
    requireAsset: false,
  });
  await expect(disclosure).toHaveAttribute('open', '');
  await expectNoHorizontalOverflow(page);
});

test('measures command navigation and preserves shortcut focus recovery', async ({ page }, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Open console navigation' });
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  const search = page.getByRole('combobox', { name: 'Search pages and tools' });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'dashboard_command_palette',
    path: '/dashboard',
    prepare: async () => {
      await page.goto('/dashboard');
      await expect(trigger).toBeEnabled();
      await expect(dialog).toHaveCount(0);
    },
    action: () => page.keyboard.press('Control+K'),
    ready: dialog,
    readyControl: search,
    requireAsset: false,
  });
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
