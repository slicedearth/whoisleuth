import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverReviewCues,
  MAX_DISCOVER_REVIEW_CUES,
} from '../frontend/src/lib/analysis/discover-review-cues.ts';

test('builds a fixed explainable cue list from already-derived candidate evidence', () => {
  assert.deepEqual(discoverReviewCues({
    referenceMatch: true,
    mixedScript: true,
    internationalized: true,
    generationPathCount: 3,
    certificateObserved: true,
  }), [
    'source or profile character match',
    'mixed writing scripts',
    'internationalized domain',
    'multiple generation paths',
    'certificate-log observation',
  ]);
});

test('does not create a cue from a single generation path or absent evidence', () => {
  assert.deepEqual(discoverReviewCues({
    referenceMatch: false,
    mixedScript: false,
    internationalized: false,
    generationPathCount: 1,
    certificateObserved: false,
  }), []);
  assert.equal(MAX_DISCOVER_REVIEW_CUES, 5);
});
