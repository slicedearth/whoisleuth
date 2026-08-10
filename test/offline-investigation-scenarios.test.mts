import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_OFFLINE_SCENARIO_CHOICES,
  MAX_OFFLINE_SCENARIO_STEPS,
  OFFLINE_INVESTIGATION_SCENARIOS,
  evaluateOfflineScenarioChoice,
  offlineInvestigationScenario,
} from '../frontend/src/lib/analysis/offline-investigation-scenarios.ts';

test('covers the three foundational investigation recipes with bounded fictional evidence', () => {
  assert.deepEqual(
    OFFLINE_INVESTIGATION_SCENARIOS.map((scenario) => scenario.recipeId).sort(),
    ['brand_sweep', 'infrastructure_pivot', 'new_domain_triage'],
  );
  for (const scenario of OFFLINE_INVESTIGATION_SCENARIOS) {
    assert.match(scenario.target, /\.example\.invalid$/u);
    assert.ok(scenario.steps.length > 0);
    assert.ok(scenario.steps.length <= MAX_OFFLINE_SCENARIO_STEPS);
    assert.equal(offlineInvestigationScenario(scenario.id)?.id, scenario.id);
    for (const step of scenario.steps) {
      assert.ok(step.evidence.length > 0);
      assert.ok(step.choices.length > 1);
      assert.ok(step.choices.length <= MAX_OFFLINE_SCENARIO_CHOICES);
      assert.equal(step.choices.filter((choice) => choice.correct).length, 1);
      assert.equal(new Set(step.choices.map((choice) => choice.id)).size, step.choices.length);
      assert.ok(step.evidence.every((evidence) => evidence.limitation.length > 0));
    }
  }
});

test('returns bounded feedback only for a known scenario, step, and choice', () => {
  const scenario = OFFLINE_INVESTIGATION_SCENARIOS[0];
  const step = scenario?.steps[0];
  const correct = step?.choices.find((choice) => choice.correct);
  const incorrect = step?.choices.find((choice) => !choice.correct);
  assert.ok(scenario && step && correct && incorrect);
  assert.deepEqual(
    evaluateOfflineScenarioChoice(scenario.id, step.id, correct.id),
    { correct: true, feedback: correct.feedback },
  );
  assert.deepEqual(
    evaluateOfflineScenarioChoice(scenario.id, step.id, incorrect.id),
    { correct: false, feedback: incorrect.feedback },
  );
  assert.equal(evaluateOfflineScenarioChoice('missing', step.id, correct.id), null);
  assert.equal(evaluateOfflineScenarioChoice(scenario.id, 'missing', correct.id), null);
  assert.equal(evaluateOfflineScenarioChoice(scenario.id, step.id, 'missing'), null);
});

test('does not embed live targets, executable actions, or unsupported conclusions', () => {
  const serialized = JSON.stringify(OFFLINE_INVESTIGATION_SCENARIOS);
  assert.doesNotMatch(serialized, /https?:\/\//u);
  assert.doesNotMatch(serialized, /\b(?:bash|powershell|curl|wget|nmap)\b/iu);
  assert.match(serialized, /not evidence of safety/u);
  assert.match(serialized, /not an ownership assertion/u);
  assert.match(serialized, /never triggered by a score/u);
});
