import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import { runInvestigationRecipe } from '../cli/investigation-run.mts';
import { buildInvestigationPlan } from '../cli/investigation-plan.mts';
import { validateWorkflowResult } from '../cli/investigation-artifacts.mts';
import { commandOptionSpec, commandHelp } from '../cli/command-reference.mts';

const NOW = '2026-08-05T05:00:00.000Z';
const PUBLIC_CHECKPOINT = readFileSync(new URL('./fixtures/cli-investigation-run-v2.json', import.meta.url), 'utf8');
const LOOKUP = JSON.parse(PUBLIC_CHECKPOINT).completedSteps[0].result;
const BINDINGS = [
  { stepId: 'export', input: 1, sourceStepId: 'collect' },
  { stepId: 'verify', input: 1, sourceStepId: 'export' },
] as const;
const BINDING_ARGS = ['--use-artifact', 'export:1=collect', '--use-artifact', 'verify:1=export'];

function capture() {
  let output = '';
  return { stream: { write(value: string) { output += value; } }, value: () => output };
}

async function retainedTriage(extra: readonly string[] = [], resume = PUBLIC_CHECKPOINT) {
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(['workflow-run', 'domain-triage', 'example.test', '--resume', 'run.json', ...BINDING_ARGS, '--json', ...extra], {
    stdout: stdout.stream, stderr: stderr.stream, now: () => NOW,
    readDiffInput: (source) => { assert.equal(source, 'run.json'); return resume; },
    readExportInput: () => assert.fail('A bound Lookup must not read an external file.'),
    readArtifactInput: () => assert.fail('Bound evidence must not read an external file.'),
    runUnifiedLookup: () => assert.fail('Retained observations must not be recollected.'),
  });
  assert.equal(stderr.value(), '');
  assert.equal(code, 4);
  return JSON.parse(stdout.value());
}

describe('typed fixed-workflow artefact reuse', () => {
  test('declares one repeatable explicit binding option without changing filename selection syntax', () => {
    const args = parseCliArguments(['workflow-run', 'domain-triage', 'example.test', ...BINDING_ARGS]);
    assert.equal(args.action, 'workflow-run');
    if (args.action !== 'workflow-run') assert.fail();
    assert.deepEqual(args.artifactBindings, BINDINGS);
    assert.deepEqual(args.selections, []);
    assert.equal(commandOptionSpec('workflow-run', '--use-artifact')?.occurrence, 'repeatable');
    assert.match(commandHelp('workflow-run'), /--use-artifact/u);
    for (const value of ['export=collect', 'export:0=collect', 'export:-1=collect', 'export:1=collect:1', 'export:1=']) {
      assert.throws(() => parseCliArguments(['workflow-run', 'domain-triage', 'example.test', '--use-artifact', value]), /input-number/u);
    }
  });

  test('standard inputs complete real collection, export and verification without extraction files', async () => {
    const stdout = capture();
    const stderr = capture();
    let collections = 0;
    const code = await runCli(['workflow-run', 'domain-triage', 'example.test', '--approve-network', '--json'], {
      stdout: stdout.stream, stderr: stderr.stream, now: () => NOW,
      runUnifiedLookup: async () => { collections += 1; return { diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' } }, availability: {} }; },
      readExportInput: () => assert.fail('No external Lookup selected.'),
      readArtifactInput: () => assert.fail('No external evidence selected.'),
    });
    assert.equal(code, 0, stderr.value());
    assert.equal(collections, 1);
    const result = JSON.parse(stdout.value());
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.artifactBindings, BINDINGS);
    assert.deepEqual(result.completedSteps.map((step: { command: string }) => step.command), ['lookup', 'export', 'verify-artifact']);
    assert.equal(result.completedSteps[2].result.artifact.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.completedSteps[1].result.diagnostics.rdap.status, 'unsupported');
    assert.equal(result.completedSteps[0].result.generatedAt, NOW);
    assert.deepEqual(result.completedSteps[1].inputs, [{ input: 1, sourceStepId: 'collect', artifactId: result.completedSteps[0].artifact.id }]);
    assert.deepEqual(result.completedSteps[2].inputs, [{ input: 1, sourceStepId: 'export', artifactId: result.completedSteps[1].artifact.id }]);
  });

  test('upgrades the public checkpoint and binds its exact retained partial observation without collection', async () => {
    const result = await retainedTriage();
    assert.equal(result.state, 'partial');
    assert.equal(result.version, 3);
    assert.deepEqual(result.completedSteps[0].result, LOOKUP);
    assert.equal(result.completedSteps[0].result.generatedAt, LOOKUP.generatedAt);
    assert.equal(result.completedSteps[2].result.checks.structure, 'verified');
    const repeated = await retainedTriage([], JSON.stringify(result));
    assert.deepEqual(repeated.completedSteps, result.completedSteps);
  });

  test('mixes positional file selections and exact earlier artefacts in diff and timeline', async () => {
    const stdout = capture();
    const stderr = capture();
    const files: string[] = [];
    const prior = structuredClone(LOOKUP);
    prior.generatedAt = '2026-08-01T00:00:00.000Z';
    const checkpoint = {
      schema: 'whoisleuth.cli.investigation-run', version: 2, recipe: 'historical-comparison', subject: 'example.test', selections: [],
      completedSteps: [{ id: 'current', command: 'lookup', arguments: ['example.test', '--deep', '--json'], mode: 'network', exitCode: 0, result: LOOKUP }],
    };
    const code = await runCli(['workflow-run', 'historical-comparison', 'example.test', '--resume', 'run.json', '--json',
      '--use-artifact', 'diff:2=current', '--select', 'diff=prior.json',
      '--use-artifact', 'timeline:3=current', '--select', 'timeline=first.json', '--select', 'timeline=second.json'], {
      stdout: stdout.stream, stderr: stderr.stream, now: () => NOW,
      readDiffInput: (source) => {
        files.push(source);
        return source === 'run.json' ? JSON.stringify(checkpoint) : JSON.stringify({
          ...prior, generatedAt: source === 'first.json' ? '2026-07-01T00:00:00.000Z' : prior.generatedAt,
        });
      },
      runUnifiedLookup: () => assert.fail('The current Lookup is retained.'),
    });
    assert.equal(code, 0, stderr.value());
    const result = JSON.parse(stdout.value());
    assert.equal(result.state, 'complete');
    assert.deepEqual(files, ['run.json', 'prior.json', 'first.json', 'second.json']);
    assert.equal(result.completedSteps[1].result.schema, 'whoisleuth.cli.lookup-diff');
    assert.equal(result.completedSteps[2].result.schema, 'whoisleuth.cli.lookup-timeline');
    assert.equal(result.completedSteps[2].inputs[0].input, 3);
    assert.equal(new Set(result.completedSteps[2].result.observations.map((item: { generatedAt: string }) => item.generatedAt)).size, 3);
    assert.equal(result.completedSteps[1].arguments[0], 'prior.json');
  });

  test('uses bounded native files alongside retained artefacts and fails a missing selection without recollection', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'workflow-native-inputs-'));
    const priorPath = path.join(directory, 'prior observation.json');
    const firstPath = path.join(directory, 'first observation.json');
    const checkpoint = {
      schema: 'whoisleuth.cli.investigation-run', version: 2, recipe: 'historical-comparison', subject: 'example.test', selections: [],
      completedSteps: [{ id: 'current', command: 'lookup', arguments: ['example.test', '--deep', '--json'], mode: 'network', exitCode: 0, result: LOOKUP }],
    };
    const args = ['workflow-run', 'historical-comparison', 'example.test', '--resume', 'retained-state.json', '--json',
      '--use-artifact', 'diff:2=current', '--select', `diff=${priorPath}`,
      '--use-artifact', 'timeline:3=current', '--select', `timeline=${firstPath}`, '--select', `timeline=${priorPath}`];
    try {
      await writeFile(priorPath, JSON.stringify({ ...LOOKUP, generatedAt: '2026-08-01T00:00:00.000Z' }));
      await writeFile(firstPath, JSON.stringify({ ...LOOKUP, generatedAt: '2026-07-01T00:00:00.000Z' }));
      for (const missing of [false, true]) {
        if (missing) await rm(priorPath);
        const stdout = capture();
        const stderr = capture();
        const code = await runCli(args, {
          stdout: stdout.stream, stderr: stderr.stream, now: () => NOW,
          workflowResumeInput: JSON.stringify(checkpoint),
          runUnifiedLookup: () => assert.fail('A retained current observation must not be recollected.'),
        });
        const result = JSON.parse(stdout.value());
        assert.deepEqual(result.completedSteps[0].result, LOOKUP);
        assert.equal(result.completedSteps[1].arguments[0], priorPath);
        if (missing) {
          assert.equal(code, 2);
          assert.equal(result.state, 'step_failed');
          assert.equal(result.completedSteps[1].artifact, null);
          assert.equal(result.completedSteps.length, 2);
          assert.match(stderr.value(), /^diff: Usage error:.*\bENOENT\b/u);
          assert.doesNotMatch(stdout.value(), /\bENOENT\b/u);
        } else {
          assert.equal(code, 0, stderr.value());
          assert.equal(stderr.value(), '');
          assert.equal(result.state, 'complete');
          assert.equal(result.completedSteps[1].result.schema, 'whoisleuth.cli.lookup-diff');
          assert.equal(result.completedSteps[2].result.schema, 'whoisleuth.cli.lookup-timeline');
          assert.deepEqual(result.completedSteps[2].result.observations.map((item: { generatedAt: string }) => item.generatedAt),
            ['2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', LOOKUP.generatedAt]);
          assert.equal(result.completedSteps[2].inputs[0].input, 3);
        }
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('rejects forward, duplicate, unknown, wrong-schema, out-of-range and non-file bindings before execution', async () => {
    for (const [recipe, bindings] of [
      ['domain-triage', [{ stepId: 'export', input: 1, sourceStepId: 'verify' }]],
      ['domain-triage', [BINDINGS[0], BINDINGS[0]]],
      ['domain-triage', [{ stepId: 'export', input: 1, sourceStepId: 'missing' }]],
      ['domain-triage', [{ stepId: 'verify', input: 1, sourceStepId: 'collect' }]],
      ['domain-triage', [{ stepId: 'export', input: 2, sourceStepId: 'collect' }]],
      ['domain-triage', [{ stepId: 'collect', input: 1, sourceStepId: 'collect' }]],
      ['lookalike-review', [{ stepId: 'inspect', input: 1, sourceStepId: 'scan' }]],
      ['owned-domain-review', [{ stepId: 'manifest', input: 1, sourceStepId: 'lookup' }]],
    ] as const) {
      await assert.rejects(() => runInvestigationRecipe(recipe, 'example.test', {
        artifactBindings: bindings, approveNetwork: true, resumeInput: null, generatedAt: NOW,
        execute: async () => assert.fail('Invalid bindings must be rejected before any step.'),
      }), /compatible earlier output/u);
    }
    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      artifactBindings: BINDINGS, selections: [{ stepId: 'export', value: 'external.json' }],
      approveNetwork: true, resumeInput: null, generatedAt: NOW, execute: async () => assert.fail(),
    }), /more selections/u);
  });

  test('detects changed artefact content, identities, input links and version downgrades before execution', async () => {
    const valid = await retainedTriage();
    const variants = [
      (value: typeof valid) => { value.completedSteps[0].result.generatedAt = NOW; },
      (value: typeof valid) => { value.completedSteps[0].artifact.id = `sha256:${'0'.repeat(64)}`; },
      (value: typeof valid) => { value.completedSteps[0].artifact.version += 1; },
      (value: typeof valid) => { value.completedSteps[1].inputs[0].artifactId = `sha256:${'0'.repeat(64)}`; },
      (value: typeof valid) => { value.completedSteps[1].inputs = []; },
      (value: typeof valid) => { value.completedSteps[1].arguments = ['external.json']; },
      (value: typeof valid) => { value.artifactBindings = []; },
      (value: typeof valid) => { delete value.artifactBindings; },
      (value: typeof valid) => { value.version = 2; },
    ];
    for (const mutate of variants) {
      const value = structuredClone(valid);
      mutate(value);
      await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
        approveNetwork: true, resumeInput: JSON.stringify(value), generatedAt: NOW, execute: async () => assert.fail(),
      }), /identity|bindings|fixed recipe/u);
    }
  });

  test('completed inputs cannot be rebound and an ordinary artefact-shaped filename stays literal', async () => {
    const valid = await retainedTriage();
    await assert.rejects(() => runInvestigationRecipe('domain-triage', 'example.test', {
      artifactBindings: BINDINGS, selections: [{ stepId: 'export', value: 'different.json' }],
      approveNetwork: false, resumeInput: JSON.stringify(valid), generatedAt: NOW, execute: async () => assert.fail(),
    }), /completed step|more selections/u);
    const selections = [{ stepId: 'export', value: 'workflow-artifact:ordinary-filename.json' }];
    let selected = '';
    await runInvestigationRecipe('domain-triage', 'example.test', {
      selections, approveNetwork: false, resumeInput: PUBLIC_CHECKPOINT, generatedAt: NOW,
      execute: async (_command, args, inputs) => { selected = args[0]!; assert.equal(inputs.size, 0); return { exitCode: 2, stdout: '' }; },
    });
    assert.equal(selected, selections[0]!.value);
  });

  test('failed export cannot provide an artefact and its retry remains offline', async () => {
    const first = await runInvestigationRecipe('domain-triage', 'example.test', {
      artifactBindings: BINDINGS, approveNetwork: false, resumeInput: PUBLIC_CHECKPOINT, generatedAt: NOW,
      execute: async (command) => { assert.equal(command, 'export'); return { exitCode: 2, stdout: '' }; },
    });
    assert.equal(first.state, 'step_failed');
    assert.equal(first.completedSteps.at(-1)!.artifact, null);
    const retried = await retainedTriage([], JSON.stringify(first));
    assert.equal(retried.state, 'partial');
    assert.equal(retried.completedSteps.length, 3);
  });

  test('identities use deterministic code-unit ordering, preserve clocks and reject future or malformed reusable output', () => {
    const step = buildInvestigationPlan('domain-triage', 'example.test', NOW).steps[0]!;
    const value = { ...LOOKUP, extension: { 'ä': 'accented', Z: 'upper', a: 'lower' } };
    const sorted = (input: unknown): unknown => Array.isArray(input) ? input.map(sorted)
      : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map((key) => [key, sorted((input as Record<string, unknown>)[key])])) : input;
    const expected = `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`;
    const identity = validateWorkflowResult(step, value, true);
    assert.equal(identity.id, expected);
    assert.equal(validateWorkflowResult(step, Object.fromEntries(Object.entries(value).reverse()), true).id, expected);
    assert.equal(value.generatedAt, LOOKUP.generatedAt);
    for (const invalid of [{ ...value, version: 999 }, { ...value, version: '2' }, { schema: value.schema, version: 2 }, { ...value, generatedAt: 'yesterday' }]) {
      assert.throws(() => validateWorkflowResult(step, invalid, true));
    }
  });

  test('exact output versions are checked for every installed runnable step', () => {
    for (const recipe of ['domain-triage', 'lookalike-review', 'owned-domain-review', 'historical-comparison'] as const) {
      for (const step of buildInvestigationPlan(recipe, 'example.test', NOW).steps) {
        assert.throws(() => validateWorkflowResult(step, { schema: step.produces, version: 999, schemaVersion: 999 }, false));
      }
    }
  });
});
