import {
  normalizeProfile,
  type ActiveBrandProfileSourceState,
  type BrandProfile,
} from '../brand-profiles.ts';
import type { Candidate } from '../candidate-handoff-core.ts';
import { bulkProfileContextProvenance } from '../analysis/bulk-session-model.ts';
import { bulkQueryLimit } from '../analysis/bulk-limits.ts';
import { bulkConcurrency, type BulkPacing } from '../analysis/bulk-pacing.ts';
import { failedBulkScanResult, normalizeBulkScanResult } from '../analysis/bulk-scan-normalizer.ts';
import { fetchCompactBulkLookup } from '../analysis/bulk-lookup-controller.ts';
import type { ScanMode } from '../analysis/bulk-result-model.ts';
import type { BulkScanController, BulkScanProfileSnapshot } from './bulk-scan-controller.ts';
import type { BulkSessionWorkspace } from './bulk-session-workspace.ts';

type BulkCollectionContext = Readonly<{
  mode: ScanMode;
  pacing: BulkPacing;
  profile: BrandProfile | null;
  profileSourceState: ActiveBrandProfileSourceState;
}>;
type BulkCollectionEffects = Readonly<{
  context(): BulkCollectionContext;
  active(): boolean;
  prepareView(): void;
  status(message: string): void;
  provenance(domain: string): Candidate | undefined;
  fetchLookup?: typeof fetchCompactBulkLookup;
}>;
type ScanWorkspace = Pick<BulkSessionWorkspace, 'beginScan'> & {
  readonly state: Pick<BulkSessionWorkspace['state'], 'busy'>;
};

/** Owns scan admission and evidence context. The scan and session controllers
 * continue to own cancellation, result publication and durable storage. */
export class BulkCollectionWorkflow {
  private readonly scan: BulkScanController;
  private readonly workspace: ScanWorkspace;
  private readonly effects: BulkCollectionEffects;

  constructor(scan: BulkScanController, workspace: ScanWorkspace, effects: BulkCollectionEffects) {
    this.scan = scan;
    this.workspace = workspace;
    this.effects = effects;
  }

  async run(
    domains: readonly string[],
    replace = true,
    preservePrior = false,
  ): Promise<string[] | null> {
    if (this.scan.state.running) return null;
    if (this.workspace.state.busy) {
      this.effects.status('Wait for the saved-session operation to finish before scanning.');
      return null;
    }
    const context = this.effects.context();
    if (context.profileSourceState === 'loading') {
      this.effects.status(
        'Wait for saved Brand Profile context to finish loading before scanning.',
      );
      return null;
    }
    const limit = bulkQueryLimit(context.mode);
    if (!domains.length) {
      this.effects.status('Enter at least one domain.');
      return null;
    }
    if (domains.length > limit) {
      this.effects.status(
        `${context.mode === 'fast' ? 'Fast' : 'Deep'} scans are limited to ${limit} domains.`,
      );
      return null;
    }
    const sourceState = context.profileSourceState;
    const profile =
      sourceState === 'ready' && context.profile ? normalizeProfile(context.profile) : null;
    const snapshot: BulkScanProfileSnapshot = Object.freeze({
      mode: context.mode,
      sourceState,
      profile,
      provenance: bulkProfileContextProvenance(sourceState, profile),
    });
    if (!this.workspace.beginScan(replace, { mode: snapshot.mode, domains })) return null;
    this.effects.prepareView();
    this.effects.status(
      `Scanning ${domains.length} domain${domains.length === 1 ? '' : 's'}…${sourceState === 'unavailable' ? ' Brand Profile-derived trust, allowlist, match, and contextual Risk evidence will remain inconclusive.' : ''}`,
    );
    const normalisation = (domain: string, candidate: Candidate | undefined) => ({
      targetDomain: domain,
      mode: snapshot.mode,
      profile: snapshot.profile,
      profileSourceState: snapshot.sourceState,
      candidate: candidate ?? null,
    });
    const executionPromise = this.scan.run({
      domains,
      replace,
      preservePrior,
      profile: snapshot,
      concurrency: bulkConcurrency(snapshot.mode, context.pacing),
      fetchLookup: (domain, signal) =>
        (this.effects.fetchLookup ?? fetchCompactBulkLookup)(domain, snapshot.mode, signal),
      normalizeResult: (domain, body) =>
        normalizeBulkScanResult(
          body,
          normalisation(
            domain,
            this.effects.provenance(domain) || this.effects.provenance(body.availability.domain),
          ),
        ),
      failedResult: (domain, message) =>
        failedBulkScanResult(message, normalisation(domain, this.effects.provenance(domain))),
    });
    const revision = this.scan.state.revision;
    try {
      const execution = await executionPromise;
      if (!execution.owned) return null;
      const { completed, total } = this.scan.state;
      if (execution.aborted) {
        this.effects.status(`Cancelled after ${completed} of ${total} lookups in this attempt. ${this.scan.results.length} retained result${this.scan.results.length === 1 ? ' remains' : 's remain'} available${preservePrior ? ', including earlier evidence' : ''}. Saving records result coverage, not a completed refresh.`);
        return null;
      }
      this.effects.status(
        `Completed ${completed} of ${total} lookups.${sourceState === 'unavailable' ? ' Brand Profile context was unavailable; profile-derived fields are retained as inconclusive and every row records that limitation.' : ''}${execution.preservedReasons.length ? ` Retained ${execution.preservedReasons.length} stronger prior result${execution.preservedReasons.length === 1 ? '' : 's'}.` : ''}`,
      );
      return [...execution.preservedReasons];
    } catch {
      const { completed, total } = this.scan.state;
      if (this.effects.active() && revision === this.scan.state.revision) {
        this.effects.status(
          `The scan stopped unexpectedly after ${completed} of ${total} lookups. Completed results remain available; review them before starting another scan.`,
        );
      }
      return null;
    }
  }
}

export type { BulkCollectionContext, BulkCollectionEffects };
