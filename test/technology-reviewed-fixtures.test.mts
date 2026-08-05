import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
  TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
  TECHNOLOGY_REVIEWED_FIXTURES,
  TECHNOLOGY_REVIEW_LICENCE_BASES,
} from '../fixtures/technology-reviewed-fixtures.mts';
import {
  TECHNOLOGY_REVIEWED_SOURCE_SCHEMA,
  TECHNOLOGY_REVIEWED_SOURCE_VERSION,
  TECHNOLOGY_REVIEWED_SOURCES,
} from '../fixtures/technology-reviewed-sources.mts';
import {
  TECHNOLOGY_PROFILE_VERSION,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
} from '../lib/website-technology.mts';

const FIXTURE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LICENCE_BASES = new Set<string>(TECHNOLOGY_REVIEW_LICENCE_BASES);
const PROVENANCE_LICENCE_BASES = new Set([
  'minimized-with-permission',
  'permissively-licensed-source',
  'copyleft-licensed-source',
  'official-demonstration-terms',
]);
const EXACT_SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const EXACT_RUNTIME_VERSION_RE = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const OCI_REFERENCE_RE = /^oci:(?:[a-z0-9.-]+\/)*[a-z0-9._-]+:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/u;

describe('contributor-reviewed technology fixture corpus', () => {
  test('keeps every reviewed observation compatible, minimised, and deterministic', () => {
    const ids = new Set<string>();
    const catalogueIds = new Set(TECHNOLOGY_SIGNATURE_CATALOGUE.map((item) => item.id));
    for (const fixture of TECHNOLOGY_REVIEWED_FIXTURES) {
      assert.equal(fixture.schema, TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA);
      assert.equal(fixture.version, TECHNOLOGY_REVIEWED_FIXTURE_VERSION);
      assert.equal(fixture.catalogueVersion, TECHNOLOGY_PROFILE_VERSION);
      assert.match(fixture.id, FIXTURE_ID_RE);
      assert.equal(ids.has(fixture.id), false, `Duplicate reviewed fixture id: ${fixture.id}`);
      ids.add(fixture.id);
      assert.ok(LICENCE_BASES.has(fixture.licenseBasis));
      assert.ok(Number.isFinite(Date.parse(fixture.observedAt)));
      assert.ok(Number.isFinite(Date.parse(fixture.reviewedAt)));
      assert.ok(Date.parse(fixture.observedAt) <= Date.parse(fixture.reviewedAt));
      assert.ok(fixture.expectedIds.every((id) => catalogueIds.has(id)));
      assert.ok(fixture.negativeFor.every((id) => catalogueIds.has(id)));
      assert.equal(fixture.expectedIds.some((id) => fixture.negativeFor.includes(id)), false);
      if (fixture.kind === 'negative') {
        assert.equal(fixture.expectedIds.length, 0);
        assert.ok(fixture.negativeFor.length > 0);
      } else if (fixture.kind === 'mixed') {
        assert.ok(fixture.expectedIds.length > 0);
        assert.ok(fixture.negativeFor.length > 0);
      } else {
        assert.ok(fixture.expectedIds.length > 0);
        assert.equal(fixture.negativeFor.length, 0);
        assert.equal(fixture.kind, fixture.expectedIds.length > 1 ? 'overlap' : 'positive');
      }
      assert.deepEqual(fixture.privacy, {
        rawPageRetained: false,
        sourceTargetRetained: false,
        contactsRetained: false,
      });
      assert.deepEqual(
        analyzeWebsiteTechnology(fixture.input).findings.map((finding) => finding.id).sort(),
        [...fixture.expectedIds].sort(),
      );
      const serialized = JSON.stringify(fixture);
      assert.doesNotMatch(serialized, /https?:\/\/(?!cdn\.shopify\.com|static\.parastorage\.com|wixstatic\.com|static\.squarespace\.com|static1\.squarespace\.com|framerusercontent\.com|editmysite\.com|cloudfront\.net|cdn\d+\.bigcommerce\.com)/iu);
      assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    }
  });

  test('binds every reviewed reference fixture to bounded target-free build provenance', () => {
    const fixturesById = new Map(TECHNOLOGY_REVIEWED_FIXTURES.map((fixture) => [fixture.id, fixture]));
    const sourceIds = new Set<string>();
    for (const source of TECHNOLOGY_REVIEWED_SOURCES) {
      assert.equal(source.schema, TECHNOLOGY_REVIEWED_SOURCE_SCHEMA);
      assert.equal(source.version, TECHNOLOGY_REVIEWED_SOURCE_VERSION);
      assert.equal(sourceIds.has(source.fixtureId), false, `Duplicate reviewed source: ${source.fixtureId}`);
      sourceIds.add(source.fixtureId);
      const fixture = fixturesById.get(source.fixtureId);
      assert.ok(fixture, `Reviewed source has no fixture: ${source.fixtureId}`);
      assert.ok(PROVENANCE_LICENCE_BASES.has(fixture.licenseBasis));
      assert.match(source.artifactSha256, /^[a-f0-9]{64}$/u);
      if (source.responseMetadataSha256 !== null) {
        assert.match(source.responseMetadataSha256, /^[a-f0-9]{64}$/u);
      }
      assert.equal(
        source.responseMetadataSha256 !== null,
        typeof fixture.input.httpServer === 'string'
          || Boolean(fixture.input.responseHeaders && Object.keys(fixture.input.responseHeaders).length),
        `Response metadata provenance mismatch: ${source.fixtureId}`,
      );
      assert.ok(source.sourceLicence.length > 0 && source.sourceLicence.length <= 80);
      assert.ok(Number.isFinite(Date.parse(source.licenceReviewedAt)));
      assert.equal(source.networkRequestsDuringFixtureEvaluation, 0);
      assert.equal(source.rawArtifactIncluded, false);
      assert.ok(source.supportingEnvironments.length <= 4);
      assert.equal(new Set(source.supportingEnvironments).size, source.supportingEnvironments.length);
      assert.ok(source.supportingEnvironments.every((value) => OCI_REFERENCE_RE.test(value)));
      assert.equal(source.supportingEnvironments.includes(source.buildEnvironment ?? ''), false);
      if (source.sourceKind !== 'demonstration') {
        const runtimeVersion = /^[a-z][a-z0-9._-]*@(.+)$/u.exec(source.runtimeReference ?? '')?.[1];
        assert.match(runtimeVersion ?? '', EXACT_RUNTIME_VERSION_RE);
        assert.equal(source.derivation, 'offline-local-build');
      }
      if (source.buildRecipe === 'official-container-default') {
        assert.notEqual(source.buildEnvironment, null);
      }
      if (source.buildEnvironment !== null) {
        assert.match(source.buildEnvironment, OCI_REFERENCE_RE);
      }
      if (source.sourceKind === 'package') {
        assert.match(source.sourceReference, /^npm:(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u);
        assert.match(source.sourceRevision, EXACT_SEMVER_RE);
        assert.match(source.sourceIntegrity ?? '', /^sha512-[A-Za-z0-9+/]{80,96}={0,2}$/u);
      } else if (source.sourceKind === 'repository') {
        assert.match(source.sourceReference, /^git:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u);
        assert.match(source.sourceRevision, /^[a-f0-9]{40}$/u);
        assert.equal(source.sourceIntegrity, null);
      } else if (source.sourceKind === 'container') {
        assert.match(source.sourceReference, /^oci:(?:[a-z0-9.-]+\/)*[a-z0-9._-]+$/u);
        assert.match(source.sourceRevision, /^[a-z0-9][a-z0-9._-]{0,79}$/u);
        assert.match(source.sourceIntegrity ?? '', /^sha256:[a-f0-9]{64}$/u);
        assert.equal(
          source.buildEnvironment,
          `${source.sourceReference}:${source.sourceRevision}@${source.sourceIntegrity}`,
        );
      } else {
        assert.match(source.sourceReference, /^official:[a-z0-9][a-z0-9._/-]*$/u);
        assert.ok(Number.isFinite(Date.parse(source.sourceRevision)));
        assert.equal(source.sourceRevision, fixture.observedAt);
        assert.equal(source.sourceIntegrity, null);
        assert.equal(source.sourceLicence, 'official-demonstration-terms');
        assert.equal(source.runtimeReference, null);
        assert.equal(source.buildRecipe, 'official-public-demonstration');
        assert.equal(source.buildEnvironment, null);
        assert.equal(source.supportingEnvironments.length, 0);
        assert.equal(source.derivation, 'reviewed-public-demonstration');
      }
      const serialized = JSON.stringify(source);
      assert.doesNotMatch(serialized, /https?:\/\//iu);
      assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    }
    for (const fixture of TECHNOLOGY_REVIEWED_FIXTURES) {
      assert.equal(
        sourceIds.has(fixture.id),
        PROVENANCE_LICENCE_BASES.has(fixture.licenseBasis),
        `Fixture provenance mismatch: ${fixture.id}`,
      );
    }
  });
});
