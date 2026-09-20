import {
  searchInvestigationIndex,
  type InvestigationSearchIndex,
  type InvestigationSearchResult,
} from './investigation-search.ts';

export const MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS = 3;
export const MAX_INVESTIGATION_CONTEXT_PREVIEW_LIMITATIONS = 8;

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
  return `${count} other local match${count === 1 ? ' is' : 'es are'} available on the other result pages.`;
}

export function projectInvestigationContextPreview(
  index: InvestigationSearchIndex,
  query: unknown,
  page = 1,
): InvestigationContextPreview {
  const response = searchInvestigationIndex(index, query, { page, pageSize: MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS });
  if (response.state === 'idle') {
    return { state: 'idle', query: '', results: [], totalMatches: 0, omittedMatches: 0, detail: 'Enter a target before opening saved context.', limitations: [] };
  }
  if (response.state === 'invalid') {
    return { state: 'unavailable', query: response.query, results: [], totalMatches: 0, omittedMatches: 0, detail: response.detail, limitations: limitations(index.limitations) };
  }

  const sourceLimitations = RETAINED_SOURCES
    .filter((source) => index.sources[source].state !== 'supported')
    .map((source) => `${SOURCE_LABELS[source]} (${index.sources[source].state})`);
  const results = response.results;
  const omittedMatches = Math.max(0, response.totalMatches - results.length);
  const partial = index.truncated
    || sourceLimitations.length > 0
    || results.some((result) => result.complete !== true || result.truncated === true);
  const previewLimitations = limitations([
    ...(sourceLimitations.length ? [`Saved collections not fully searched: ${sourceLimitations.join(', ')}.`] : []),
    ...index.limitations,
    ...(omittedMatches > 0 ? [omittedMatchDetail(omittedMatches)] : []),
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
      ? `${response.detail} The retained evidence or local coverage is partial.`
      : response.detail,
    limitations: previewLimitations,
  };
}
