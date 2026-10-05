import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  consumerFixtures,
  runConsumer,
  verifyConsumerRoundtrip,
  verifyConsumerCaseProjection,
  assertMispPrivacy,
  MAX_CONSUMER_INPUT_BYTES,
  compareMispAttributeTimes,
  verifyOfficialMispSchema,
} from './interchange-consumer-harness.mts';
import { parseExternalIntelligenceDocument } from '../frontend/src/lib/analysis/external-intelligence-import.ts';

type Value = Record<string, unknown>;
const fixtures = await consumerFixtures();
const fixture = (id: string) => fixtures.find((item) => item.id === id)!;
const objects = (id: string) => fixture(id).value.objects as Value[];
const event = (value: Value) => value.Event as Value;
const attributes = (value: Value) => event(value).Attribute as Value[];
const preview = (value: Value) =>
  parseExternalIntelligenceDocument(
    value,
    createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  );

test('real export owners provide bounded private-field-free fixtures and conserved lifecycle identities', () => {
  assert.equal(fixtures.length, 15);
  assert.equal(fixtures.filter((item) => item.negative).length, 2);
  assert.doesNotMatch(JSON.stringify(fixtures), /private-fixture-fields-must-not-export/u);
  const managed = (state: string) =>
    objects(`stix-managed-${state}`).filter((item) => item.type === 'indicator');
  const initial = managed('new'),
    renewed = managed('renewed'),
    expired = managed('expired'),
    withdrawn = managed('withdrawn');
  assert.equal(initial.length, 2);
  for (const next of [renewed, expired, withdrawn])
    assert.deepEqual(
      next.map((item) => item.id),
      initial.map((item) => item.id),
    );
  assert.equal(initial[0]!.valid_until, '2026-09-01T00:00:00.000Z');
  assert.equal(renewed[0]!.valid_until, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(expired, initial, 'Local expiry must not silently revoke the original export.');
  assert.equal(withdrawn[0]!.revoked, true);
  assert.equal(withdrawn[1]!.revoked, false);
  for (const state of ['new', 'renewed', 'expired', 'withdrawn'])
    assertMispPrivacy(fixture(`misp-managed-${state}`).value);
});

test('import projection retains source clocks and markings, not validity as observation or implicit deletion', () => {
  const stix = preview(fixture('stix-markings').value);
  assert.ok(stix.items.some((item) => item.markings.includes('TLP:AMBER')));
  const managed = preview(fixture('stix-managed-renewed').value);
  assert.ok(
    managed.items.some(
      (item) =>
        item.entityValue === 'candidate.example' && item.observedAt === '2026-07-31T00:00:00.000Z',
    ),
  );
  assert.ok(
    managed.items
      .filter((item) => item.entityValue === 'unknown-time.example')
      .every((item) => item.observedAt === null),
  );
  assert.ok(managed.items.every((item) => item.observedAt !== '2026-10-01T00:00:00.000Z'));
  const misp = preview(fixture('misp-markings').value);
  assert.ok(
    misp.items.every(
      (item) =>
        item.markings.includes('distribution=0') &&
        item.markings.includes('attribute-distribution=5'),
    ),
  );
  assert.ok(misp.items.every((item) => item.labels.includes('tlp:amber')));
  const withdrawn = preview(fixture('misp-managed-withdrawn').value);
  assert.equal(withdrawn.items.length, 1);
  assert.ok(withdrawn.exclusions.some((item) => /deleted/iu.test(item.reason)));
  assert.ok(withdrawn.sourceInspection!.transformations.length > 0);
});

test('import value controls exclude malformed domains without mutating the source or retaining private prose', () => {
  const source = structuredClone(fixture('misp-defensive').value);
  attributes(source)[0]!.value = 'not a domain';
  attributes(source)[0]!.comment = 'reserved-private-comment';
  const before = JSON.stringify(source),
    result = preview(source);
  assert.equal(result.items.length, 1);
  assert.ok(result.exclusions.length > 0);
  assert.doesNotMatch(JSON.stringify(result), /reserved-private-comment/u);
  assert.equal(JSON.stringify(source), before);
  const stix = structuredClone(fixture('stix-defensive').value);
  const domain = (stix.objects as Value[]).find((item) => item.type === 'domain-name')!;
  domain.value = '*.candidate.example';
  assert.ok(!preview(stix).items.some((item) => item.externalId === domain.id));
});

test('privacy controls independently reject sharing, publication, IDS and correlation broadening', () => {
  const edits: Array<(value: Value) => void> = [
    (value) => {
      event(value).published = true;
    },
    (value) => {
      event(value).distribution = '3';
    },
    (value) => {
      event(value).disable_correlation = false;
    },
    (value) => {
      attributes(value)[0]!.to_ids = true;
    },
    (value) => {
      attributes(value)[0]!.disable_correlation = false;
    },
    (value) => {
      attributes(value)[0]!.distribution = '0';
    },
  ];
  for (const edit of edits) {
    const value = structuredClone(fixture('misp-defensive').value);
    edit(value);
    assert.throws(() => assertMispPrivacy(value), assert.AssertionError);
  }
});

test('round-trip assertions reject changed IDs, source clocks, restrictions and withdrawal', () => {
  for (const [id, edit] of [
    [
      'stix-managed-withdrawn',
      (value: Value) => {
        (value.objects as Value[]).find((item) => item.type === 'indicator')!.revoked = false;
      },
    ],
    [
      'stix-defensive',
      (value: Value) => {
        (value.objects as Value[]).find((item) => item.type === 'observed-data')!.last_observed =
          '2026-08-02T00:00:00.000Z';
      },
    ],
    [
      'misp-defensive',
      (value: Value) => {
        attributes(value)[0]!.uuid = '00000000-0000-4000-8000-000000000099';
      },
    ],
    [
      'misp-defensive',
      (value: Value) => {
        event(value).published = true;
      },
    ],
  ] as const) {
    const input = fixture(id),
      value = structuredClone(input.value);
    edit(value);
    assert.throws(
      () => verifyConsumerRoundtrip(input, { id, valid: true, value }),
      assert.AssertionError,
    );
  }
});

test('process invocation bounds reject before execution and failures remain private', () => {
  assert.throws(() => verifyOfficialMispSchema('{}'), /pinned revision and digest/u);
  assert.throws(() => runConsumer('/reserved/missing-python', fixtures, 30_000, '{}'), /pinned revision and digest/u);
  for (const count of [0, 17])
    assert.throws(
      () =>
        runConsumer(
          '/reserved/missing-python',
          Array.from({ length: count }, () => fixture('misp-defensive')),
        ),
      /Invalid offline consumer/u,
    );
  for (const timeout of [0, 30_001, 1.5])
    assert.throws(
      () => runConsumer('/reserved/missing-python', fixtures, timeout),
      /Invalid offline consumer/u,
    );
  assert.throws(
    () =>
      runConsumer('/reserved/missing-python', [
        { id: 'large', format: 'misp', value: { text: 'x'.repeat(MAX_CONSUMER_INPUT_BYTES + 1) } },
      ]),
    /limit|bound/iu,
  );
  assert.throws(
    () => runConsumer('/reserved/missing-python-private', fixtures),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        'Offline consumer process failed, timed out or exceeded its output limit.',
      );
      return true;
    },
  );
});

test('MISP clocks compare independently by UUID, including unequal, absent, removed and changed values', () => {
  const source = structuredClone(fixture('misp-defensive').value);
  attributes(source)[0]!.first_seen = '2026-07-30T01:02:03.000Z';
  attributes(source)[0]!.last_seen = '2026-07-31T04:05:06.000Z';
  const original = JSON.stringify(source);
  const normalised = structuredClone(source);
  attributes(normalised)[0]!.first_seen = '2026-07-30T01:02:03+00:00';
  attributes(normalised)[0]!.last_seen = '2026-07-31T04:05:06Z';
  attributes(normalised).reverse();
  assert.deepEqual(compareMispAttributeTimes(source, normalised).map(item => item.state), ['preserved', 'preserved', 'absent', 'absent']);
  for (const field of ['first_seen', 'last_seen'] as const) {
    for (const mutation of ['removed', 'changed', 'invalid', 'added'] as const) {
      const next = structuredClone(source), index = mutation === 'added' ? 1 : 0;
      if (mutation === 'removed') delete attributes(next)[index]![field];
      else attributes(next)[index]![field] = mutation === 'invalid' ? 'not-a-clock' : '2026-08-03T00:00:00.000Z';
      const differences = compareMispAttributeTimes(source, next).filter(item => item.state !== 'preserved' && item.state !== 'absent');
      assert.deepEqual(differences.map(item => [item.uuid, item.field, item.state]), [[attributes(source)[index]!.uuid, field, mutation]]);
      assert.throws(() => verifyConsumerRoundtrip({ id: 'changed-misp', format: 'misp', value: source }, { id: 'changed-misp', valid: true, value: next }), Error);
    }
  }
  const duplicate = structuredClone(source);
  attributes(duplicate)[1]!.uuid = attributes(duplicate)[0]!.uuid;
  assert.throws(() => compareMispAttributeTimes(source, duplicate), /unique/u);
  assert.equal(JSON.stringify(source), original);
});

test('hermetic Case projection conserves source provenance through real model serialisation', () => {
  const originals = JSON.stringify(fixtures);
  const reports = fixtures
    .filter((item) => !item.negative)
    .map((item) => verifyConsumerCaseProjection(item.value));
  assert.equal(reports.length, 13);
  assert.equal(
    reports.reduce((count, report) => count + report.assertionsVerified, 0),
    36,
  );
  assert.equal(JSON.stringify(fixtures), originals);
});
