import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';

import {
  playwrightJsonReporterEnvironment,
  playwrightJsonResultsPath,
  playwrightRunArtifacts,
  playwrightRunIdentity,
  resolvePlaywrightRunArtifacts,
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
    const environment = {
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'functional',
      WHOISLEUTH_PLAYWRIGHT_SHARD: '3/4',
    };
    assert.deepEqual(playwrightRunArtifacts(environment), {
      identity: 'shard-3-of-4',
      authFile: 'playwright/.auth/shard-3-of-4.json',
      jsonResults: 'playwright-results/shard-3-of-4.json',
      htmlReport: 'playwright-report/shard-3-of-4',
      testResults: 'test-results/shard-3-of-4',
    });
    assert.equal(
      playwrightJsonResultsPath('/tmp/browser-workspace', environment),
      '/tmp/browser-workspace/playwright-results/shard-3-of-4.json',
    );
    assert.deepEqual(playwrightJsonReporterEnvironment('/tmp/browser-workspace', environment), {
      PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/browser-workspace/playwright-results/shard-3-of-4.json',
    });
    assert.equal(playwrightRunIdentity({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' }), 'performance');
  });

  test('anchors every configured artefact to its checkout rather than an importing configuration', () => {
    const root = path.resolve('fixture checkout');
    for (const environment of [{}, {
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'functional',
      WHOISLEUTH_PLAYWRIGHT_SHARD: '3/4',
    }, { WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' }]) {
      const relative = playwrightRunArtifacts(environment);
      const configured = resolvePlaywrightRunArtifacts(root, environment);
      assert.equal(configured.identity, relative.identity);
      for (const key of ['authFile', 'jsonResults', 'htmlReport', 'testResults'] as const) {
        assert.equal(configured[key], path.join(root, relative[key]));
        assert.equal(path.isAbsolute(configured[key]), true);
        assert.equal(path.resolve(root, 'e2e', configured[key]), configured[key]);
      }
      assert.equal(configured.jsonResults, playwrightJsonResultsPath(root, environment));
    }
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
