import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  TECHNOLOGY_REVIEWED_SOURCE_SCHEMA,
  TECHNOLOGY_REVIEWED_SOURCE_VERSION,
  type TechnologyReviewedSource,
} from '../fixtures/technology-reviewed-sources.mts';
import {
  technologyExampleArtifactDigest,
  technologyResponseMetadataDigest,
} from '../tools/technology-example-review.mts';
import {
  TECHNOLOGY_SOURCE_MANIFEST_SCHEMA,
  TECHNOLOGY_SOURCE_MANIFEST_VERSION,
  MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES,
  formatTechnologySourceVerification,
  main,
  parseTechnologySourceVerificationArguments,
  verifyTechnologySources,
} from '../tools/technology-source-verify.mts';

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function writer() {
  let value = '';
  return { stream: { write(chunk: string) { value += chunk; } }, read: () => value };
}

const HTML = '<main>Reviewed local fixture</main>';
const RESPONSE = Object.freeze({
  httpServer: 'nginx/1.29.8',
  responseHeaders: Object.freeze({}),
});
const SOURCE: TechnologyReviewedSource = Object.freeze({
  schema: TECHNOLOGY_REVIEWED_SOURCE_SCHEMA,
  version: TECHNOLOGY_REVIEWED_SOURCE_VERSION,
  fixtureId: 'official-local-container-20260805',
  sourceKind: 'container',
  sourceReference: 'oci:docker.io/library/nginx',
  sourceRevision: '1.29-alpine',
  sourceIntegrity: 'sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de',
  sourceLicence: 'BSD-2-Clause',
  licenceReviewedAt: '2026-08-05T02:36:00.000Z',
  runtimeReference: 'nginx@1.29.8',
  buildRecipe: 'official-container-default',
  buildEnvironment: 'oci:docker.io/library/nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de',
  supportingEnvironments: Object.freeze([]),
  artifactSha256: technologyExampleArtifactDigest(HTML),
  responseMetadataSha256: technologyResponseMetadataDigest(RESPONSE),
  derivation: 'offline-local-build',
  networkRequestsDuringFixtureEvaluation: 0,
  rawArtifactIncluded: false,
});

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema: TECHNOLOGY_SOURCE_MANIFEST_SCHEMA,
    version: TECHNOLOGY_SOURCE_MANIFEST_VERSION,
    entries: [{
      fixtureId: SOURCE.fixtureId,
      artifactPath: '/private/local/reference.html',
      ...RESPONSE,
    }],
    ...overrides,
  };
}

describe('technology source verifier', () => {
  test('verifies a rebuilt artefact without returning its path or evidence values', async () => {
    const report = await verifyTechnologySources(manifest(), {
      sources: [SOURCE],
      requireAll: true,
      readArtifact: async () => HTML,
    });
    assert.equal(report.summary.ready, true);
    assert.equal(report.summary.complete, true);
    assert.deepEqual(report.results, [{
      fixtureId: SOURCE.fixtureId,
      status: 'match',
      artifactMatch: true,
      responseMetadataMatch: true,
    }]);
    assert.equal(report.bounds.networkRequests, 0);
    assert.equal(report.bounds.writes, 0);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /private\/local|nginx\/1\.29\.8|Reviewed local fixture/u);
    assert.match(formatTechnologySourceVerification(report), /Verified: 1\/1; mismatches: 0/u);
  });

  test('reports artefact and metadata drift independently', async () => {
    const report = await verifyTechnologySources(manifest({
      entries: [{
        fixtureId: SOURCE.fixtureId,
        artifactPath: 'changed.html',
        httpServer: 'Caddy',
      }],
    }), {
      sources: [SOURCE],
      readArtifact: async () => '<main>Changed fixture</main>',
    });
    assert.equal(report.summary.ready, false);
    assert.deepEqual(report.results[0], {
      fixtureId: SOURCE.fixtureId,
      status: 'mismatch',
      artifactMatch: false,
      responseMetadataMatch: false,
    });
    assert.match(formatTechnologySourceVerification(report), /artefact=different; response metadata=different/u);
  });

  test('rejects incomplete, unknown, duplicated, and over-broad manifests', async () => {
    const second = Object.freeze({ ...SOURCE, fixtureId: 'official-second-container-20260805' });
    await assert.rejects(
      verifyTechnologySources(manifest(), { sources: [SOURCE, second], requireAll: true, readArtifact: async () => HTML }),
      /omits fixtures/iu,
    );
    await assert.rejects(
      verifyTechnologySources(manifest({ entries: [{ fixtureId: 'unknown-fixture', artifactPath: 'fixture.html' }] }), {
        sources: [SOURCE],
        readArtifact: async () => HTML,
      }),
      /unknown fixtures/iu,
    );
    await assert.rejects(
      verifyTechnologySources(manifest({
        entries: [
          { fixtureId: SOURCE.fixtureId, artifactPath: 'one.html' },
          { fixtureId: SOURCE.fixtureId, artifactPath: 'two.html' },
        ],
      }), { sources: [SOURCE], readArtifact: async () => HTML }),
      /unique lowercase identifiers/iu,
    );
    await assert.rejects(
      verifyTechnologySources(manifest({ extra: true }), { sources: [SOURCE], readArtifact: async () => HTML }),
      /unsupported fields/iu,
    );
    await assert.rejects(
      verifyTechnologySources(manifest({
        entries: [{ fixtureId: SOURCE.fixtureId, artifactPath: 'fixture.html', responseHeaders: [] }],
      }), { sources: [SOURCE], readArtifact: async () => HTML }),
      /Response headers must be an object/iu,
    );
  });

  test('parses only the bounded read-only CLI switches', () => {
    assert.deepEqual(parseTechnologySourceVerificationArguments(['manifest.json']), {
      manifestPath: 'manifest.json',
      requireAll: false,
      json: false,
    });
    assert.deepEqual(parseTechnologySourceVerificationArguments(['manifest.json', '--require-all', '--json']), {
      manifestPath: 'manifest.json',
      requireAll: true,
      json: true,
    });
    assert.throws(
      () => parseTechnologySourceVerificationArguments(['manifest.json', '--json', '--json']),
      /Usage/iu,
    );
    assert.throws(
      () => parseTechnologySourceVerificationArguments(['manifest.json', '--write']),
      /Usage/iu,
    );
  });

  test('bounds and validates the manifest before interpreting it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'technology-source-verify-'));
    createdDirectories.push(directory);
    const manifestPath = path.join(directory, 'manifest.json');
    const errors = writer();
    await writeFile(manifestPath, '{not-json', 'utf8');
    assert.equal(await main([manifestPath], writer().stream, errors.stream), 2);
    assert.match(errors.read(), /valid JSON/iu);
    await writeFile(manifestPath, Buffer.alloc(MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES + 1, 97));
    const oversizedErrors = writer();
    assert.equal(await main([manifestPath], writer().stream, oversizedErrors.stream), 2);
    assert.match(oversizedErrors.read(), /between 1 byte/iu);
  });
});
