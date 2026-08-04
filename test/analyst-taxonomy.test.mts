import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ANALYST_REVIEW_REASONS,
  ANALYST_REVIEW_REASON_VALUES,
  MISP_TAXONOMY_REFERENCES,
  analystInteroperabilityTags,
} from '../lib/analyst-taxonomy.mts';

describe('analyst interoperability taxonomy', () => {
  test('keeps one shared bounded review-reason vocabulary', () => {
    assert.equal(ANALYST_REVIEW_REASONS.length, 10);
    assert.equal(ANALYST_REVIEW_REASON_VALUES.size, 9);
    assert.deepEqual(MISP_TAXONOMY_REFERENCES.map(({ namespace }) => namespace), [
      'domain-abuse', 'estimative-language', 'event-assessment', 'false-positive', 'phishing',
    ]);
  });

  test('derives only conservative tags from analyst-owned state', () => {
    assert.deepEqual(analystInteroperabilityTags('false_positive', 'shared_infrastructure'), [
      'false-positive:confirmed="true"',
      'false-positive:risk="high"',
    ]);
    assert.deepEqual(analystInteroperabilityTags('suspicious', 'insufficient_evidence'), [
      'estimative-language:confidence-in-analytic-judgment="low"',
    ]);
    assert.deepEqual(analystInteroperabilityTags('confirmed_abuse', 'confirmed_credential_abuse'), [
      'phishing:techniques="fake-website"',
    ]);
    assert.deepEqual(analystInteroperabilityTags('confirmed_abuse', 'other_reviewed'), []);
  });
});
