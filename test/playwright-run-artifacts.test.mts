import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  playwrightRunArtifacts,
  playwrightRunIdentity,
} from '../tools/playwright-run-artifacts.mts';

describe('Playwright run artefact ownership', () => {
  test('retains legacy paths for an ordinary focused run', () => {
    assert.deepEqual(playwrightRunArtifacts({}), {
      identity: 'default',
      authFile: 'playwright/.auth/user.json',
      jsonResults: 'playwright-results.json',
      htmlReport: 'playwright-report',
      testResults: 'test-results',
    });
  });

  test('isolates functional shards and the performance authority', () => {
    assert.deepEqual(playwrightRunArtifacts({
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'functional',
      WHOISLEUTH_PLAYWRIGHT_SHARD: '3/4',
    }), {
      identity: 'shard-3-of-4',
      authFile: 'playwright/.auth/shard-3-of-4.json',
      jsonResults: 'playwright-results/shard-3-of-4.json',
      htmlReport: 'playwright-report/shard-3-of-4',
      testResults: 'test-results/shard-3-of-4',
    });
    assert.equal(playwrightRunIdentity({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' }), 'performance');
  });

  test('rejects malformed, conflicting, and out-of-range identities', () => {
    assert.throws(() => playwrightRunIdentity({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'unknown' }), /run kind/u);
    assert.throws(() => playwrightRunIdentity({ WHOISLEUTH_PLAYWRIGHT_SHARD: '../1' }), /N\/TOTAL/u);
    assert.throws(() => playwrightRunIdentity({ WHOISLEUTH_PLAYWRIGHT_SHARD: '5/4' }), /maintained range/u);
    assert.throws(() => playwrightRunIdentity({
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance',
      WHOISLEUTH_PLAYWRIGHT_SHARD: '1/4',
    }), /cannot also/u);
  });
});
