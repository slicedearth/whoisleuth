import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

describe('multi-target collection preflights', () => {
  test('reports an exact Bulk target count without collecting', async () => {
    let stdout = '';
    let collected = false;
    const code = await runCli(['bulk', '--deep', '--plan', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} },
      readBulkInput: async () => 'alpha.test\nbeta.test\n',
      runUnifiedLookup: async () => { collected = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(collected, false);
    const document = JSON.parse(stdout);
    assert.equal(document.schema, 'whoisleuth.cli.collection-preflight');
    assert.equal(document.scope.selectedTargets, 2);
    assert.equal(document.scope.commandTargetLimit, 50);
    assert.equal(document.networkRequestsMade, false);
  });

  test('keeps request-count uncertainty and persistence boundaries explicit', () => {
    const parsed = parseCliArguments(['discover-scan', 'Example Brand', '--scan-limit', '20', '--resolver', '1.1.1.1', '--allowlist', 'allow.txt', '--plan', '--json']);
    assert.equal(parsed.action, 'discover-scan');
    if (parsed.action !== 'discover-scan') return;
    assert.equal(parsed.plan, true);
    assert.equal(parsed.scanLimit, 20);
    assert.equal(parsed.resolverText, '1.1.1.1');
    assert.throws(() => parseCliArguments(['bulk', '--plan', '--checkpoint', 'state.json']), /cannot be combined/iu);
    assert.throws(() => parseCliArguments(['discover-scan', 'example.test', '--plan', '--jsonl']), /terminal or JSON/iu);
  });
});
