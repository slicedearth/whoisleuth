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

  try {
    const settled = await Promise.allSettled(Array.from(
      { length: Math.min(Math.max(1, concurrency), domains.length) },
      () => worker().catch(cause => {
        controller.abort();
        throw cause;
      }),
    ));
    const failure = settled.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return Object.freeze({
      preservedReasons: Object.freeze([...preservedReasons]),
      completed,
      owned: ownsScan(),
      aborted: controller.signal.aborted,
    });
  } finally {
    if (publishTimer) clearTimeout(publishTimer);
    // A failed projection must not leave a queued publication or lose rows
    // that settled earlier. A replaced run must not clear its successor's state.
    if (ownsScan()) {
      try { onPublish(snapshot()); }
      finally { onSnapshot(null); }
    }
  }
}

type BulkScanState = Readonly<{
  running: boolean;
  paused: boolean;
  completed: number;
  total: number;
  elapsedMs: number;
  revision: number;
  results: ScanResult[];
}>;

type BulkScanRunOptions = Omit<BulkScanExecutionOptions,
  'controller' | 'currentResults' | 'ownsScan' | 'waitWhilePaused' | 'onSnapshot' | 'onPublish' | 'onProgress'>;

function emptyScanState(revision = 0): BulkScanState {
  return { running: false, paused: false, completed: 0, total: 0, elapsedMs: 0, revision, results: [] };
}

/** Owns a page's run lifetime; collection and evidence policies remain injected. */
class BulkScanController {
  readonly #publish: (state: BulkScanState) => void;
  #state = emptyScanState();
  #controller: AbortController | null = null;
  #snapshot: (() => ScanResult[]) | null = null;
  #pauseResolvers: Array<() => void> = [];
  #disposed = false;

  constructor(publish: (state: BulkScanState) => void) { this.#publish = publish; }
  get state(): BulkScanState { return this.#state; }
  get results(): ScanResult[] { return this.#snapshot?.() ?? this.#state.results; }

  #update(patch: Partial<BulkScanState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#publish(this.#state);
  }

  #resume(): void {
    for (const resolve of this.#pauseResolvers.splice(0)) resolve();
  }

  #invalidate(): void {
    this.#controller?.abort();
    this.#resume();
    this.#controller = null;
    this.#snapshot = null;
  }

  restore(results: readonly ScanResult[], total: number, completed = results.length): void {
    if (this.#disposed) return;
    this.#invalidate();
    this.#update({ ...emptyScanState(this.#state.revision + 1), results: [...results], total,
      completed: Math.min(completed, results.length) });
  }

  togglePause(): void {
    if (!this.#state.running || this.#controller?.signal.aborted || this.#disposed) return;
    this.#update({ paused: !this.#state.paused });
    if (!this.#state.paused) this.#resume();
  }

  cancel(): void {
    if (this.#disposed) return;
    this.#update({ paused: false });
    this.#controller?.abort();
    this.#resume();
  }

  dispose(): void {
    if (this.#disposed) return;
    const results = this.results;
    this.#disposed = true;
    this.#invalidate();
    // No publication after unmount; the caller may retain this settled snapshot.
    this.#state = { ...this.#state, running: false, paused: false, results };
  }

  async run(options: BulkScanRunOptions): Promise<BulkScanExecutionResult> {
    if (this.#disposed) return { preservedReasons: [], completed: 0, owned: false, aborted: true };
    const currentResults = this.results;
    this.#invalidate();
    const controller = new AbortController();
    this.#controller = controller;
    const ownsScan = () => !this.#disposed && this.#controller === controller;
    const resume = () => this.#resume();
    controller.signal.addEventListener('abort', resume, { once: true });
    this.#update({ ...emptyScanState(this.#state.revision + 1), running: true,
      results: options.replace ? [] : currentResults, total: options.domains.length });
    try {
      return await executeBulkScan({
        ...options, currentResults, controller, ownsScan,
        waitWhilePaused: async () => {
          if (this.#state.paused && ownsScan() && !controller.signal.aborted) {
            await new Promise<void>(resolve => this.#pauseResolvers.push(resolve));
          }
        },
        onSnapshot: snapshot => { if (ownsScan()) this.#snapshot = snapshot; },
        onPublish: results => { if (ownsScan()) this.#update({ results }); },
        onProgress: (completed, elapsedMs) => { if (ownsScan()) this.#update({ completed, elapsedMs }); },
      });
    } finally {
      controller.signal.removeEventListener('abort', resume);
      if (ownsScan()) {
        this.#resume();
        this.#controller = null;
        this.#snapshot = null;
        this.#update({ running: false, paused: false });
      }
    }
  }
}

export {
  RESULT_PUBLISH_MS,
  executeBulkScan,
  BulkScanController,
};
export type {
  BulkScanExecutionOptions,
  BulkScanExecutionResult,
  BulkScanProfileSnapshot,
  BulkScanState,
  BulkScanRunOptions,
};
