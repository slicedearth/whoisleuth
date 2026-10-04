import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { readInfrastructureObservation, parseInfrastructureObservation, serialiseInfrastructureObservation, compareInfrastructureObservations, MAX_INFRASTRUCTURE_HOSTS, MAX_INFRASTRUCTURE_OBSERVATION_BYTES, infrastructureTechnologyRoles } from '../packages/investigation/infrastructure-observation.mts';

const raw = await readFile(new URL('./fixtures/infrastructure-observations/infrastructure-observation-v1.json', import.meta.url), 'utf8');
const fixture = () => parseInfrastructureObservation(raw);
function later() {
  const result = fixture(); result.id = 'selected-example-later'; result.observedAt = '2026-10-02T12:00:00.000Z';
  for (const row of [...result.dns, ...result.certificates, ...result.roles]) row.observedAt = '2026-10-02T11:59:00.000Z';
  return result;
}

test('snapshot v1 round trip preserves queried owner, wildcard identity and independent provider roles', () => {
  const value = fixture(), before = structuredClone(value);
  assert.deepEqual(parseInfrastructureObservation(serialiseInfrastructureObservation(value)), value);
  assert.equal(value.dns[1]!.ownerName, 'edge.example.test');
  assert.equal(value.dns[1]!.queriedName, 'www.example.test');
  assert.ok(value.certificates[0]!.names.includes('*.example.test'));
  assert.deepEqual(value.roles.map(row => row.role), ['observed_edge', 'application_platform', 'routing_origin']);
  assert.deepEqual(value, before);
});
test('future versions, unknown keys, duplicate source identities and duplicate JSON keys fail closed', () => {
  assert.throws(() => readInfrastructureObservation({ ...fixture(), version: 2 }), /Unsupported/u);
  assert.throws(() => readInfrastructureObservation({ ...fixture(), extra: true }), /structure/u);
  const value = fixture(); value.sources.push(value.sources[0]!);
  assert.throws(() => readInfrastructureObservation(value), /duplicate/u);
  assert.throws(() => parseInfrastructureObservation(raw.replace('"version": 1,', '"version": 1, "version": 1,')));
});
test('host and DNS bounds reject rather than silently pruning accepted evidence', () => {
  const value = fixture(); value.scope.hostnames = Array.from({ length: MAX_INFRASTRUCTURE_HOSTS + 1 }, (_, index) => `h${index}.example.test`);
  assert.throws(() => readInfrastructureObservation(value));
  assert.throws(() => readInfrastructureObservation({ ...fixture(), coverage: { state: 'complete', truncated: true, detail: 'Limited' } }), /Complete/u);
});
test('DNS outcomes, address families, wildcard host selection and alias forks are validated', () => {
  const value = fixture(); value.dns[1]!.outcome = 'failed';
  assert.throws(() => readInfrastructureObservation(value), /Answered/u);
  const badAddress = fixture(); badAddress.dns[1]!.type = 'AAAA';
  assert.throws(() => readInfrastructureObservation(badAddress));
  const wildcard = fixture(); wildcard.scope.hostnames[0] = '*.example.test';
  assert.throws(() => readInfrastructureObservation(wildcard), /canonical/u);
  const aliases = fixture(); aliases.dns[0]!.values.push('other.example.test');
  assert.throws(() => readInfrastructureObservation(aliases), /competing/u);
});
test('source-family matching prevents registration data from claiming routing or edge data claiming origin', () => {
  const value = fixture(); value.sources[3]!.family = 'ip_registration';
  assert.throws(() => readInfrastructureObservation(value), /matching source family/u);
  const origin = fixture(); origin.roles[0]!.role = 'observed_origin'; origin.roles[0]!.value = 'origin.example.test';
  assert.throws(() => readInfrastructureObservation(origin), /matching source family/u);
  assert.deepEqual(infrastructureTechnologyRoles({ category: 'delivery platform' }), ['observed_edge']);
});
test('source references cannot retain queries or credentials and roles cannot name unobserved addresses', () => {
  const value = fixture(); value.sources[0]!.reference = 'https://source.example.test/?token=private';
  assert.throws(() => readInfrastructureObservation(value), /references/u);
  const role = fixture(); role.roles[2]!.subject = '203.0.113.17';
  assert.throws(() => readInfrastructureObservation(role), /supporting DNS/u);
});
test('complete selected coverage requires every selected hostname and type; partial retains failed attempts', () => {
  const value = fixture(); value.dns.pop();
  assert.throws(() => readInfrastructureObservation(value), /every explicitly selected/u);
  value.coverage.state = 'partial';
  value.dns[0] = { ...value.dns[0]!, values: [], outcome: 'failed', complete: false };
  assert.equal(readInfrastructureObservation(value).dns[0]!.outcome, 'failed');
});
test('unchanged and changed comparisons remain source-qualified and do not mutate snapshots', () => {
  const before = fixture(), after = later(), original = structuredClone(after);
  assert.ok(compareInfrastructureObservations(before, after).rows.every(row => row.state === 'unchanged'));
  after.dns[2]!.values = ['192.0.2.26'];
  const result = compareInfrastructureObservations(before, after);
  assert.equal(result.rows.find(row => row.hostname === 'mail.example.test')?.state, 'changed');
  assert.deepEqual(original, later());
});
test('not returned is not disappearance and incomplete later collections produce unknowns', () => {
  const before = fixture(), after = later();
  after.dns[2] = { ...after.dns[2]!, values: [], outcome: 'no_data' };
  let result = compareInfrastructureObservations(before, after);
  assert.equal(result.rows.find(row => row.hostname === 'mail.example.test')?.state, 'not_returned');
  assert.match(result.rows.find(row => row.hostname === 'mail.example.test')!.detail, /does not establish disappearance/u);
  after.coverage.state = 'partial'; after.dns[2]!.complete = false; after.dns[2]!.outcome = 'failed';
  result = compareInfrastructureObservations(before, after);
  assert.equal(result.rows.find(row => row.hostname === 'mail.example.test')?.state, 'unknown');
});
test('changed sources, scope and concurrent times cannot manufacture temporal changes', () => {
  for (const change of [(row: ReturnType<typeof fixture>) => { row.sources[0]!.name = 'Different source'; }, (row: ReturnType<typeof fixture>) => { row.observedAt = fixture().observedAt; for (const fact of [...row.dns, ...row.certificates, ...row.roles]) fact.observedAt = row.observedAt; }, (row: ReturnType<typeof fixture>) => { row.scope.selection = 'certificate_names'; }]) {
    const after = later(); change(after);
    assert.equal(compareInfrastructureObservations(fixture(), after).state, 'incomparable');
    assert.ok(compareInfrastructureObservations(fixture(), after).rows.every(row => row.state === 'incomparable'));
  }
});

test('later envelopes cannot order reversed, equal or mixed source cohorts in any evidence family', () => {
  for (const observedAt of ['2026-09-30T11:00:00.000Z', '2026-10-01T11:59:00.000Z']) {
    const before = fixture(), after = later();
    for (const row of [...before.dns, ...before.certificates, ...before.roles]) row.observedAt = '2026-10-01T11:59:00.000Z';
    for (const row of [...after.dns, ...after.certificates, ...after.roles]) row.observedAt = observedAt;
    after.dns[2]!.values = ['192.0.2.26']; after.roles[0]!.value = 'Changed claim'; after.certificates[0]!.names = ['other.example.test'];
    const compared = compareInfrastructureObservations(before, after);
    assert.equal(compared.state, 'partial');
    assert.ok(compared.rows.every(row => row.state === 'unknown'));
    assert.ok(compared.rows.every(row => row.beforeTimes.length === 1 && row.afterTimes[0] === observedAt));
    after.dns[2] = { ...after.dns[2]!, values: [], outcome: 'no_data' };
    assert.equal(compareInfrastructureObservations(before, after).rows.find(row => row.family === 'A' && row.hostname === 'mail.example.test')!.state, 'unknown');
  }
  const before = fixture(), after = later();
  after.dns.push({ ...after.dns[2]!, observedAt: '2026-10-02T10:00:00.000Z', values: ['192.0.2.27'] });
  const row = compareInfrastructureObservations(before, after).rows.find(row => row.family === 'A' && row.hostname === 'mail.example.test')!;
  assert.equal(row.state, 'unknown'); assert.equal(row.afterTimes.length, 2);
  after.certificates.push({ ...after.certificates[0]!, observedAt: '2026-10-02T10:00:00.000Z' });
  after.roles.push({ ...after.roles[0]!, observedAt: '2026-10-02T10:00:00.000Z' });
  for (const family of ['certificate_names', after.roles[0]!.role]) {
    const mixed = compareInfrastructureObservations(before, after).rows.filter(value => value.family === family);
    assert.ok(mixed.length > 0);
    assert.ok(mixed.every(value => value.state === 'unknown' && value.afterTimes.length === 2));
  }
  const missing = later(); missing.certificates = []; missing.roles = [];
  assert.ok(compareInfrastructureObservations(before, missing).rows.filter(row => row.family === 'certificate_names' || row.family === 'observed_edge').every(row => row.state === 'unknown'));
});

test('DNS comparisons never combine answers to different queried names sharing one owner', () => {
  const before = fixture(), after = later();
  for (const value of [before, after]) {
    value.dns[2]!.ownerName = 'edge.example.test';
    value.dns[2]!.values = ['192.0.2.26'];
  }
  after.dns[2]!.values = ['192.0.2.27'];
  const rows = compareInfrastructureObservations(before, after).rows.filter(row => row.family === 'A' && row.hostname === 'edge.example.test');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.state), ['unchanged', 'changed']);
});
test('wildcard-only certificate scope never invents an enumerated hostname', () => {
  const value = fixture(); value.scope = { hostnames: [], dnsTypes: [], selection: 'certificate_names' }; value.dns = []; value.roles = []; value.certificates[0]!.names = ['*.example.test'];
  assert.equal(readInfrastructureObservation(value).scope.hostnames.length, 0);
});
test('representative 128-host inventory retains every supplied response and refuses oversized serialized evidence', () => {
  const value = fixture(); value.scope.hostnames = Array.from({ length: 128 }, (_, index) => `host-${index}.example.test`); value.scope.dnsTypes = ['A']; value.roles = []; value.certificates = [];
  value.dns = value.scope.hostnames.map((queriedName, index) => ({ ...fixture().dns[1]!, queriedName, ownerName: queriedName, values: [`192.0.2.${index}`] }));
  assert.equal(parseInfrastructureObservation(serialiseInfrastructureObservation(value)).dns.length, 128);
  value.certificates = Array.from({ length: 32 }, (_, index) => ({ ...fixture().certificates[0]!, fingerprintSha256: index.toString(16).padStart(64, '0'), names: Array.from({ length: 128 }, (_, nameIndex) => `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.n${nameIndex}.example.test`) }));
  assert.throws(() => readInfrastructureObservation(value), /byte bound/u);
});
test('every admitted dense representation serialises within its own parser ceiling', () => {
  const value = fixture(); value.coverage.state = 'partial'; value.scope.dnsTypes = ['A']; value.roles = []; value.certificates = [];
  value.scope.hostnames = Array.from({ length: 128 }, (_, index) => `host-${index}.example.test`);
  value.dns = value.scope.hostnames.flatMap(queriedName => Array.from({ length: 3 }, (_, index) => ({ ...fixture().dns[1]!, queriedName, ownerName: queriedName, observedAt: `2026-10-01T11:0${index}:00.000Z`, values: ['192.0.2.20'] })));
  const retained = readInfrastructureObservation(value), serialized = serialiseInfrastructureObservation(retained);
  assert.ok(Buffer.byteLength(serialized) <= MAX_INFRASTRUCTURE_OBSERVATION_BYTES);
  assert.deepEqual(parseInfrastructureObservation(serialized), retained);
});
test('incomplete identical rows are unknown and negative DNS outcomes stay distinct', () => {
  const before = fixture(), after = later(); after.coverage.state = 'partial'; after.dns[2]!.complete = false;
  assert.equal(compareInfrastructureObservations(before, after).rows.find(row => row.family === 'A' && row.hostname === 'mail.example.test')?.state, 'unknown');
  before.dns[2] = { ...before.dns[2]!, values: [], outcome: 'no_data' };
  after.coverage.state = 'complete'; after.dns[2] = { ...after.dns[2]!, values: [], outcome: 'nxdomain', complete: true };
  const row = compareInfrastructureObservations(before, after).rows.find(row => row.family === 'A_outcome' && row.hostname === 'mail.example.test');
  assert.deepEqual(row?.before, ['no_data']); assert.deepEqual(row?.after, ['nxdomain']); assert.equal(row?.state, 'changed');
  after.coverage.state = 'partial'; after.dns[2]!.complete = false;
  for (const outcome of ['failed', 'not_checked'] as const) {
    after.dns[2]!.outcome = outcome;
    assert.equal(compareInfrastructureObservations(before, after).rows.find(row => row.family === 'A_outcome' && row.hostname === 'mail.example.test')?.state, 'unknown');
  }
});
test('observation ordering requires canonical UTC instants and duplicate certificate or role identities reject', () => {
  const before = fixture(), after = later();
  assert.equal(compareInfrastructureObservations(before, after).state, 'compared');
  after.observedAt = '2026-10-02T13:00:00+01:00';
  assert.throws(() => readInfrastructureObservation(after), /observation time/u);
  const certificate = fixture(); certificate.certificates.push(certificate.certificates[0]!);
  assert.throws(() => readInfrastructureObservation(certificate), /duplicate/u);
  const role = fixture(); role.roles.push(role.roles[0]!);
  assert.throws(() => readInfrastructureObservation(role), /duplicate/u);
});
