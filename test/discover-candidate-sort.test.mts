import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  candidateReviewCues,
  sortDiscoverCandidates,
  type CandidateMetadata,
  type CandidateSort,
} from '../frontend/src/lib/analysis/discover-candidate-sort.ts';
import type { Candidate } from '../frontend/src/lib/candidate-handoff.ts';

function candidate(
  domain: string,
  mutationTypes: string[],
  lastObservedAt = '',
): Candidate {
  return {
    domain,
    source: 'example',
    mutationTypes,
    ...(lastObservedAt
      ? {
          certificateTransparency: {
            certificateCount: 1,
            firstObservedAt: lastObservedAt,
            lastObservedAt,
            hostnames: [],
          },
        }
      : {}),
  };
}

const candidates = [
  candidate('zeta.example', ['single']),
  candidate('alpha.example', ['one', 'two'], '2026-07-28T00:00:00.000Z'),
  candidate('mixed.example', ['single']),
];
const metadata = new Map<string, CandidateMetadata>([
  ['zeta.example', { hasIdn: false, unicodeDomain: '', scripts: [], mixedScript: false, referenceDomains: [] }],
  ['alpha.example', { hasIdn: true, unicodeDomain: 'alpha.example', scripts: ['Latin'], mixedScript: false, referenceDomains: ['official.example'] }],
  ['mixed.example', { hasIdn: true, unicodeDomain: 'mixed.example', scripts: ['Latin', 'Cyrillic'], mixedScript: true, referenceDomains: [] }],
]);

describe('Discover candidate sorting', () => {
  test('keeps generated order stable and does not mutate the source array', () => {
    const sorted = sortDiscoverCandidates(candidates, 'generated', metadata);
    assert.deepEqual(sorted.map((item) => item.domain), ['zeta.example', 'alpha.example', 'mixed.example']);
    assert.notEqual(sorted, candidates);
  });

  test('orders every analyst sort deterministically', () => {
    const expected: Readonly<Record<CandidateSort, string>> = {
      generated: 'zeta.example',
      'review-signals': 'alpha.example',
      domain: 'alpha.example',
      'generation-paths': 'alpha.example',
      reference: 'alpha.example',
      mixed: 'mixed.example',
      'certificate-newest': 'alpha.example',
    };
    for (const [sort, first] of Object.entries(expected) as Array<[CandidateSort, string]>) {
      assert.equal(sortDiscoverCandidates(candidates, sort, metadata)[0]?.domain, first);
    }
  });

  test('explains the cues used by review-signal ordering', () => {
    assert.deepEqual(candidateReviewCues(candidates[1]!, metadata.get('alpha.example')), [
      'source or profile character match',
      'internationalized domain',
      'multiple generation paths',
      'certificate-log observation',
    ]);
  });
});
