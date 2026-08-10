import {
  searchInvestigationIndex,
  type InvestigationSearchIndex,
  type InvestigationSearchResult,
} from './investigation-search.ts';

export const MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS = 3;
export const MAX_INVESTIGATION_CONTEXT_PREVIEW_LIMITATIONS = 4;

export type InvestigationContextPreviewState = 'idle' | 'ready' | 'partial' | 'unavailable' | 'no_matches';

export type InvestigationContextPreview = Readonly<{
  state: InvestigationContextPreviewState;
  query: string;
  results: readonly InvestigationSearchResult[];
  totalMatches: number;
  omittedMatches: number;
  detail: string;
  limitations: readonly string[];
}>;

const RETAINED_SOURCES = ['cases', 'campaigns', 'brandProfiles', 'relationshipObservations'] as const;
const SOURCE_LABELS: Readonly<Record<(typeof RETAINED_SOURCES)[number], string>> = Object.freeze({
  cases: 'Cases',
  campaigns: 'Campaigns',
  brandProfiles: 'Brand profiles',
  relationshipObservations: 'Retained relationship observations',
});

function limitations(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0).map((value) => value.slice(0, 300)))]
    .slice(0, MAX_INVESTIGATION_CONTEXT_PREVIEW_LIMITATIONS);
}

function omittedMatchDetail(count: number): string {
  return `${count} additional local match${count === 1 ? ' was' : 'es were'} omitted from this three-item preview.`;
}

export function projectInvestigationContextPreview(
  index: InvestigationSearchIndex,
  query: unknown,
): InvestigationContextPreview {
  const response = searchInvestigationIndex(index, query);
  if (response.state === 'idle') {
    return { state: 'idle', query: '', results: [], totalMatches: 0, omittedMatches: 0, detail: 'Enter a target before opening saved context.', limitations: [] };
  }
  if (response.state === 'invalid') {
    return { state: 'unavailable', query: response.query, results: [], totalMatches: 0, omittedMatches: 0, detail: response.detail, limitations: limitations(index.limitations) };
  }

  const sourceLimitations = RETAINED_SOURCES
    .filter((source) => index.sources[source].state !== 'supported')
    .map((source) => `${SOURCE_LABELS[source]} saved context is ${index.sources[source].state} and was not fully searched.`);
  const results = response.results.slice(0, MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS);
  const omittedMatches = Math.max(0, response.totalMatches - results.length);
  const partial = index.truncated
    || response.truncated
    || omittedMatches > 0
    || sourceLimitations.length > 0
    || results.some((result) => result.complete !== true || result.truncated === true);
  const previewLimitations = limitations([
    ...(omittedMatches > 0 ? [omittedMatchDetail(omittedMatches)] : []),
    ...sourceLimitations,
    ...index.limitations,
  ]);

  if (response.state === 'no_matches') {
    return {
      state: partial ? 'partial' : 'no_matches',
      query: response.query,
      results: [],
      totalMatches: 0,
      omittedMatches: 0,
      detail: partial
        ? 'No match was found in the available saved context, but local coverage is partial.'
        : response.detail,
      limitations: previewLimitations,
    };
  }

  return {
    state: partial ? 'partial' : 'ready',
    query: response.query,
    results,
    totalMatches: response.totalMatches,
    omittedMatches,
    detail: partial
      ? `Showing ${results.length} bounded local match${results.length === 1 ? '' : 'es'} with partial coverage.${omittedMatches > 0 ? ` ${omittedMatchDetail(omittedMatches)}` : ''}`
      : `Showing ${results.length} complete local match${results.length === 1 ? '' : 'es'}.`,
    limitations: previewLimitations,
  };
}
