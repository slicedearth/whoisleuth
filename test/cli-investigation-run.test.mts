import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { CliUsageError, parseCliArguments } from '../cli/arguments.mts';
import { formatInvestigationRun, investigationRunExitCode, runInvestigationRecipe } from '../cli/investigation-run.mts';
import { createCliDiagnosticOutput } from '../cli/errors.mts';
import { buildInvestigationPlan } from '../cli/investigation-plan.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildCliLookupDocument } from '../cli/saved-lookup.mts';
import { buildCliEvidenceExport } from '../cli/export-evidence.mts';
import * as evidence from '../lib/evidence-export.mts';

const NOW = '2026-08-05T05:00:00.000Z';

function commandOutput(recipe: Parameters<typeof buildInvestigationPlan>[0], subject: string, command: string) {
  const step = buildInvestigationPlan(recipe, subject, NOW).steps.find((item) => item.command === command);
  assert.ok(step);
  const lookup = buildCliLookupDocument('example.test', {
    type: 'domain', value: 'example.test', inputHostname: 'example.test', registrableDomain: 'example.test', isSubdomain: false,
  }, { diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' } }, availability: {} }, NOW, 'deep');
  if (command === 'lookup') return JSON.stringify(lookup);
  if (command === 'export') return JSON.stringify(buildCliEvidenceExport(JSON.stringify(lookup), evidence, NOW));
  return JSON.stringify({ schema: step.produces, version: command === 'discover' ? 2 : command === 'verify-artifact' ? 3 : 1 });
}

describe('fixed investigation execution', () => {
  test('keeps plan-only recipes outside workflow-run execution', () => {
    assert.throws(
      () => parseCliArguments(['workflow-run', 'campaign-review', 'Example Organisation']),
      CliUsageError,
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
    assert.equal(result.version, 3);
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
      action: 'workflow-run', recipe: 'domain-triage', subject: 'example.test', resumeSource: 'state.json', selections: [{ stepId: 'export', value: 'saved.json' }], artifactBindings: [], approveNetwork: true, output: 'json', quiet: false, color: true,
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

  test('reads version-1 checkpoints and retains analyst selections across resume', async () => {
    const plan = buildInvestigationPlan('lookalike-review', 'Example Brand', NOW);
    const legacy = {
      schema: 'whoisleuth.cli.investigation-run',
      version: 1,
      recipe: 'lookalike-review',
      subject: 'example brand',
      completedSteps: [{ ...plan.steps[0], exitCode: 0, result: JSON.parse(commandOutput('lookalike-review', 'Example Brand', 'discover')) }],
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
      result: JSON.parse(commandOutput('lookalike-review', 'Example Brand', 'discover')),
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
      execute: async (command) => { calls.push(command); return { exitCode: EXIT_CODES.SUCCESS, stdout: commandOutput('lookalike-review', 'Example Brand', command) }; },
    });
    assert.deepEqual(calls, ['discover']);
    assert.equal(resumed.completedSteps[0]?.exitCode, 0);
    assert.equal(resumed.state, 'awaiting_network_approval');

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

  test('does not promote usage, operational, internal or offline partial failures to completed work', async () => {
    assert.deepEqual(EXIT_CODES, { SUCCESS: 0, USAGE: 2, LOOKUP_FAILED: 3, PARTIAL_FAILURE: 4, INTERNAL_ERROR: 70, CANCELLED: 130 });
    for (const [exitCode, expectedExit] of [[2, 2], [3, 3], [4, 4], [70, 70], [1, 70]] as const) {
      const first = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
        approveNetwork: true, resumeInput: null, generatedAt: NOW,
        execute: async (command) => ({ exitCode, stdout: commandOutput('lookalike-review', 'Example Brand', command) }),
      });
      assert.equal(first.state, 'step_failed');
      assert.equal(first.completedSteps.length, 1);
      assert.equal(investigationRunExitCode(first), expectedExit);
      assert.match(formatInvestigationRun(first), /Failed\s+Generate candidates/u);
      const calls: string[] = [];
      const resumed = await runInvestigationRecipe('lookalike-review', 'Example Brand', {
        approveNetwork: false, resumeInput: JSON.stringify(first), generatedAt: NOW,
        execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: commandOutput('lookalike-review', 'Example Brand', command) }; },
      });
      assert.deepEqual(calls, ['discover']);
      assert.equal(resumed.state, 'awaiting_network_approval');
      assert.equal(investigationRunExitCode(resumed), 0);
    }
  });

  test('pauses and retains partial observations only for the three fixed collection commands', async () => {
    for (const [recipe, command, expectedCalls] of [
      ['domain-triage', 'lookup', ['lookup']],
      ['owned-domain-review', 'posture', ['posture']],
      ['lookalike-review', 'discover-scan', ['discover', 'discover-scan']],
    ] as const) {
      const calls: string[] = [];
      const result = await runInvestigationRecipe(recipe, 'example.test', {
        approveNetwork: true, resumeInput: null, generatedAt: NOW,
        execute: async (next) => { calls.push(next); return { exitCode: next === command ? 4 : 0, stdout: commandOutput(recipe, 'example.test', next) }; },
      });
      assert.deepEqual(calls, expectedCalls);
      assert.equal(result.state, 'partial');
      assert.equal(result.currentStep?.command, command);
      assert.equal(investigationRunExitCode(result), 4);
      assert.match(formatInvestigationRun(result), /Review\s+Collect/u);
      const resumed = await runInvestigationRecipe(recipe, 'example.test', {
        approveNetwork: false, resumeInput: JSON.stringify(result), generatedAt: NOW,
        execute: async () => { assert.fail('A retained observation must not be recollected.'); },
      });
      assert.equal(investigationRunExitCode(resumed), 4);
      assert.deepEqual(resumed.completedSteps, result.completedSteps);
      assert.ok(['awaiting_analyst_selection', 'awaiting_network_approval'].includes(resumed.state));
    }
  });

  test('keeps an earlier partial observation partial after later steps finish and on repeated resume', async () => {
    const selections = [{ stepId: 'export', value: 'lookup.json' }, { stepId: 'verify', value: 'evidence.json' }];
    const first = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true, resumeInput: null, selections, generatedAt: NOW,
      execute: async (command) => ({ exitCode: 4, stdout: commandOutput('domain-triage', 'example.test', command) }),
    });
    const calls: string[] = [];
    const resumed = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false, resumeInput: JSON.stringify(first), generatedAt: NOW,
      execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: commandOutput('domain-triage', 'example.test', command) }; },
    });
    assert.deepEqual(calls, ['export', 'verify-artifact']);
    assert.equal(resumed.state, 'partial');
    assert.equal(resumed.currentStep, null);
    assert.equal(investigationRunExitCode(resumed), 4);
    const again = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true, resumeInput: JSON.stringify(resumed), generatedAt: NOW,
      execute: async () => { assert.fail('A finished partial checkpoint must not repeat any step.'); },
    });
    assert.equal(again.state, 'partial');
    assert.equal(investigationRunExitCode(again), 4);
  });

  test('does not accept failed offline export or verification even when output has the expected schema', async () => {
    for (const failedCommand of ['export', 'verify-artifact']) {
      const result = await runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: true, resumeInput: null, generatedAt: NOW,
        selections: [{ stepId: 'export', value: 'lookup.json' }, { stepId: 'verify', value: 'evidence.json' }],
        execute: async (command) => ({ exitCode: command === failedCommand ? 4 : 0, stdout: commandOutput('domain-triage', 'example.test', command) }),
      });
      assert.equal(result.state, 'step_failed');
      assert.equal(result.currentStep?.command, failedCommand);
      const calls: string[] = [];
      const resumed = await runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: false, resumeInput: JSON.stringify(result), generatedAt: NOW,
        execute: async (command) => { calls.push(command); return { exitCode: 0, stdout: commandOutput('domain-triage', 'example.test', command) }; },
      });
      assert.equal(calls[0], failedCommand);
      assert.equal(resumed.state, 'complete');
    }
  });

  test('reads the public version-2 writer fixture without repeating its retained partial collection', async () => {
    // The public 2.3.0 writer with its retained Lookup fixture and an injected
    // partial exit produced these immutable bytes; this is not live collection.
    const input = readFileSync(new URL('./fixtures/cli-investigation-run-v2.json', import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(input).digest('hex'), '8f12f15e95930c145bd3c8be4318a72cfb50bf8d5bb998427e08452d80ec5ac7');
    const resumed = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true, resumeInput: input, generatedAt: NOW,
      execute: async () => { assert.fail('The public checkpoint already retained the collection.'); },
    });
    assert.equal(resumed.version, 3);
    assert.equal(resumed.state, 'awaiting_analyst_selection');
    assert.equal(investigationRunExitCode(resumed), 4);
    assert.deepEqual(resumed.completedSteps.map(({ artifact, inputs, ...step }) => {
      assert.match(artifact!.id, /^sha256:[a-f0-9]{64}$/u);
      assert.deepEqual(inputs, []);
      return step;
    }), JSON.parse(input).completedSteps);
    for (const version of [0, 4, '3', null]) {
      await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: true, resumeInput: JSON.stringify({ ...JSON.parse(input), version }), generatedAt: NOW,
        execute: async () => { assert.fail('An unsupported checkpoint must not execute.'); },
      }), /versioned recipe/u);
    }
  });

  test('rejects wrong-contract partial collection as a failed attempt and retries deliberately', async () => {
    const first = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: true, resumeInput: null, generatedAt: NOW,
      execute: async () => ({ exitCode: 4, stdout: '{"schema":"whoisleuth.unexpected"}' }),
    });
    assert.equal(first.state, 'step_failed');
    const resumed = await runInvestigationRecipe('domain-triage', 'example.test', {
      approveNetwork: false, resumeInput: JSON.stringify(first), generatedAt: NOW,
      execute: async () => { assert.fail('Retry still requires new collection approval.'); },
    });
    assert.equal(resumed.state, 'awaiting_network_approval');
    assert.equal(resumed.completedSteps.length, 0);
  });

  test('preserves failure diagnostics on stderr without putting them in machine checkpoint output', async () => {
    for (const [error, expectedExit] of [[new Error('Fixture collector unavailable'), 3], [new CliUsageError('Fixture input is invalid'), 2]] as const) {
      let stdout = '';
      let stderr = '';
      const code = await runCli(['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--json'], {
        stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } }, now: () => NOW,
        runUnifiedLookup: async () => { throw error; },
      });
      assert.equal(code, expectedExit);
      assert.match(stderr, /Fixture (collector unavailable|input is invalid)/u);
      assert.ok(stderr.length <= 350);
      assert.equal(JSON.parse(stdout).state, 'step_failed');
      assert.equal(stdout.includes(error.message), false);
    }
  });

  test('bounds diagnostic capture and removes terminal controls, URLs and credential-shaped fields', () => {
    const output = createCliDiagnosticOutput();
    output.stream.write('Failure at https://user:fixture-password@example.test/private?token=example\n');
    output.stream.write('Authorization: Bearer fixture-header\npassword="must not render"\n');
    output.stream.write('\u001b[31mCollector unavailable\u001b[0m\u202e\u0007\n');
    output.stream.write('x'.repeat(10_000));
    output.stream.write('must-not-be-retained');
    const text = output.value();
    assert.ok(text.length <= 300);
    assert.match(text, /Collector unavailable/u);
    assert.equal(text.includes('token=example'), false);
    assert.doesNotMatch(text, /fixture-password|fixture-header|must not render|https:|private\?|must-not-be-retained|[\u001b\u202e\u0007]/u);
    assert.match(text, /URL omitted/u);
    const empty = createCliDiagnosticOutput();
    for (let index = 0; index < 5_000; index += 1) empty.stream.write('');
    empty.stream.write(' \n');
    assert.equal(empty.value(), '');
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
