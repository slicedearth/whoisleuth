import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA,
  TECHNOLOGY_REVIEWED_FIXTURE_VERSION,
  TECHNOLOGY_REVIEWED_FIXTURES,
  TECHNOLOGY_REVIEW_LICENCE_BASES,
} from '../fixtures/technology-reviewed-fixtures.mts';
import {
  TECHNOLOGY_PROFILE_VERSION,
  TECHNOLOGY_SIGNATURE_CATALOGUE,
  analyzeWebsiteTechnology,
} from '../lib/website-technology.mts';

const FIXTURE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LICENCE_BASES = new Set<string>(TECHNOLOGY_REVIEW_LICENCE_BASES);

describe('contributor-reviewed technology fixture corpus', () => {
  test('keeps every reviewed observation compatible, minimized, and deterministic', () => {
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
      assert.ok(fixture.expectedIds.length > 0);
      assert.ok(fixture.expectedIds.every((id) => catalogueIds.has(id)));
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
});
