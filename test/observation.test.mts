import { requiredValue } from './value-assertions.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as observationFacade from '../lib/observation.mts';
import * as observationContract from '../packages/evidence/observation.mts';
import type {
  Observation as CanonicalObservation,
  ObservationInput as CanonicalObservationInput,
  ObservationReadResult as CanonicalObservationReadResult,
  ObservationStatus as CanonicalObservationStatus,
  ScanMode as CanonicalScanMode,
} from '../packages/evidence/observation.mts';
import type {
  Observation as FacadeObservation,
  ObservationInput as FacadeObservationInput,
  ObservationReadResult as FacadeObservationReadResult,
  ObservationStatus as FacadeObservationStatus,
  ScanMode as FacadeScanMode,
} from '../lib/observation.mts';

const {
  MAX_OBSERVATION_DIAGNOSTICS,
  OBSERVATION_VERSION,
  createObservation,
  readObservationEnvelope,
} = observationContract;

type ExactType<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const FACADE_TYPE_COMPATIBILITY: readonly [
  ExactType<CanonicalObservation, FacadeObservation>,
  ExactType<CanonicalObservationInput, FacadeObservationInput>,
  ExactType<CanonicalObservationReadResult, FacadeObservationReadResult>,
  ExactType<CanonicalObservationStatus, FacadeObservationStatus>,
  ExactType<CanonicalScanMode, FacadeScanMode>,
] = [true, true, true, true, true];

test('keeps the historical observation import as an exact contract facade', () => {
  assert.deepEqual(Object.keys(observationContract).sort(), [
    'MAX_OBSERVATION_DIAGNOSTICS',
    'MAX_OBSERVATION_LIMITATIONS',
    'MAX_OBSERVATION_LIMITATION_LENGTH',
    'OBSERVATION_VERSION',
    'createObservation',
    'normalizeCtTimestamp',
    'normalizeExplicitIsoTimestamp',
    'normalizeLegacyIsoTimestamp',
    'readObservationEnvelope',
  ]);
  assert.deepEqual(Object.keys(observationFacade).sort(), Object.keys(observationContract).sort());
  assert.deepEqual(FACADE_TYPE_COMPATIBILITY, [true, true, true, true, true]);
  assert.equal(observationFacade.OBSERVATION_VERSION, observationContract.OBSERVATION_VERSION);
  assert.equal(observationFacade.createObservation, observationContract.createObservation);
  assert.equal(observationFacade.readObservationEnvelope, observationContract.readObservationEnvelope);
  assert.equal(observationFacade.normalizeCtTimestamp, observationContract.normalizeCtTimestamp);
  assert.equal(observationFacade.normalizeExplicitIsoTimestamp, observationContract.normalizeExplicitIsoTimestamp);
  assert.equal(observationFacade.normalizeLegacyIsoTimestamp, observationContract.normalizeLegacyIsoTimestamp);
});

test('creates a deterministic bounded observation envelope', () => {
  const result = createObservation({
    status: 'partial', observedAt: '2026-07-13T01:02:03Z', scanMode: 'deep', source: 'dns',
    durationMs: 12.6, complete: false, truncated: true,
    limitations: [' Point-in-time data. ', 'Point-in-time data.', 'x'.repeat(400)],
    diagnostics: {
      ptr: { status: 'error', error: 'failed\ncontrol', discarded: 2, ignored: 'nope' },
      attemptCount: 4,
      extension_key: 'not part of the first-party v1 vocabulary',
      'bad key': 'discarded',
    },
  });
  assert.equal(result.version, OBSERVATION_VERSION);
  assert.equal(result.observedAt, '2026-07-13T01:02:03.000Z');
  assert.equal(result.durationMs, 13);
  assert.equal(result.limitations.length, 2);
  assert.equal(requiredValue(result.limitations[1]).length, 300);
  assert.deepEqual(result.diagnostics.attemptCount, 4);
  assert.deepEqual(result.diagnostics.ptr, { status: 'error', error: 'failed control', discarded: 2 });
  assert.equal(Object.hasOwn(result.diagnostics, 'extension_key'), false);
  assert.equal(Object.hasOwn(result.diagnostics, 'bad key'), false);
});

test('reader distinguishes absent, supported, invalid, and future envelopes', () => {
  assert.equal(readObservationEnvelope(undefined).state, 'absent');
  assert.equal(readObservationEnvelope({ version: 1 }).state, 'invalid');
  assert.equal(readObservationEnvelope({ version: 99 }).state, 'unsupported');
  const supported = readObservationEnvelope(createObservation({
    status: 'success', observedAt: '2026-07-13T00:00:00Z', source: 'dns', complete: true,
  }));
  assert.equal(supported.state, 'supported');
  assert.equal(supported.observation.complete, true);
});

test('creator never emits an observation timestamp its reader rejects', () => {
  for (const observedAt of [
    '0001-01-01T00:00:00Z',
    '2026-07-13T01:02:03+10:00',
    '9999-12-31T23:59:59Z',
    '0001-01-01T00:00:00+14:00',
    '9999-12-31T23:59:59-14:00',
  ]) {
    const observation = createObservation({ status: 'success', observedAt, source: 'test', complete: true });
    assert.equal(readObservationEnvelope(observation).state, 'supported');
  }
});

test('invalid optional values fail safe without inventing scan profiles', () => {
  const result = createObservation({ status: 'made-up', observedAt: 'bad', scanMode: 'interactive', source: '', durationMs: Infinity });
  assert.equal(result.status, 'error');
  assert.equal(result.scanMode, null);
  assert.equal(result.source, 'unknown');
  assert.equal(result.durationMs, null);
  assert.match(result.observedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('bounds untrusted limitation and diagnostic work before accumulation', () => {
  let outOfRangeLimitationReads = 0;
  const limitations: unknown[] = Array.from({ length: 40 }, (_, index) => `limit-${index}`);
  Object.defineProperty(limitations, '40', {
    configurable: true,
    enumerable: true,
    get() {
      outOfRangeLimitationReads += 1;
      return 'must not be read';
    },
  });
  limitations.length = 1_000_000;

  let diagnosticOwnKeyReads = 0;
  let diagnosticDescriptorReads = 0;
  const boundedDiagnostics = new Proxy({ attemptCount: 4 }, {
    ownKeys() {
      diagnosticOwnKeyReads += 1;
      throw new Error('must not enumerate untrusted diagnostic keys');
    },
    getOwnPropertyDescriptor(target, key) {
      diagnosticDescriptorReads += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const bounded = createObservation({
    status: 'partial',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    limitations,
    diagnostics: boundedDiagnostics,
  });
  assert.equal(outOfRangeLimitationReads, 0);
  assert.equal(bounded.limitations.length, 10);
  assert.deepEqual(bounded.diagnostics, { attemptCount: 4 });
  assert.equal(diagnosticOwnKeyReads, 0);
  assert.ok(diagnosticDescriptorReads > 0 && diagnosticDescriptorReads <= 92);

  const cyclic: Record<string, unknown> = { status: 'error' };
  cyclic.detail = cyclic;
  let accessorReads = 0;
  Object.defineProperty(cyclic, 'error', {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return 'must not be read';
    },
  });
  const cycleResult = createObservation({
    status: 'error',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    diagnostics: { ptr: cyclic },
  });
  assert.deepEqual(cycleResult.diagnostics.ptr, { status: 'error' });
  assert.equal(accessorReads, 0);
});

test('retains every complete flat diagnostic at the public maximum', () => {
  const keys = [
    'a', 'aaaa', 'addressSource', 'advisoryMatches', 'arrayItemsExamined',
    'attemptCount', 'authorityCount', 'caa', 'caa_policy', 'catalogComponents',
    'certificateGroups', 'certificateGroupsTruncated', 'certificateRows',
    'charactersExamined', 'cidrCount', 'classifiedInputs', 'cname',
    'connectionAttempts', 'delegation', 'discarded',
  ];
  const diagnostics = Object.fromEntries(keys.map((key) => [key, {
    status: 'partial',
    error: 'bounded failure',
    detail: 'bounded detail',
    truncated: true,
    discarded: 2,
    count: 3,
  }]));
  const result = createObservation({
    status: 'partial',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    diagnostics,
  });
  assert.equal(Object.keys(result.diagnostics).length, 20);
  for (const key of keys) {
    assert.deepEqual(result.diagnostics[key], {
      status: 'partial',
      error: 'bounded failure',
      detail: 'bounded detail',
      truncated: true,
      discarded: 2,
      count: 3,
    });
  }
});

test('rejects prototype-sensitive and trapping diagnostic properties', () => {
  const prototypeInput = JSON.parse('{"__proto__":{"status":"error","detail":"inherited"}}');
  const created = createObservation({
    status: 'partial',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    diagnostics: prototypeInput,
  });
  assert.equal(Object.getPrototypeOf(created.diagnostics), Object.prototype);
  assert.equal(Object.hasOwn(created.diagnostics, '__proto__'), false);
  assert.equal(created.diagnostics.status, undefined);
  assert.deepEqual(created.diagnostics, {});
  const reread = readObservationEnvelope(created);
  assert.equal(reread.state, 'supported');
  assert.deepEqual(reread.observation?.diagnostics, {});

  const nested = new Proxy({ status: 'error' }, {
    getOwnPropertyDescriptor() {
      throw new Error('nested descriptor trap');
    },
  });
  const trapping = new Proxy({ attemptCount: 2, ptr: nested }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'attemptCount') throw new Error('top-level descriptor trap');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const trapped = createObservation({
    status: 'partial',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    diagnostics: trapping,
  });
  assert.deepEqual(trapped.diagnostics, {});
  assert.equal(readObservationEnvelope(trapped).state, 'supported');
});

test('does not invoke untrusted envelope accessors or coerce non-numeric durations', () => {
  let topLevelAccessorReads = 0;
  const input: Record<string, unknown> = {
    status: 'success',
    observedAt: '2026-07-13T01:02:03Z',
    source: 'fixture',
    durationMs: null,
  };
  Object.defineProperty(input, 'diagnostics', {
    configurable: true,
    enumerable: true,
    get() {
      topLevelAccessorReads += 1;
      throw new Error('must not be read');
    },
  });
  const created = createObservation(input);
  assert.equal(created.durationMs, null);
  assert.deepEqual(created.diagnostics, {});
  assert.equal(topLevelAccessorReads, 0);

  const supported = readObservationEnvelope(created);
  assert.equal(supported.state, 'supported');
  assert.equal(supported.observation?.durationMs, null);

  const accessorEnvelope = { ...created };
  Object.defineProperty(accessorEnvelope, 'version', {
    configurable: true,
    enumerable: true,
    get() {
      topLevelAccessorReads += 1;
      throw new Error('must not be read');
    },
  });
  assert.equal(readObservationEnvelope(accessorEnvelope).state, 'invalid');
  assert.equal(topLevelAccessorReads, 0);

  for (const durationMs of ['', ' ', '0x10', '1e2', '+2', '-2', '2.5', true, {}, []]) {
    const invalidDuration = createObservation({
      status: 'success',
      observedAt: '2026-07-13T01:02:03Z',
      source: 'fixture',
      durationMs,
    });
    assert.equal(invalidDuration.durationMs, null);
    const wireValue = { ...invalidDuration, durationMs };
    const result = readObservationEnvelope(wireValue);
    assert.equal(result.state, 'supported');
    assert.equal(result.observation?.durationMs, null);
  }
});

test('snapshots each untrusted envelope field once before validation and normalisation', () => {
  const input = {
    version: OBSERVATION_VERSION,
    status: 'success',
    observedAt: '2026-07-13T01:02:03Z',
    scanMode: 'deep',
    source: 'dns',
    durationMs: 7,
    complete: true,
    truncated: false,
    limitations: ['Point-in-time evidence.'],
    diagnostics: { attemptCount: 1 },
  };
  const reads = new Map<PropertyKey, number>();
  const stateful = new Proxy(input, {
    getOwnPropertyDescriptor(target, key) {
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      if (count > 1 && key === 'status') return { configurable: true, enumerable: true, value: 'error' };
      if (count > 1 && key === 'source') return { configurable: true, enumerable: true, value: 'unknown' };
      if (count > 1 && key === 'observedAt') return { configurable: true, enumerable: true, value: 'invalid' };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = readObservationEnvelope(stateful);
  assert.equal(result.state, 'supported');
  assert.deepEqual(result.observation, createObservation(input));
  for (const count of reads.values()) assert.equal(count, 1);

  let revoke: (() => void) | null = null;
  const revocable = Proxy.revocable(input, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      revoke?.();
      return descriptor;
    },
  });
  revoke = revocable.revoke;
  assert.equal(readObservationEnvelope(revocable.proxy).state, 'invalid');
});

test('pins and exercises every first-party observation v1 diagnostic key', async () => {
  const fixtureUrl = new URL('./fixtures/observation-diagnostic-vocabulary-v1.json', import.meta.url);
  const bytes = await readFile(fixtureUrl);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '03e5750b00fee5e858e1e67e004ae2bf8cf7d457810fd037584b972891b5f3f0',
  );
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    version?: unknown;
    families?: unknown;
  };
  assert.equal(parsed.version, OBSERVATION_VERSION);
  assert.ok(Array.isArray(parsed.families));
  const families = parsed.families as Array<{ family?: unknown; keys?: unknown }>;
  const familyNames = new Set<string>();
  const keys: string[] = [];
  for (const family of families) {
    assert.equal(typeof family.family, 'string');
    assert.match(family.family as string, /^[a-z0-9_]+$/u);
    assert.equal(familyNames.has(family.family as string), false);
    familyNames.add(family.family as string);
    assert.ok(Array.isArray(family.keys));
    for (const key of family.keys) {
      assert.equal(typeof key, 'string');
      assert.match(key as string, /^[a-z0-9_-]+$/iu);
      assert.ok((key as string).length <= 40);
      keys.push(key as string);
    }
  }
  assert.equal(keys.length, 92);
  assert.equal(new Set(keys).size, 92);
  for (const requiredFamily of ['dns', 'network_context', 'page_identity', 'website_security_posture']) {
    assert.equal(familyNames.has(requiredFamily), true);
  }

  const sortedKeys = [...keys].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  for (let offset = 0; offset < sortedKeys.length; offset += MAX_OBSERVATION_DIAGNOSTICS) {
    const chunk = sortedKeys.slice(offset, offset + MAX_OBSERVATION_DIAGNOSTICS);
    const diagnostics = Object.fromEntries(chunk.map((key, index) => [key, index + 1]));
    const observation = createObservation({
      status: 'success',
      observedAt: '2026-07-13T01:02:03Z',
      source: 'fixture',
      complete: true,
      diagnostics,
    });
    assert.deepEqual(Object.keys(observation.diagnostics), chunk);
    const reread = readObservationEnvelope(observation);
    assert.equal(reread.state, 'supported');
    assert.deepEqual(Object.keys(reread.observation?.diagnostics ?? {}), chunk);
  }
});

test('keeps the frozen observation envelope v1 byte-compatible', async () => {
  const fixtureUrl = new URL('./fixtures/observation-envelope-v1.json', import.meta.url);
  const bytes = await readFile(fixtureUrl);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '1c4f755159df81a7b26f21720b140aa53df87eebb6edf657d17e7af2d50aa4d4',
  );
  const parsed = JSON.parse(bytes.toString('utf8'));
  const result = readObservationEnvelope(parsed);
  assert.equal(result.state, 'supported');
  assert.deepEqual(result.observation, parsed);
  assert.equal(`${JSON.stringify(result.observation, null, 2)}\n`, bytes.toString('utf8'));
});
