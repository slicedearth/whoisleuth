import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildBrandMimicryReview } from '../frontend/src/lib/analysis/brand-mimicry-review.ts';

describe('brand mimicry review projection', () => {
  test('keeps independently observed relationships and context separate', () => {
    const review = buildBrandMimicryReview({
      hasActiveProfile: true,
      profileSignals: {
        faviconMatch: true,
        reusesOfficialAssets: true,
      },
      pageComparison: {
        comparisonVersion: 1,
        partial: false,
        components: [
          {
            label: 'External resource hosts',
            method: 'Bounded set overlap',
            status: 'overlap',
            outcome: '1 host shared',
            sharedValues: ['assets.example'],
          },
          {
            label: 'DOM structure',
            method: 'Exact SHA-256 equality',
            status: 'different',
            outcome: 'Different captured digest',
          },
        ],
      },
      hasPasswordField: true,
      phishingLanguageMatch: 'Review your account',
    });

    assert.ok(review);
    assert.equal(review.version, 1);
    assert.equal(review.items.filter((item) => item.state === 'relationship').length, 3);
    assert.equal(review.items.filter((item) => item.state === 'context').length, 2);
    assert.deepEqual(
      review.items.find((item) => item.label === 'External resource hosts relationship')?.sharedValues,
      ['assets.example'],
    );
    assert.equal('score' in review, false);
  });

  test('does not create a review for an official, partner, or allowlisted domain', () => {
    assert.equal(buildBrandMimicryReview({
      hasActiveProfile: true,
      trustedDomainKind: 'official',
      profileSignals: { faviconMatch: true },
    }), null);
  });

  test('preserves unavailable comparison evidence rather than treating it as different', () => {
    const review = buildBrandMimicryReview({
      hasActiveProfile: true,
      profileSignals: {},
    });

    assert.ok(review);
    assert.equal(review.items[0]?.state, 'unavailable');
    assert.match(review.items[0]?.detail ?? '', /does not indicate that the pages differ/u);
  });

  test('bounds hostile text and drops unsupported comparison entries', () => {
    const review = buildBrandMimicryReview({
      hasActiveProfile: true,
      profileSignals: {},
      pageComparison: {
        comparisonVersion: 1,
        partial: true,
        components: [
          {
            label: `Page\u0000 ${'x'.repeat(200)}`,
            method: 'Method\nname',
            status: 'same',
            outcome: 'Same\ncomponent',
            sharedValues: Array.from({ length: 20 }, (_, index) => `host-${index}.example`),
          },
          { label: 'Ignored', status: 'unsupported' },
        ],
      },
    });

    assert.ok(review);
    assert.equal(review.partial, true);
    assert.equal(review.items.length, 1);
    assert.equal(review.items[0]?.sharedValues.length, 8);
    assert.doesNotMatch(JSON.stringify(review), /\\u0000|\\n/u);
  });
});
