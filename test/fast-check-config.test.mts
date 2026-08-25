import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fastCheckParameters, fastCheckReplayDetails } from './helpers/fast-check-config.mts';

describe('Fast-check execution profile', () => {
  test('keeps ordinary runs bounded and preserves a regression seed', () => {
    assert.deepEqual(fastCheckParameters(80, 5_952, {}), { numRuns: 80, seed: 5_952 });
  });

  test('multiplies scheduled runs and permits an explicit replay seed', () => {
    assert.deepEqual(fastCheckParameters(600, 5_952, {
      WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '10',
      WHOISLEUTH_FAST_CHECK_SEED: '123456',
    }), { numRuns: 6_000, seed: 123_456 });
  });

  test('retains a bounded replay path and renders exact replay details', () => {
    const parameters = fastCheckParameters(40, 5_952, {
      WHOISLEUTH_FAST_CHECK_PATH: '2:1:0',
    });
    assert.deepEqual(parameters, { numRuns: 40, seed: 5_952, path: '2:1:0' });
    assert.equal(fastCheckReplayDetails(parameters), 'Property replay: seed=5952, path=2:1:0, runs=40.');
    assert.throws(
      () => fastCheckParameters(10, undefined, { WHOISLEUTH_FAST_CHECK_PATH: '../unsafe' }),
      /bounded colon-separated replay path/u,
    );
  });

  test('caps total cases and rejects malformed or excessive controls', () => {
    assert.deepEqual(fastCheckParameters(2_000, undefined, {
      WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '20',
    }), { numRuns: 20_000 });
    assert.throws(
      () => fastCheckParameters(10, undefined, { WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '0' }),
      /between 1 and 20/u,
    );
    assert.throws(
      () => fastCheckParameters(10, undefined, { WHOISLEUTH_FAST_CHECK_SEED: 'not-a-seed' }),
      /base-10 integer/u,
    );
  });
});
