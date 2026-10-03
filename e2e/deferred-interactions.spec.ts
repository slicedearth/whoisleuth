import { performance } from 'node:perf_hooks';
import type { Locator, Page, Request, TestInfo } from '@playwright/test';
import { CLI_COMMANDS } from '../cli/command-reference.mts';
import { ALLOWED_ORIGIN, expect, test } from './fixtures';
import { caseRecord } from './case-test-fixtures';
import { COMMAND_NAVIGATION_READINESS } from './console-navigation';
import { currentBrandProfileBrowserStore, expectNoHorizontalOverflow, migrateLegacyBrowserData } from './helpers';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import {
  PERFORMANCE_SAMPLE_COUNT,
  PERFORMANCE_TIMING_POLICY,
  abortBrowserInteractionReadiness,
  beginBrowserInteractionReadiness,
  beginInteractionTransferProbe,
  performanceMeasurementContext,
  performanceSampleMedian,
  summarizePerformanceTimings,
  readBrowserInteractionReadiness,
  readInteractionRuntimeProbe,
  resetInteractionRuntimeProbe,
  resetPerformanceSampleState,
  type BrowserInteractionReadiness,
  type PerformanceMeasurementContext,
} from './performance-sampling.ts';

type InteractionId =
  | 'cli_command_detail'
  | 'cli_catalogue_filter'
  | 'examples_large_output'
  | 'demo_later_stage'
  | 'monitor_relationships_view'
  | 'brands_portfolio_workbench'
  | 'bulk_analysis_transition'
  | 'bulk_cohort_outliers'
  | 'lookup_dns_evidence'
  | 'case_workspace_open'
  | 'case_response_section'
  | 'dashboard_command_palette';

type InteractionBudget = Readonly<{
  residualLayoutShiftScore: number;
}>;
type TransferPolicy = 'observational' | 'prepared_no_transfer';

type DeferredInteractionMeasurement = Readonly<{
  schema: 'whoisleuth.deferred-interaction-measurement';
  version: 4;
  mode: 'authenticated_local_chromium_production_build';
  readinessClock: 'browser_event_to_animation_frame';
  interaction: InteractionId;
  path: string;
  readyPresentation: 'visible_usable' | 'attached_hidden';
  budget: InteractionBudget;
  transferPolicy: TransferPolicy;
  timingPolicy: typeof PERFORMANCE_TIMING_POLICY;
  execution: PerformanceMeasurementContext;
  assetEncodedTransferBytes: number;
  completedAssetRequestCount: number;
  usableMs: number;
  hostActionMs: number;
  longTaskSupported: boolean;
  longTaskCount: number;
  longTaskTotalMs: number;
  layoutShiftSupported: boolean;
  layoutShiftCount: number;
  layoutShiftScore: number;
  transitionLayoutShiftCount: number;
  transitionLayoutShiftScore: number;
  residualLayoutShiftCount: number;
  residualLayoutShiftScore: number;
  investigationRequestCount: number;
  limitations: readonly string[];
}>;

type DeferredInteractionSampleSet = Readonly<{
  schema: 'whoisleuth.deferred-interaction-sample-set';
  version: 4;
  mode: 'authenticated_local_chromium_repeated_interaction';
  interaction: InteractionId;
  path: string;
  readyPresentation: 'visible_usable' | 'attached_hidden';
  budget: InteractionBudget;
  transferPolicy: TransferPolicy;
  timingPolicy: typeof PERFORMANCE_TIMING_POLICY;
  execution: PerformanceMeasurementContext;
  sampleCount: number;
  usableMsMedian: number;
  usableMsMaximum: number;
  hostActionMsMedian: number;
  hostActionMsMaximum: number;
  assetEncodedTransferBytesMedian: number;
  assetEncodedTransferBytesMaximum: number;
  longTaskTotalMsMedian: number;
  longTaskTotalMsMaximum: number;
  samples: readonly DeferredInteractionMeasurement[];
  limitations: readonly string[];
}>;

// Browser event-to-frame marks
// exclude host command, keyboard-dispatch and assertion-polling time.
// The CLI filter row measures one real keyboard refinement after a prefilled
// multi-result query. That keeps the browser recent-input semantics while
// excluding artificial driver time for a no-delay multi-character sequence.
// Case selection ends when its Summary and section navigation are usable.
// Response navigation is separate and ends when its response controls are usable.
// Bulk Analysis likewise owns a separate transition/preload row before the
// cohort-outlier disclosure is measured. Each phase keeps its own observations.
// Prepared interactions require zero new assets, declared by each scenario's
// requireAsset option. Deferred transfer is reported, not compared with an old
// bundle size. Movement after usable paint remains bounded independently.
const INTERACTION_LAYOUT_BUDGET: InteractionBudget = Object.freeze({ residualLayoutShiftScore: 0.01 });

const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
const CASES_KEY = 'whois-rdap-cases-v1';
const FIXTURE_TIME = '2026-08-23T00:00:00.000Z';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isInvestigationEndpoint(request: Request): boolean {
  const url = new URL(request.url());
  if (url.origin !== ALLOWED_ORIGIN || !url.pathname.startsWith('/api/')) return false;
  return url.pathname !== '/api/session' && url.pathname !== '/api/capabilities';
}

async function beginInteractionProbe(page: Page) {
  await page.addInitScript(resetInteractionRuntimeProbe);
  await page.evaluate(resetInteractionRuntimeProbe);

  const transfer = await beginInteractionTransferProbe(page);
  const investigationRequests: string[] = [];
  let active = true;

  const onRequest = (request: Request) => {
    if (!active || !isInvestigationEndpoint(request)) return;
    const url = new URL(request.url());
    investigationRequests.push(`${request.method()} ${url.pathname}`);
  };
  page.on('request', onRequest);

  async function close() {
    if (!active) return null;
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let framesRemaining = 8;
        const observeNextFrame = () => {
          framesRemaining -= 1;
          if (framesRemaining === 0) resolve();
          else requestAnimationFrame(observeNextFrame);
        };
        requestAnimationFrame(observeNextFrame);
      });
    });
    const runtime = await readInteractionRuntimeProbe(page);
    active = false;
    page.off('request', onRequest);
    return {
      ...await transfer.close(),
      runtime,
      investigationRequests,
    };
  }

  async function abort() {
    if (!active) return;
    active = false;
    page.off('request', onRequest);
    await transfer.close().catch(() => undefined);
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
  browserReadiness: BrowserInteractionReadiness;
  ready: Locator;
  readyControl?: Locator;
  readyPresentation?: 'visible_usable' | 'attached_hidden';
  requireAsset?: boolean;
}>;

async function measureDeferredInteractionSample(
  options: DeferredInteractionOptions,
  sample: number,
): Promise<DeferredInteractionMeasurement> {
  const budget = INTERACTION_LAYOUT_BUDGET;
  const readyPresentation = options.readyPresentation ?? 'visible_usable';
  await options.page.waitForLoadState('networkidle');
  await beginBrowserInteractionReadiness(options.page, options.browserReadiness);
  const probe = await beginInteractionProbe(options.page);
  try {
    const hostStartedAt = performance.now();
    await options.action();
    const hostActionMs = round(performance.now() - hostStartedAt);
    const { browserReadyMs: usableMs } = await readBrowserInteractionReadiness(options.page);
    if (readyPresentation === 'attached_hidden') {
      await expect(options.ready, `${options.interaction} must prepare its deferred target`).toBeAttached();
      await expect(options.ready, `${options.interaction} must keep its prepared target inside the closed disclosure`).toBeHidden();
    } else {
      await expect(options.ready, `${options.interaction} must render its deferred target`).toBeVisible();
    }
    if (options.readyControl) {
      await expect(options.readyControl, `${options.interaction} must expose a usable control`).toBeVisible();
      await expect(options.readyControl).toBeEnabled();
    }
    const captured = await probe.close();
    if (!captured) throw new Error(`The ${options.interaction} measurement probe closed before recording.`);
    const measurement: DeferredInteractionMeasurement = Object.freeze({
      schema: 'whoisleuth.deferred-interaction-measurement',
      version: 4,
      mode: 'authenticated_local_chromium_production_build',
      readinessClock: 'browser_event_to_animation_frame',
      interaction: options.interaction,
      path: options.path,
      readyPresentation,
      budget,
      transferPolicy: options.requireAsset === false ? 'prepared_no_transfer' : 'observational',
      timingPolicy: PERFORMANCE_TIMING_POLICY,
      execution: performanceMeasurementContext(options.page, options.testInfo),
      assetEncodedTransferBytes: captured.assetEncodedTransferBytes,
      completedAssetRequestCount: captured.completedAssetRequestCount,
      usableMs,
      hostActionMs,
      longTaskSupported: captured.runtime.longTaskSupported,
      longTaskCount: captured.runtime.longTaskCount,
      longTaskTotalMs: captured.runtime.longTaskTotalMs,
      layoutShiftSupported: captured.runtime.layoutShiftSupported,
      layoutShiftCount: captured.runtime.layoutShiftCount,
      layoutShiftScore: captured.runtime.layoutShiftScore,
      transitionLayoutShiftCount: captured.runtime.transitionLayoutShiftCount,
      transitionLayoutShiftScore: captured.runtime.transitionLayoutShiftScore,
      residualLayoutShiftCount: captured.runtime.residualLayoutShiftCount,
      residualLayoutShiftScore: captured.runtime.residualLayoutShiftScore,
      investigationRequestCount: captured.investigationRequests.length,
      limitations: Object.freeze([
        'This is a local production-build interaction measurement, not production latency.',
        'The desktop Chromium process does not represent all visitor hardware or network conditions.',
        'Usable time starts at the triggering browser event and ends when the declared targets remain ready after their first usable animation frame has painted.',
        readyPresentation === 'attached_hidden'
          ? 'This phase is ready when its target is attached inside a deliberately closed disclosure; the target is prepared but not yet visible or usable.'
          : 'This phase is ready only when its target and declared control are visible and usable.',
        'Host command, keyboard dispatch and assertion-polling duration is excluded from usable time; host action duration is retained separately as diagnostic context.',
        'Transfer includes same-origin JavaScript and CSS completed after the explicit action.',
        'The Chromium run must expose long-task and layout-shift observers; zero means none were observed.',
        'Layout shift excludes entries associated with recent input, matching the browser CLS definition.',
        'Transition layout shift includes every entry between input and browser-owned readiness. It reports expansion and other transition movement without a recent-input exemption or acceptance ceiling.',
        'Residual layout shift includes every entry from browser-owned usable readiness through eight observation frames, including movement before host assertions complete.',
        'Prepared interactions must transfer no new assets. Deferred transfer is measured without historical byte ceilings; post-readiness layout and investigation-request checks remain blocking.',
        'Elapsed time and long-task duration are observations for the recorded execution context, not universal performance guarantees or CI timing thresholds.',
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
      expect(measurement.assetEncodedTransferBytes).toBeGreaterThan(0);
    }
    expect(measurement.usableMs).toBeGreaterThan(0);
    expect(measurement.longTaskSupported).toBe(true);
    expect(measurement.layoutShiftSupported).toBe(true);
    expect(measurement.residualLayoutShiftScore).toBeLessThanOrEqual(budget.residualLayoutShiftScore);
    expect(captured.investigationRequests, 'module loading must not start an investigation or collection request').toEqual([]);
    return measurement;
  } catch (cause) {
    await abortBrowserInteractionReadiness(options.page);
    await probe.abort();
    throw cause;
  }
}

async function measureDeferredInteraction(options: DeferredInteractionOptions): Promise<DeferredInteractionSampleSet> {
  const budget = INTERACTION_LAYOUT_BUDGET;
  const readyPresentation = options.readyPresentation ?? 'visible_usable';
  const measurements: DeferredInteractionMeasurement[] = [];
  for (let sample = 1; sample <= PERFORMANCE_SAMPLE_COUNT; sample += 1) {
    await resetPerformanceSampleState(options.page);
    await options.prepare(sample);
    measurements.push(await measureDeferredInteractionSample(options, sample));
  }
  const sampleSet: DeferredInteractionSampleSet = Object.freeze({
    schema: 'whoisleuth.deferred-interaction-sample-set',
    version: 4,
    mode: 'authenticated_local_chromium_repeated_interaction',
    interaction: options.interaction,
    path: options.path,
    readyPresentation,
    budget,
    transferPolicy: options.requireAsset === false ? 'prepared_no_transfer' : 'observational',
    timingPolicy: PERFORMANCE_TIMING_POLICY,
    execution: performanceMeasurementContext(options.page, options.testInfo),
    sampleCount: measurements.length,
    ...summarizePerformanceTimings(measurements),
    hostActionMsMedian: performanceSampleMedian(measurements.map((measurement) => measurement.hostActionMs)),
    hostActionMsMaximum: Math.max(...measurements.map((measurement) => measurement.hostActionMs)),
    assetEncodedTransferBytesMedian: performanceSampleMedian(measurements.map((measurement) => measurement.assetEncodedTransferBytes)),
    assetEncodedTransferBytesMaximum: Math.max(...measurements.map((measurement) => measurement.assetEncodedTransferBytes)),
    samples: Object.freeze([...measurements]),
    limitations: Object.freeze([
      'Three independently cache-cleared, browser-local-state-cleared samples retain their median and maximum for performance review.',
      'Samples share one Chromium and local server process; this reduces scheduler noise and is not a first-process cold-start claim.',
      'Browser-visible readiness and host action duration remain separate observations; neither is converted into a host-derived acceptance limit.',
      'Compare repeated runs of the same workload under comparable conditions before attributing a timing difference to a code change.',
      'Every sample remains subject to functional readiness, transfer, request and layout checks, and the bounded test timeout still rejects hangs.',
    ]),
  });
  const body = Buffer.from(`${JSON.stringify(sampleSet, null, 2)}\n`, 'utf8');
  expect(body.byteLength, 'the attached interaction sample set must remain bounded').toBeLessThan(32_768);
  await options.testInfo.attach(`deferred-interaction-${options.interaction}-samples.json`, {
    body,
    contentType: 'application/json',
  });
  process.stdout.write(`Deferred interaction sample set: ${JSON.stringify(sampleSet)}\n`);

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

async function installBulkLookupFixture(page: Page): Promise<void> {
  await page.route('**/api/lookup?*', async (route) => {
    const target = new URL(route.request().url()).searchParams.get('q') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(bulkResponse(target)),
    });
  });
}

async function prepareBulkResults(page: Page): Promise<void> {
  await page.goto('/bulk');
  await page.locator('#domains').fill(['alpha.test', 'beta.test', 'gamma.test'].join('\n'));
  await page.getByRole('button', { name: 'Scan 3 domains' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed 3 of 3 lookups.' })).toBeVisible();
  await expect(page.locator('.results-table tbody tr')).toHaveCount(3);
}

async function prepareCaseResponseFixture(page: Page, caseId: string): Promise<void> {
  await migrateLegacyBrowserData(page, {
    [CASES_KEY]: {
      version: CASE_SCHEMA_VERSION,
      cases: [caseRecord({ id: caseId, domain: 'response.example.test' })],
    },
  }, { clearStorage: true, destination: '/cases' });
  await expect(page.locator(`#case-head-${caseId}`)).toBeVisible();
}

test('measures a deferred public CLI command detail without collection', async ({ page }, testInfo) => {
  const command = page.locator('article[data-command="commands"]');
  const open = command.locator(':scope > .command-row > button');
  const workspace = page.locator('article[data-command-detail="commands"]');
  const detail = workspace.locator('.command-detail');

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
      await open.focus();
      await page.keyboard.press('Enter');
    },
    browserReadiness: {
      start: { event: 'click', selector: 'article[data-command="commands"] .command-row > button' },
      targets: [
        { selector: '#command-detail-commands' },
        { selector: 'article[data-command-detail="commands"] .back-to-results', requireEnabled: true },
      ],
    },
    ready: detail,
    readyControl: workspace.getByRole('link', { name: /Back to/u }),
    requireAsset: false,
  });
  await expect(workspace).toBeFocused();
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
    browserReadiness: {
      start: { event: 'input', selector: '.filters input[type="search"]' },
      targets: [
        { selector: '.filter-status', exactText: `Showing 1 of ${CLI_COMMANDS.length} commands.` },
        { selector: 'article[data-command="workflow-plan"] .command-row > button', requireEnabled: true },
      ],
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
  const output = example.getByRole('textbox', { name: 'Importable public Case handoff synthetic output' });

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
    browserReadiness: {
      start: { event: 'click', selector: 'article[data-example="case-handoff"] > button' },
      targets: [
        { selector: '[aria-label="Importable public Case handoff synthetic output"]' },
        { selector: 'article[data-example="case-handoff"] .output-actions button', requireEnabled: true },
      ],
    },
    ready: output,
    readyControl: example.getByRole('button', { name: 'Download example' }),
  });
  await expect(disclosure).toBeFocused();
  await expect(output).toHaveValue(/"schema": "whoisleuth\.cli\.case-pack"/u);
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
    browserReadiness: {
      start: { event: 'click', selector: '#demo-workspace button' },
      targets: [
        { selector: '#brand-heading', exactText: 'Define the official identity' },
        { selector: '#demo-workspace .profile-handoff button', requireEnabled: true },
      ],
    },
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
    browserReadiness: {
      start: { event: 'click', selector: '#tab-relationships' },
      targets: [
        { selector: '#monitor-view-panel[aria-labelledby="tab-relationships"] .case-relationship-workspace' },
        { selector: '.profile-clusters' },
        { selector: '.retained-observations' },
        { selector: '.cluster-workspace' },
      ],
    },
    ready: relationshipWorkspace,
    readyControl: relationshipWorkspace.getByRole('combobox', { name: 'Relationship', exact: true }),
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
      await page.getByRole('tab', { name: 'Tools', exact: true }).click();
      await expect(workbench).toBeEnabled();
      await expect(heading).toHaveCount(0);
    },
    action: async () => {
      await workbench.selectOption('portfolio');
    },
    browserReadiness: {
      start: { event: 'change', selector: '#brand-workbench' },
      targets: [
        { selector: '#portfolio-posture-matrix-title', exactText: 'Owned-domain comparison' },
        { selector: '#brand-workbench', requireEnabled: true },
      ],
    },
    ready: heading,
    readyControl: workbench,
  });
  await expect(page).toHaveURL(/\/brands\?workbench=portfolio$/u);
  await expectNoHorizontalOverflow(page);
});

test('measures the Bulk Analysis transition and its deferred preload after collection completes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installBulkLookupFixture(page);
  const resultViews = page.getByRole('group', { name: 'Bulk result view' });
  const analysisView = resultViews.getByRole('button', { name: 'Analysis', exact: true });
  const analysisPanel = page.locator('#bulk-analysis-panel');
  const cohortToggle = analysisPanel.getByRole('button', { name: /Cohort outliers/u });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'bulk_analysis_transition',
    path: '/bulk',
    prepare: async () => {
      await prepareBulkResults(page);
      await expect(analysisView).toHaveAttribute('aria-pressed', 'false');
      await expect(analysisPanel).toBeHidden();
      await page.mouse.move(0, 0);
    },
    action: () => analysisView.click(),
    browserReadiness: {
      // The click's real pointer approach owns the preload, so the browser
      // interval starts before the component imports rather than at onclick.
      start: {
        event: 'pointerover',
        selector: '.mobile-result-switcher button[aria-controls="bulk-analysis-panel"]',
      },
      targets: [
        { selector: '#bulk-analysis-panel.mobile-view-active[data-analysis-preload-ready="true"]' },
        {
          selector: '.mobile-result-switcher button[aria-controls="bulk-analysis-panel"][aria-pressed="true"]',
          requireEnabled: true,
        },
      ],
    },
    ready: analysisPanel,
    readyControl: cohortToggle,
  });
  await expect(analysisView).toHaveAttribute('aria-pressed', 'true');
  await expect(analysisPanel).toHaveAttribute('data-analysis-preload-ready', 'true');
  await expectNoHorizontalOverflow(page);
});

test('measures the prepared Bulk cohort-analysis disclosure after collection completes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await installBulkLookupFixture(page);
  const outlierHeading = page.getByRole('heading', { name: 'Local cohort outliers' });
  const resultViews = page.getByRole('group', { name: 'Bulk result view' });
  const analysisView = resultViews.getByRole('button', { name: 'Analysis', exact: true });
  const analysisPanel = page.locator('#bulk-analysis-panel');
  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'bulk_cohort_outliers',
    path: '/bulk',
    prepare: async () => {
      await prepareBulkResults(page);
      // The separately measured Analysis transition owns its best-effort
      // preload. This row deliberately measures only the prepared disclosure.
      await analysisView.click();
      await expect(analysisView).toHaveAttribute('aria-pressed', 'true');
      await expect(analysisPanel).toHaveAttribute('data-analysis-preload-ready', 'true');
      await expect(outlierHeading).toHaveCount(0);
    },
    action: async () => {
      await page.getByRole('button', { name: /Cohort outliers/u }).click();
    },
    browserReadiness: {
      start: { event: 'click', selector: '#bulk-analysis-panel .mobile-disclosure-toggle' },
      targets: [
        { selector: '#bulk-outlier-title', exactText: 'Local cohort outliers' },
        { selector: '#bulk-analysis-panel .mobile-disclosure-content' },
      ],
    },
    ready: outlierHeading,
    readyControl: page.getByRole('button', { name: /Cohort outliers/u }),
    requireAsset: false,
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
      await expect(familyToggle).toHaveAttribute('aria-label', 'Expand details: Web and DNS evidence');
      await expect(dnsHeading).toHaveCount(0);
    },
    action: async () => {
      await familyToggle.focus();
      await page.keyboard.press('Enter');
    },
    browserReadiness: {
      start: { event: 'click', selector: '#web-evidence > button.family-summary' },
      targets: [
        { selector: '#evidence-dns .dns-card' },
        { selector: '#evidence-dns .dns-card > summary' },
      ],
    },
    ready: dnsHeading,
    readyControl: page.locator('#evidence-dns .dns-card > summary'),
  });
  await expect(familyToggle).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test('measures Case selection through a usable Summary and section navigation', async ({ page }, testInfo) => {
  const caseId = 'deferred-preparation-case';
  const caseHeading = page.locator(`#case-head-${caseId}`);
  const detail = page.locator(`[data-case-detail="${caseId}"]`);
  const sectionLink = detail.getByRole('link', { name: 'Evidence', exact: true });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'case_workspace_open',
    path: '/cases',
    prepare: async () => {
      await prepareCaseResponseFixture(page, caseId);
      await expect(detail).toHaveCount(0);
    },
    action: async () => {
      await caseHeading.focus();
      await page.keyboard.press('Enter');
    },
    browserReadiness: {
      start: { event: 'click', selector: `#case-head-${caseId}` },
      targets: [
        { selector: `[data-case-detail="${caseId}"]` },
        { selector: '.case-sections a[aria-current="page"]' },
        { selector: '.case-sections a[href$="section=evidence"]', requireEnabled: true },
        { selector: '[aria-label="Retained Case records"]' },
      ],
    },
    ready: detail,
    readyControl: sectionLink,
    requireAsset: false,
  });
  await expect(page.getByRole('region', { name: 'Saved Cases', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('link', { name: 'Summary', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);
});

test('measures Case Response section activation through usable response controls', async ({ page }, testInfo) => {
  const caseId = 'deferred-response-case';
  const caseHeading = page.locator(`#case-head-${caseId}`);
  const detail = page.locator(`[data-case-detail="${caseId}"]`);
  const responseLink = detail.getByRole('navigation', { name: 'Case sections' }).getByRole('link', { name: 'Response', exact: true });
  const actions = detail.getByRole('region', { name: 'Case response actions', exact: true });
  const recipient = actions.getByRole('textbox', { name: 'Recipient or owner', exact: true });

  await measureDeferredInteraction({
    page,
    testInfo,
    interaction: 'case_response_section',
    path: '/cases',
    prepare: async () => {
      await prepareCaseResponseFixture(page, caseId);
      await expect(detail).toHaveCount(0);
      await caseHeading.click();
      await expect(responseLink).toBeVisible();
      await expect(detail.getByRole('region', { name: 'Case response actions', exact: true, includeHidden: true })).toBeHidden();
    },
    action: async () => {
      await responseLink.focus();
      await page.keyboard.press('Enter');
    },
    browserReadiness: {
      start: { event: 'click', selector: '.case-sections a[href$="section=response"]' },
      targets: [
        { selector: '#case-response-decision-deferred-response-case' },
        { selector: '#case-response-decision-deferred-response-case input[required][maxlength="320"]', requireEnabled: true },
      ],
    },
    ready: actions,
    readyControl: recipient,
    requireAsset: false,
  });
  await expect(responseLink).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);
});

test('measures command navigation and preserves shortcut focus recovery', async ({ page }, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Search console navigation' });
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
    browserReadiness: {
      start: { event: 'keydown', key: 'k', controlOrMeta: true },
      targets: COMMAND_NAVIGATION_READINESS,
    },
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
