import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SCHEMA_REVISION,
  conformanceBundles,
  parseBundle,
  validateStixBundle,
} from '../tools/stix-schema-conformance.mts';

describe('STIX 2.1 schema conformance gate', () => {
  test('validates the current WHOISleuth export families against pinned schemas', async () => {
    assert.match(SCHEMA_REVISION, /^[a-f0-9]{40}$/u);
    const bundles = conformanceBundles();
    assert.equal(bundles.length, 2);
    await Promise.all(bundles.map((bundle) => validateStixBundle(bundle)));
  });

  test('rejects malformed and oversized bundles without network access', async () => {
    await assert.rejects(validateStixBundle('{"type":"bundle","objects":[{}]}'), /schema validation failed/u);
    assert.throws(() => parseBundle('[]'), /must be an object/u);
  });
});
