// Bounded Bulk scan execution independent of route reactivity and presentation.

import {
  reconcileBulkResultProfileContext,
  toBulkSessionResult,
  type ScanMode,
  type ScanResult,
} from '../analysis/bulk-result-model.ts';
import { preservePriorBulkResult } from '../analysis/bulk-retry-plan.ts';
import type { CompactLookupHttpResponse } from '../analysis/lookup-response.ts';
import type {
  ActiveBrandProfileSourceState,
  BrandProfile,
} from '../brand-profiles.ts';
import type { BulkProfileContextProvenance } from '../analysis/bulk-session-model.ts';

const RESULT_PUBLISH_MS = 100;

type BulkScanProfileSnapshot = Readonly<{
  mode: ScanMode;
  sourceState: Exclude<ActiveBrandProfileSourceState, 'loading'>;
  profile: BrandProfile | null;
  provenance: BulkProfileContextProvenance;
}>;

type BulkScanExecutionOptions = {
  domains: readonly string[];
  currentResults: readonly ScanResult[];
  replace: boolean;
  preservePrior: boolean;
  profile: BulkScanProfileSnapshot;
  controller: AbortController;
  concurrency: number;
  ownsScan: () => boolean;
  waitWhilePaused: () => Promise<void>;
  fetchLookup: (domain: string, signal: AbortSignal) => Promise<CompactLookupHttpResponse>;
  normalizeResult: (
    domain: string,
    response: CompactLookupHttpResponse,
    profile: BulkScanProfileSnapshot,
  ) => ScanResult;
  failedResult: (
    domain: string,
    message: string,
    profile: BulkScanProfileSnapshot,
  ) => ScanResult;
  onSnapshot: (snapshot: (() => ScanResult[]) | null) => void;
  onPublish: (results: ScanResult[]) => void;
  onProgress: (completed: number, elapsedMs: number) => void;
  now?: () => number;
  publishIntervalMs?: number;
  reconcilePrior?: (
    result: ScanResult,
    provenance: BulkProfileContextProvenance,
  ) => ScanResult;
  chooseResult?: (
    prior: ScanResult,
    next: ScanResult,
  ) => Readonly<{ preserve: boolean; reason: string }>;
};

type BulkScanExecutionResult = Readonly<{
  preservedReasons: readonly string[];
  completed: number;
  owned: boolean;
  aborted: boolean;
}>;

function defaultResultChoice(
  prior: ScanResult,
  next: ScanResult,
): Readonly<{ preserve: boolean; reason: string }> {
  return preservePriorBulkResult(
    toBulkSessionResult(prior),
    toBulkSessionResult(next),
  );
}

async function executeBulkScan(
  options: BulkScanExecutionOptions,
): Promise<BulkScanExecutionResult> {
  const {
    chooseResult = defaultResultChoice,
    concurrency,
    controller,
    currentResults,
    domains,
    failedResult,
    fetchLookup,
    normalizeResult,
    now = () => performance.now(),
    onProgress,
    onPublish,
    onSnapshot,
    ownsScan,
    preservePrior,
    profile,
    publishIntervalMs = RESULT_PUBLISH_MS,
    reconcilePrior = reconcileBulkResultProfileContext,
    replace,
    waitWhilePaused,
  } = options;
  const targetDomains = new Set(domains);
  const priorByDomain = new Map(currentResults
    .filter((row) => targetDomains.has(row.domain))
    .map((row) => [row.domain, reconcilePrior(row, profile.provenance)]));
  const baseResults = replace
    ? []
    : currentResults.filter((row) => !targetDomains.has(row.domain));
  const pendingResults: Array<ScanResult | undefined> = preservePrior
    ? domains.map((domain) => priorByDomain.get(domain))
    : new Array(domains.length);
  const preservedReasons: string[] = [];
  let cursor = 0;
  let completed = 0;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const snapshot = () => [
    ...baseResults,
    ...pendingResults.filter((row): row is ScanResult => Boolean(row)),
  ];
  const publish = () => {
    if (publishTimer) {
      clearTimeout(publishTimer);
      publishTimer = null;
    }
    if (ownsScan()) onPublish(snapshot());
  };
  const schedulePublish = () => {
    if (ownsScan() && !publishTimer) {
      publishTimer = setTimeout(publish, publishIntervalMs);
    }
  };

  onSnapshot(snapshot);
  const startedAt = now();
  const worker = async () => {
    while (cursor < domains.length && !controller.signal.aborted) {
      await waitWhilePaused();
      if (controller.signal.aborted || !ownsScan()) break;
      const index = cursor;
      cursor += 1;
      const domain = domains[index];
      if (domain === undefined) break;
      let next: ScanResult;
      try {
        const response = await fetchLookup(domain, controller.signal);
        next = normalizeResult(domain, response, profile);
        if (profile.mode === 'deep' && response.availability?.deepScanComplete === false) {
          next.saved.scanDepth = 'fast';
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') break;
        next = failedResult(
          domain,
          cause instanceof Error ? cause.message : 'Lookup failed',
          profile,
        );
      }
      if (!ownsScan()) break;
      const prior = priorByDomain.get(domain);
      if (preservePrior && prior) {
        const decision = chooseResult(prior, next);
        if (decision.preserve) {
          pendingResults[index] = prior;
          preservedReasons.push(`${domain}: ${decision.reason}`);
        } else {
          pendingResults[index] = next;
        }
      } else {
        pendingResults[index] = next;
      }
      completed += 1;
      onProgress(completed, now() - startedAt);
      schedulePublish();
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), domains.length) },
    worker,
  ));
  if (!ownsScan()) {
    if (publishTimer) clearTimeout(publishTimer);
    return Object.freeze({
      preservedReasons: Object.freeze([...preservedReasons]),
      completed,
      owned: false,
      aborted: controller.signal.aborted,
    });
  }
  publish();
  onSnapshot(null);
  return Object.freeze({
    preservedReasons: Object.freeze([...preservedReasons]),
    completed,
    owned: true,
    aborted: controller.signal.aborted,
  });
}

export {
  RESULT_PUBLISH_MS,
  executeBulkScan,
};
export type {
  BulkScanExecutionOptions,
  BulkScanExecutionResult,
  BulkScanProfileSnapshot,
};
