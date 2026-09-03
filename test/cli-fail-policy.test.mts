import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  CLI_FAIL_POLICIES,
  CLI_FAIL_POLICIES_BY_COMMAND,
  evaluateCliFailPolicies,
  parseCliFailPolicies,
} from '../cli/fail-policy.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

describe('explicit CLI failure policies', () => {
  test('parses a bounded distinct policy list', () => {
    assert.deepEqual(parseCliFailPolicies('source-failure,inconclusive,source-failure', 'lookup'), ['source-failure', 'inconclusive']);
    assert.throws(() => parseCliFailPolicies('malicious', 'lookup'), /for lookup supports/iu);
    const parsed = parseCliArguments(['lookup', 'example.test', '--fail-on', 'source-failure,danger']);
    assert.equal(parsed.action, 'lookup');
    if (parsed.action === 'lookup') assert.deepEqual(parsed.failOn, ['source-failure', 'danger']);
  });

  test('accepts only policies with an executable evidence path for each command', () => {
    const argv = {
      lookup: ['lookup', 'example.test'],
      bulk: ['bulk'],
      'discover-scan': ['discover-scan', 'example.test'],
      'monitor-once': ['monitor-once'],
    } as const;
    for (const [command, supported] of Object.entries(CLI_FAIL_POLICIES_BY_COMMAND)) {
      for (const policy of CLI_FAIL_POLICIES) {
        const argumentsForPolicy = [...argv[command as keyof typeof argv], '--fail-on', policy];
        if ((supported as readonly string[]).includes(policy)) {
          assert.equal(parseCliArguments(argumentsForPolicy).action, command, `${command} should accept ${policy}`);
        } else {
          assert.throws(() => parseCliArguments(argumentsForPolicy), new RegExp(`for ${command} supports`, 'iu'));
        }
      }
    }
  });

  test('keeps ordinary findings neutral unless a selected policy matches', () => {
    const document = { availability: { state: 'inconclusive' }, diagnostics: { rdap: { status: 'partial' } }, risk: { score: 82 } };
    assert.deepEqual(evaluateCliFailPolicies(document, []), []);
    assert.deepEqual(evaluateCliFailPolicies(document, ['source-failure', 'inconclusive', 'danger']).map((item) => item.policy), ['source-failure', 'inconclusive', 'danger']);
  });

  test('emits the final structured Lookup before returning the policy exit', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['lookup', 'example.test', '--json', '--fail-on', 'inconclusive'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
      now: () => '2026-08-05T06:00:00.000Z',
      runUnifiedLookup: async () => ({
        availability: { state: 'inconclusive' },
        rdap: { parsed: {} },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
      }),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.cli.lookup');
    assert.match(stderr, /Failure policy matched: inconclusive/iu);
  });

  test('detects only unexpected complete observation changes as material drift', () => {
    assert.equal(evaluateCliFailPolicies({ flightRecorder: { summary: { unexpectedChanges: 0, collectionChanges: 3 } } }, ['material-drift']).length, 0);
    assert.equal(evaluateCliFailPolicies({ flightRecorder: { summary: { unexpectedChanges: 1 } } }, ['material-drift']).length, 1);
  });

  test('evaluates nested result danger and monitor review uncertainty', () => {
    assert.deepEqual(
      evaluateCliFailPolicies({ results: [{ riskScore: 82 }] }, ['danger']),
      [{ policy: 'danger', reason: 'risk score 82 met the 70 review threshold' }],
    );
    assert.deepEqual(
      evaluateCliFailPolicies({ review: { state: 'inconclusive' } }, ['inconclusive']),
      [{ policy: 'inconclusive', reason: '1 authority or availability state(s) remained inconclusive' }],
    );
  });
});
