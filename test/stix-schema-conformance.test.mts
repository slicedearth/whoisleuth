import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  MAX_SCHEMA_BYTES,
  MAX_VENDOR_TREE_BYTES,
  SCHEMA_REVISION,
  SCHEMA_TREE_SHA256,
  conformanceBundles,
  parseBundle,
  schemaTreeSha256,
  validateStixBundle,
} from '../tools/stix-schema-conformance.mts';

describe('STIX 2.1 schema conformance gate', () => {
  test('validates the current WHOISleuth export families against pinned schemas', async () => {
    assert.equal(SCHEMA_REVISION, 'c4f8d589acf2bdb3783655c89e0ffb6e150006ae');
    assert.match(SCHEMA_TREE_SHA256, /^[a-f0-9]{64}$/u);
    assert.equal(await schemaTreeSha256(), SCHEMA_TREE_SHA256);
    const bundles = conformanceBundles();
    assert.equal(bundles.length, 2);
    await Promise.all(bundles.map((bundle) => validateStixBundle(bundle)));
  });

  test('rejects malformed and oversized bundles without network access', async () => {
    await assert.rejects(validateStixBundle('{"type":"bundle","objects":[{}]}'), /schema validation failed/u);
    assert.throws(() => parseBundle('[]'), /must be an object/u);
  });

  test('rejects oversized vendored files and aggregate trees before unbounded allocation', async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-stix-bounds-'));
    const vendor = path.join(root, 'fixtures/stix/oasis-stix-2.1-json-schemas');
    await mkdir(vendor, { recursive: true });
    try {
      await context.test('per-file bound', async () => {
        await writeFile(path.join(vendor, 'oversized.json'), Buffer.alloc(MAX_SCHEMA_BYTES + 1));
        await assert.rejects(schemaTreeSha256(root), /schema byte limit/u);
        await rm(path.join(vendor, 'oversized.json'));
      });
      await context.test('aggregate bound', async () => {
        const fileBytes = Math.floor(MAX_VENDOR_TREE_BYTES / 9) + 1;
        await Promise.all(Array.from({ length: 9 }, (_value, index) =>
          writeFile(path.join(vendor, `schema-${index}.json`), Buffer.alloc(fileBytes))));
        await assert.rejects(schemaTreeSha256(root), /aggregate byte limit/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
