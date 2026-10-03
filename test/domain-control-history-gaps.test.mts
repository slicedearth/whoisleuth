import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildDomainControlFlightRecorder,
  serializeDomainControlFlightRecorder,
  validateDomainControlFlightRecorderDocument,
} from '../lib/domain-control-flight-recorder.mts';
import { DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA } from '../packages/contracts/domain-control-flight-recorder.mts';

const at = (day: number) => `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`;
function observation(day: number, values: string[], options: {
  state?: string; source?: string; depth?: string; sourceTime?: string | null; missing?: boolean;
} = {}) {
  return {
    domain: 'example.test', capturedAt: at(day), collectionDepth: options.depth ?? 'deep',
    fields: options.missing ? [] : [{ id: 'delegated_nameservers', source: options.source ?? 'DNS',
      state: options.state ?? 'observed', observedAt: options.sourceTime === undefined ? at(day) : options.sourceTime, values }],
  };
}
function review(observations: ReturnType<typeof observation>[], windows: unknown[] = []) {
  const result = buildDomainControlFlightRecorder({
    schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, version: 3, observations, approvedWindows: windows,
  }, at(20));
  assert.deepEqual(validateDomainControlFlightRecorderDocument(result), result);
  return result;
}
const oldValue = ['ns1.example.test'];
const newValue = ['ns2.example.test'];
const window = (startsAt: string, endsAt: string) => ({
  id: 'reviewed-change', domain: 'example.test', startsAt, endsAt,
  fields: ['delegated_nameservers'], reason: 'Reviewed migration.',
});

test('changed recovery retains its complete baseline and explicitly uncertain interval', () => {
  const result = review([observation(1, oldValue), observation(2, [], { state: 'unavailable' }),
    observation(3, newValue, { state: 'partial' }), observation(4, newValue)]);
  const changed = result.events.at(-1)!;
  assert.equal(changed.kind, 'observed_change');
  assert.deepEqual(changed.before, oldValue);
  assert.deepEqual(changed.after, newValue);
  assert.deepEqual(changed.changeInterval, { after: at(1), by: at(4), incompleteObservations: 2 });
  assert.match(changed.explanation, /exact time is unknown/u);
  assert.deepEqual(result.summary, { firstObservations: 1, observedChanges: 1, approvedChanges: 0,
    unexpectedChanges: 1, collectionChanges: 1, recoveredSources: 0, incompleteFields: 2 });
});

test('equal recovery does not claim that values stayed unchanged during the gap', () => {
  const result = review([observation(1, oldValue), observation(2, [], { state: 'partial' }), observation(3, oldValue)]);
  assert.equal(result.summary.observedChanges, 0);
  assert.equal(result.events.at(-1)?.kind, 'recovered');
  assert.equal(result.events.at(-1)?.changeInterval, null);
  assert.match(result.events.at(-1)!.explanation, /Intervening changes.*remain unknown/u);
});

test('omitted fields, unknown conditions and absent or non-increasing clocks remain gaps', () => {
  for (const options of [{ missing: true }, { depth: 'unknown' }, { sourceTime: null }, { sourceTime: at(1) }]) {
    const result = review([observation(1, oldValue), observation(2, newValue, options), observation(3, newValue)]);
    assert.equal(result.events[1]?.state, 'partial');
    assert.deepEqual(result.events.at(-1)?.changeInterval, { after: at(1), by: at(3), incompleteObservations: 1 });
  }
});

test('a changed source or known collection depth cannot bridge a historical baseline', () => {
  for (const options of [{ source: 'Other DNS' }, { depth: 'fast' }]) {
    const result = review([observation(1, oldValue), observation(2, [], { state: 'unavailable' }),
      observation(3, newValue, options), observation(4, newValue, options), observation(5, oldValue, options)]);
    assert.equal(result.events[2]?.state, 'partial');
    assert.equal(result.events[3]?.kind, 'recovered');
    assert.deepEqual(result.events[4]?.changeInterval, { after: at(4), by: at(5), incompleteObservations: 0 });
    assert.equal(result.summary.observedChanges, 1);
  }
});

test('an explicitly observed empty value can establish removal after an incomplete observation', () => {
  const result = review([observation(1, oldValue), observation(2, [], { state: 'partial' }), observation(3, [])]);
  assert.equal(result.events.at(-1)?.kind, 'observed_change');
  assert.deepEqual(result.events.at(-1)?.after, []);
});

test('only a window covering both complete observations qualifies the uncertain change', () => {
  const observations = [observation(1, oldValue), observation(2, [], { state: 'unavailable' }), observation(3, newValue)];
  for (const [start, end, approved] of [[1, 3, true], [1, 4, true], [2, 3, false], [1, 2, false], [4, 5, false]] as const) {
    const result = review(observations, [window(at(start), at(end))]);
    assert.equal(result.summary.approvedChanges, approved ? 1 : 0);
    assert.equal(result.events.at(-1)?.approvedWindow !== null, approved);
  }
});

test('suppressed equivalent observations refine the interval without losing gap accounting', () => {
  const result = review([observation(1, oldValue), observation(2, oldValue), observation(3, [], { state: 'partial' }), observation(4, newValue)]);
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.events.at(-1)?.changeInterval, { after: at(2), by: at(4), incompleteObservations: 1 });
});

test('current readers reject inconsistent intervals, gap counts, contexts and approval claims', () => {
  const result = review([observation(1, oldValue), observation(2, [], { state: 'partial' }), observation(3, newValue)], [window(at(1), at(3))]);
  type MutableEvent = {
    changeInterval: { after: string; by: string; incompleteObservations: number } | null;
    collectionDepth: string; approvedWindow: { startsAt: string; endsAt: string } | null;
  };
  const mutations: Array<[(event: MutableEvent) => void, RegExp]> = [
    [event => { event.changeInterval = null; }, /must retain its change interval/u],
    [event => { event.changeInterval!.by = at(4); }, /inconsistent change interval/u],
    [event => { event.changeInterval!.after = at(3); }, /inconsistent change interval/u],
    [event => { event.changeInterval!.incompleteObservations = 0; }, /unsupported observed-change claim/u],
    [event => { event.changeInterval!.incompleteObservations = 0.5; }, /must be an integer/u],
    [event => { event.collectionDepth = 'fast'; }, /unsupported observed-change claim/u],
    [event => { event.collectionDepth = 'unknown'; }, /invalid collection conditions/u],
    [event => { event.approvedWindow!.startsAt = at(2); }, /does not contain the change interval/u],
    [event => { event.approvedWindow!.endsAt = at(2); }, /does not contain the change interval/u],
  ];
  for (const [mutate, message] of mutations) {
    const invalid = structuredClone(result);
    mutate(invalid.events.at(-1)! as MutableEvent);
    assert.throws(() => validateDomainControlFlightRecorderDocument(invalid), message);
  }
});

test('historical source-timed and original documents retain their exact serialised bytes', async () => {
  for (const version of [1, 2]) {
    const raw = await readFile(new URL(`./fixtures/domain-control-flight-recorder-v${version}.json`, import.meta.url), 'utf8');
    const document = validateDomainControlFlightRecorderDocument(JSON.parse(raw));
    assert.equal(document.version, version);
    assert.equal(serializeDomainControlFlightRecorder(document), raw);
  }
});
