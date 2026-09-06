import type { Page } from '@playwright/test';

export const PLAYWRIGHT_FUNCTIONAL_PROJECT = 'chromium';
export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT = 'performance-authority';

export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS = Object.freeze([
  'e2e/console-loading.spec.ts',
  'e2e/deferred-interactions.spec.ts',
] as const);

const PERFORMANCE_AUTHORITY_BASENAMES = PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS
  .map((file) => file.slice('e2e/'.length).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));

export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN = new RegExp(
  `(?:^|[/\\\\])(?:${PERFORMANCE_AUTHORITY_BASENAMES.join('|')})$`,
  'u',
);
export const PLAYWRIGHT_NETWORK_GUARD_ROUTE_PATTERN = '**/*';
export const PLAYWRIGHT_AUTOMATIC_GUARD_OPTIONS = Object.freeze({ auto: true as const });

export function isPlaywrightPerformanceAuthoritySpec(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS.some((candidate) => (
    normalized === candidate || normalized.endsWith(`/${candidate}`)
  ));
}

export function isPlaywrightFunctionalSpec(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return /^e2e\/[a-zA-Z0-9._-]+\.spec\.ts$/u.test(normalized)
    && !isPlaywrightPerformanceAuthoritySpec(normalized);
}

export function enforcesMachineTimingBudgets(projectName: string): boolean {
  return projectName === PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT;
}

// Three samples make the median require two passes against the reviewed
// budget. One scheduler-affected sample remains permitted, but the two-times
// hard ceiling prevents the median from hiding a severe regression.
export const PERFORMANCE_SAMPLE_COUNT = 3;
export const PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER = 2;

export type MachineTimingSampleSet = Readonly<{
  usableMsMedian: number;
  usableMsMaximum: number;
  longTaskTotalMsMedian: number;
  longTaskTotalMsMaximum: number;
}>;
export type MachineTimingBudget = Readonly<{
  usableMs: number;
  longTaskTotalMs: number;
}>;
export type MachineTimingBudgetCheck = Readonly<{
  metric: keyof MachineTimingSampleSet;
  observed: number;
  maximum: number;
}>;

export function machineTimingBudgetChecks(
  projectName: string,
  sampleSet: MachineTimingSampleSet,
  budget: MachineTimingBudget,
): readonly MachineTimingBudgetCheck[] {
  if (!enforcesMachineTimingBudgets(projectName)) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ metric: 'usableMsMedian', observed: sampleSet.usableMsMedian, maximum: budget.usableMs }),
    Object.freeze({
      metric: 'longTaskTotalMsMedian',
      observed: sampleSet.longTaskTotalMsMedian,
      maximum: budget.longTaskTotalMs,
    }),
    Object.freeze({
      metric: 'usableMsMaximum',
      observed: sampleSet.usableMsMaximum,
      maximum: budget.usableMs * PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER,
    }),
    Object.freeze({
      metric: 'longTaskTotalMsMaximum',
      observed: sampleSet.longTaskTotalMsMaximum,
      maximum: budget.longTaskTotalMs * PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER,
    }),
  ]);
}

export type BrowserReadinessTarget = Readonly<{
  selector: string;
  exactText?: string;
  requireEnabled?: boolean;
  visibility?: 'visible' | 'attached';
}>;

export function validateBrowserReadinessTargets(targets: readonly BrowserReadinessTarget[]): void {
  if (targets.length < 1 || targets.length > 4) {
    throw new TypeError('Browser readiness requires between one and four target definitions.');
  }
  for (const target of targets) {
    if (!target.selector.trim() || target.selector.length > 240) {
      throw new TypeError('Browser readiness selectors must be bounded non-empty strings.');
    }
    if (target.exactText !== undefined && target.exactText.length > 500) {
      throw new TypeError('Browser readiness text must remain within the maintained bound.');
    }
    if (target.visibility !== undefined && target.visibility !== 'visible' && target.visibility !== 'attached') {
      throw new TypeError('Browser readiness visibility is unsupported.');
    }
  }
}

export async function installNavigationReadinessMark(
  page: Page,
  targets: readonly BrowserReadinessTarget[],
): Promise<void> {
  validateBrowserReadinessTargets(targets);
  await page.addInitScript((definitions) => {
    const scope = globalThis as typeof globalThis & { __whoisleuthNavigationReadyAt?: number | null };
    scope.__whoisleuthNavigationReadyAt = null;
    const normalizeText = (value: string): string => value.replace(/\s+/gu, ' ').trim();
    const targetReady = (target: BrowserReadinessTarget): boolean => (
      [...document.querySelectorAll(target.selector)].some((element) => {
        const style = getComputedStyle(element);
        if (target.visibility !== 'attached'
          && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || element.getClientRects().length === 0)) return false;
        if (target.exactText !== undefined && normalizeText(element.textContent ?? '') !== normalizeText(target.exactText)) return false;
        if (target.requireEnabled && (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true')) return false;
        return true;
      })
    );
    const poll = (): void => {
      if (definitions.every(targetReady)) {
        scope.__whoisleuthNavigationReadyAt = performance.now();
      } else {
        requestAnimationFrame(poll);
      }
    };
    requestAnimationFrame(poll);
  }, targets);
}

export async function resetPerformanceSampleState(
  page: Page,
  allowedOrigin: string,
): Promise<void> {
  if (page.url() === allowedOrigin || page.url().startsWith(`${allowedOrigin}/`)) {
    await page.evaluate(() => sessionStorage.clear());
  }
  await page.goto('about:blank');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Network.enable');
    await session.send('Network.clearBrowserCache');
    await session.send('Storage.clearDataForOrigin', {
      origin: allowedOrigin,
      storageTypes: 'appcache,cache_storage,indexeddb,local_storage,service_workers,websql',
    });
  } finally {
    await session.detach();
  }
}

export function performanceSampleMedian(values: readonly number[]): number {
  if (values.length !== PERFORMANCE_SAMPLE_COUNT || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Performance authority requires exactly ${PERFORMANCE_SAMPLE_COUNT} finite non-negative samples.`);
  }
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function resolvePlaywrightExecutionContract(environment: Environment = process.env) {
  const hosted = Boolean(environment.CI);
  const useExistingBuild = hosted || environment.WHOISLEUTH_E2E_USE_BUILD === '1';
  return Object.freeze({
    hosted,
    useExistingBuild,
    includePerformanceAuthority: environment.WHOISLEUTH_E2E_PERFORMANCE_FIRST === '1',
    forbidOnly: true as const,
    failOnFlakyTests: true as const,
    retries: 0 as const,
    workers: 1 as const,
    trace: 'retain-on-failure' as const,
    screenshot: 'only-on-failure' as const,
    functionalProject: Object.freeze({
      name: PLAYWRIGHT_FUNCTIONAL_PROJECT,
      excludedSpecs: PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,
      dependencies: Object.freeze(['setup'] as const),
    }),
    performanceProject: Object.freeze({
      name: PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
      matchedSpecs: PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,
      dependencies: Object.freeze(['setup'] as const),
      workers: 1 as const,
      fullyParallel: false as const,
      retries: 0 as const,
    }),
  });
}

export function playwrightPerformanceAuthorityArguments(playwrightCli: string): readonly string[] {
  return Object.freeze([
    playwrightCli,
    'test',
    ...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
    `--project=${PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT}`,
    '--workers=1',
    '--retries=0',
  ]);
}
