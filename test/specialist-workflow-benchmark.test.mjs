import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_SPECIALIST_WORKFLOW_DETAIL_LENGTH,
  MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES,
  MAX_SPECIALIST_WORKFLOW_SCENARIOS,
  SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA,
  SPECIALIST_WORKFLOW_BENCHMARK_VERSION,
  buildSpecialistWorkflowBenchmark,
  formatSpecialistWorkflowBenchmark,
  main,
  parseArguments,
} from '../tools/specialist-workflow-benchmark.mts';

const NOW = new Date('2026-07-20T02:00:00.000Z');

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
}

function byId(report, id) {
  const scenario = report.scenarios.find((item) => item.id === id);
  assert.ok(scenario, `Missing benchmark scenario ${id}`);
  return scenario;
}

describe('offline specialist workflow benchmark', () => {
  test('runs every bounded scenario against the current production contracts', async () => {
    const report = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    assert.equal(report.schema, SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA);
    assert.equal(report.version, SPECIALIST_WORKFLOW_BENCHMARK_VERSION);
    assert.equal(report.generatedAt, NOW.toISOString());
    assert.equal(report.mode, 'offline_synthetic');
    assert.deepEqual(report.summary, { total: 8, passed: 8, failed: 0, passRate: 1 });
    assert.equal(report.summary.total, MAX_SPECIALIST_WORKFLOW_SCENARIOS);
    assert.equal(report.bounds.networkRequests, 0);
    assert.equal(report.bounds.registryFixtureLimit, MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES);
    assert.ok(report.scenarios.every((scenario) => scenario.status === 'pass'
      && scenario.failedAssertions === 0
      && scenario.failures.length === 0
      && scenario.failuresTruncated === false
      && scenario.detail.length <= MAX_SPECIALIST_WORKFLOW_DETAIL_LENGTH));
  });

  test('reports fixture coverage, source completeness, labels, provenance, truncation, and export compatibility', async () => {
    const report = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    assert.equal(report.metrics.registry.fixturesEvaluated, 218);
    assert.equal(report.metrics.registry.parserFamilies, 165);
    assert.equal(report.metrics.registry.failed, 0);
    assert.equal(report.metrics.registry.passRate, 1);
    assert.equal(report.metrics.lookalikeGeneration.duplicateOutputs, 0);
    assert.equal(report.metrics.lookalikeGeneration.uniqueCandidates, report.metrics.lookalikeGeneration.candidates);
    assert.ok(report.metrics.lookalikeGeneration.combinedProvenanceCandidates > 0);
    assert.equal(report.metrics.collectionCompleteness.incompleteCollectionRate, 1);
    assert.equal(report.metrics.collectionCompleteness.undisclosedIncomplete, 0);
    assert.equal(report.metrics.collectionCompleteness.unsupportedSources, 1);
    assert.equal(report.metrics.collectionCompleteness.failedLookupSources, 2);
    assert.equal(report.metrics.collectionCompleteness.lookupFunctionCalls, 3);
    assert.equal(report.metrics.ruleReplay.falsePositiveRate, 0);
    assert.equal(report.metrics.ruleReplay.duplicateRuleMatchKeys, 0);
    assert.equal(report.metrics.relationshipProvenance.graphEdgeProvenanceCompleteness, 1);
    assert.equal(report.metrics.graphTruncation.truncated, true);
    assert.equal(report.metrics.exportCompatibility.readySections, report.metrics.exportCompatibility.sectionsExpected);
  });

  test('keeps missing evidence neutral and shared infrastructure qualified', async () => {
    const report = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    assert.equal(byId(report, 'partial-source-states').status, 'pass');
    assert.equal(byId(report, 'benign-shared-infrastructure').status, 'pass');
    assert.equal(report.metrics.benignSharedInfrastructure.automaticRuleMatches, 0);
    assert.ok(report.limitations.some((value) => /do not prove ownership, intent, safety, or maliciousness/i.test(value)));
  });

  test('uses a transparent workflow-step proxy instead of unstable wall-clock timing', async () => {
    const report = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    assert.deepEqual(report.metrics.workflow.timeToFirstUsefulPivot, {
      measurement: 'workflow_step_proxy', value: 3, unit: 'steps', wallClockMeasured: false,
    });
    assert.deepEqual(report.metrics.workflow.steps, ['seed', 'collect', 'pivot', 'review', 'save']);
    assert.match(report.limitations.join(' '), /not an analyst wall-clock measurement/i);
  });

  test('is deterministic under an injected time and retains no raw fixture or unknown archive fields', async () => {
    const first = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    const second = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    assert.deepEqual(second, first);
    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, /Domain Name:|Registrant Email:|discard-me/);
  });

  test('formats a bounded maintainer summary and exposes complete versioned JSON through main', async () => {
    const report = await buildSpecialistWorkflowBenchmark({ now: () => NOW });
    const terminal = formatSpecialistWorkflowBenchmark(report);
    assert.match(terminal, /8\/8 scenarios passed/);
    assert.match(terminal, /network requests: 0/i);
    assert.match(terminal, /Use --json/);

    const stdout = capture();
    const stderr = capture();
    assert.equal(await main(['--json'], { now: () => NOW, stdout: stdout.stream, stderr: stderr.stream }), 0);
    assert.equal(stderr.value(), '');
    assert.equal(JSON.parse(stdout.value()).schema, SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA);
  });

  test('accepts only one optional JSON flag and returns a setup error for invalid invocation', async () => {
    assert.deepEqual(parseArguments([]), { json: false });
    assert.deepEqual(parseArguments(['--json']), { json: true });
    assert.throws(() => parseArguments(['--json', '--json']), /only once/);
    assert.throws(() => parseArguments(['--live']), /Unknown option/);
    const stderr = capture();
    assert.equal(await main(['--live'], { now: () => NOW, stdout: capture().stream, stderr: stderr.stream }), 2);
    assert.match(stderr.value(), /Unknown option/);
  });
});
