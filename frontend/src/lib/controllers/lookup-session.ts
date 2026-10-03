import {
  createLookupRequestDraft,
  lookupResultDepth,
  normalizeLookupTaskView,
  reconcileLookupUrlState,
  type LookupTaskView,
} from '../analysis/lookup-presentation.ts';
import type { LookupProgressUpdate } from '../../../../lib/lookup-progress-http.mts';
import type { LookupWorkflowState } from '../console-workflow-state.ts';
import { createLookupResultState, restoreLookupResultState } from './lookup-view-state.ts';

export function createLookupSessionState() {
  return {
    request: createLookupRequestDraft(),
    observation: createLookupResultState(),
    error: '',
    collectSelectedUrl: false,
    loading: false,
    loadingElapsedMs: 0,
    sourceProgress: null as LookupProgressUpdate | null,
    task: 'general' as LookupTaskView,
    preferredTask: 'general' as LookupTaskView,
    visualView: 'sources' as 'sources' | 'relationships' | 'timeline',
    urlReady: false,
    lastUrl: '',
  };
}
export type LookupSessionState = ReturnType<typeof createLookupSessionState>;

type LookupSessionEffects = Readonly<{
  invalidateRequest: () => void;
  resetSavedContext: (preserveWatchlistDraft: boolean) => void;
}>;

/** Owns transient navigation state, never request execution or durable writes. */
export class LookupSession {
  readonly state: LookupSessionState;
  private readonly effects: LookupSessionEffects;

  constructor(state: LookupSessionState, effects: LookupSessionEffects) {
    this.state = state;
    this.effects = effects;
  }

  invalidateInput(): void {
    this.effects.invalidateRequest();
    this.state.loading = false;
    this.state.loadingElapsedMs = 0;
    this.state.sourceProgress = null;
  }

  clearCompleted(preserveWatchlistDraft = false): void {
    this.state.observation = createLookupResultState();
    this.effects.resetSavedContext(preserveWatchlistDraft);
  }

  changeQuery(value: string): void {
    this.state.request.query = value;
    if (!this.state.loading) return;
    this.invalidateInput();
    this.clearCompleted();
    this.state.error = '';
  }

  selectTask(value: LookupTaskView): void {
    this.state.preferredTask = normalizeLookupTaskView(value);
    this.applyTask(this.state.preferredTask);
  }

  private applyTask(task: LookupTaskView): void {
    this.state.task = task;
    this.state.visualView = task === 'acquisition' || task === 'owned' ? 'timeline'
      : task === 'brand' || task === 'incident' ? 'relationships' : 'sources';
  }

  static urlSignature(url: URL): string { return `${url.pathname}${url.search}`; }

  reconcileUrl(url: URL): void {
    const { request, observation } = this.state;
    const next = reconcileLookupUrlState({
      query: request.query,
      depth: request.lookupMode,
      task: this.state.task,
      result: observation.response,
      completedTarget: observation.target,
      error: this.state.error,
      retainedResultDepth: observation.response ? observation.depth ?? lookupResultDepth(observation.response) : null,
    }, url.searchParams, this.state.preferredTask);
    const clearedResult = Boolean(observation.response && !next.result);
    if (next.query !== request.query || next.depth !== request.lookupMode || clearedResult) this.invalidateInput();
    request.query = next.query;
    request.lookupMode = next.depth;
    this.applyTask(next.task);
    observation.response = next.result;
    observation.target = next.completedTarget;
    this.state.error = next.error;
    if (clearedResult) this.clearCompleted();
    this.state.lastUrl = LookupSession.urlSignature(url);
  }

  restore(saved: LookupWorkflowState | null, preferredTask: LookupTaskView, url: URL): void {
    this.state.preferredTask = preferredTask;
    if (saved) {
      // Draft keys come from their defaults; adding an option does not require
      // another restore list. Completed evidence is restored independently.
      for (const key of Object.keys(this.state.request) as (keyof typeof this.state.request)[]) {
        Object.assign(this.state.request, { [key]: saved[key] });
      }
      this.state.observation = restoreLookupResultState(saved);
      this.state.error = saved.result && !this.state.observation.response ? '' : saved.error;
    }
    this.reconcileUrl(url);
    this.state.urlReady = true;
  }

  snapshot(): LookupWorkflowState {
    const { request, observation, error } = this.state;
    return {
      ...request,
      completedTarget: observation.target,
      completedIncidentUrl: observation.incidentUrl,
      completedLookupDepth: observation.depth,
      error,
      result: observation.response,
    };
  }
}
