import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseSavedLookupDocument } from '../cli/saved-lookup.mts';
import { buildReviewedTechnologyFixture } from '../tools/technology-fixture-review.mts';
import {
  buildTechnologyReviewCandidate,
  parseArguments,
} from '../tools/technology-review-candidate.mts';

function savedLookup(overrides: Record<string, unknown> = {}) {
  return parseSavedLookupDocument(JSON.stringify({
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    type: 'domain',
    mode: 'deep',
    query: 'private-target.invalid',
    registrableDomain: 'private-target.invalid',
    generatedAt: '2026-08-05T10:00:00.000Z',
    diagnostics: {
      rdap: { status: 'not_found' },
      whois: { status: 'not_found' },
    },
    availability: {
      technologyProfile: {
        source: 'derived',
        status: 'success',
        complete: true,
        truncated: false,
        observedAt: '2026-08-05T09:00:00.000Z',
        findings: [{
          id: 'sveltekit',
          evidence: [{
            source: 'static HTML',
            description: 'Static asset paths use SvelteKit build conventions.',
          }],
        }],
      },
    },
    ...overrides,
  }));
}

const options = Object.freeze({
  id: 'reviewed-sveltekit-deployment',
  expectedIds: ['sveltekit'],
  licenceBasis: 'minimized-with-permission' as const,
  reviewedAt: '2026-08-05T11:00:00.000Z',
});

describe('technology review candidate intake', () => {
  test('reconstructs target-free fixture input from a saved complete Deep lookup', () => {
    const candidate = buildTechnologyReviewCandidate(savedLookup(), options);
    assert.deepEqual(candidate, {
      schema: 'whoisleuth.technology-fixture-review-input',
      version: 1,
      id: 'reviewed-sveltekit-deployment',
      reviewedAt: '2026-08-05T11:00:00.000Z',
      observedAt: '2026-08-05T09:00:00.000Z',
      licenseBasis: 'minimized-with-permission',
      expectedIds: ['sveltekit'],
      input: { html: '<link href="/_app/immutable/fixture.css">' },
    });
    assert.doesNotMatch(JSON.stringify(candidate), /private-target|query|registrableDomain/u);
    const reviewed = buildReviewedTechnologyFixture(candidate);
    assert.deepEqual(reviewed.expectedIds, ['sveltekit']);
  });

  test('reconstructs compatible passive-header findings without raw identifiers', () => {
    const document = savedLookup({
      availability: {
        technologyProfile: {
          source: 'derived', status: 'success', complete: true, truncated: false,
          observedAt: '2026-08-05T09:00:00.000Z',
          findings: [{
            id: 'fastly',
            evidence: [{
              source: 'passive response header',
              description: 'A Fastly request identifier response header was observed.',
            }],
          }],
        },
      },
    });
    const candidate = buildTechnologyReviewCandidate(document, {
      ...options,
      id: 'reviewed-fastly-header',
      expectedIds: ['fastly'],
    });
    assert.deepEqual((candidate.input as Record<string, unknown>).responseHeaders, {
      'x-fastly-request-id': 'fixture',
    });
  });

  test('requires complete current evidence and exact analyst confirmation', () => {
    assert.throws(
      () => buildTechnologyReviewCandidate(savedLookup({
        availability: {
          technologyProfile: {
            status: 'partial', complete: false, truncated: true,
            observedAt: '2026-08-05T09:00:00.000Z', findings: [],
          },
        },
      }), options),
      /complete, successful/iu,
    );
    assert.throws(
      () => buildTechnologyReviewCandidate(savedLookup(), { ...options, expectedIds: ['astro'] }),
      /do not match the saved findings/iu,
    );
    assert.throws(
      () => buildTechnologyReviewCandidate(savedLookup({
        availability: {
          technologyProfile: {
            status: 'success', complete: true, truncated: false,
            observedAt: '2026-08-05T09:00:00.000Z',
            findings: [{
              id: 'sveltekit',
              evidence: [{ source: 'static HTML', description: 'Untrusted upstream explanation.' }],
            }],
          },
        },
      }), options),
      /outside the current catalogue/iu,
    );
  });

  test('parses only the bounded explicit candidate options', () => {
    assert.deepEqual(parseArguments([
      'lookup.json',
      '--id=reviewed-sveltekit-deployment',
      '--expected=sveltekit',
      '--licence-basis=minimized-with-permission',
      '--reviewed-at=2026-08-05T11:00:00.000Z',
    ]), {
      inputPath: 'lookup.json',
      id: 'reviewed-sveltekit-deployment',
      expectedIds: ['sveltekit'],
      licenceBasis: 'minimized-with-permission',
      reviewedAt: '2026-08-05T11:00:00.000Z',
    });
    assert.throws(() => parseArguments(['lookup.json', '--unknown=value']), /Unknown option/iu);
    assert.throws(
      () => parseArguments(['lookup.json', '--id=one', '--id=two']),
      /Invalid or repeated option/iu,
    );
  });
});
