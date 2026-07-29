import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES,
  createLookupProgressFinal,
  createLookupProgressNdjsonDecoder,
  createLookupProgressReducer,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
} from '../lib/lookup-progress.mts';
import {
  buildIncrementalLookupTransportSpikeReport,
} from '../tools/incremental-lookup-transport-spike.mts';

const PLANNED = ['rdap', 'whois'] as const;

function reducer() {
  return createLookupProgressReducer({
    validateFinalResult(result, sources) {
      return Boolean(
        result
        && typeof result === 'object'
        && !Array.isArray(result)
        && (result as { schema?: unknown }).schema === 'fixture.lookup'
        && sources.length === 2,
      );
    },
  });
}

describe('incremental Lookup transport spike', () => {
  test('decodes arbitrary chunks while keeping partial fragments non-persistable', () => {
    const events = [
      createLookupProgressStart('deep', PLANNED),
      createLookupProgressSource(1, 'rdap', 'success', { status: 'success' }, { complete: true }),
      createLookupProgressSource(2, 'whois', 'partial', { status: 'partial' }, { truncated: true }),
      createLookupProgressFinal(3, PLANNED, { schema: 'fixture.lookup', version: 1 }),
    ];
    const state = reducer();
    const observedSnapshots: ReturnType<typeof state.snapshot>[] = [];
    const decoder = createLookupProgressNdjsonDecoder((event) => {
      observedSnapshots.push(state.apply(event));
    });
    const bytes = new TextEncoder().encode(events.map(encodeLookupProgressEvent).join(''));
    for (let index = 0; index < bytes.length; index += 7) {
      decoder.push(bytes.subarray(index, Math.min(index + 7, bytes.length)));
    }
    decoder.finish();

    assert.equal(observedSnapshots.length, 4);
    assert.ok(observedSnapshots.every((snapshot) => snapshot.persistable === false));
    assert.equal(observedSnapshots[1]?.settledSources[0]?.state, 'success');
    assert.equal(observedSnapshots[2]?.settledSources[1]?.state, 'partial');
    assert.equal(observedSnapshots[2]?.settledSources[1]?.complete, false);
    assert.deepEqual(state.finish(), { schema: 'fixture.lookup', version: 1 });
  });

  test('refuses missing, duplicate, out-of-order, unplanned, and post-final events', () => {
    const state = reducer();
    state.apply(createLookupProgressStart('deep', PLANNED));
    assert.throws(
      () => state.apply(createLookupProgressSource(2, 'rdap', 'success', {})),
      /sequence 2 arrived while 1/iu,
    );

    const duplicate = reducer();
    duplicate.apply(createLookupProgressStart('deep', PLANNED));
    duplicate.apply(createLookupProgressSource(1, 'rdap', 'success', {}));
    assert.throws(
      () => duplicate.apply(createLookupProgressSource(2, 'rdap', 'success', {})),
      /duplicate, unplanned, or out of order/iu,
    );
    assert.throws(
      () => duplicate.apply(createLookupProgressFinal(2, PLANNED, { schema: 'fixture.lookup' })),
      /before every planned source settled/iu,
    );
    assert.throws(() => duplicate.finish(), /before a validated final result/iu);
  });

  test('requires the ordinary final response validator before crossing persistence', () => {
    const state = reducer();
    state.apply(createLookupProgressStart('deep', PLANNED));
    state.apply(createLookupProgressSource(1, 'rdap', 'error', {
      state: 'error',
      limitation: 'No result was inferred.',
    }));
    state.apply(createLookupProgressSource(2, 'whois', 'not_found', {
      state: 'not_found',
      limitation: 'This source alone is not authoritative for availability.',
    }, { complete: true }));
    assert.throws(
      () => state.apply(createLookupProgressFinal(3, PLANNED, { schema: 'wrong' })),
      /ordinary response validator/iu,
    );
    assert.throws(() => state.finish(), /before a validated final result/iu);
  });

  test('bounds fragments, event fields, and malformed NDJSON', () => {
    assert.throws(
      () => createLookupProgressSource(
        1,
        'rdap',
        'success',
        'x'.repeat(MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES + 1),
      ),
      /fragment exceeds/iu,
    );
    const decoder = createLookupProgressNdjsonDecoder(() => {});
    assert.throws(
      () => decoder.push(new TextEncoder().encode('{"bad":\n')),
      /malformed JSON/iu,
    );
  });

  test('proves the offline reference sequence while keeping production disabled', () => {
    const report = buildIncrementalLookupTransportSpikeReport();
    assert.equal(report.ready, true);
    assert.equal(report.productionEnabled, false);
    assert.equal(report.events, 4);
    assert.match(report.guarantees.join(' '), /never interpreted as absence/iu);
    assert.match(report.remainingGates.join(' '), /remote-runtime adapter/iu);
  });
});
