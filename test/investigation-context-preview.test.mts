import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS,
  projectInvestigationContextPreview,
} from '../frontend/src/lib/analysis/investigation-context-preview.ts';
import {
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
  markInvestigationSearchSourcesUnavailable,
  unavailableInvestigationSearchIndex,
  type InvestigationSearchIndex,
} from '../frontend/src/lib/analysis/investigation-search.ts';

function indexWithEntries(count: number): InvestigationSearchIndex {
  const entries = Array.from({ length: count }, (_, index) => ({
    entityId: `domain-${index}`,
    entityType: 'domain' as const,
    label: `Target ${index}`,
    canonical: `target-${index}.example`,
    terms: [{ field: 'domain' as const, value: `target-${index}.example`, normalized: `target-${index}.example` }],
    termsTruncated: false,
    sourceStore: 'cases' as const,
    source: 'case evidence',
    classification: null,
    observedAt: '2026-08-01T00:00:00.000Z',
    complete: true,
    truncated: false,
    limitations: [],
    href: `/monitor?case=${index}`,
    action: 'Open case',
  }));
  return {
    schema: INVESTIGATION_SEARCH_SCHEMA,
    version: INVESTIGATION_SEARCH_VERSION,
    state: 'ready',
    generatedAt: '2026-08-01T00:00:00.000Z',
    projectionVersion: 1,
    sources: {
      cases: { state: 'supported', version: 1, records: count, truncated: false },
      campaigns: { state: 'supported', version: 1, records: 0, truncated: false },
      brandProfiles: { state: 'supported', version: 1, records: 0, truncated: false },
      relationshipRows: { state: 'absent', version: null, records: 0, truncated: false },
      relationshipObservations: { state: 'supported', version: 1, records: 0, truncated: false },
    },
    entries,
    entityCount: entries.length,
    termCount: entries.length,
    truncated: false,
    limitations: [],
  };
}

test('projects at most three complete local matches without mutating the index', () => {
  const index = indexWithEntries(1);
  const before = structuredClone(index);
  const preview = projectInvestigationContextPreview(index, 'target');
  assert.equal(preview.state, 'ready');
  assert.equal(preview.results.length, 1);
  assert.equal(preview.omittedMatches, 0);
  assert.deepEqual(index, before);
});

test('discloses bounded match omission and incomplete retained sources as partial', () => {
  const index = indexWithEntries(5);
  const capped = projectInvestigationContextPreview(index, 'target');
  assert.equal(capped.state, 'partial');
  assert.equal(capped.results.length, MAX_INVESTIGATION_CONTEXT_PREVIEW_RESULTS);
  assert.equal(capped.omittedMatches, 2);
  assert.match(capped.limitations.join(' '), /2 additional local matches were omitted/u);
  assert.match(capped.detail, /2 additional local matches were omitted/u);

  index.limitations = ['One', 'Two', 'Three', 'Four'];
  const limitationCap = projectInvestigationContextPreview(index, 'target');
  assert.equal(limitationCap.limitations.length, 4);
  assert.match(limitationCap.limitations[0] ?? '', /2 additional local matches were omitted/u);
  assert.match(limitationCap.detail, /2 additional local matches were omitted/u);

  const unavailableSource = markInvestigationSearchSourcesUnavailable(index, ['campaigns']);
  assert.equal(index.sources.campaigns.state, 'supported');
  assert.equal(unavailableSource.sources.campaigns.state, 'unavailable');
  const incomplete = projectInvestigationContextPreview(unavailableSource, 'target-0');
  assert.equal(incomplete.state, 'partial');
  assert.match(incomplete.limitations.join(' '), /Campaigns saved context is unavailable/u);
  assert.equal(incomplete.results.length, 1);

  const incompleteNoMatch = projectInvestigationContextPreview(unavailableSource, 'unrelated');
  assert.equal(incompleteNoMatch.state, 'partial');
  assert.equal(incompleteNoMatch.results.length, 0);
  assert.match(incompleteNoMatch.detail, /coverage is partial/u);
});

test('keeps complete no-match and unavailable index states explicit', () => {
  const noMatch = projectInvestigationContextPreview(indexWithEntries(1), 'unrelated');
  assert.equal(noMatch.state, 'no_matches');
  assert.match(noMatch.detail, /does not mean/u);

  const unavailable = projectInvestigationContextPreview(
    unavailableInvestigationSearchIndex('Local context could not be read.'),
    'target',
  );
  assert.equal(unavailable.state, 'unavailable');
  assert.match(unavailable.detail, /could not be read/u);
});
