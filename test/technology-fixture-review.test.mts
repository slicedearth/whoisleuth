import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReviewedTechnologyFixture,
} from '../tools/technology-fixture-review.mts';
import { TECHNOLOGY_REVIEWED_FIXTURES } from '../fixtures/technology-reviewed-fixtures.mts';

function input(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'whoisleuth.technology-fixture-review-input',
    version: 1,
    id: 'reviewed-wordpress-generator',
    reviewedAt: '2026-07-29T10:00:00.000Z',
    observedAt: '2026-07-28T10:00:00.000Z',
    licenseBasis: 'factual-observation',
    expectedIds: ['wordpress'],
    input: { generator: 'WordPress 7.1' },
    ...overrides,
  };
}

describe('reviewed technology-fixture contribution tool', () => {
  test('retains only minimized factual evidence and explicit privacy metadata', () => {
    const fixture = buildReviewedTechnologyFixture(input());
    assert.equal(fixture.schema, 'whoisleuth.technology-reviewed-fixture');
    assert.deepEqual(fixture.expectedIds, ['wordpress']);
    assert.deepEqual(fixture.input, {
      generator: 'WordPress',
      observedAt: '2026-07-28T10:00:00.000Z',
    });
    assert.equal(fixture.label, 'Reviewed wordpress fixture');
    assert.deepEqual(fixture.privacy, {
      rawPageRetained: false,
      sourceTargetRetained: false,
      contactsRetained: false,
    });
  });

  test('reconstructs known static markers instead of copying reviewed markup', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'reviewed-sveltekit-marker',
      expectedIds: ['sveltekit'],
      input: {
        html: '<html><body><a data-sveltekit-preload-data="hover">Private page wording</a></body></html>',
      },
    }));
    assert.equal(
      fixture.input.html,
      '<a data-sveltekit-preload-data="hover"></a>',
    );
    assert.doesNotMatch(JSON.stringify(fixture), /Private page wording/u);
  });

  test('keeps the checked-in observation reproducible through the sanitising review tool', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'owned-public-sveltekit-20260805',
      reviewedAt: '2026-08-05T00:00:00.000Z',
      observedAt: '2026-08-05T00:00:00.000Z',
      expectedIds: ['sveltekit'],
      input: { html: '<a data-sveltekit-preload-data="hover">Excluded page wording</a>' },
    }));
    assert.deepEqual(fixture, TECHNOLOGY_REVIEWED_FIXTURES[0]);
  });

  test('rejects target-bearing material, unapproved origins, and mismatched expected results', () => {
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        input: { generator: 'WordPress https://private-target.invalid' },
      })),
      /target or contact/iu,
    );
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        expectedIds: ['shopify'],
        input: { resourceOrigins: ['https://private-target.invalid'] },
      })),
      /approved shared vendor host/iu,
    );
    assert.throws(
      () => buildReviewedTechnologyFixture(input({ expectedIds: ['drupal'] })),
      /observed.*instead/iu,
    );
    assert.throws(
      () => buildReviewedTechnologyFixture(input({ participantTarget: 'private-target.invalid' })),
      /unsupported fields/iu,
    );
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        input: {
          generator: 'WordPress 7.1',
          comment: 'private review note',
        },
      })),
      /unsupported fields/iu,
    );
  });
});
