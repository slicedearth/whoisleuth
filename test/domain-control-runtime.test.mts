import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import * as domainNameContract from '../packages/evidence/domain-name.mts';
import * as domainControlContract from '../packages/evidence/domain-control-runtime.mts';
import * as domainControlWire from '../packages/contracts/domain-control-manifest.mts';
import * as domainControlCoreFacade from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';
import * as domainControlRecordsFacade from '../frontend/src/lib/analysis/domain-control-records.ts';
import { normalizeDomain as historicalNormalizeDomain } from '../frontend/src/lib/analysis/case-record-core.ts';
import { MAX_DOMAIN_LENGTH as historicalMaxDomainLength } from '../frontend/src/lib/analysis/case-record-contracts.ts';
import {
  DOMAIN_CONTROL_CAA_RECORD_KEYS,
  DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_KEYS,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS,
  DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
  DOMAIN_CONTROL_MANIFEST_ROOT_KEYS,
  DOMAIN_CONTROL_MX_RECORD_KEYS,
  DOMAIN_CONTROL_RECORD_LIST_FIELDS,
  DOMAIN_CONTROL_DS_RECORD_KEYS,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  MAX_DOMAIN_CONTROL_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_JSON_VALUES,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_NOTE_LENGTH,
  MAX_DOMAIN_CONTROL_TEXT_LENGTH,
  MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
  type DomainControlManifestInput,
} from '../packages/contracts/domain-control-manifest.mts';
import { MAX_DOMAIN_NAME_LENGTH } from '../packages/contracts/domain-name.mts';
import {
  buildDomainControlManifest,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { verifyDomainControlPassport } from '../frontend/src/lib/analysis/domain-control-passport.ts';
import type {
  DomainControlManifestDocument,
  DomainControlManifestEntry,
  UnsignedDomainControlManifest,
} from '../packages/evidence/domain-control-runtime.mts';
import type {
  DomainControlPassport,
  DomainControlPassportEntry,
  UnsignedDomainControlPassport,
} from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';

type ExactType<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const FACADE_TYPE_COMPATIBILITY: readonly [
  ExactType<DomainControlManifestDocument, DomainControlPassport>,
  ExactType<DomainControlManifestEntry, DomainControlPassportEntry>,
  ExactType<UnsignedDomainControlManifest, UnsignedDomainControlPassport>,
] = [true, true, true];

const GENERATED_AT = '2026-08-03T00:00:00.000Z';
const EXPIRES_AT = '2026-09-03T00:00:00.000Z';

function input(entry: Record<string, unknown> = { domain: 'example.test' }): Record<string, unknown> {
  return {
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
    expiresAt: EXPIRES_AT,
    entries: [entry],
  };
}

describe('pure domain-control runtime ownership', () => {
  test('keeps both historical frontend paths as exact runtime and type facades', () => {
    const expectedCoreExports = [
      'DOMAIN_CONTROL_MANIFEST_VERSION',
      'DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA',
      'DOMAIN_CONTROL_PASSPORT_LIMITATIONS',
      'DOMAIN_CONTROL_PASSPORT_SCHEMA',
      'DOMAIN_CONTROL_PASSPORT_VERSION',
      'MAX_DOMAIN_CONTROL_MANIFEST_BYTES',
      'MAX_DOMAIN_CONTROL_PASSPORT_BYTES',
      'MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES',
      'assertDomainControlPassportByteBudget',
      'buildUnsignedDomainControlPassport',
      'domainControlPassportSerialisedBytes',
      'normalizeDomainControlPassportDocument',
    ].sort();
    assert.deepEqual(Object.keys(domainControlCoreFacade).sort(), expectedCoreExports);
    for (const name of expectedCoreExports as Array<keyof typeof domainControlCoreFacade>) {
      assert.equal(domainControlCoreFacade[name], domainControlContract[name], name);
    }
    assert.deepEqual(Object.keys(domainControlRecordsFacade).sort(), [
      'MAX_CANONICAL_DOMAIN_CONTROL_RECORDS',
      'canonicalCaaRecord',
      'canonicalDomainControlRecordList',
      'canonicalDsRecord',
      'canonicalMxRecord',
    ].sort());
    for (const name of Object.keys(domainControlRecordsFacade) as Array<keyof typeof domainControlRecordsFacade>) {
      assert.equal(domainControlRecordsFacade[name], domainControlContract[name], name);
    }
    assert.deepEqual(FACADE_TYPE_COMPATIBILITY, [true, true, true]);
    assert.equal(historicalNormalizeDomain, domainNameContract.normalizeDomain);
  });

  test('derives raw wire shapes and executable bounds from dependency-neutral contracts', () => {
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_INPUT_KEYS, ['schema', 'version', 'expiresAt', 'entries']);
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_ROOT_KEYS, ['schema', 'version', 'generatedAt', 'expiresAt', 'entries', 'limitations', 'integrity']);
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS, ['domain', 'nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock', 'renewalReviewAt', 'note']);
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS, ['algorithm', 'canonicalization', 'digestSha256']);
    assert.deepEqual(DOMAIN_CONTROL_RECORD_LIST_FIELDS, ['nameservers', 'ds', 'mx', 'caa']);
    assert.deepEqual(DOMAIN_CONTROL_MX_RECORD_KEYS, ['exchange', 'host', 'value', 'priority', 'preference']);
    assert.deepEqual(DOMAIN_CONTROL_CAA_RECORD_KEYS, ['critical', 'flags', 'tag', 'value']);
    assert.deepEqual(DOMAIN_CONTROL_DS_RECORD_KEYS, ['keyTag', 'key_tag', 'algorithm', 'digestType', 'digest_type', 'digest']);
    for (const descriptor of [
      DOMAIN_CONTROL_MANIFEST_INPUT_KEYS,
      DOMAIN_CONTROL_MANIFEST_ROOT_KEYS,
      DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS,
      DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS,
      DOMAIN_CONTROL_RECORD_LIST_FIELDS,
      DOMAIN_CONTROL_MX_RECORD_KEYS,
      DOMAIN_CONTROL_CAA_RECORD_KEYS,
      DOMAIN_CONTROL_DS_RECORD_KEYS,
      DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
    ]) assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(domainControlContract.DOMAIN_CONTROL_PASSPORT_LIMITATIONS, DOMAIN_CONTROL_MANIFEST_LIMITATIONS);
    assert.equal(domainControlContract.MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES, MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES);
    assert.equal(domainControlContract.MAX_CANONICAL_DOMAIN_CONTROL_RECORDS, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS);
    assert.deepEqual({
      manifestBytes: domainControlWire.MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
      minimumEntries: domainControlWire.MIN_DOMAIN_CONTROL_MANIFEST_ENTRIES,
      maximumEntries: domainControlWire.MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
      minimumRecords: domainControlWire.MIN_DOMAIN_CONTROL_RECORDS,
      retainedRecords: domainControlWire.MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
      recordInputFactor: domainControlWire.DOMAIN_CONTROL_RECORD_INPUT_BOUND_FACTOR,
      inputRecords: domainControlWire.MAX_DOMAIN_CONTROL_INPUT_RECORDS,
      jsonDepth: domainControlWire.MAX_DOMAIN_CONTROL_JSON_DEPTH,
      jsonValues: domainControlWire.MAX_DOMAIN_CONTROL_JSON_VALUES,
      rawDomain: domainControlWire.MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH,
      canonicalDomain: domainControlWire.MAX_DOMAIN_CONTROL_DOMAIN_LENGTH,
      text: domainControlWire.MAX_DOMAIN_CONTROL_TEXT_LENGTH,
      note: domainControlWire.MAX_DOMAIN_CONTROL_NOTE_LENGTH,
      timestamp: domainControlWire.MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
      textInputFactor: domainControlWire.DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR,
      integerText: domainControlWire.MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH,
      mxText: domainControlWire.MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH,
      mxPriority: domainControlWire.MAX_DOMAIN_CONTROL_MX_PRIORITY,
      caaTag: domainControlWire.MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH,
      caaValue: domainControlWire.MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH,
      caaPresentation: domainControlWire.MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH,
      caaFlags: domainControlWire.MAX_DOMAIN_CONTROL_CAA_FLAGS,
      dsDigestMinimum: domainControlWire.MIN_DOMAIN_CONTROL_DS_DIGEST_LENGTH,
      dsDigestMaximum: domainControlWire.MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH,
      dsPresentation: domainControlWire.MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH,
      dsKeyTag: domainControlWire.MAX_DOMAIN_CONTROL_DS_KEY_TAG,
      dsAlgorithm: domainControlWire.MAX_DOMAIN_CONTROL_DS_ALGORITHM,
      dsDigestType: domainControlWire.MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE,
      spkiHex: domainControlWire.DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH,
      manifestDigestHex: domainControlWire.DOMAIN_CONTROL_DIGEST_SHA256_HEX_LENGTH,
    }, {
      manifestBytes: 16_777_216,
      minimumEntries: 1,
      maximumEntries: 100,
      minimumRecords: 0,
      retainedRecords: 32,
      recordInputFactor: 4,
      inputRecords: 128,
      jsonDepth: 16,
      jsonValues: 400_000,
      rawDomain: 1_024,
      canonicalDomain: 253,
      text: 300,
      note: 500,
      timestamp: 64,
      textInputFactor: 4,
      integerText: 32,
      mxText: 500,
      mxPriority: 65_535,
      caaTag: 32,
      caaValue: 500,
      caaPresentation: 600,
      caaFlags: 255,
      dsDigestMinimum: 2,
      dsDigestMaximum: 1_024,
      dsPresentation: 1_200,
      dsKeyTag: 65_535,
      dsAlgorithm: 255,
      dsDigestType: 255,
      spkiHex: 64,
      manifestDigestHex: 64,
    });
    assert.equal(
      domainControlWire.MAX_DOMAIN_CONTROL_INPUT_RECORDS,
      domainControlWire.MAX_CANONICAL_DOMAIN_CONTROL_RECORDS
        * domainControlWire.DOMAIN_CONTROL_RECORD_INPUT_BOUND_FACTOR,
    );
    assert.equal(domainControlWire.MAX_DOMAIN_CONTROL_DOMAIN_LENGTH, MAX_DOMAIN_NAME_LENGTH);
    assert.equal(historicalMaxDomainLength, MAX_DOMAIN_NAME_LENGTH);

    const typedInput: DomainControlManifestInput = {
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: EXPIRES_AT,
      entries: [{
        domain: 'example.test',
        nameservers: ['ns1.example.test'],
        mx: [{ exchange: 'mail.example.test', priority: '10' }],
        caa: [{ tag: 'issue', value: 'ca.example' }],
        ds: [{ key_tag: 12_345, algorithm: 13, digest_type: 2, digest: 'abcdef' }],
      }],
    };
    assert.equal(buildDomainControlManifest(typedInput, GENERATED_AT).entries[0]?.domain, 'example.test');
  });

  test('preserves every structured alias and accepts only agreeing duplicates', () => {
    const { canonicalMxRecord, canonicalCaaRecord, canonicalDsRecord } = domainControlContract;
    for (const host of ['exchange', 'host', 'value']) {
      for (const priority of ['priority', 'preference']) {
        assert.equal(canonicalMxRecord({ [host]: 'MAIL.EXAMPLE.TEST.', [priority]: '10' }), '10 mail.example.test');
      }
    }
    assert.equal(canonicalMxRecord({ exchange: 'MAIL.EXAMPLE.TEST.', host: 'mail.example.test', priority: 10, preference: '10' }), '10 mail.example.test');
    assert.equal(canonicalMxRecord({ exchange: null, host: 'mail.example.test', priority: null, preference: 10 }), '10 mail.example.test');
    assert.equal(canonicalCaaRecord({ tag: 'ISSUE', value: 'ca.example' }), '0 issue ca.example');
    assert.equal(canonicalCaaRecord({ critical: 0, flags: '0', tag: 'issue', value: 'ca.example' }), '0 issue ca.example');
    assert.equal(canonicalDsRecord({ keyTag: 12_345, key_tag: '12345', algorithm: 13, digestType: 2, digest_type: '2', digest: 'ABCDEF' }), '12345 13 2 abcdef');

    assert.throws(() => canonicalMxRecord({ exchange: 'mail.example.test', host: 'other.example.test', priority: 10 }), /aliases must resolve/iu);
    assert.throws(() => canonicalMxRecord({ exchange: 'mail.example.test', priority: 10, preference: 'invalid' }), /aliases must resolve/iu);
    assert.throws(() => canonicalCaaRecord({ critical: 0, flags: 1, tag: 'issue', value: 'ca.example' }), /aliases must resolve/iu);
    assert.throws(() => canonicalDsRecord({ keyTag: 1, key_tag: 2, algorithm: 13, digestType: 2, digest: 'abcdef' }), /aliases must resolve/iu);
    assert.throws(() => canonicalDsRecord({ keyTag: 1, algorithm: 13, digestType: 2, digest_type: 'x', digest: 'abcdef' }), /aliases must resolve/iu);
  });

  test('accepts ordinary structured data and rejects non-ordinary record shapes without invoking values', () => {
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      exchange: 'mail.example.test',
      priority: 10,
    });
    assert.equal(domainControlContract.canonicalMxRecord(nullPrototype), '10 mail.example.test');

    let getterCalls = 0;
    const accessor: Record<string, unknown> = { priority: 10 };
    Object.defineProperty(accessor, 'exchange', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'mail.example.test';
      },
    });
    assert.throws(() => domainControlContract.canonicalMxRecord(accessor), /ordinary data fields/iu);
    assert.equal(getterCalls, 0);

    const hidden = { priority: 10 };
    Object.defineProperty(hidden, 'exchange', { enumerable: false, value: 'mail.example.test' });
    assert.throws(() => domainControlContract.canonicalMxRecord(hidden), /ordinary data fields/iu);
    assert.throws(() => domainControlContract.canonicalMxRecord({ exchange: 'mail.example.test', priority: 10, extra: true }), /unknown field/iu);
    assert.throws(() => domainControlContract.canonicalMxRecord(Object.assign(Object.create({ exchange: 'mail.example.test' }), { priority: 10 })), /plain object/iu);
    assert.throws(() => domainControlContract.canonicalMxRecord(new (class RecordValue {
      exchange = 'mail.example.test';
      priority = 10;
    })()), /plain object/iu);
    const symbolic = { exchange: 'mail.example.test', priority: 10, [Symbol('json-invisible')]: true };
    assert.equal(domainControlContract.canonicalMxRecord(symbolic), '10 mail.example.test');
    assert.throws(() => domainControlContract.canonicalMxRecord({ exchange: 'mail.example.test', priority: 10, toJSON() { return {}; } }), /unknown field/iu);
    const revoked = Proxy.revocable({ exchange: 'mail.example.test', priority: 10 }, {});
    revoked.revoke();
    assert.throws(() => domainControlContract.canonicalMxRecord(revoked.proxy));

    let coercions = 0;
    const coerced = { toString() { coercions += 1; return 'example.test'; } };
    assert.throws(() => buildDomainControlManifest(input({ domain: coerced }), GENERATED_AT), /invalid entry/iu);
    assert.equal(domainControlContract.canonicalMxRecord({ exchange: coerced, priority: 10 }), '');
    assert.equal(coercions, 0);
  });

  test('uses one detached dense-array snapshot and enforces list bounds and kinds', () => {
    const { canonicalDomainControlRecordList } = domainControlContract;
    assert.deepEqual(canonicalDomainControlRecordList([], 'mx'), []);
    assert.deepEqual(
      canonicalDomainControlRecordList(Array.from({ length: 128 }, (_, index) => `${index % 32} mail${index % 32}.example.test`), 'mx'),
      Array.from({ length: 32 }, (_, index) => `${index} mail${index}.example.test`).sort(),
    );
    assert.throws(() => canonicalDomainControlRecordList(Array.from({ length: 129 }, () => '0 .'), 'mx'), /between 0 and 128/iu);
    assert.throws(() => canonicalDomainControlRecordList(new Array(1), 'mx'), /ordinary indexed data/iu);
    assert.throws(() => canonicalDomainControlRecordList(new (class RecordList extends Array<string> {})('0 .'), 'mx'), /between 0 and 128/iu);

    let iteratorCalls = 0;
    const custom = ['0 .'];
    Object.defineProperty(custom, Symbol.iterator, {
      value() {
        iteratorCalls += 1;
        return [][Symbol.iterator]();
      },
    });
    assert.throws(() => canonicalDomainControlRecordList(custom, 'mx'), /ordinary indexed data/iu);
    assert.equal(iteratorCalls, 0);
    const annotated = ['0 .'] as string[] & { source?: string };
    annotated.source = 'json-invisible-array-metadata';
    assert.deepEqual(canonicalDomainControlRecordList(annotated, 'mx'), ['0 .']);
    assert.throws(() => canonicalDomainControlRecordList(['1 13 2 ab'] as unknown, 'unexpected' as 'ds'), /kind is unsupported/iu);

    const target = [{ domain: 'example.test' }];
    let lengthDescriptors = 0;
    const stateful = new Proxy(target, {
      getOwnPropertyDescriptor(value, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
        if (property === 'length' && descriptor) {
          lengthDescriptors += 1;
          return { ...descriptor, value: lengthDescriptors === 1 ? 1 : 101 };
        }
        return descriptor;
      },
    });
    const manifest = buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: EXPIRES_AT,
      entries: stateful,
    }, GENERATED_AT);
    assert.equal(manifest.entries.length, 1);
    assert.equal(lengthDescriptors, 1);

    assert.deepEqual(buildDomainControlManifest(input(), GENERATED_AT).entries[0]?.nameservers, []);
    for (const malformed of [null, undefined, 'ns.example.test', { 0: 'ns.example.test', length: 1 }]) {
      assert.throws(() => buildDomainControlManifest(input({ domain: 'example.test', nameservers: malformed }), GENERATED_AT), /entries|indexed data/iu);
    }
  });

  test('serialises the exact current document to its portable bytes', async () => {
    const raw = await readFile(new URL('./fixtures/domain-control-manifest-v2.json', import.meta.url), 'utf8');
    assert.equal(domainControlContract.serializeDomainControlManifest(JSON.parse(raw)), raw);
  });

  test('returns only the detached validated snapshot from Node and browser verifiers', async () => {
    const valid = buildDomainControlManifest(input(), GENERATED_AT);
    let propertyReads = 0;
    const divergent = new Proxy(structuredClone(valid), {
      get(target, property, receiver) {
        propertyReads += 1;
        if (property === 'entries') return [{ domain: 'not-validated.test' }];
        return Reflect.get(target, property, receiver);
      },
    });
    const nodeVerified = verifyDomainControlManifest(divergent);
    assert.equal(propertyReads, 0);
    assert.notEqual(nodeVerified, divergent);
    assert.equal(nodeVerified.entries[0]?.domain, 'example.test');
    assert.equal(Object.isFrozen(nodeVerified), true);
    assert.equal(Object.isFrozen(nodeVerified.entries), true);

    const wrongDigest = structuredClone(valid) as unknown as {
      integrity: { digestSha256: string };
    };
    wrongDigest.integrity.digestSha256 = `sha256:${'0'.repeat(64)}`;
    let wrongDigestReads = 0;
    const digestProxy = new Proxy(wrongDigest, {
      get(target, property, receiver) {
        wrongDigestReads += 1;
        if (property === 'integrity') return valid.integrity;
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(() => verifyDomainControlManifest(digestProxy), /integrity/iu);
    assert.equal(wrongDigestReads, 0);

    const mutable = structuredClone(valid) as unknown as {
      entries: Array<{ domain: string }>;
    };
    const browserVerification = verifyDomainControlPassport(mutable, GENERATED_AT);
    mutable.entries[0]!.domain = 'changed-after-validation.test';
    const browserVerified = await browserVerification;
    assert.notEqual(browserVerified, mutable);
    assert.equal(browserVerified.entries[0]?.domain, 'example.test');
    assert.equal(Object.isFrozen(browserVerified.entries[0]), true);
  });

  test('keeps structural serialisation separate from integrity verification', async () => {
    const valid = buildDomainControlManifest(input(), GENERATED_AT);
    const changedDigest = {
      ...valid,
      integrity: {
        ...valid.integrity,
        digestSha256: `sha256:${'0'.repeat(64)}`,
      },
    };
    const serialised = domainControlContract.serializeDomainControlManifest(changedDigest);
    assert.equal(
      (JSON.parse(serialised) as { integrity: { digestSha256: string } }).integrity.digestSha256,
      changedDigest.integrity.digestSha256,
    );
    assert.throws(() => verifyDomainControlManifest(changedDigest), /integrity/iu);
    await assert.rejects(() => verifyDomainControlPassport(changedDigest, GENERATED_AT), /integrity/iu);
  });
});
