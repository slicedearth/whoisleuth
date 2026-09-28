import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CliUsageError, parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

describe('multi-target collection preflights', () => {
  for (const command of ['bulk', 'discover-scan'] as const) {
    for (const mode of ['fast', 'deep'] as const) {
      test(`${command} ${mode} plans report the admitted ceilings without collecting`, async () => {
        const targetLimit = mode === 'deep' ? 50 : 500;
        const concurrency = mode === 'deep' ? 3 : 8;
        const invocation = [command, ...(command === 'discover-scan' ? ['example.test'] : []), `--${mode}`];
        assert.throws(() => parseCliArguments([...invocation, '--concurrency', String(concurrency + 1)]), CliUsageError);
        if (command === 'discover-scan') {
          assert.throws(() => parseCliArguments([...invocation, '--scan-limit', String(targetLimit + 1)]), CliUsageError);
        }
        let stdout = '';
        let stderr = '';
        let requests = 0;
        const code = await runCli([
          ...invocation, '--plan', '--json', '--concurrency', String(concurrency),
          ...(command === 'discover-scan' ? ['--scan-limit', String(targetLimit)] : []),
        ], {
          stdout: { write(value) { stdout += value; } },
          stderr: { write(value) { stderr += value; } },
          readBulkInput: () => 'alpha.test\nbeta.test\n',
          loadTyposquatGenerator: async () => ({
            MAX_GENERATION_TLDS: 20, MUTATION_FAMILY_IDS: ['character_omission'],
            MUTATION_LABELS: { character_omission: 'Character omission' },
            normalizeMutationFamilyIds: () => [],
            normalizeCustomDictionaryTerms: () => ({ values: [], rejectedCount: 0 }),
            generateTyposquatCandidateSet: () => ({
              inputValid: true, version: 1,
              candidates: ['alpha.test', 'beta.test'].map(domain => ({
                domain, source: 'example.test', tld: 'test', mutationTypes: ['character_omission'],
              })),
            }),
          }),
          runUnifiedLookup: async () => { requests += 1; return {}; },
        });
        assert.equal(code, EXIT_CODES.SUCCESS, stderr);
        assert.equal(requests, 0);
        const document = JSON.parse(stdout);
        assert.equal(document.scope.selectedTargets, 2);
        assert.equal(document.scope.commandTargetLimit, targetLimit);
        assert.equal(document.scope.concurrency, concurrency);
        assert.equal(document.networkRequestsMade, false);
      });
    }
  }

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
    assert.throws(() => parseCliArguments(['bulk', '--plan', '--checkpoint', 'state.json']), CliUsageError);
    assert.throws(() => parseCliArguments(['discover-scan', 'example.test', '--plan', '--jsonl']), CliUsageError);
  });
});
