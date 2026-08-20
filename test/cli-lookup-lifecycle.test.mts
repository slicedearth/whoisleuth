import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  CLI_LOOKUP_QUERY_TYPES,
  CLI_LOOKUP_SCHEMA,
  CLI_LOOKUP_SCHEMA_LIFECYCLE,
  CLI_LOOKUP_VERSION,
  LEGACY_CLI_LOOKUP_VERSION,
  MAX_CLI_LOOKUP_BYTES,
} from '../packages/contracts/cli-lookup.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  buildCliLookupDocument,
  normalizeCliLookupDocument,
  parseCliLookupDocument,
  parseSavedLookupDocument,
  serializeCliLookupDocument,
  type CliLookupDocument,
  type UnknownRecord,
} from '../cli/saved-lookup.mts';
import { SCHEMA_LIFECYCLE_HOOK_MODULES } from '../tools/schema-lifecycle-repository.mts';

const FIXTURE_URLS = {
  legacy: new URL('./fixtures/cli-lookup-v1.json', import.meta.url),
  legacyAsn: new URL('./fixtures/cli-lookup-asn-v1.json', import.meta.url),
  currentDomain: new URL('./fixtures/cli-lookup-v2.json', import.meta.url),
  currentAsn: new URL('./fixtures/cli-lookup-asn-v2.json', import.meta.url),
};
const ENVELOPE_KEYS = new Set([
  'schema',
  'version',
  'generatedAt',
  'mode',
  'query',
  'type',
  'inputHostname',
  'registrableDomain',
  'isSubdomain',
  'collectionContext',
]);

async function fixture(url: URL): Promise<string> {
  return readFile(url, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resultPortion(document: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(document).filter(([key]) => !ENVELOPE_KEYS.has(key)));
}

function assertRecursivelyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertRecursivelyFrozen(item);
}

describe('CLI Lookup schema lifecycle', () => {
  test('owns one immutable extensible version history and discriminated consumer boundary', () => {
    assert.equal(CLI_LOOKUP_SCHEMA_LIFECYCLE.id, 'cli-lookup');
    assert.equal(CLI_LOOKUP_SCHEMA_LIFECYCLE.metadata.metadataVersion, 3);
    assert.equal(
      SCHEMA_LIFECYCLE_REGISTRY.some((family) => family.id === CLI_LOOKUP_SCHEMA_LIFECYCLE.id),
      true,
    );
    assert.deepEqual(CLI_LOOKUP_QUERY_TYPES, ['domain', 'ipv4', 'ipv6', 'asn']);
    assert.deepEqual(
      CLI_LOOKUP_SCHEMA_LIFECYCLE.contracts.map((contract) => ({
        version: contract.version,
        lifecycle: contract.lifecycle,
        readable: contract.readable,
        emitted: contract.emitted,
        exactKeys: contract.exactKeys,
        extensionPolicy: contract.extensionPolicy,
      })),
      [
        { version: 1, lifecycle: 'legacy', readable: true, emitted: false, exactKeys: false, extensionPolicy: 'preserve_bounded' },
        { version: 2, lifecycle: 'current', readable: true, emitted: true, exactKeys: false, extensionPolicy: 'preserve_bounded' },
      ],
    );
    assert.deepEqual(
      CLI_LOOKUP_SCHEMA_LIFECYCLE.metadata.consumerEdges
        .find((edge) => edge.id === 'cli-lookup.cli-read-domain')
        ?.acceptedContracts[0]?.discriminator,
      { path: '$.type', values: ['domain'] },
    );
    assert.deepEqual(
      CLI_LOOKUP_SCHEMA_LIFECYCLE.metadata.consumerEdges
        .find((edge) => edge.id === 'cli-lookup.cli-read-all')
        ?.acceptedContracts[0]?.discriminator,
      null,
    );
    assertRecursivelyFrozen(CLI_LOOKUP_SCHEMA_LIFECYCLE);
  });

  test('pins historical domain and current domain and ASN fixture bytes', async () => {
    const cases = [
      {
        id: 'cli-lookup-v1',
        raw: await fixture(FIXTURE_URLS.legacy),
        bytes: 952,
        digest: '0e6601693e384b29285ead97b20947c3a464baf2521277901ff86ad5a6e3a59e',
        version: LEGACY_CLI_LOOKUP_VERSION,
        type: 'domain',
      },
      {
        id: 'cli-lookup-asn-v1',
        raw: await fixture(FIXTURE_URLS.legacyAsn),
        bytes: 714,
        digest: 'bb06e18c67527e559a039f7f826d4d605d7581a556e2e6e511c461ba97dcfdef',
        version: LEGACY_CLI_LOOKUP_VERSION,
        type: 'asn',
      },
      {
        id: 'cli-lookup-v2',
        raw: await fixture(FIXTURE_URLS.currentDomain),
        bytes: 4_410,
        digest: 'd98356ede18ddd12fde8cf10b0cfa43c42f6c9a09f1951e0605e1ec912892778',
        version: CLI_LOOKUP_VERSION,
        type: 'domain',
      },
      {
        id: 'cli-lookup-asn-v2',
        raw: await fixture(FIXTURE_URLS.currentAsn),
        bytes: 714,
        digest: 'a3ee74df02050d6efd935784734c8c4cfd5fcb9833393de68935f5040faf2856',
        version: CLI_LOOKUP_VERSION,
        type: 'asn',
      },
    ] as const;

    for (const item of cases) {
      assert.equal(Buffer.byteLength(item.raw, 'utf8'), item.bytes, item.id);
      assert.equal(sha256(item.raw), item.digest, item.id);
      assert.equal(item.raw.endsWith('\n'), true, item.id);
      assert.equal(item.raw.startsWith('\uFEFF'), false, item.id);
      const document = parseCliLookupDocument(item.raw);
      assert.equal(document.version, item.version, item.id);
      assert.equal(document.type, item.type, item.id);
      const serialised = serializeCliLookupDocument(document);
      if (item.id !== 'cli-lookup-v1') assert.equal(serialised, item.raw, item.id);
      else assert.deepEqual(parseCliLookupDocument(serialised), document, item.id);
      assertRecursivelyFrozen(document);
    }

    assert.equal(
      CLI_LOOKUP_SCHEMA_LIFECYCLE.fixtures.every((item) => (
        cases.some((expected) => expected.id === item.id
          && expected.bytes === item.bytes
          && expected.digest === item.sha256)
      )),
      true,
    );
    assert.throws(
      () => parseSavedLookupDocument(cases.find((item) => item.id === 'cli-lookup-asn-v2')!.raw),
      /domain lookup documents only/u,
    );
  });

  test('reproduces both current fixtures through the canonical builder and serializer', async () => {
    const domainRaw = await fixture(FIXTURE_URLS.currentDomain);
    const domainSource = JSON.parse(domainRaw) as UnknownRecord;
    const domain = buildCliLookupDocument(
      String(domainSource.query),
      {
        type: 'domain',
        value: String(domainSource.registrableDomain),
        inputHostname: String(domainSource.inputHostname),
        registrableDomain: String(domainSource.registrableDomain),
        isSubdomain: Boolean(domainSource.isSubdomain),
      },
      resultPortion(domainSource),
      String(domainSource.generatedAt),
      String(domainSource.mode),
    );
    assert.equal(serializeCliLookupDocument(domain), domainRaw);

    const asnRaw = await fixture(FIXTURE_URLS.currentAsn);
    const asnSource = JSON.parse(asnRaw) as UnknownRecord;
    const asn = buildCliLookupDocument(
      String(asnSource.query),
      { type: 'asn', value: String(asnSource.query) },
      resultPortion(asnSource),
      String(asnSource.generatedAt),
      String(asnSource.mode),
    );
    assert.equal(serializeCliLookupDocument(asn), asnRaw);
  });

  test('reads every emitted query type while retaining the domain-only compatibility facade', async () => {
    const source = JSON.parse(await fixture(FIXTURE_URLS.currentAsn)) as UnknownRecord;
    for (const [query, classified] of [
      ['192.0.2.8', { type: 'ipv4' as const, value: '192.0.2.8' }],
      ['2001:db8::8', { type: 'ipv6' as const, value: '2001:db8::8' }],
      ['AS64496', { type: 'asn' as const, value: 'AS64496' }],
    ] as const) {
      const document = buildCliLookupDocument(
        query,
        classified,
        resultPortion(source),
        '2026-08-20T00:00:00.000Z',
        'fast',
      );
      const raw = serializeCliLookupDocument(document);
      assert.equal(parseCliLookupDocument(raw).type, classified.type);
      assert.throws(() => parseSavedLookupDocument(raw), /domain lookup documents only/u);
    }
  });

  test('preserves bounded extensions on a detached frozen snapshot without invoking accessors', async () => {
    const domainFixtureForHostileInputs = await fixture(FIXTURE_URLS.currentDomain);
    const source = JSON.parse(domainFixtureForHostileInputs) as UnknownRecord;
    source.extensionProbe = { values: ['first'] };
    const normalized = normalizeCliLookupDocument(source);
    ((source.extensionProbe as UnknownRecord).values as string[])[0] = 'mutated';
    assert.deepEqual((normalized.extensionProbe as UnknownRecord).values, ['first']);
    assertRecursivelyFrozen(normalized);

    let getterCalls = 0;
    Object.defineProperty(source, 'accessorProbe', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private';
      },
    });
    assert.throws(() => normalizeCliLookupDocument(source), /non-ordinary object field/u);
    assert.equal(getterCalls, 0);

    const proxied = new Proxy(JSON.parse(await fixture(FIXTURE_URLS.currentDomain)), {});
    assert.throws(() => normalizeCliLookupDocument(proxied), /non-ordinary object/u);

    let resultGetterCalls = 0;
    const result = resultPortion(JSON.parse(await fixture(FIXTURE_URLS.currentDomain)) as UnknownRecord);
    Object.defineProperty(result, 'accessorProbe', {
      enumerable: true,
      get() {
        resultGetterCalls += 1;
        return 'private';
      },
    });
    assert.throws(
      () => buildCliLookupDocument(
        'example.test',
        {
          type: 'domain',
          value: 'example.test',
          inputHostname: 'example.test',
          registrableDomain: 'example.test',
          isSubdomain: false,
        },
        result,
        '2026-08-20T00:00:00.000Z',
      ),
      /non-ordinary object field/u,
    );
    assert.equal(resultGetterCalls, 0);

    const ordinaryResult = resultPortion(JSON.parse(
      await fixture(FIXTURE_URLS.currentDomain),
    ) as UnknownRecord);
    ordinaryResult.extensionProbe = { values: ['first'] };
    ordinaryResult.collectionContext = { observerLabel: 'upstream-spoof' };
    const built = buildCliLookupDocument(
      'example.test',
      {
        type: 'domain',
        value: 'example.test',
        inputHostname: 'example.test',
        registrableDomain: 'example.test',
        isSubdomain: false,
      },
      ordinaryResult,
      '2026-08-20T00:00:00.000Z',
    );
    ((ordinaryResult.extensionProbe as UnknownRecord).values as string[])[0] = 'mutated';
    assert.deepEqual((built.extensionProbe as UnknownRecord).values, ['first']);
    assert.equal(built.collectionContext, undefined);
    assertRecursivelyFrozen(built);

    let contextGetterCalls = 0;
    const hostileContext = {};
    Object.defineProperty(hostileContext, 'observerLabel', {
      enumerable: true,
      get() {
        contextGetterCalls += 1;
        throw new Error('private-context-marker');
      },
    });
    assert.throws(
      () => buildCliLookupDocument(
        'example.test',
        {
          type: 'domain', value: 'example.test', inputHostname: 'example.test',
          registrableDomain: 'example.test', isSubdomain: false,
        },
        resultPortion(JSON.parse(domainFixtureForHostileInputs) as UnknownRecord),
        '2026-08-20T00:00:00.000Z',
        'fast',
        hostileContext,
      ),
      (error: unknown) => error instanceof TypeError
        && /non-ordinary field/u.test(error.message)
        && !error.message.includes('private-context-marker'),
    );
    assert.equal(contextGetterCalls, 0);

    let classifiedGets = 0;
    const hostileClassified = new Proxy({
      type: 'domain', value: 'example.test', inputHostname: 'example.test',
      registrableDomain: 'example.test', isSubdomain: false,
    }, {
      get(target, key, receiver) {
        classifiedGets += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    assert.throws(
      () => buildCliLookupDocument(
        'example.test', hostileClassified as Parameters<typeof buildCliLookupDocument>[1],
        resultPortion(JSON.parse(domainFixtureForHostileInputs) as UnknownRecord),
        '2026-08-20T00:00:00.000Z',
      ),
      /ordinary object/u,
    );
    assert.equal(classifiedGets, 0);
  });

  test('enforces the portable output ceiling and rejects cross-type or future envelopes', async () => {
    const source = JSON.parse(await fixture(FIXTURE_URLS.currentDomain)) as UnknownRecord;
    assert.throws(
      () => serializeCliLookupDocument({ ...source, extensionProbe: 'x'.repeat(MAX_CLI_LOOKUP_BYTES) }),
      /limited to 8388608 bytes/u,
    );
    let tailGetterCalls = 0;
    const oversized = { ...source, extensionProbe: 'x'.repeat(MAX_CLI_LOOKUP_BYTES) };
    Object.defineProperty(oversized, 'untouchedTail', {
      enumerable: true,
      get() {
        tailGetterCalls += 1;
        return 'private-tail-marker';
      },
    });
    const originalStringify = JSON.stringify;
    let largestStringifiedInput = 0;
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      if (typeof value === 'string') largestStringifiedInput = Math.max(largestStringifiedInput, value.length);
      return Reflect.apply(originalStringify, JSON, [value, ...args]);
    }) as typeof JSON.stringify;
    try {
      assert.throws(
        () => normalizeCliLookupDocument(oversized),
        /limited to 8388608 bytes/u,
      );
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(tailGetterCalls, 0);
    assert.equal(largestStringifiedInput, 0);
    assert.throws(
      () => normalizeCliLookupDocument({ ...source, version: 3 }),
      /version 1 or 2/u,
    );
    assert.throws(
      () => normalizeCliLookupDocument({ ...source, type: 'asn' }),
      /declared lookup type/u,
    );
  });

  test('binds every hook to a fixed statically imported module export', () => {
    assert.equal(CLI_LOOKUP_SCHEMA, 'whoisleuth.cli.lookup');
    for (const hook of CLI_LOOKUP_SCHEMA_LIFECYCLE.metadata.hooks) {
      const module = SCHEMA_LIFECYCLE_HOOK_MODULES[
        hook.module as keyof typeof SCHEMA_LIFECYCLE_HOOK_MODULES
      ];
      assert.ok(module, hook.module);
      assert.equal(typeof (module as Record<string, unknown>)[hook.exportName], 'function', hook.id);
    }
  });
});
