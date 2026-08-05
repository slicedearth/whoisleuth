import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { runInvestigationRecipe } from '../cli/investigation-run.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-08-05T05:00:00.000Z';

describe('fixed investigation execution', () => {
  test('pauses before network collection without approval', async () => {
    let executed = 0;
    const result = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false, resumeInput: null, generatedAt: NOW,
      execute: async () => { executed += 1; return { exitCode: 0, stdout: '{}' }; },
    });
    assert.equal(result.state, 'awaiting_network_approval');
    assert.equal(result.currentStep?.id, 'collect');
    assert.equal(executed, 0);
  });

  test('executes only concrete approved steps then pauses at analyst selection', async () => {
    const calls: string[] = [];
    const result = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: true, resumeInput: null, generatedAt: NOW,
      execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: JSON.stringify({ schema: `test.${command}` }) }; },
    });
    assert.deepEqual(calls, ['discover', 'discover-scan']);
    assert.equal(result.state, 'awaiting_analyst_selection');
    assert.equal(result.currentStep?.id, 'inspect');
    assert.equal(result.completedSteps.length, 2);
  });

  test('resumes a matching checkpoint without repeating completed steps', async () => {
    const first = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false, resumeInput: null, generatedAt: NOW,
      execute: async (command) => ({ exitCode: 0, stdout: JSON.stringify({ command }) }),
    });
    const calls: string[] = [];
    const resumed = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: true, resumeInput: JSON.stringify(first), generatedAt: NOW,
      execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: '{}' }; },
    });
    assert.deepEqual(calls, ['discover-scan']);
    assert.equal(resumed.completedSteps.length, 2);
    assert.equal(resumed.state, 'awaiting_analyst_selection');
  });

  test('exposes explicit approval and resume arguments through the runner', async () => {
    assert.deepEqual(parseCliArguments(['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--resume', 'state.json', '--json']), {
      action: 'workflow-run', recipe: 'domain-triage', subject: 'example.test', resumeSource: 'state.json', approveNetwork: true, output: 'json', quiet: false, color: true,
    });
    let stdout = '';
    let calls = 0;
    const code = await runCli(['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      runUnifiedLookup: async () => { calls += 1; return { diagnostics: {}, availability: {} }; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(stdout).state, 'awaiting_analyst_selection');
  });

  test('rejects resume data from another subject or injected step', async () => {
    const invalid = { schema: 'whoisleuth.cli.investigation-run', version: 1, recipe: 'domain-triage', subject: 'other.test', completedSteps: [] };
    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false, resumeInput: JSON.stringify(invalid), generatedAt: NOW, execute: async () => ({ exitCode: 0, stdout: '{}' }),
    }), /must match/iu);
  });
});
