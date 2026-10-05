import { buildInvestigationProjection, type InvestigationProjection, type InvestigationProjectionInput, type InvestigationStoreName } from './analysis/investigation-projection.ts';
import {
  buildInvestigationSearchIndex, investigationHistory, markInvestigationSearchSourcesUnavailable, recentInvestigationResults, searchInvestigationIndex,
  type InvestigationHistory,
  type InvestigationSearchIndex, type InvestigationSearchResponse, type InvestigationSearchResult,
} from './analysis/investigation-search.ts';
import { projectInvestigationContextPreview, type InvestigationContextPreview } from './analysis/investigation-context-preview.ts';
import { investigationInfrastructure, investigationInfrastructureRelationships,
  type InvestigationInfrastructure, type InvestigationInfrastructureOptions,
  type InvestigationInfrastructureRelationships } from './analysis/investigation-infrastructure.ts';
import { reviewRetainedInfrastructureSnapshots, type RetainedInfrastructureSnapshotReview } from '../../../packages/investigation/retained-infrastructure-snapshots.mts';

export type InvestigationSearchSummary = Pick<InvestigationSearchIndex,
  'state' | 'sources' | 'entityCount' | 'termCount' | 'truncated' | 'limitations'> & {
    recentResults: InvestigationSearchResult[];
  };
export type SearchWorkerOperation =
  | { kind: 'build'; collections: InvestigationProjectionInput; unavailableStores: readonly InvestigationStoreName[] }
  | { kind: 'search'; query: string; page?: number; pageSize?: number }
  | { kind: 'preview'; query: string; page?: number }
  | { kind: 'history'; entityId: string; page?: number }
  | { kind: 'infrastructure'; options: InvestigationInfrastructureOptions }
  | { kind: 'infrastructure_snapshots'; selectedIds?: string[]; page?: number }
  | { kind: 'infrastructure_relationships'; entityId: string; page?: number; topologyQuery?: string };
export type SearchWorkerRequest = SearchWorkerOperation & { id: number };
export type SearchWorkerResponse = { id: number } & (
  | { kind: 'build'; summary: InvestigationSearchSummary }
  | { kind: 'search'; result: InvestigationSearchResponse }
  | { kind: 'preview'; result: InvestigationContextPreview }
  | { kind: 'history'; result: InvestigationHistory }
  | { kind: 'infrastructure'; result: InvestigationInfrastructure }
  | { kind: 'infrastructure_snapshots'; result: RetainedInfrastructureSnapshotReview }
  | { kind: 'infrastructure_relationships'; result: InvestigationInfrastructureRelationships }
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
  let projection: InvestigationProjection | null = null;
  return (request: SearchWorkerRequest): void => {
    if (!request || !Number.isSafeInteger(request.id) || request.id < 1) return;
    const id = request.id;
    try {
      if (request.kind === 'build') {
        index = null;
        projection = null;
        const prepared = buildInvestigationProjection(request.collections);
        index = markInvestigationSearchSourcesUnavailable(
          buildInvestigationSearchIndex(prepared), request.unavailableStores,
        );
        projection = prepared;
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
      } else if (request.kind === 'history') {
        const result = investigationHistory(projection, request.entityId, request.page);
        // Storage-read failures belong to the same session as search results.
        send({ id, kind: 'history', result: { ...result, partial: result.partial || index.truncated,
          limitations: [...new Set([...result.limitations, ...index.limitations])] } });
      } else if (request.kind === 'infrastructure') {
        send({ id, kind: 'infrastructure', result: investigationInfrastructure(projection, index, request.options) });
      } else if (request.kind === 'infrastructure_snapshots') {
        const result = reviewRetainedInfrastructureSnapshots(projection, request.selectedIds, request.page);
        send({ id, kind: 'infrastructure_snapshots', result: { ...result, partial: result.partial || index.truncated } });
      } else if (request.kind === 'infrastructure_relationships') {
        const result = investigationInfrastructureRelationships(projection, request.entityId, request.page, request.topologyQuery);
        send({ id, kind: 'infrastructure_relationships', result: { ...result,
          partial: result.partial || index.truncated,
          limitations: [...new Set([...result.limitations, ...index.limitations])].slice(0, 20) } });
      } else {
        send({ id, kind: 'error', detail: 'Saved-work search received an unsupported operation.' });
      }
    } catch {
      send({ id: request.id, kind: 'error', detail: 'Saved-work search could not process the retained data. No saved records were changed.' });
    }
  };
}
