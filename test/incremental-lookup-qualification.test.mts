import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  qualifyLookupProgressResponse,
} from '../lib/lookup-progress-qualification.mts';
import {
  buildIncrementalLookupQualificationReport,
  main,
} from '../tools/incremental-lookup-qualification.mts';

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
