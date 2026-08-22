import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES,
  DOMAIN_CONTROL_MANIFEST_COMPATIBILITY,
  DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION,
  DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  defineSchemaLifecycleFamily,
  type SchemaLifecycleFamily,
} from '../packages/contracts/schema-lifecycle.mts';
import {
  buildDomainControlManifest,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import {
  buildDomainControlPassport,
  verifyDomainControlPassport,
} from '../frontend/src/lib/analysis/domain-control-passport.ts';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const GENERATED_AT = '2026-08-03T00:00:00.000Z';

type MutableLifecycle = {
  id: string;
  owner: string;
  privacy: string;
  contracts: Array<Record<string, unknown>>;
  fixtures: Array<Record<string, unknown>>;
  compatibility: Array<Record<string, unknown>>;
};

function mutableLifecycle(): MutableLifecycle {
  return structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as unknown as MutableLifecycle;
}

function assertRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertRecursivelyFrozen(descriptor.value, seen);
  }
}

async function rawFixture(id: string): Promise<Readonly<{ raw: string; document: Record<string, unknown> }>> {
  const fixture = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find((candidate) => candidate.id === id);
  assert.ok(fixture, `Lifecycle fixture is registered: ${id}`);
  const bytes = await readFile(new URL(fixture.path, REPOSITORY_ROOT));
  assert.equal(bytes.byteLength, fixture.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
  assert.equal(bytes.at(-1), 0x0a);
  return { raw: bytes.toString('utf8'), document: JSON.parse(bytes.toString('utf8')) as Record<string, unknown> };
}

describe('domain-control schema lifecycle', () => {
  it('owns one exact current input and output contract', () => {
    assertRecursivelyFrozen(DOMAIN_CONTROL_SCHEMA_LIFECYCLE);
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.id, 'domain-control-manifest');
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.owner, 'packages/contracts/domain-control-manifest.mts');
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.privacy, 'analyst_authored_sensitive');
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS, [DOMAIN_CONTROL_MANIFEST_VERSION]);
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES, [{
      version: DOMAIN_CONTROL_MANIFEST_VERSION,
      canonicalization: 'sorted-json-v2',
      explicit: true,
    }]);
    assert.equal(DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION, 'sorted-json-v2');
    assert.deepEqual(
      new Set(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.contracts.map(({ schema }) => schema)),
      new Set([DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, DOMAIN_CONTROL_MANIFEST_SCHEMA]),
    );
    assert.ok(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.contracts.every(({ lifecycle }) => lifecycle === 'current'));
    assert.deepEqual(
      new Set(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.map(({ id }) => id)),
      new Set(['domain-control-manifest-input-v1', 'domain-control-manifest-v2']),
    );
    assert.deepEqual(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.compatibility, [
      DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY,
      DOMAIN_CONTROL_MANIFEST_COMPATIBILITY,
    ]);
    assert.equal(DOMAIN_CONTROL_MANIFEST_INPUT_VERSION, 1);
  });

  it('produces and verifies the exact current fixture in both runtimes', async () => {
    const [{ document: input }, current] = await Promise.all([
      rawFixture('domain-control-manifest-input-v1'),
      rawFixture('domain-control-manifest-v2'),
    ]);
    const nodeManifest = buildDomainControlManifest(input, GENERATED_AT);
    const browserManifest = await buildDomainControlPassport(input, GENERATED_AT);
    assert.equal(`${JSON.stringify(nodeManifest, null, 2)}\n`, current.raw);
    assert.deepEqual(browserManifest, nodeManifest);
    assert.equal(verifyDomainControlManifest(current.document).version, DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal((await verifyDomainControlPassport(current.document, GENERATED_AT)).version, DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(
      (current.document.integrity as Record<string, unknown>).digestSha256,
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find(({ id }) => id === 'domain-control-manifest-v2')?.contentDigestSha256,
    );
  });

  it('uses locale-independent current bytes and rejects reader-only versions without mutation', async () => {
    const input = {
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: '2026-09-03T00:00:00.000Z',
      entries: ['aa.example', 'ab.example', 'az.example', 'z.example'].map((domain) => ({ domain })),
    };
    const originalLocaleCompare = String.prototype.localeCompare;
    let manifest: ReturnType<typeof buildDomainControlManifest>;
    String.prototype.localeCompare = function forbiddenLocaleCompare(): never {
      throw new Error('Domain-control ordering must not consult localeCompare.');
    };
    try {
      manifest = buildDomainControlManifest(input, GENERATED_AT);
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
    }
    assert.deepEqual(manifest.entries.map(({ domain }) => domain), [
      'aa.example', 'ab.example', 'az.example', 'z.example',
    ]);

    const { integrity, ...unsigned } = manifest;
    const suppliedOrder = { ...unsigned, entries: [...unsigned.entries].reverse() };
    const signedSuppliedOrder = {
      ...suppliedOrder,
      integrity: {
        ...integrity,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(suppliedOrder)).digest('hex')}`,
      },
    };
    assert.deepEqual(
      verifyDomainControlManifest(signedSuppliedOrder).entries.map(({ domain }) => domain),
      ['z.example', 'az.example', 'ab.example', 'aa.example'],
    );

    const unsupported = structuredClone(signedSuppliedOrder) as Record<string, unknown>;
    unsupported.version = 1;
    const before = structuredClone(unsupported);
    assert.throws(() => verifyDomainControlManifest(unsupported), /unsupported|version/iu);
    await assert.rejects(verifyDomainControlPassport(unsupported, GENERATED_AT), /unsupported|version/iu);
    assert.deepEqual(unsupported, before);
  });

  it('defensively copies lifecycle metadata and rejects duplicate or divergent declarations', () => {
    const source = mutableLifecycle();
    const copied = defineSchemaLifecycleFamily(source as unknown as SchemaLifecycleFamily);
    source.id = 'changed-after-definition';
    source.contracts[0]!.schema = 'whoisleuth.changed-after-definition';
    assert.equal(copied.id, 'domain-control-manifest');
    assert.equal(copied.contracts[0]?.schema, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA);
    assertRecursivelyFrozen(copied);

    const duplicate = mutableLifecycle();
    duplicate.contracts.push(structuredClone(duplicate.contracts[1]!));
    assert.throws(() => defineSchemaLifecycleFamily(duplicate as unknown as SchemaLifecycleFamily));

    const divergentOwner = mutableLifecycle();
    divergentOwner.compatibility[0]!.owner = 'packages/contracts/other-owner.mts';
    assert.throws(
      () => defineSchemaLifecycleFamily(divergentOwner as unknown as SchemaLifecycleFamily),
      /does not match its contracts/iu,
    );

    const mismatchedFixture = mutableLifecycle();
    mismatchedFixture.fixtures[0]!.version = DOMAIN_CONTROL_MANIFEST_VERSION;
    assert.throws(() => defineSchemaLifecycleFamily(mismatchedFixture as unknown as SchemaLifecycleFamily));
  });
});
