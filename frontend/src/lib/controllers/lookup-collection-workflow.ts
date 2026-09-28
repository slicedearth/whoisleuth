import { parseIncidentUrlContext } from '../../../../packages/cases/case-incident-context.mts';
import { prepareSelectedLookupUrl } from '../../../../packages/evidence/lookup-target.mts';
import { MAX_HANDOFF_CANDIDATES } from '../../../../packages/investigation/candidate-handoff.mts';
import type { CaseRecord } from '../cases.ts';
import type { saveCandidateHandoff } from '../candidate-handoff.ts';
import {
  buildLookupRequestUrl,
  prepareLookupCollectionTarget,
  type LookupRequestSelection,
} from '../analysis/lookup-page-actions.ts';
import { publishLookupResult } from './lookup-publication.ts';
import type { LookupRequestController, LookupOperation } from './lookup-request-controller.ts';
import type { LookupSession } from './lookup-session.ts';

type LookupCollectionContext = Readonly<{
  disabled: { reason: string | null } | null;
  tooLarge: boolean;
  entries: readonly string[];
  preferredCase: Pick<CaseRecord, 'id' | 'domain'> | null;
  capabilities: Pick<
    LookupRequestSelection,
    | 'externalIntelligenceSupported'
    | 'malwareHostIntelligenceSupported'
    | 'malwareIocIntelligenceSupported'
    | 'websiteObservationSupported'
    | 'securityTxtEligible'
  >;
}>;

type LookupReveal = Readonly<{ current(): boolean; dispose(): void }>;
const PHASE_FAILURE = {
  request: 'Lookup request could not be prepared.',
  publication: 'Lookup completed, but its result could not be displayed.',
  reconciliation: 'Lookup completed, but its saved Case or watchlist context could not be refreshed.',
  retention: 'Lookup completed, but the Case update could not be confirmed. Check the saved Case before retrying the update.',
  presentation: 'Lookup completed, but the result view could not be updated.',
} as const;
type LookupCollectionEffects = Readonly<{
  context(): LookupCollectionContext;
  active(): boolean;
  saveHandoff: typeof saveCandidateHandoff;
  navigate(href: string): Promise<unknown>;
  stopReveal(): void;
  captureReveal(): LookupReveal | undefined;
  refreshProfile(): Promise<void>;
  refreshCase(revision: number, preferred: LookupCollectionContext['preferredCase']): Promise<void>;
  refreshWatchlist(revision: number): Promise<void>;
  retainCase(): Promise<unknown>;
  rendered(): Promise<void>;
  reveal(refreshCaseEvidence: boolean): void;
}>;

/** Coordinates one submitted investigation. Request cancellation and durable
 * writes remain with their existing owners; rendering is an explicit effect. */
export class LookupCollectionWorkflow {
  private readonly session: LookupSession;
  private readonly requests: LookupRequestController;
  private readonly effects: LookupCollectionEffects;

  constructor(
    session: LookupSession,
    requests: LookupRequestController,
    effects: LookupCollectionEffects,
  ) {
    this.session = session;
    this.requests = requests;
    this.effects = effects;
  }

  async run(
    options: Readonly<{ refreshCaseEvidence?: boolean }> = {},
  ): Promise<LookupOperation | undefined> {
    const state = this.session.state;
    const context = this.effects.context();
    if (context.disabled) {
      state.error = context.disabled.reason || 'Lookup is disabled by deployment policy.';
      return;
    }
    if (context.tooLarge) {
      state.error = 'This domain list is too large. Shorten it and try again.';
      return;
    }
    if (!context.entries.length || state.loading) return;
    if (context.entries.length > 1) {
      await this.handoff(context.entries);
      return;
    }

    const entry = context.entries[0];
    if (!entry) return;
    const isIncidentUrl = state.task === 'incident' && /^[a-z][a-z\d+.-]*:\/\//iu.test(entry);
    const incident = isIncidentUrl ? parseIncidentUrlContext(entry) : null;
    if (isIncidentUrl && !incident) {
      state.error =
        'Incident URLs must be absolute HTTP(S) URLs without credentials and within the Case URL bound.';
      return;
    }
    let target: string;
    let selectedUrl: string | undefined;
    try {
      target = prepareLookupCollectionTarget(entry);
      if (state.collectSelectedUrl) {
        if (state.request.lookupMode !== 'deep' || !context.capabilities.websiteObservationSupported)
          throw new TypeError(
            'Selected URL collection requires an enabled Deep website observation.',
          );
        selectedUrl = prepareSelectedLookupUrl(entry, target);
      }
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : 'Lookup target could not be prepared.';
      return;
    }

    const preferredCase = context.preferredCase
      ? { id: context.preferredCase.id, domain: context.preferredCase.domain }
      : null;
    this.effects.stopReveal();
    this.session.clearCompleted(true);
    state.loading = true;
    state.loadingElapsedMs = 0;
    state.error = '';
    state.sourceProgress = null;
    const mode = state.request.lookupMode;
    const reveal = this.effects.captureReveal();
    const operation = this.requests.begin(
      () =>
        this.effects.active() &&
        this.effects.context().entries[0] === entry &&
        state.request.lookupMode === mode,
    );
    const url = buildLookupRequestUrl(target, { ...state.request, mode, ...context.capabilities });
    let phase: keyof typeof PHASE_FAILURE = 'request';

    try {
      const completed = await this.requests.run(
        url,
        (elapsed) => {
          state.loadingElapsedMs = elapsed;
        },
        () => this.effects.refreshProfile(),
        {
          ...(selectedUrl ? { selectedUrl } : {}),
          ...(mode === 'deep'
            ? {
                onProgress: (update) => {
                  if (operation.current()) state.sourceProgress = update;
                },
              }
            : {}),
        },
        operation,
      );
      if (completed.state === 'stale' || !operation.current()) return;
      const outcome = completed.outcome;
      if (!outcome.ok) {
        state.error = outcome.message;
        return;
      }
      const published = await publishLookupResult(operation, {
        publish: () => {
          phase = 'publication';
          state.observation.response = outcome.value;
          state.observation.target = target;
          state.observation.incidentUrl = incident?.exactUrl ?? '';
          state.observation.depth = mode;
        },
        reconcile: () => {
          phase = 'reconciliation';
          return Promise.all([
            this.effects.refreshCase(operation.revision, preferredCase),
            this.effects.refreshWatchlist(operation.revision),
          ]);
        },
        retain: async () => {
          phase = 'retention';
          if (options.refreshCaseEvidence && reveal?.current()) await this.effects.retainCase();
        },
        ready: async () => {
          phase = 'presentation';
          state.loading = false;
          await this.effects.rendered();
        },
        reveal: () => {
          if (reveal?.current()) this.effects.reveal(Boolean(options.refreshCaseEvidence));
        },
      });
      if (published) return operation;
    } catch {
      if (operation.current()) state.error = PHASE_FAILURE[phase];
    } finally {
      reveal?.dispose();
      if (operation.current()) {
        state.loading = false;
        state.sourceProgress = null;
      }
    }
  }

  private async handoff(entries: readonly string[]): Promise<void> {
    const state = this.session.state;
    let targets: string[];
    try {
      targets = entries.slice(0, MAX_HANDOFF_CANDIDATES).map(prepareLookupCollectionTarget);
    } catch (cause) {
      state.error =
        cause instanceof Error ? cause.message : 'Lookup targets could not be prepared.';
      return;
    }
    this.session.clearCompleted();
    state.error = '';
    const result = this.effects.saveHandoff(
      'manual',
      targets.map((domain) => ({
        domain: domain.toLowerCase(),
        source: 'manual input',
        mutationTypes: [],
      })),
    );
    if (!result.saved) {
      state.error =
        'This browser could not retain the selected domains for Bulk. Check site-storage access and try again.';
      return;
    }
    await this.effects.navigate(`/bulk?source=manual&handoff=${result.token}`);
  }
}

export type { LookupCollectionContext, LookupCollectionEffects };
