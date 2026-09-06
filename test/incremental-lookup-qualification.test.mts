import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  qualifyLookupProgressResponse,
} from '../lib/lookup-progress-qualification.mts';
import {
  createLookupProgressFinal,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
} from '../lib/lookup-progress.mts';
import {
  buildIncrementalLookupQualificationReport,
  main,
} from '../tools/incremental-lookup-qualification.mts';

const QUALIFICATION_FINAL = Object.freeze({ schema: 'fixture.lookup', version: 1 });

function prebufferedQualificationResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function qualificationLines(): string[] {
  const sources = ['rdap', 'whois'] as const;
  return [
    encodeLookupProgressEvent(createLookupProgressStart('deep', sources)),
    encodeLookupProgressEvent(createLookupProgressSource(1, 'rdap', 'success', { status: 'success' }, { complete: true })),
    encodeLookupProgressEvent(createLookupProgressSource(2, 'whois', 'partial', { status: 'partial' })),
    encodeLookupProgressEvent(createLookupProgressFinal(3, sources, QUALIFICATION_FINAL)),
  ];
}

describe('incremental Lookup production-qualification harness', () => {
  test('handles help and rejects unexpected command-line arguments', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const writable = (values: string[]) => ({ write(value: string) { values.push(value); } });
    assert.equal(await main(writable(output), writable(errors), ['--help']), 0);
    assert.match(output.join(''), /^Usage:/u);
    assert.equal(errors.join(''), '');
    output.length = 0;
    assert.equal(await main(writable(output), writable(errors), ['unexpected']), 2);
    assert.equal(output.join(''), '');
    assert.match(errors.join(''), /does not accept arguments/iu);
  });

  test('exercises all offline failure modes while keeping production adapters disabled', async () => {
    const report = await buildIncrementalLookupQualificationReport();
    assert.equal(report.ready, true);
    assert.equal(report.productionReady, false);
    assert.ok(Object.values(report.checks).every(Boolean));
    assert.deepEqual(report.adapters, [
      { id: 'express', state: 'not_enabled', productionQualified: false },
      { id: 'netlify', state: 'not_enabled', productionQualified: false },
    ]);
    assert.match(report.productionGate.join(' '), /real authenticated staging adapter/iu);
  });

  test('does not use a slow consumer to qualify already-buffered multi-chunk delivery', async () => {
    const lines = qualificationLines();
    let delayedClock = 0;
    const delayed = await qualifyLookupProgressResponse(prebufferedQualificationResponse(lines), {
      expectedFinal: QUALIFICATION_FINAL,
      timeoutMs: 2_000,
      readDelayMs: 250,
      maximumFirstEventMs: 100,
      minimumEventSpanMs: 250,
      now: () => delayedClock,
      sleep: async (milliseconds) => { delayedClock += milliseconds; },
    });
    assert.equal(delayed.chunks, 4);
    assert.equal(delayed.eventSpanMs, 750);
    assert.equal(delayed.bufferingDetected, null);

    const uncontaminated = await qualifyLookupProgressResponse(prebufferedQualificationResponse(lines), {
      expectedFinal: QUALIFICATION_FINAL,
      timeoutMs: 2_000,
      maximumFirstEventMs: 100,
      minimumEventSpanMs: 250,
      now: () => 0,
    });
    assert.equal(uncontaminated.chunks, 4);
    assert.equal(uncontaminated.eventSpanMs, 0);
    assert.equal(uncontaminated.bufferingDetected, true);
  });

  test('rejects authentication expiry, incompatible media, and absent bodies before parsing', async () => {
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('', { status: 403 }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /authentication expiry/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /application\/x-ndjson/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /no readable body/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('{}\n', {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'public, max-age=60',
        },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /no-store/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('{}\n', {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-encoding': 'br',
        },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /compressed responses/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('{}\n', {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
        },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /nosniff/iu,
    );
    await assert.rejects(
      qualifyLookupProgressResponse(new Response('{}\n', {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-length': '3',
        },
      }), {
        expectedFinal: {},
        timeoutMs: 1000,
      }),
      /fixed-length/iu,
    );
  });
});
