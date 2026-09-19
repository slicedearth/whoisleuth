import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES,
  MAX_LOOKUP_PROGRESS_FINAL_BYTES,
  MAX_LOOKUP_PROGRESS_STREAM_BYTES,
  createLookupProgressFinal,
  createLookupProgressNdjsonDecoder,
  createLookupProgressReducer,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
} from '../lib/lookup-progress.mts';

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

describe('bounded Lookup progress', () => {
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

  test('retains identical UTF-8 events at every byte boundary and rejects invalid encoding', () => {
    const event = createLookupProgressFinal(3, PLANNED, { title: 'a\u00e9\u4e16\u{1f50e}z' });
    const bytes = new TextEncoder().encode(`${JSON.stringify(event)}\r\n`);
    for (let split = 0; split <= bytes.length; split += 1) {
      const observed: unknown[] = [];
      const decoder = createLookupProgressNdjsonDecoder((value) => observed.push(value));
      decoder.push(bytes.subarray(0, split));
      decoder.push(bytes.subarray(split));
      decoder.finish();
      assert.deepEqual(observed, [event], `split ${split}`);
    }
    for (const invalid of [new Uint8Array([0xc3, 0x0a]), new Uint8Array([0xff]), new Uint8Array([0xc3])]) {
      const decoder = createLookupProgressNdjsonDecoder(() => assert.fail('Invalid UTF-8 cannot emit an event'));
      assert.throws(() => { decoder.push(invalid); decoder.finish(); }, /encoded data/iu);
    }
  });

  test('enforces exact line and stream limits before parsing independently of chunking', () => {
    const maximum = MAX_LOOKUP_PROGRESS_FINAL_BYTES + MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES;
    const line = new Uint8Array(maximum).fill(32);
    for (const ending of [new Uint8Array([10]), new Uint8Array([13, 10])]) {
      const decoder = createLookupProgressNdjsonDecoder(() => {});
      decoder.push(line);
      assert.throws(() => decoder.push(ending), /malformed JSON/iu, 'Admitted bytes reach the JSON validator');
    }
    const oversized = createLookupProgressNdjsonDecoder(() => {});
    oversized.push(line);
    assert.throws(() => oversized.push(new Uint8Array([32])), /line exceeds its byte bound/iu);
    const stream = createLookupProgressNdjsonDecoder(() => {});
    stream.push(new Uint8Array(MAX_LOOKUP_PROGRESS_STREAM_BYTES).fill(10));
    assert.throws(() => stream.push(new Uint8Array([10])), /total byte bound/iu);
  });

  test('encoding work grows with payload bytes rather than the number of chunks', () => {
    const original = TextEncoder.prototype.encode;
    for (const size of [256 * 1024, 512 * 1024]) {
      const event = createLookupProgressFinal(3, PLANNED, { text: 'x'.repeat(size) });
      const bytes = original.call(new TextEncoder(), encodeLookupProgressEvent(event));
      const work: number[] = [];
      for (const chunkSize of [bytes.length, 4096]) {
        let encoded = 0;
        const probe = mock.method(TextEncoder.prototype, 'encode', function (this: TextEncoder, input?: string) {
          const value = original.call(this, input);
          encoded += value.byteLength;
          return value;
        });
        try {
          let count = 0;
          const decoder = createLookupProgressNdjsonDecoder(() => { count += 1; });
          for (let start = 0; start < bytes.length; start += chunkSize) decoder.push(bytes.subarray(start, start + chunkSize));
          decoder.finish();
          assert.equal(count, 1);
          work.push(encoded);
        } finally { probe.mock.restore(); }
      }
      assert.equal(work[1], work[0], 'Chunking must not add repeated whole-prefix encoding');
      assert.ok((work[0] ?? Infinity) <= bytes.length * 3, 'Only bounded whole-document validation remains');
    }
  });

});
