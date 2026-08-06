import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, test } from 'node:test';

import {
  MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES,
  TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA,
  TECHNOLOGY_EXAMPLE_REVIEW_VERSION,
  buildTechnologyExampleReview,
  main,
  parseArguments,
} from '../tools/technology-example-review.mts';
import { MAX_REVIEWED_FIXTURE_LABEL_LENGTH } from '../tools/technology-fixture-review.mts';

const createdDirectories: string[] = [];
const PACKAGE_INTEGRITY = 'sha512-EYByj6nk+aD9KeVxV6Hmo2/nAAT79P21Y82ycTBOBtrmqilloIbIEhgL2/8Xpt2Jz/pgNqHAwyusOGwmbKeJmA==';

const positiveOptions = Object.freeze({
  id: 'official-docusaurus-starter-20260805',
  expectedIds: ['docusaurus'],
  negativeFor: [],
  licenceBasis: 'permissively-licensed-source' as const,
  sourceReference: 'npm:@docusaurus/core',
  sourceRevision: '3.10.2',
  sourceIntegrity: PACKAGE_INTEGRITY,
  sourceLicence: 'MIT',
  runtimeReference: 'node@26.4.0',
  buildRecipe: 'official-default-starter' as const,
  buildEnvironment: null,
  observedAt: '2026-08-05T01:20:00.000Z',
  reviewedAt: '2026-08-05T01:20:00.000Z',
});

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('reviewed technology reference-build intake', () => {
  test('derives a target-free positive fixture and separately verifiable provenance', () => {
    const html = '<!doctype html><html><head><meta name="generator" content="Docusaurus v3.10.2"></head><body>Reference wording</body></html>';
    const result = buildTechnologyExampleReview(html, positiveOptions);
    assert.equal(result.schema, TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA);
    assert.equal(result.version, TECHNOLOGY_EXAMPLE_REVIEW_VERSION);
    assert.equal(result.fixture.kind, 'positive');
    assert.deepEqual(result.fixture.expectedIds, ['docusaurus']);
    assert.deepEqual(result.fixture.input, {
      generator: 'Docusaurus',
      observedAt: positiveOptions.observedAt,
    });
    assert.equal(result.provenance.fixtureId, result.fixture.id);
    assert.equal(result.provenance.sourceReference, 'npm:@docusaurus/core');
    assert.equal(result.provenance.networkRequestsDuringFixtureEvaluation, 0);
    assert.equal(result.provenance.rawArtifactIncluded, false);
    assert.equal(result.provenance.buildEnvironment, null);
    assert.deepEqual(result.provenance.supportingEnvironments, []);
    assert.equal(result.provenance.responseMetadataSha256, null);
    assert.match(result.provenance.artifactSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(result.provenanceContext, {
      comparisonExcludesCandidateFixtureId: true,
      existingFixtureIdsAtSourceOrigin: [],
      firstObservedExpectedIds: ['docusaurus'],
      independentSourceOriginExpectedIds: [],
      repeatedSourceOriginExpectedIds: [],
    });
    assert.doesNotMatch(JSON.stringify(result), /Reference wording|fixture\.invalid|https?:\/\//u);
  });

  test('distinguishes first, independent, and same-origin reviewed observations', () => {
    const html = '<meta name="generator" content="Docusaurus">';
    const repeated = buildTechnologyExampleReview(html, {
      ...positiveOptions,
      id: 'reviewed-docusaurus-repeat-20260805',
    });
    assert.ok(repeated.provenanceContext.existingFixtureIdsAtSourceOrigin.includes(
      'official-docusaurus-starter-20260805',
    ));
    assert.deepEqual(repeated.provenanceContext.repeatedSourceOriginExpectedIds, ['docusaurus']);
    assert.deepEqual(repeated.provenanceContext.independentSourceOriginExpectedIds, []);

    const independent = buildTechnologyExampleReview(html, {
      ...positiveOptions,
      id: 'reviewed-docusaurus-independent-20260805',
      sourceReference: 'git:example/docusaurus-reference',
      sourceRevision: '92fd5b8da0f5c3d4164ae02fe605de363753e504',
      sourceIntegrity: null,
      runtimeReference: null,
      buildRecipe: 'reviewed-repository-artifact',
    });
    assert.deepEqual(independent.provenanceContext.independentSourceOriginExpectedIds, ['docusaurus']);
    assert.deepEqual(independent.provenanceContext.repeatedSourceOriginExpectedIds, []);

    const first = buildTechnologyExampleReview(
      '<main class="shopify-section"></main>',
      {
        ...positiveOptions,
        id: 'reviewed-commerce-first-20260805',
        expectedIds: ['shopify'],
        sourceReference: 'git:example/commerce-reference',
        sourceRevision: 'c9986dacd02965a788d66d96ba49021258f8459d',
        sourceIntegrity: null,
        runtimeReference: null,
        buildRecipe: 'reviewed-repository-artifact',
      },
      { fixtures: [], sources: [] },
    );
    assert.deepEqual(first.provenanceContext.firstObservedExpectedIds, ['shopify']);
    assert.deepEqual(first.provenanceContext.independentSourceOriginExpectedIds, []);
    assert.deepEqual(first.provenanceContext.repeatedSourceOriginExpectedIds, []);
  });

  test('derives a negative control only when the complete artefact produces no findings', () => {
    const result = buildTechnologyExampleReview(
      '<main>This Eleventy example explains the starter without implementation metadata.</main>',
      {
        ...positiveOptions,
        id: 'official-eleventy-base-blog-negative-20260805',
        expectedIds: [],
        negativeFor: ['eleventy'],
        sourceReference: 'git:11ty/eleventy-base-blog',
        sourceRevision: 'e37a55c4c4705d7881929de5242ec50448b5eb0b',
        sourceIntegrity: null,
        buildRecipe: 'official-repository-build',
      },
    );
    assert.equal(result.fixture.kind, 'negative');
    assert.deepEqual(result.fixture.expectedIds, []);
    assert.deepEqual(result.fixture.negativeFor, ['eleventy']);
    assert.doesNotMatch(JSON.stringify(result.fixture), /This Eleventy example explains the starter/u);
    assert.throws(
      () => buildTechnologyExampleReview(
        '<meta name="generator" content="Eleventy">',
        {
          ...positiveOptions,
          id: 'invalid-negative',
          expectedIds: [],
          negativeFor: ['eleventy'],
        },
      ),
      /unexpectedly detected/iu,
    );

    const broadControl = buildTechnologyExampleReview(
      '<main>Ordinary static starter</main>',
      {
        ...positiveOptions,
        id: 'official-static-starter-negative-20260805',
        expectedIds: [],
        negativeFor: [
          'angular', 'aspnet', 'aspnet-web-forms', 'astro', 'docusaurus',
          'eleventy', 'express', 'framer', 'gatsby', 'hexo', 'hugo', 'jekyll',
          'nextjs', 'nuxt', 'php', 'squarespace', 'sveltekit', 'webflow',
          'weebly', 'wix',
        ],
        sourceReference: 'git:example/static-starter',
        sourceRevision: 'ad55e344217ad86c1572567e10ba5f40002a13a3',
        sourceIntegrity: null,
        runtimeReference: null,
        buildRecipe: 'reviewed-repository-artifact',
      },
    );
    assert.equal(broadControl.fixture.label, 'Reviewed negative control for 20 technology signatures');
    assert.ok(broadControl.fixture.label.length <= MAX_REVIEWED_FIXTURE_LABEL_LENGTH);
  });

  test('binds a containerised reference build to an immutable image digest', () => {
    const buildEnvironment = 'oci:docker.io/library/ruby:3.4-bookworm@sha256:34c2dbcb42f6d5d638bb47735d39d6a0360e1431b92e5054e5f24161b712cb47';
    const result = buildTechnologyExampleReview(
      '<meta name="generator" content="Jekyll v4.4.1">',
      {
        ...positiveOptions,
        id: 'official-jekyll-minima-starter-20260805',
        expectedIds: ['jekyll'],
        sourceReference: 'git:jekyll/minima',
        sourceRevision: '4de322363fca5927e6f4012cb94f6dad69ab5e6c',
        sourceIntegrity: null,
        runtimeReference: 'ruby@3.4.10',
        buildRecipe: 'official-container-default',
        buildEnvironment,
      },
    );
    assert.equal(result.provenance.buildRecipe, 'official-container-default');
    assert.equal(result.provenance.buildEnvironment, buildEnvironment);
    assert.deepEqual(result.fixture.expectedIds, ['jekyll']);
  });

  test('records a pinned build runtime for an official documentation example', () => {
    const buildEnvironment = 'oci:docker.io/library/node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43';
    const result = buildTechnologyExampleReview(
      '<main ng-version="22.1.2"></main>',
      {
        ...positiveOptions,
        id: 'official-angular-ssr-starter-20260805',
        expectedIds: ['angular'],
        sourceReference: 'npm:@angular/cli',
        sourceRevision: '22.1.2',
        sourceIntegrity: 'sha512-gzB+iuZzB507DAkZb9s5+Jw8QRzOBolUhHEuAKH74xF6oWlEP5JdexfTgti45SjXaKKqeYpODJFnUmSQQJRhxA==',
        runtimeReference: 'node@24.19.0',
        buildRecipe: 'official-documentation-example',
        buildEnvironment,
      },
    );

    assert.equal(result.provenance.buildRecipe, 'official-documentation-example');
    assert.equal(result.provenance.buildEnvironment, buildEnvironment);
    assert.deepEqual(result.fixture.expectedIds, ['angular']);
  });

  test('records an exact four-part runtime version used by an official build', () => {
    const result = buildTechnologyExampleReview(
      '<a href="index.php?route=common/home"></a>',
      {
        ...positiveOptions,
        id: 'official-opencart-reference-20260805',
        expectedIds: ['opencart'],
        licenceBasis: 'copyleft-licensed-source',
        sourceReference: 'git:opencart/opencart',
        sourceRevision: '2c4efa4d95d29a510f59037b2a302f8e2a229e4a',
        sourceIntegrity: null,
        sourceLicence: 'GPL-3.0-only',
        runtimeReference: 'opencart@4.1.0.3',
        buildRecipe: 'official-container-default',
        buildEnvironment: 'oci:docker.io/library/php:8.2-apache@sha256:bf518c4a303e5574b967201f22228f2f39e214afd23dcd6d58c965bc3c008086',
      },
    );

    assert.equal(result.provenance.runtimeReference, 'opencart@4.1.0.3');
    assert.deepEqual(result.fixture.expectedIds, ['opencart']);
  });

  test('records a locally permitted reference build without treating its runtime as open source', () => {
    const result = buildTechnologyExampleReview(
      '<main>Default welcome page</main>',
      {
        ...positiveOptions,
        id: 'official-cms-local-reference-20260805',
        expectedIds: ['craft-cms', 'nginx'],
        negativeFor: ['drupal', 'wordpress'],
        licenceBasis: 'minimized-with-permission',
        sourceReference: 'git:craftcms/cms',
        sourceRevision: 'd3fe86760eb6a6c2c2ba82495dcebb69d108b261',
        sourceIntegrity: null,
        sourceLicence: 'proprietary',
        runtimeReference: 'craft-cms@5.10.13.1',
        buildRecipe: 'official-repository-build',
        buildEnvironment: 'oci:docker.io/craftcms/nginx:8.2@sha256:bead949d91c821518a084f3db193bb77cfca4f7436488908d7643305f178c317',
        supportingEnvironments: [
          'oci:docker.io/library/composer:2@sha256:4d71c3c2109c61d5415544264b59ad4087e4c5b7244481723664138fd36d5040',
          'oci:docker.io/library/mariadb:11.8@sha256:d9f7eb2637296652f24b484afd5d246f759f49f5babcadc6a9e344c9acb75fbf',
        ],
        httpServer: 'nginx',
        responseHeaders: { 'x-powered-by': 'Craft CMS' },
      },
    );

    assert.equal(result.fixture.licenseBasis, 'minimized-with-permission');
    assert.equal(result.provenance.sourceLicence, 'proprietary');
    assert.deepEqual(result.fixture.expectedIds, ['craft-cms', 'nginx']);
  });

  test('records a licensed repository artefact without inventing a build runtime', () => {
    const result = buildTechnologyExampleReview(
      '<html data-wf-page="private-page-id" data-wf-site="private-site-id"><main>Excluded copy</main></html>',
      {
        ...positiveOptions,
        id: 'licensed-static-export-20260805',
        expectedIds: ['webflow'],
        negativeFor: ['framer', 'squarespace', 'weebly', 'wix'],
        licenceBasis: 'copyleft-licensed-source',
        sourceReference: 'git:example/static-export',
        sourceRevision: '92fd5b8da0f5c3d4164ae02fe605de363753e504',
        sourceIntegrity: null,
        sourceLicence: 'LGPL-3.0-only',
        runtimeReference: null,
        buildRecipe: 'reviewed-repository-artifact',
      },
    );

    assert.equal(result.provenance.runtimeReference, null);
    assert.equal(result.provenance.derivation, 'reviewed-repository-artifact');
    assert.deepEqual(result.fixture.input, {
      html: '<main data-wf-page="fixture"></main>',
      observedAt: positiveOptions.observedAt,
    });
    assert.doesNotMatch(JSON.stringify(result), /private-page-id|private-site-id|Excluded copy/u);
  });

  test('accepts public-domain repository artefacts without broadening source retention', () => {
    const result = buildTechnologyExampleReview(
      '<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="excluded-state">',
      {
        ...positiveOptions,
        id: 'licensed-webforms-export-20260805',
        expectedIds: ['aspnet-web-forms'],
        negativeFor: ['angular', 'nextjs', 'nuxt', 'sveltekit'],
        licenceBasis: 'public-domain',
        sourceReference: 'git:example/public-domain-export',
        sourceRevision: 'c9986dacd02965a788d66d96ba49021258f8459d',
        sourceIntegrity: null,
        sourceLicence: 'CC0-1.0',
        runtimeReference: null,
        buildRecipe: 'reviewed-repository-artifact',
      },
    );

    assert.equal(result.fixture.licenseBasis, 'public-domain');
    assert.deepEqual(result.fixture.input, {
      html: '<input name="__VIEWSTATE">',
      observedAt: positiveOptions.observedAt,
    });
    assert.doesNotMatch(JSON.stringify(result), /excluded-state/u);
  });

  test('records a reviewed official demonstration without inventing build or runtime provenance', () => {
    const result = buildTechnologyExampleReview(
      '<meta name="generator" content="TYPO3 CMS"><main>Excluded demonstration copy</main>',
      {
        ...positiveOptions,
        id: 'official-typo3-demonstration-20260805',
        expectedIds: ['apache-http-server', 'typo3'],
        negativeFor: ['drupal', 'joomla', 'wordpress'],
        licenceBasis: 'official-demonstration-terms',
        sourceReference: 'official:typo3/demo',
        sourceRevision: '2026-08-05T03:52:53.000Z',
        sourceIntegrity: null,
        sourceLicence: 'official-demonstration-terms',
        runtimeReference: null,
        buildRecipe: 'official-public-demonstration',
        httpServer: 'Apache',
        observedAt: '2026-08-05T03:52:53.000Z',
        reviewedAt: '2026-08-05T03:54:00.000Z',
      },
    );

    assert.equal(result.provenance.sourceKind, 'demonstration');
    assert.equal(result.provenance.runtimeReference, null);
    assert.equal(result.provenance.derivation, 'reviewed-public-demonstration');
    assert.equal(result.provenance.buildEnvironment, null);
    assert.deepEqual(result.fixture.expectedIds, ['apache-http-server', 'typo3']);
    assert.doesNotMatch(JSON.stringify(result), /Excluded demonstration copy|https?:\/\//u);
  });

  test('minimises response metadata and preserves explicit mixed controls', () => {
    const buildEnvironment = 'oci:docker.io/library/drupal:11-apache@sha256:5fb998e12185c2861643ded29abf3dcabfc5d6741c443175fd62f5e6b25ffbf1';
    const result = buildTechnologyExampleReview(
      '<main data-drupal-selector="fixture"></main>',
      {
        ...positiveOptions,
        id: 'official-drupal-container-20260805',
        expectedIds: ['apache-http-server', 'drupal', 'php'],
        negativeFor: ['joomla', 'wordpress'],
        licenceBasis: 'copyleft-licensed-source',
        sourceReference: 'oci:docker.io/library/drupal',
        sourceRevision: '11-apache',
        sourceIntegrity: 'sha256:5fb998e12185c2861643ded29abf3dcabfc5d6741c443175fd62f5e6b25ffbf1',
        sourceLicence: 'GPL-2.0-or-later',
        runtimeReference: 'drupal@11.4.4',
        buildRecipe: 'official-container-default',
        buildEnvironment,
        httpServer: 'Apache/2.4.68 (Debian)',
        responseHeaders: { 'x-powered-by': 'PHP/8.5.9' },
      },
    );
    assert.equal(result.fixture.kind, 'mixed');
    assert.deepEqual(result.fixture.expectedIds, ['apache-http-server', 'drupal', 'php']);
    assert.deepEqual(result.fixture.negativeFor, ['joomla', 'wordpress']);
    assert.deepEqual(result.fixture.input, {
      httpServer: 'Apache',
      html: '<main data-drupal-selector="fixture"></main>',
      responseHeaders: { 'x-powered-by': 'PHP' },
      observedAt: positiveOptions.observedAt,
    });
    assert.match(result.provenance.responseMetadataSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(result), /2\.4\.68|8\.5\.9/u);
  });

  test('rejects conflicting expectations and unverified or target-bearing provenance', () => {
    const html = '<meta name="generator" content="Docusaurus">';
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        negativeFor: ['docusaurus'],
      }),
      /both expected and forbidden/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceReference: 'https://reference.invalid/source',
      }),
      /target-free npm package, repository, OCI image, or official demonstration/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceIntegrity: null,
      }),
      /require a sha512/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceRevision: 'latest',
      }),
      /Package revision version/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceRevision: '3.10.2-01',
      }),
      /leading zeroes/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceRevision: '3.10.2-a..b',
      }),
      /empty identifier/iu,
    );
    assert.equal(buildTechnologyExampleReview(html, {
      ...positiveOptions,
      sourceRevision: '3.10.2-rc.1+build.4',
    }).provenance.sourceRevision, '3.10.2-rc.1+build.4');
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        runtimeReference: 'node@latest',
      }),
      /exact three- or four-part version/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        expectedIds: ['astro'],
      }),
      /do not match/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        buildRecipe: 'official-container-default',
      }),
      /require an immutable OCI build environment/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        buildEnvironment: 'oci:docker.io/library/node:latest@sha256:not-a-digest',
      }),
      /immutable OCI image reference/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        sourceReference: 'oci:docker.io/library/nginx',
        sourceRevision: '1.29-alpine',
        sourceIntegrity: 'sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de',
        buildRecipe: 'official-container-default',
        buildEnvironment: 'oci:docker.io/library/caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d',
      }),
      /same immutable image/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        responseHeaders: { server: 'Private value' },
      }),
      /does not support server/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview(html, {
        ...positiveOptions,
        supportingEnvironments: ['oci:docker.io/library/mariadb:latest@sha256:not-a-digest'],
      }),
      /Supporting environments/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview('<main data-wf-page="fixture"></main>', {
        ...positiveOptions,
        sourceReference: 'git:example/static-export',
        sourceRevision: '92fd5b8da0f5c3d4164ae02fe605de363753e504',
        sourceIntegrity: null,
        runtimeReference: null,
        buildRecipe: 'official-repository-build',
      }),
      /Runtime reference/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview('<main data-wf-page="fixture"></main>', {
        ...positiveOptions,
        runtimeReference: null,
        buildRecipe: 'reviewed-repository-artifact',
      }),
      /repository source/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview('<meta name="generator" content="TYPO3 CMS">', {
        ...positiveOptions,
        id: 'invalid-demonstration',
        expectedIds: ['typo3'],
        licenceBasis: 'official-demonstration-terms',
        sourceReference: 'official:typo3/demo',
        sourceRevision: positiveOptions.observedAt,
        sourceIntegrity: null,
        sourceLicence: 'official-demonstration-terms',
        buildRecipe: 'official-public-demonstration',
      }),
      /no inferred runtime version/iu,
    );
    assert.throws(
      () => buildTechnologyExampleReview('<meta name="generator" content="TYPO3 CMS">', {
        ...positiveOptions,
        id: 'invalid-demonstration-licence',
        expectedIds: ['typo3'],
        licenceBasis: 'official-demonstration-terms',
        sourceReference: 'official:typo3/demo',
        sourceRevision: positiveOptions.observedAt,
        sourceIntegrity: null,
        sourceLicence: 'MIT',
        runtimeReference: null,
        buildRecipe: 'official-public-demonstration',
      }),
      /reviewed demonstration terms basis/iu,
    );
  });

  test('parses explicit options and reads only a bounded local UTF-8 artefact', async () => {
    const parsed = parseArguments([
      'dist/index.html',
      '--id=official-docusaurus-starter-20260805',
      '--expected=docusaurus',
      '--licence-basis=permissively-licensed-source',
      '--source-reference=npm:@docusaurus/core',
      '--source-revision=3.10.2',
      `--source-integrity=${PACKAGE_INTEGRITY}`,
      '--source-licence=MIT',
      '--runtime-reference=node@26.4.0',
      '--build-recipe=official-default-starter',
      '--supporting-environment=oci:docker.io/library/mariadb:11.8@sha256:d9f7eb2637296652f24b484afd5d246f759f49f5babcadc6a9e344c9acb75fbf',
      '--supporting-environment=oci:docker.io/library/node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43',
      '--http-server=Netlify',
      '--response-header=x-vercel-id:fixture-response',
      '--observed-at=2026-08-05T01:20:00.000Z',
      '--reviewed-at=2026-08-05T01:20:00.000Z',
    ]);
    assert.equal(parsed.inputPath, 'dist/index.html');
    assert.deepEqual(parsed.expectedIds, ['docusaurus']);
    assert.deepEqual(parsed.negativeFor, []);
    assert.equal(parsed.httpServer, 'Netlify');
    assert.deepEqual(parsed.responseHeaders, { 'x-vercel-id': 'fixture-response' });
    assert.deepEqual(parsed.supportingEnvironments, [
      'oci:docker.io/library/mariadb:11.8@sha256:d9f7eb2637296652f24b484afd5d246f759f49f5babcadc6a9e344c9acb75fbf',
      'oci:docker.io/library/node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43',
    ]);
    const demonstration = parseArguments([
      'capture.html',
      '--id=official-demonstration',
      '--expected=typo3',
      '--licence-basis=official-demonstration-terms',
      '--source-reference=official:typo3/demo',
      '--source-revision=2026-08-05T03:52:53.000Z',
      '--source-licence=official-demonstration-terms',
      '--build-recipe=official-public-demonstration',
      '--observed-at=2026-08-05T03:52:53.000Z',
      '--reviewed-at=2026-08-05T03:54:00.000Z',
    ]);
    assert.equal(demonstration.runtimeReference, null);
    assert.equal(demonstration.sourceIntegrity, null);
    assert.throws(() => parseArguments(['page.html', '--unknown=value']), /Unknown option/iu);

    const directory = await mkdtemp(path.join(tmpdir(), 'technology-example-review-'));
    createdDirectories.push(directory);
    const htmlPath = path.join(directory, 'index.html');
    await writeFile(htmlPath, '<meta name="generator" content="Docusaurus">', 'utf8');
    const stdout = capture();
    const stderr = capture();
    assert.equal(await main([
      htmlPath,
      ...Object.entries({
        id: positiveOptions.id,
        expected: positiveOptions.expectedIds.join(','),
        'licence-basis': positiveOptions.licenceBasis,
        'source-reference': positiveOptions.sourceReference,
        'source-revision': positiveOptions.sourceRevision,
        'source-integrity': positiveOptions.sourceIntegrity,
        'source-licence': positiveOptions.sourceLicence,
        'runtime-reference': positiveOptions.runtimeReference,
        'build-recipe': positiveOptions.buildRecipe,
        'observed-at': positiveOptions.observedAt,
        'reviewed-at': positiveOptions.reviewedAt,
      }).map(([key, value]) => `--${key}=${value}`),
    ], stdout.stream, stderr.stream), 0);
    assert.equal(JSON.parse(stdout.value()).fixture.id, positiveOptions.id);
    assert.equal(stderr.value(), '');

    await writeFile(htmlPath, Buffer.alloc(MAX_TECHNOLOGY_EXAMPLE_HTML_BYTES + 1, 97));
    const oversizedErrors = capture();
    assert.equal(await main([htmlPath], capture().stream, oversizedErrors.stream), 2);
    assert.match(oversizedErrors.value(), /between 1 byte/iu);
  });
});
