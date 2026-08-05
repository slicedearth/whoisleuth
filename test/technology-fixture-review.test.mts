import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildReviewedTechnologyFixture,
} from '../tools/technology-fixture-review.mts';
import { TECHNOLOGY_REVIEWED_FIXTURES } from '../fixtures/technology-reviewed-fixtures.mts';
import { analyzeWebsiteTechnology } from '../lib/website-technology.mts';

function input(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'whoisleuth.technology-fixture-review-input',
    version: 2,
    id: 'reviewed-wordpress-generator',
    reviewedAt: '2026-07-29T10:00:00.000Z',
    observedAt: '2026-07-28T10:00:00.000Z',
    licenseBasis: 'factual-observation',
    expectedIds: ['wordpress'],
    negativeFor: [],
    input: { generator: 'WordPress 7.1' },
    ...overrides,
  };
}

describe('reviewed technology-fixture contribution tool', () => {
  test('retains only minimised factual evidence and explicit privacy metadata', () => {
    const fixture = buildReviewedTechnologyFixture(input());
    assert.equal(fixture.schema, 'whoisleuth.technology-reviewed-fixture');
    assert.equal(fixture.kind, 'positive');
    assert.deepEqual(fixture.expectedIds, ['wordpress']);
    assert.deepEqual(fixture.negativeFor, []);
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

  test('reconstructs passive platform headers without retaining upstream values', () => {
    const cases = [
      ['php', 'x-powered-by', 'PHP/8.4.1', 'PHP'],
      ['aspnet', 'x-powered-by', 'ASP.NET/4.8', 'ASP.NET'],
      ['express', 'x-powered-by', 'Express/5', 'Express'],
      ['fastly', 'x-fastly-request-id', 'private-request-identifier', 'fixture'],
    ] as const;
    for (const [technologyId, header, value, expected] of cases) {
      const fixture = buildReviewedTechnologyFixture(input({
        id: `reviewed-${technologyId}-header`,
        expectedIds: [technologyId],
        input: { responseHeaders: { [header]: value } },
      }));
      assert.deepEqual(fixture.input.responseHeaders, { [header]: expected });
      assert.doesNotMatch(JSON.stringify(fixture), /private-request-identifier|8\.4\.1|4\.8/u);
    }
  });

  test('accepts the reviewed source classes used by local and official examples', () => {
    for (const licenseBasis of [
      'minimized-with-permission',
      'public-domain',
      'permissively-licensed-source',
      'copyleft-licensed-source',
      'official-demonstration-terms',
    ]) {
      const fixture = buildReviewedTechnologyFixture(input({ licenseBasis }));
      assert.equal(fixture.licenseBasis, licenseBasis);
    }
  });

  test('keeps the checked-in observation reproducible through the sanitising review tool', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'owned-public-delivery-stack-20260805',
      reviewedAt: '2026-08-05T00:00:00.000Z',
      observedAt: '2026-08-05T00:00:00.000Z',
      expectedIds: ['cloudflare', 'netlify', 'sveltekit'],
      negativeFor: ['fastly', 'vercel'],
      input: {
        httpServer: 'cloudflare',
        html: '<a data-sveltekit-preload-data="hover">Excluded page wording</a>',
        responseHeaders: {
          'cf-ray': 'private-request-identifier',
          'x-nf-request-id': 'private-request-identifier',
        },
      },
    }));
    assert.deepEqual(fixture, TECHNOLOGY_REVIEWED_FIXTURES[0]);
  });

  test('reproduces an official demonstration from facts without retaining its page or target', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'official-typo3-demonstration-20260805',
      reviewedAt: '2026-08-05T03:54:00.000Z',
      observedAt: '2026-08-05T03:52:53.000Z',
      licenseBasis: 'official-demonstration-terms',
      expectedIds: ['apache-http-server', 'typo3'],
      negativeFor: ['drupal', 'joomla', 'wordpress'],
      input: {
        generator: 'TYPO3 CMS',
        httpServer: 'Apache',
      },
    }));
    const checkedIn = TECHNOLOGY_REVIEWED_FIXTURES.find((item) => item.id === fixture.id);

    assert.deepEqual(fixture, checkedIn);
    assert.doesNotMatch(JSON.stringify(fixture), /https?:\/\//u);
  });

  test('reproduces a locally permitted reference build from minimised response facts', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'official-craft-cms-reference-20260805',
      reviewedAt: '2026-08-05T04:25:00.000Z',
      observedAt: '2026-08-05T04:21:30.000Z',
      licenseBasis: 'minimized-with-permission',
      expectedIds: ['craft-cms', 'nginx'],
      negativeFor: ['drupal', 'wordpress'],
      input: {
        httpServer: 'nginx',
        responseHeaders: { 'x-powered-by': 'Craft CMS' },
      },
    }));
    const checkedIn = TECHNOLOGY_REVIEWED_FIXTURES.find((item) => item.id === fixture.id);

    assert.deepEqual(fixture, checkedIn);
    assert.doesNotMatch(JSON.stringify(fixture), /https?:\/\//u);
  });

  test('reproduces a licensed static export without retaining its page identifiers', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'licensed-webflow-export-20260805',
      reviewedAt: '2026-08-05T05:15:00.000Z',
      observedAt: '2026-08-05T05:10:00.000Z',
      licenseBasis: 'copyleft-licensed-source',
      expectedIds: ['cloudfront', 'webflow'],
      negativeFor: ['framer', 'squarespace', 'weebly', 'wix'],
      input: {
        generator: 'Webflow',
        html: '<html data-wf-page="private-page-id"></html>',
        resourceOrigins: ['https://cloudfront.net'],
      },
    }));
    const checkedIn = TECHNOLOGY_REVIEWED_FIXTURES.find((item) => item.id === fixture.id);

    assert.deepEqual(fixture, checkedIn);
    assert.doesNotMatch(JSON.stringify(fixture), /private-page-id/u);
  });

  test('reproduces licensed generator, component, and form-state markers without retained values', () => {
    const cases = [
      {
        id: 'licensed-eleventy-output-20260805',
        reviewedAt: '2026-08-05T06:25:00.000Z',
        observedAt: '2026-08-05T06:20:00.000Z',
        licenseBasis: 'permissively-licensed-source',
        expectedIds: ['eleventy'],
        negativeFor: ['docusaurus', 'hexo', 'hugo', 'jekyll'],
        input: { generator: 'Eleventy 2.0.1' },
      },
      {
        id: 'licensed-framer-export-20260805',
        reviewedAt: '2026-08-05T06:35:00.000Z',
        observedAt: '2026-08-05T06:30:00.000Z',
        licenseBasis: 'permissively-licensed-source',
        expectedIds: ['framer'],
        negativeFor: ['squarespace', 'webflow', 'weebly', 'wix'],
        input: { html: '<div data-framer-name="private-component">Excluded copy</div>' },
      },
      {
        id: 'licensed-webforms-export-20260805',
        reviewedAt: '2026-08-05T06:45:00.000Z',
        observedAt: '2026-08-05T06:40:00.000Z',
        licenseBasis: 'public-domain',
        expectedIds: ['aspnet-web-forms'],
        negativeFor: ['angular', 'nextjs', 'nuxt', 'sveltekit'],
        input: { html: '<input name="__VIEWSTATE" value="private-state">' },
      },
      {
        id: 'licensed-squarespace-export-20260805',
        reviewedAt: '2026-08-05T07:05:00.000Z',
        observedAt: '2026-08-05T07:00:00.000Z',
        licenseBasis: 'permissively-licensed-source',
        expectedIds: ['squarespace'],
        negativeFor: ['framer', 'webflow', 'weebly', 'wix'],
        input: { generator: 'Squarespace 7.1' },
      },
      {
        id: 'licensed-wix-export-20260805',
        reviewedAt: '2026-08-05T07:15:00.000Z',
        observedAt: '2026-08-05T07:10:00.000Z',
        licenseBasis: 'permissively-licensed-source',
        expectedIds: ['wix'],
        negativeFor: ['framer', 'squarespace', 'webflow', 'weebly'],
        input: { generator: 'Wix.com Website Builder' },
      },
    ];

    for (const candidate of cases) {
      const fixture = buildReviewedTechnologyFixture(input(candidate));
      const checkedIn = TECHNOLOGY_REVIEWED_FIXTURES.find((item) => item.id === fixture.id);

      assert.deepEqual(fixture, checkedIn);
      assert.doesNotMatch(JSON.stringify(fixture), /private-component|private-state|Excluded copy/u);
    }
  });

  test('creates catalogue-owned negative controls without retaining source page copy', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'reviewed-eleventy-negative',
      expectedIds: [],
      negativeFor: ['eleventy'],
      input: {
        html: '<main>Eleventy named in ordinary visible copy without implementation metadata.</main>',
      },
    }));
    assert.equal(fixture.kind, 'negative');
    assert.deepEqual(fixture.expectedIds, []);
    assert.deepEqual(fixture.negativeFor, ['eleventy']);
    assert.deepEqual(analyzeWebsiteTechnology(fixture.input).findings, []);
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        expectedIds: [],
        negativeFor: ['eleventy'],
        input: { html: '<main>Copied reference page wording</main>' },
      })),
      /canonical review marker/iu,
    );
  });

  test('records expected findings and deliberate nonmatches from one reviewed artefact', () => {
    const fixture = buildReviewedTechnologyFixture(input({
      id: 'reviewed-runtime-mixed-control',
      expectedIds: ['apache-http-server', 'php'],
      negativeFor: ['drupal', 'joomla', 'wordpress'],
      input: {
        httpServer: 'Apache/2.4.68 (Debian)',
        responseHeaders: { 'x-powered-by': 'PHP/8.4.24' },
      },
    }));
    assert.equal(fixture.kind, 'mixed');
    assert.deepEqual(fixture.expectedIds, ['apache-http-server', 'php']);
    assert.deepEqual(fixture.negativeFor, ['drupal', 'joomla', 'wordpress']);
    assert.deepEqual(analyzeWebsiteTechnology(fixture.input).findings.map((finding) => finding.id), [
      'php',
      'apache-http-server',
    ]);
    assert.throws(
      () => buildReviewedTechnologyFixture(input({ negativeFor: ['wordpress'] })),
      /both expect and forbid/iu,
    );
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
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        expectedIds: ['php'],
        input: { responseHeaders: { 'x-origin-debug': 'PHP' } },
      })),
      /not approved/iu,
    );
    assert.throws(
      () => buildReviewedTechnologyFixture(input({
        expectedIds: ['fastly'],
        input: { responseHeaders: { 'x-fastly-request-id': 'https://private-target.invalid/request' } },
      })),
      /target or contact/iu,
    );
  });
});
