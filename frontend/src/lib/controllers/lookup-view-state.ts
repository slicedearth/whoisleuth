import type { LookupHttpResponse } from '../../../../lib/lookup-response-contract.mts';
import { parseIncidentUrlContext } from '../../../../packages/cases/case-incident-context.mts';
import type { LookupSourceRefreshLedger } from '../analysis/lookup-source-refresh.ts';
import { lookupResultDepth } from '../analysis/lookup-presentation.ts';
import type { LookupWorkflowState } from '../console-workflow-state.ts';

/** Everything whose lifetime belongs to one completed observation. */
export function createLookupResultState() {
  return {
    response: null as LookupHttpResponse | null,
    target: '',
    incidentUrl: '',
    depth: null as 'fast' | 'deep' | null,
    refreshLedger: null as LookupSourceRefreshLedger | null,
    exportStatus: '',
    expandedSections: [] as string[],
    assessmentOpen: false,
    serviceScope: '',
    serviceFalsePositives: '',
    draftStatus: '',
  };
}

export function restoreLookupResultState(saved: LookupWorkflowState) {
  const state = createLookupResultState();
  const depth = saved.completedLookupDepth === 'fast' || saved.completedLookupDepth === 'deep'
    ? saved.completedLookupDepth : lookupResultDepth(saved.result);
  if (!saved.result || !depth) return state;
  return {
    ...state,
    response: saved.result,
    target: saved.completedTarget,
    incidentUrl: typeof saved.completedIncidentUrl === 'string' && parseIncidentUrlContext(saved.completedIncidentUrl)
      ? saved.completedIncidentUrl : '',
    depth,
  };
}

export function createLookupWatchlistState(draft?: Readonly<{ name: string; target: string }>) {
  return {
    names: [] as string[],
    sourceState: 'loading' as 'loading' | 'ready' | 'unavailable',
    name: draft?.name ?? '',
    target: draft?.target ?? '',
    status: '',
    busy: false,
  };
}

export type LookupResultState = ReturnType<typeof createLookupResultState>;
export type LookupWatchlistState = ReturnType<typeof createLookupWatchlistState>;
