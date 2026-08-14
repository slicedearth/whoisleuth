import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { buildInvestigationPlan, INVESTIGATION_PLAN_RECIPES } from '../cli/investigation-plan.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-08-03T05:00:00.000Z';

function capture() {
  let output = '';
  return { stream: { write(value: string) { output += value; } }, value: () => output };
}

describe('fixed investigation plans', () => {
  test('builds every recipe as a bounded plan without an execution surface', () => {
    for (const recipe of INVESTIGATION_PLAN_RECIPES) {
      const plan = buildInvestigationPlan(recipe, recipe === 'lookalike-review' ? 'Example Brand' : 'example.test', NOW);
      assert.equal(plan.execution, 'plan_only');
      assert.ok(plan.steps.length >= 3);
      assert.ok(plan.steps.every((step) => step.command && Array.isArray(step.arguments)));
      assert.doesNotMatch(JSON.stringify(plan), /shell|script|eval|automatic enforcement/iu);
    }
  });

  test('keeps network disclosure and analyst selection explicit', () => {
    const plan = buildInvestigationPlan('owned-domain-review', 'Example.Test.', NOW);
    assert.equal(plan.subject, 'example.test');
    assert.ok(plan.steps.some((step) => step.approval === 'network_disclosure'));
    assert.ok(plan.steps.some((step) => step.approval === 'analyst_selection'));
    assert.ok(plan.steps.some((step) => step.command === 'domain-control'));
    assert.match(plan.limitations.join(' '), /does not execute commands/iu);
  });

  test('exposes terminal and JSON output without invoking collection', async () => {
    assert.deepEqual(parseCliArguments(['workflow-plan', 'domain-triage', 'example.test', '--json']), {
      action: 'workflow-plan',
      recipe: 'domain-triage',
      subject: 'example.test',
      output: 'json',
      quiet: false,
      color: true,
    });
    let collectionCalled = false;
    const stdout = capture();
    const code = await runCli(['workflow-plan', 'domain-triage', 'example.test', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => NOW,
      runUnifiedLookup: async () => { collectionCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(collectionCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.investigation-plan');
  });

  test('rejects unsupported recipes and non-domain subjects where required', () => {
    assert.throws(() => parseCliArguments(['workflow-plan', 'unknown', 'example.test']), /recipe must be one of/iu);
    assert.throws(() => buildInvestigationPlan('domain-triage', 'not a domain', NOW), /requires one valid domain/iu);
    assert.throws(
      () => buildInvestigationPlan('domain-triage', 'example.test', '2026-08-03T05:00:00'),
      /explicit timezone/iu,
    );
    assert.equal(
      buildInvestigationPlan('domain-triage', 'example.test', '2026-08-03T05:00:00+01:00').generatedAt,
      '2026-08-03T04:00:00.000Z',
    );
  });
});
