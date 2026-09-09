import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildDomainControlFlightRecorder, serializeDomainControlFlightRecorder,
  validateDomainControlFlightRecorderDocument,
  type DomainControlFlightRecorderObservation,
} from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
} from '../packages/contracts/domain-control-flight-recorder.mts';
import {
  buildCliDomainControlReview, domainControlObservationFromSavedLookup,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, CLI_DOMAIN_CONTROL_REVIEW_VERSION,
} from '../cli/domain-control-observations.mts';
import { parseSavedLookupDocument } from '../cli/saved-lookup.mts';
import { buildDomainControlManifest } from '../lib/domain-control-manifest.mts';

const FIRST = '2026-08-19T00:00:00.000Z';
const LAST = '2026-08-20T00:00:00.000Z';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

function capture(capturedAt: string, observedAt: string | null, value: string): DomainControlFlightRecorderObservation {
  return {
    domain: 'example.test', capturedAt, collectionDepth: 'deep',
    fields: [{ id: 'page_identity', source: 'Static page identity', state: 'observed', values: [value], observedAt }],
  };
}
function history(observations: readonly DomainControlFlightRecorderObservation[]) {
  return buildDomainControlFlightRecorder({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
    observations, approvedWindows: [],
  }, LAST);
}

test('history retains source and capture clocks, opaque values and an independent public document', () => {
  const caaCapture = (capturedAt: string, observedAt: string, value: string) => {
    const input = capture(capturedAt, observedAt, value);
    return { ...input, fields: input.fields.map((field) => ({ ...field, id: 'caa_policy' as const, source: 'DNS CAA' })) };
  };
  const first = caaCapture(FIRST, '2026-08-18T23:00:00.000Z', '0 iodef https://reports.example/CaseA');
  const second = caaCapture(LAST, '2026-08-19T23:00:00.000Z', '0 iodef https://reports.example/CaseB');
  const result = history([first, second]);
  const change = result.events.find((event) => event.kind === 'observed_change');
  assert.ok(change);
  assert.equal(change.observedAt, second.fields[0]!.observedAt);
  assert.equal(change.capturedAt, LAST);
  assert.deepEqual(change.before, first.fields[0]!.values);
  assert.deepEqual(change.after, second.fields[0]!.values);
  assert.deepEqual(validateDomainControlFlightRecorderDocument(result), result);
  const publicRaw = fixture('domain-control-flight-recorder-v1');
  assert.equal(serializeDomainControlFlightRecorder(validateDomainControlFlightRecorderDocument(JSON.parse(publicRaw))), publicRaw);
  assert.throws(() => validateDomainControlFlightRecorderDocument({ ...result, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION + 1 }), /supported version/);
});

test('unknown, future and non-increasing source times cannot establish an observed change', () => {
  for (const time of [null, FIRST, '2026-08-18T00:00:00.000Z', '2026-08-21T00:00:00.000Z']) {
    const result = history([capture(FIRST, FIRST, 'before'), capture(LAST, time, 'after')]);
    assert.equal(result.summary.observedChanges, 0, String(time));
    assert.equal(result.summary.incompleteFields, 1);
    assert.equal(result.events.at(-1)?.state, 'partial');
    assert.deepEqual(result.events.at(-1)?.after, ['after']);
    assert.deepEqual(validateDomainControlFlightRecorderDocument(result), result);
  }
  const unknown = history([capture(FIRST, null, 'retained')]);
  assert.equal(unknown.summary.incompleteFields, 1);
  assert.equal(unknown.events[0]?.kind, 'incomplete_observation');
  assert.equal(unknown.events[0]?.observedAt, null);
});

test('equal-capture conflicts are order independent and source changes are not value changes', () => {
  const a = capture(FIRST, FIRST, 'one');
  const b = capture(FIRST, FIRST, 'two');
  assert.deepEqual(history([a, b]), history([b, a]));
  assert.equal(history([a, b]).summary.firstObservations, 0);
  const other = capture(LAST, LAST, 'two');
  const changedSource = { ...other, fields: other.fields.map((field) => ({ ...field, source: 'Other source' })) };
  assert.equal(history([a, changedSource]).summary.observedChanges, 0);
  assert.equal(history([a, { ...other, collectionDepth: 'fast' }]).summary.observedChanges, 0);
  const repeated = history([a, { ...a, capturedAt: LAST }]);
  assert.equal(repeated.summary.observedChanges, 0);
  assert.equal(repeated.summary.incompleteFields, 0);
});

test('historical chronology does not expire old pairs or shorten 64-record fields', () => {
  const first = capture(FIRST, '2025-01-01T00:00:00.000Z', 'one');
  const second = capture(LAST, '2025-01-02T00:00:00.000Z', 'two');
  assert.equal(history([first, second]).summary.observedChanges, 1);
  const values = Array.from({ length: 64 }, (_, i) => `0 iodef https://reports.example/Case${i}`);
  const full = { ...first, fields: first.fields.map((field) => ({ ...field, id: 'caa_policy' as const, source: 'DNS CAA', values })) };
  const result = history([full]);
  assert.equal(result.events[0]?.after.length, 64);
  assert.deepEqual(result.events[0]?.after, [...values].sort());
  assert.throws(() => history([{ ...full, fields: full.fields.map((field) => ({ ...field, values: [...values, '0 issue ca.example'] })) }]), /at most 64/);
});

test('current history readers reject forged conclusive clocks, duplicate identities and counts', () => {
  const original = history([capture(FIRST, FIRST, 'one'), capture(LAST, LAST, 'two')]);
  const noClock = { ...original, events: original.events.map((event, index) => index === 1 ? { ...event, observedAt: null } : event) };
  assert.throws(() => validateDomainControlFlightRecorderDocument(noClock), /source time/);
  const duplicates = { ...original, events: original.events.map((event, index) => index === 1 ? { ...event, id: original.events[0]!.id } : event) };
  assert.throws(() => validateDomainControlFlightRecorderDocument(duplicates), /duplicate identity/);
  assert.throws(() => validateDomainControlFlightRecorderDocument({ ...original, summary: { ...original.summary, incompleteFields: 9 } }), /summary/);
});

test('legacy generic record text is retained as incomplete instead of acquiring a current conclusion', () => {
  const input = JSON.parse(fixture('domain-control-flight-recorder-input-v1'));
  input.observations[0].fields[0].values = ['not a nameserver'];
  const result = buildDomainControlFlightRecorder(input, LAST);
  const first = result.events.find((event) => event.field === 'delegated_nameservers');
  assert.equal(first?.state, 'partial');
  assert.deepEqual(first?.after, ['not a nameserver']);
  assert.deepEqual(validateDomainControlFlightRecorderDocument(result), result);
});

function lookup() {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: LAST, mode: 'deep', type: 'domain',
    query: 'example.test', registrableDomain: 'example.test',
    diagnostics: { rdap: { status: 'success', observedAt: FIRST }, whois: { status: 'unsupported' } },
    rdap: { parsed: { nameservers: ['ns1.example.test'], statuses: ['clientTransferProhibited'], registrar: { name: 'Example Registrar' } } },
    availability: { dns: {
      status: 'partial', observedAt: FIRST,
      diagnostics: { mx: { status: 'not_found', truncated: false, discarded: 0 }, caa: { status: 'success', truncated: false, discarded: 0 } },
      records: { mx: [] as unknown[], caa: [] as unknown[] },
      caaPolicy: { status: 'success', observedAt: FIRST, records: [{ critical: 0, tag: 'issue', value: 'inherited.example' }] },
    } },
  };
}
function review(value: ReturnType<typeof lookup>) {
  const manifestInput = JSON.parse(fixture('domain-control-manifest-input-v2'));
  manifestInput.entries[0].nameservers = [];
  manifestInput.entries[0].recordModes.nameservers = 'unconfigured';
  const manifest = buildDomainControlManifest(manifestInput, '2026-08-03T00:00:00.000Z');
  return buildCliDomainControlReview(JSON.stringify({
    schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION, manifest, lookups: [value],
  }), LAST);
}

test('CLI source clocks remain separate and exact DNS absence is not inherited policy', () => {
  const result = review(lookup());
  assert.equal(result.observations[0]?.capturedAt, LAST);
  assert.equal(result.observations[0]?.fields.find((field) => field.id === 'mail_exchangers')?.observedAt, FIRST);
  const comparisons = result.review.domains[0]!.comparisons;
  assert.equal(comparisons.find((field) => field.field === 'mx')?.state, 'aligned');
  assert.deepEqual(comparisons.find((field) => field.field === 'caa')?.observed, []);
  assert.equal(comparisons.find((field) => field.field === 'caa')?.state, 'observed');
  const nullMx = lookup();
  nullMx.availability.dns.records.mx = [{ priority: 0, exchange: '' }];
  nullMx.availability.dns.diagnostics.mx.status = 'success';
  assert.equal(review(nullMx).review.domains[0]!.comparisons.find((field) => field.field === 'mx')?.state, 'drift');
});

test('CLI missing, conflicting or stale clocks and invalid DNS rows stay inconclusive', () => {
  for (const time of ['', 'not-a-date', '2026-06-01T00:00:00.000Z', '2026-08-21T00:00:00.000Z']) {
    const value = lookup(); value.availability.dns.observedAt = time;
    assert.equal(review(value).review.domains[0]!.comparisons.find((field) => field.field === 'mx')?.state, 'partial');
  }
  const conflicting = lookup();
  Object.assign(conflicting.availability.dns, { checkedAt: '2026-08-19T01:00:00.000Z' });
  assert.equal(review(conflicting).review.domains[0]!.comparisons.find((field) => field.field === 'mx')?.state, 'partial');
  const malformed = lookup(); malformed.availability.dns.records.mx = ['invalid record'];
  assert.equal(review(malformed).review.domains[0]!.comparisons.find((field) => field.field === 'mx')?.state, 'partial');
  const contradictory = lookup(); contradictory.availability.dns.records.mx = [{ priority: 0, exchange: '' }];
  assert.equal(review(contradictory).review.domains[0]!.comparisons.find((field) => field.field === 'mx')?.state, 'partial');
});

test('CLI transfer restrictions use complete exact tokens, not substrings or missing status', () => {
  for (const [statuses, expected, state] of [
    [['clientTransferProhibited'], ['required'], 'observed'],
    [['notClientTransferProhibited'], ['not_required'], 'observed'],
    [[], [], 'partial'],
  ] as const) {
    const value = lookup(); value.rdap.parsed.statuses = [...statuses];
    const result = domainControlObservationFromSavedLookup(parseSavedLookupDocument(JSON.stringify(value)));
    const lock = result.fields.find((field) => field.id === 'registrar_lock');
    assert.deepEqual(lock?.values, expected);
    assert.equal(lock?.state, state);
  }
});
