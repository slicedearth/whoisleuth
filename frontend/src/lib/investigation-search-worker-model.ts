import { buildInvestigationProjection, type InvestigationProjectionInput, type InvestigationStoreName } from './analysis/investigation-projection.ts';
import {
  buildInvestigationSearchIndex, markInvestigationSearchSourcesUnavailable, recentInvestigationResults, searchInvestigationIndex,
  type InvestigationSearchIndex, type InvestigationSearchResponse, type InvestigationSearchResult,
} from './analysis/investigation-search.ts';
import { projectInvestigationContextPreview, type InvestigationContextPreview } from './analysis/investigation-context-preview.ts';

export type InvestigationSearchSummary = Pick<InvestigationSearchIndex,
  'state' | 'sources' | 'entityCount' | 'termCount' | 'truncated' | 'limitations'> & {
    recentResults: InvestigationSearchResult[];
  };
export type SearchWorkerOperation =
  | { kind: 'build'; collections: InvestigationProjectionInput; unavailableStores: readonly InvestigationStoreName[] }
  | { kind: 'search'; query: string; page?: number; pageSize?: number }
  | { kind: 'preview'; query: string; page?: number };
export type SearchWorkerRequest = SearchWorkerOperation & { id: number };
export type SearchWorkerResponse = { id: number } & (
  | { kind: 'build'; summary: InvestigationSearchSummary }
  | { kind: 'search'; result: InvestigationSearchResponse }
  | { kind: 'preview'; result: InvestigationContextPreview }
  | { kind: 'error'; detail: string }
);

export function investigationSearchSummary(index: InvestigationSearchIndex): InvestigationSearchSummary {
  return {
    state: index.state, sources: index.sources, entityCount: index.entityCount, termCount: index.termCount,
    truncated: index.truncated, limitations: index.limitations, recentResults: recentInvestigationResults(index),
  };
}

/** Owns one disposable index and exact query execution inside a worker. */
export function createInvestigationSearchWorkerHandler(send: (response: SearchWorkerResponse) => void) {
  let index: InvestigationSearchIndex | null = null;
  return (request: SearchWorkerRequest): void => {
    if (!request || !Number.isSafeInteger(request.id) || request.id < 1) return;
    const id = request.id;
    try {
      if (request.kind === 'build') {
        index = null;
        index = markInvestigationSearchSourcesUnavailable(
          buildInvestigationSearchIndex(buildInvestigationProjection(request.collections)), request.unavailableStores,
        );
        send({ id: request.id, kind: 'build', summary: investigationSearchSummary(index) });
      } else if (!index) {
        send({ id: request.id, kind: 'error', detail: 'Saved-work search has not been prepared.' });
      } else if (request.kind === 'search') {
        send({ id: request.id, kind: 'search', result: searchInvestigationIndex(index, request.query, {
          ...(request.page === undefined ? {} : { page: request.page }),
          ...(request.pageSize === undefined ? {} : { pageSize: request.pageSize }),
        }) });
      } else if (request.kind === 'preview') {
        send({ id: request.id, kind: 'preview', result: projectInvestigationContextPreview(index, request.query, request.page) });
      } else {
        send({ id, kind: 'error', detail: 'Saved-work search received an unsupported operation.' });
      }
    } catch {
      send({ id: request.id, kind: 'error', detail: 'Saved-work search could not process the retained data. No saved records were changed.' });
    }
  };
}
