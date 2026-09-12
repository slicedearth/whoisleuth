import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { runCli } from '../cli/runner.mts';
import { buildInvestigationPlan, INVESTIGATION_PLAN_RECIPES, workflowReviewDeclarations, type InvestigationPlanRecipe } from '../cli/investigation-plan.mts';
import { formatInvestigationRun, runInvestigationRecipe } from '../cli/investigation-run.mts';
import { workflowRecipeInputs, workflowLookupResult, WORKFLOW_NOW } from './workflow-recipe-fixtures.mts';
import type { CliDependencies } from '../cli/runner-types.mts';

const BINDINGS: Partial<Record<InvestigationPlanRecipe, readonly string[]>> = {
  'domain-triage': ['export:1=collect', 'verify:1=export'],
  'registry-disagreement': ['compare:1=collect', 'report:1=collect'],
  'historical-comparison': ['diff:2=current', 'timeline:3=current'],
  'evidence-handoff': ['lint:1=package'],
};

async function execute(recipe: InvestigationPlanRecipe, args: readonly string[], inputs = workflowRecipeInputs(), overrides: CliDependencies = {}) {
  let stdout = '', stderr = '', collected = 0;
  const read = (name?: string | null) => {
    assert.ok(name && Object.hasOwn(inputs, name), `Unexpected file read: ${name}`);
    return inputs[name]!;
  };
  const code = await runCli(['workflow-run', recipe, 'example.test', '--json', ...args], {
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } }, now: () => WORKFLOW_NOW,
    readArtifactInput: read, readExportInput: read, readCompareInput: read, readSourceReliabilityInput: read, readDiffInput: read,
    runUnifiedLookup: async query => { collected++; return workflowLookupResult(query.type === 'domain' ? query.inputHostname : 'example.test'); },
    checkDomainPosture: async () => { collected++; return { status: 'success', domain: 'example.test', checks: [] }; },
    searchCertificateTransparency: async () => { collected++; return { domains: [], matches: [], certificateGroups: [], certCount: 0, truncated: false,
      observation: { status: 'success', source: 'certificate_transparency', observedAt: WORKFLOW_NOW, complete: true, truncated: false, limitations: [] } }; },
    ...overrides,
  });
  return { code, stderr, collected, document: stdout ? JSON.parse(stdout) as Awaited<ReturnType<typeof runInvestigationRecipe>> : null };
}

function selectedArgs(recipe: InvestigationPlanRecipe) {
  const bindings = BINDINGS[recipe] ?? [];
  const args = bindings.flatMap(value => ['--use-artifact', value]);
  for (const step of buildInvestigationPlan(recipe, 'example.test', WORKFLOW_NOW).steps) {
    let input = 0;
    for (const argument of step.arguments) {
      if (!/^<[^>]+>$/u.test(argument)) continue;
      input++;
      if (bindings.some(value => value.startsWith(`${step.id}:${input}=`))) continue;
      args.push('--select', `${step.id}=${argument === '<selected-domain>' ? 'candidate.example.test' : argument.slice(1, -1)}`);
    }
  }
  return args;
}

class WorkflowTerminalInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(value: boolean) { this.isRaw = value; }
  resume() {}
  pause() {}
}

test('interactive selection preserves literal inputs and never grants network permission', async () => {
  const input = new WorkflowTerminalInput();
  let prompts = '', questions = 0;
  const selected = 'retained inputs/manifest $(literal).json';
  const result = await execute('post-change-verification', ['--interactive'], {}, {
    stdin: input, environment: { TERM: 'dumb' },
    stderr: { isTTY: true, write(value) { prompts += value; } },
    workflowQuestion: async prompt => { questions++; assert.match(prompt, /<manifest.json>/u); return selected; },
  });
  assert.equal(result.code, 0);
  assert.equal(result.collected, 0);
  assert.equal(questions, 1);
  assert.match(prompts, /no approval is implied/u);
  assert.equal(result.document?.state, 'awaiting_network_approval');
  assert.equal(result.document.networkApprovedForThisRun, false);
  assert.deepEqual(result.document.reviewsConfirmedForThisRun, []);
  assert.deepEqual(result.document.selections, [{ stepId: 'recheck', values: [selected] }]);
  assert.equal(result.document.currentStep?.arguments[0], selected);
});

test('interactive selection can pause, rejects redirected terminals and bounds supplied answers', async () => {
  const input = new WorkflowTerminalInput();
  const tty: CliDependencies = { stdin: input, environment: { TERM: 'dumb' }, stderr: { isTTY: true, write() {} } };
  const paused = await execute('post-change-verification', ['--interactive'], {}, { ...tty, workflowQuestion: async () => '' });
  assert.equal(paused.document?.state, 'awaiting_analyst_selection');
  assert.deepEqual(paused.document.selections, []);
  assert.equal(paused.collected, 0);
  const redirected = await execute('post-change-verification', ['--interactive', '--approve-network'], {}, {
    stdin: { isTTY: false }, workflowQuestion: async () => assert.fail('No prompting on a redirected stream.'),
  });
  assert.equal(redirected.code, 2);
  assert.equal(redirected.collected, 0);
  assert.match(redirected.stderr, /terminal input and terminal stderr/u);
  for (const answer of ['x'.repeat(1025), '\u001b[2J', '--output']) {
    const rejected = await execute('post-change-verification', ['--interactive', '--approve-network'], {}, { ...tty, workflowQuestion: async () => answer });
    assert.equal(rejected.code, 2);
    assert.equal(rejected.collected, 0);
  }
});

test('interactive handoff selections still require independent per-step review confirmations', async () => {
  const input = new WorkflowTerminalInput();
  const answers = ['evidence.json', 'cases.json'];
  const result = await execute('evidence-handoff', ['--interactive'], workflowRecipeInputs(), {
    stdin: input, environment: {}, stderr: { isTTY: true, write() {} }, workflowQuestion: async () => answers.shift() ?? '',
  });
  assert.equal(result.document?.state, 'awaiting_review_confirmation');
  assert.equal(result.document.currentStep?.id, 'package');
  assert.deepEqual(result.document.completedSteps.map(step => step.id), ['verify']);
  assert.deepEqual(result.document.reviewsConfirmedForThisRun, []);
  assert.equal(result.collected, 0);
});

test('recipe input callbacks reject excessive selections and honour cancellation before execution', async () => {
  for (const supplied of [['manifest.json', 'extra.json'], ['--output'], ['bad\u0000value']]) {
    await assert.rejects(() => runInvestigationRecipe('post-change-verification', 'example.test', {
      approveNetwork: true, resumeInput: null, generatedAt: WORKFLOW_NOW,
      selectInputs: async () => supplied,
      execute: async () => assert.fail('Invalid selections must fail before execution.'),
    }), /selections|invalid value/iu);
  }
  const controller = new AbortController();
  await assert.rejects(() => runInvestigationRecipe('post-change-verification', 'example.test', {
    approveNetwork: true, resumeInput: null, generatedAt: WORKFLOW_NOW, signal: controller.signal,
    selectInputs: async () => { controller.abort(); return ['manifest.json']; },
    execute: async () => assert.fail('Cancellation must precede execution.'),
  }), { name: 'AbortError' });
});

for (const recipe of INVESTIGATION_PLAN_RECIPES) test(`fixed recipe ${recipe} reaches every real command with only fixture collection and selected inputs`, async () => {
  const plan = buildInvestigationPlan(recipe, 'example.test', WORKFLOW_NOW);
  const confirmations = plan.steps.filter(step => workflowReviewDeclarations(step).length).flatMap(step => ['--confirm-review', step.id]);
  const result = await execute(recipe, ['--approve-network', ...selectedArgs(recipe), ...confirmations]);
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.equal(result.document?.state, 'complete');
  assert.deepEqual(result.document.completedSteps.map(step => step.id), plan.steps.map(step => step.id));
  assert.ok(result.document.completedSteps.every(step => step.artifact?.id.startsWith('sha256:')));
  assert.equal(result.collected > 0, plan.steps.some(step => step.mode === 'network'));
});

test('review confirmation is per step, never inherited from a checkpoint, and invalid confirmations fail before work', async () => {
  const args = selectedArgs('evidence-handoff');
  const first = await execute('evidence-handoff', args);
  assert.equal(first.document?.state, 'awaiting_review_confirmation');
  assert.equal(first.document.currentStep?.id, 'package');
  assert.deepEqual(first.document.completedSteps.map(step => step.id), ['verify']);
  assert.match(formatInvestigationRun(first.document), /--confirm-review package/u);
  const packaged = await execute('evidence-handoff', ['--resume', 'run.json', '--confirm-review', 'package'], {
    ...workflowRecipeInputs(), 'run.json': JSON.stringify(first.document),
  });
  assert.equal(packaged.document?.state, 'awaiting_review_confirmation');
  assert.equal(packaged.document.currentStep?.id, 'lint');
  assert.match(formatInvestigationRun(packaged.document), /--human-reviewed, --personal-data-reviewed, --redactions-confirmed/u);
  const resumed = await execute('evidence-handoff', ['--resume', 'run.json'], { 'run.json': JSON.stringify(packaged.document) });
  assert.equal(resumed.document?.state, 'awaiting_review_confirmation');
  assert.deepEqual(resumed.document.reviewsConfirmedForThisRun, []);
  const finished = await execute('evidence-handoff', ['--resume', 'run.json', '--confirm-review', 'lint'], { 'run.json': JSON.stringify(packaged.document) });
  assert.equal(finished.document?.state, 'complete');
  assert.equal(finished.collected, 0);
  for (const extra of [['--confirm-review', 'unknown'], ['--confirm-review', 'package', '--confirm-review', 'package']]) {
    const invalid = await execute('evidence-handoff', extra, {});
    assert.equal(invalid.code, 2); assert.equal(invalid.document, null); assert.equal(invalid.collected, 0);
  }
});

test('registry workflow resumes offline with retained identities and actionable input guidance', async () => {
  const standard = await execute('registry-disagreement', ['--approve-network']);
  assert.equal(standard.document?.state, 'complete');
  assert.equal(standard.collected, 1);
  assert.deepEqual(standard.document.artifactBindings, [
    { stepId: 'compare', input: 1, sourceStepId: 'collect' },
    { stepId: 'report', input: 1, sourceStepId: 'collect' },
  ]);
  // A checkpoint without future connections keeps its original selection boundary.
  const unbound = { ...standard.document, completedSteps: standard.document.completedSteps.slice(0, 1), artifactBindings: [] };
  const first = await execute('registry-disagreement', ['--resume', 'run.json'], { 'run.json': JSON.stringify(unbound) });
  assert.equal(first.document?.state, 'awaiting_analyst_selection');
  const text = formatInvestigationRun(first.document);
  assert.match(text, /1 of 3 steps retained/u);
  assert.match(text, /--use-artifact compare:1=collect/u);
  assert.match(text, /--resume <run.json>/u);
  const resumed = await execute('registry-disagreement', ['--resume', 'run.json', ...selectedArgs('registry-disagreement')], {
    'run.json': JSON.stringify(first.document),
  }, { runUnifiedLookup: () => assert.fail('A retained observation must not be collected again.') });
  assert.equal(resumed.document?.state, 'complete');
  assert.match(formatInvestigationRun(resumed.document), /not an analyst verdict/u);
  assert.equal(resumed.document.completedSteps[1]?.inputs[0]?.artifactId, first.document.completedSteps[0]?.artifact?.id);
});

test('mismatched report families cannot be reused and malformed evidence cannot reach a review declaration', async () => {
  const mismatch = await execute('certificate-anomaly', ['--approve-network', '--use-artifact', 'intake:1=search'], {});
  assert.equal(mismatch.code, 2); assert.equal(mismatch.collected, 0);
  const invalid = await execute('evidence-handoff', selectedArgs('evidence-handoff'), { 'evidence.json': '{}' });
  assert.ok(invalid.code !== 0);
  assert.equal(invalid.document?.state, 'step_failed');
  assert.equal(invalid.document.completedSteps.length, 1);
  assert.equal(invalid.document.completedSteps[0]?.artifact, null);
});

test('campaign briefs require a selected saved Lookup rather than a discovery aggregate', async () => {
  const result = await execute('campaign-review', ['--use-artifact', 'review:1=collect'], {});
  assert.equal(result.code, 2);
  assert.equal(result.collected, 0);
  assert.equal(result.document, null);
  assert.match(result.stderr, /compatible earlier output and file input/u);
});

test('every networked recipe pauses without collection when approval is absent', async () => {
  for (const recipe of INVESTIGATION_PLAN_RECIPES) {
    const plan = buildInvestigationPlan(recipe, 'example.test', WORKFLOW_NOW);
    if (!plan.steps.some(step => step.mode === 'network')) continue;
    const result = await execute(recipe, selectedArgs(recipe));
    assert.equal(result.code, 0, recipe);
    assert.equal(result.document?.state, 'awaiting_network_approval', recipe);
    assert.equal(result.collected, 0, recipe);
  }
});

test('cancellation after the final command cannot emit a completed checkpoint', async () => {
  const actual = await execute('registry-disagreement', ['--approve-network', ...selectedArgs('registry-disagreement')]);
  assert.ok(actual.document);
  const prior = { ...actual.document, completedSteps: actual.document.completedSteps.slice(0, -1) };
  const last = actual.document.completedSteps.at(-1)!;
  const controller = new AbortController();
  await assert.rejects(() => runInvestigationRecipe('registry-disagreement', 'example.test', {
    approveNetwork: false, resumeInput: JSON.stringify(prior), generatedAt: WORKFLOW_NOW, signal: controller.signal,
    execute: async () => { controller.abort(); return { exitCode: last.exitCode, stdout: JSON.stringify(last.result) }; },
  }), { name: 'AbortError' });
});
