import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { runInvestigationRecipe } from '../cli/investigation-run.mts';
import { buildInvestigationPlan } from '../cli/investigation-plan.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-08-05T05:00:00.000Z';

function commandOutput(recipe: Parameters<typeof buildInvestigationPlan>[0], subject: string, command: string) {
  const step = buildInvestigationPlan(recipe, subject, NOW).steps.find((item) => item.command === command);
  assert.ok(step);
  return JSON.stringify({ schema: step.produces });
}

describe('fixed investigation execution', () => {
  test('keeps plan-only recipes outside workflow-run execution', () => {
    assert.throws(
      () => parseCliArguments(['workflow-run', 'campaign-review', 'Example Organisation']),
      /workflow-run recipe must be one of/iu,
    );
  });
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
      execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: commandOutput('lookalike-review', 'Example Brand', command) }; },
    });
    assert.deepEqual(calls, ['discover', 'discover-scan']);
    assert.equal(result.state, 'awaiting_analyst_selection');
    assert.equal(result.currentStep?.id, 'inspect');
    assert.equal(result.completedSteps.length, 2);
  });

  test('substitutes bounded analyst selections in placeholder order and completes the recipe', async () => {
    const calls: Array<Readonly<{ command: string; arguments: readonly string[] }>> = [];
    const result = await runInvestigationRecipe('historical-comparison', 'example.test', {
      approveNetwork: true,
      resumeInput: null,
      selections: [
        { stepId: 'diff', value: 'earlier.json' },
        { stepId: 'diff', value: 'later.json' },
        { stepId: 'timeline', value: 'oldest.json' },
        { stepId: 'timeline', value: 'newer.json' },
        { stepId: 'timeline', value: 'current.json' },
      ],
      generatedAt: NOW,
      execute: async (command, args) => {
        calls.push({ command, arguments: args });
        return { exitCode: 0, stdout: commandOutput('historical-comparison', 'example.test', command) };
      },
    });
    assert.equal(result.version, 2);
    assert.equal(result.state, 'complete');
    assert.deepEqual(calls.map((item) => item.arguments), [
      ['example.test', '--deep', '--json'],
      ['earlier.json', 'later.json', '--json'],
      ['oldest.json', 'newer.json', 'current.json', '--json'],
    ]);
    assert.deepEqual(result.selections, [
      { stepId: 'diff', values: ['earlier.json', 'later.json'] },
      { stepId: 'timeline', values: ['oldest.json', 'newer.json', 'current.json'] },
    ]);
  });

  test('resumes a matching checkpoint without repeating completed steps', async () => {
    const first = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false, resumeInput: null, generatedAt: NOW,
      execute: async (command) => ({ exitCode: 0, stdout: commandOutput('lookalike-review', 'Example Brand', command) }),
    });
    const calls: string[] = [];
    const resumed = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: true, resumeInput: JSON.stringify(first), generatedAt: NOW,
      execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: commandOutput('lookalike-review', 'Example Brand', command) }; },
    });
    assert.deepEqual(calls, ['discover-scan']);
    assert.equal(resumed.completedSteps.length, 2);
    assert.equal(resumed.state, 'awaiting_analyst_selection');
  });

  test('exposes explicit approval and resume arguments through the runner', async () => {
    assert.deepEqual(parseCliArguments(['workflow-run', 'domain-triage', 'example.test', '--select', 'export=saved.json', '--approve-network', '--resume', 'state.json', '--json']), {
      action: 'workflow-run', recipe: 'domain-triage', subject: 'example.test', resumeSource: 'state.json', selections: [{ stepId: 'export', value: 'saved.json' }], approveNetwork: true, output: 'json', quiet: false, color: true,
    });
    let stdout = '';
    let calls = 0;
    const code = await runCli(['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      runUnifiedLookup: async () => {
        calls += 1;
        return { diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' } }, availability: {} };
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(stdout).state, 'awaiting_analyst_selection');
  });

  test('rejects unknown, excessive, and option-shaped analyst selections', async () => {
    for (const selections of [
      [{ stepId: 'unknown', value: 'input.json' }],
      [{ stepId: 'export', value: '--output' }],
      [{ stepId: 'export', value: 'one.json' }, { stepId: 'export', value: 'two.json' }],
    ]) {
      await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: false,
        resumeInput: null,
        selections,
        generatedAt: NOW,
        execute: async () => ({ exitCode: 0, stdout: '{}' }),
      }), /fixed recipe|invalid value|bounded/iu);
    }
    assert.throws(
      () => parseCliArguments(['workflow-run', 'domain-triage', 'example.test', '--select', 'export=--output']),
      /cannot start with a hyphen/iu,
    );
    assert.throws(
      () => parseCliArguments(['workflow-run', 'domain-triage', 'example.test', '--select', 'not-a-selection']),
      /step-id/iu,
    );
  });

  test('reports resume read failures and renders an unapproved run without execution', async () => {
    let stderr = '';
    assert.equal(await runCli([
      'workflow-run', 'domain-triage', 'example.test', '--resume', 'state.json',
    ], {
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      readDiffInput: async () => { throw new Error('Resume read failed'); },
    }), EXIT_CODES.USAGE);
    assert.match(stderr, /Could not read investigation resume state: Resume read failed/u);

    let terminal = '';
    let calls = 0;
    assert.equal(await runCli(['workflow-run', 'domain-triage', 'example.test', '--no-color'], {
      stdout: { write(value) { terminal += value; } },
      stderr: { write() {} },
      now: () => NOW,
      runUnifiedLookup: async () => { calls += 1; return {}; },
    }), EXIT_CODES.SUCCESS);
    assert.equal(calls, 0);
    assert.match(terminal, /awaiting network approval/iu);
  });

  test('rejects resume data from another subject or injected step', async () => {
    const invalid = { schema: 'whoisleuth.cli.investigation-run', version: 1, recipe: 'domain-triage', subject: 'other.test', completedSteps: [] };
    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false, resumeInput: JSON.stringify(invalid), generatedAt: NOW, execute: async () => ({ exitCode: 0, stdout: '{}' }),
    }), /must match/iu);
  });

  test('reads version-1 checkpoints and retains version-2 selections across resume', async () => {
    const plan = buildInvestigationPlan('lookalike-review', 'Example Brand', NOW);
    const legacy = {
      schema: 'whoisleuth.cli.investigation-run',
      version: 1,
      recipe: 'lookalike-review',
      subject: 'example brand',
      completedSteps: [{ ...plan.steps[0], exitCode: 0, result: { schema: plan.steps[0]?.produces } }],
    };
    const resumed = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: true,
      resumeInput: JSON.stringify(legacy),
      selections: [{ stepId: 'inspect', value: 'candidate.example.test' }],
      generatedAt: NOW,
      execute: async (command) => ({ exitCode: 0, stdout: commandOutput('lookalike-review', 'Example Brand', command) }),
    });
    assert.equal(resumed.state, 'complete');
    assert.deepEqual(resumed.selections, [{ stepId: 'inspect', values: ['candidate.example.test'] }]);

    await assert.rejects(() => runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false,
      resumeInput: JSON.stringify({ ...legacy, selections: [] }),
      generatedAt: NOW,
      execute: async () => ({ exitCode: 0, stdout: '{}' }),
    }), /version 1 cannot contain analyst selections/iu);
  });

  test('rejects forged, duplicate, out-of-order, and wrong-schema resume steps without execution', async () => {
    const plan = buildInvestigationPlan('lookalike-review', 'Example Brand', NOW);
    const validStep = {
      ...plan.steps[0],
      exitCode: 0,
      result: { schema: plan.steps[0]?.produces },
    };
    const variants = [
      [{ ...validStep, command: 'lookup' }],
      [{ ...validStep, arguments: ['--forged'] }],
      [{ ...validStep, mode: 'network' }],
      [{ ...validStep, id: plan.steps[1]?.id }],
      [validStep, validStep],
      [{ ...validStep, result: { schema: 'whoisleuth.unexpected' } }],
    ];
    for (const completedSteps of variants) {
      let executed = 0;
      await assert.rejects(() => runInvestigationRecipe('lookalike-review', 'Example Brand', {
        approveNetwork: true,
        resumeInput: JSON.stringify({
          schema: 'whoisleuth.cli.investigation-run', version: 1,
          recipe: 'lookalike-review', subject: 'example brand', completedSteps,
        }),
        generatedAt: NOW,
        execute: async () => { executed += 1; return { exitCode: 0, stdout: '{}' }; },
      }), /fixed recipe|unexpected command contract/iu);
      assert.equal(executed, 0);
    }
  });

  test('retries a final failed checkpoint step and rejects a failed non-final step', async () => {
    const plan = buildInvestigationPlan('lookalike-review', 'Example Brand', NOW);
    const failed = { ...plan.steps[0], exitCode: 1, result: { schema: 'failure' } };
    const resumeRoot = {
      schema: 'whoisleuth.cli.investigation-run', version: 1,
      recipe: 'lookalike-review', subject: 'example brand', completedSteps: [failed],
    };
    const calls: string[] = [];
    const resumed = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false, resumeInput: JSON.stringify(resumeRoot), generatedAt: NOW,
      execute: async (command) => { calls.push(command); return { exitCode: 2, stdout: commandOutput('lookalike-review', 'Example Brand', command) }; },
    });
    assert.deepEqual(calls, ['discover']);
    assert.equal(resumed.completedSteps[0]?.exitCode, 2);

    await assert.rejects(() => runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false,
      resumeInput: JSON.stringify({ ...resumeRoot, completedSteps: [failed, { ...plan.steps[1], exitCode: 1, result: {} }] }),
      generatedAt: NOW,
      execute: async () => ({ exitCode: 0, stdout: '{}' }),
    }), /final retained step/iu);
  });

  test('rejects successful command output from an unexpected contract', async () => {
    await assert.rejects(() => runInvestigationRecipe('lookalike-review', 'Example Brand', {
      approveNetwork: false, resumeInput: null, generatedAt: NOW,
      execute: async () => ({ exitCode: 0, stdout: JSON.stringify({ schema: 'whoisleuth.unexpected' }) }),
    }), /unexpected command contract/iu);
  });

  test('propagates cancellation instead of retaining it as a failed workflow step', async () => {
    const controller = new AbortController();
    let calls = 0;
    const running = runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true,
      resumeInput: null,
      generatedAt: NOW,
      signal: controller.signal,
      execute: async () => {
        calls += 1;
        controller.abort(new DOMException('Cancelled', 'AbortError'));
        return { exitCode: EXIT_CODES.CANCELLED, stdout: '' };
      },
    });
    await assert.rejects(running, { name: 'AbortError' });
    assert.equal(calls, 1);

    const preAborted = new AbortController();
    preAborted.abort(new DOMException('Cancelled', 'AbortError'));
    await assert.rejects(
      () => runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: false,
        resumeInput: null,
        generatedAt: NOW,
        signal: preAborted.signal,
        execute: async () => { calls += 1; return { exitCode: 0, stdout: '{}' }; },
      }),
      { name: 'AbortError' },
    );
    assert.equal(calls, 1);
  });

  test('rejects structurally over-bound resume and step JSON before retaining it', async () => {
    let deeplyNested = '{"schema":"whoisleuth.cli.lookup","nested":';
    deeplyNested += '['.repeat(49);
    deeplyNested += 'null';
    deeplyNested += ']'.repeat(49);
    deeplyNested += '}';

    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false,
      resumeInput: `{"schema":"whoisleuth.cli.investigation-run","version":1,"recipe":"domain-triage","subject":"example.test","completedSteps":${'['.repeat(49)}null${']'.repeat(49)}}`,
      generatedAt: NOW,
      execute: async () => ({ exitCode: 0, stdout: '{}' }),
    }), /nesting limit/iu);

    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true,
      resumeInput: null,
      generatedAt: NOW,
      execute: async () => ({ exitCode: 0, stdout: deeplyNested }),
    }), /step output .*nesting limit/iu);
  });
});
