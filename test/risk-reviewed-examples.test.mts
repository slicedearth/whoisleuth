import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { REVIEWED_RISK_DATASET, REVIEWED_RISK_EXAMPLES } from '../fixtures/risk-reviewed-examples.mts';
import { buildRiskCalibrationReport, parseRiskCalibrationDataset } from '../cli/risk-calibration.mts';
import { buildRiskCalibrationSummaryReport, parseRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';
import { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { runCli } from '../cli/runner.mts';

const options = { generatedAt: '2026-09-01T00:00:00.000Z', modelVersion: RISK_MODEL_VERSION, reviewThreshold: RISK_REVIEW_THRESHOLD };
const replay = () => buildRiskCalibrationReport(parseRiskCalibrationDataset(JSON.stringify(REVIEWED_RISK_DATASET)), explainRiskScore, options);

test('independent synthetic reviews retain disagreements, missing evidence and unresolved labels', () => {
  const before = structuredClone(REVIEWED_RISK_DATASET), report = replay();
  assert.deepEqual(REVIEWED_RISK_DATASET, before);
  assert.deepEqual([report.summary.total, report.summary.positive, report.summary.negative, report.summary.excluded], [12, 3, 4, 5]);
  const byId = new Map(report.records.map(record => [record.id, record]));
  for (const [abuse, expected] of [
    ['credential-abuse', 'authorised-training'], ['compromised-site', 'ordinary-registration'], ['intermittent-abuse', 'owned-offline-site'],
  ]) {
    const positive = byId.get(abuse!)!, negative = byId.get(expected!)!;
    assert.equal(positive.metricClass, 'positive'); assert.equal(negative.metricClass, 'negative');
    assert.equal(positive.score, negative.score, 'identical collected inputs cannot establish the different independently reviewed outcomes');
  }
  for (const id of ['missing-authority', 'failed-authority']) {
    const record = byId.get(id)!;
    assert.equal(record.score, null); assert.equal(record.includedInMetrics, false); assert.equal(record.exclusionReason, 'not_scored');
  }
  for (const id of ['unresolved-suspicion', 'unreviewed', 'closed-without-decision']) {
    const record = byId.get(id)!;
    assert.equal(record.metricClass, 'excluded'); assert.equal(record.includedInMetrics, false); assert.equal(record.exclusionReason, 'contextual_disposition');
  }
  const metrics = report.thresholds.find(row => row.threshold === RISK_REVIEW_THRESHOLD)!;
  assert.ok(metrics.falsePositive + metrics.falseNegative >= 3, 'each indistinguishable positive/negative pair exposes a missing discriminator, not a tuning target');
  assert.ok(report.strata.length > 0); assert.ok(report.strata.every(row => row.insufficientSample));
  assert.equal(report.interpretation.automaticTuning, false);
});

test('opposite model outputs do not rewrite independent analyst labels', () => {
  const parsed = parseRiskCalibrationDataset(JSON.stringify(REVIEWED_RISK_DATASET));
  const baseline = explainRiskScore({ availability: 'registered' }); assert.ok(baseline);
  for (const score of [0, 100]) {
    const report = buildRiskCalibrationReport(parsed, () => ({ ...baseline, score }), options);
    assert.deepEqual(report.records.map(row => row.analystDisposition), REVIEWED_RISK_DATASET.records.map(row => row.analystDisposition));
    assert.deepEqual([report.summary.positive, report.summary.negative, report.summary.excluded], [4, 5, 3]);
    const metrics = report.thresholds.find(row => row.threshold === RISK_REVIEW_THRESHOLD)!;
    assert.deepEqual([metrics.truePositive, metrics.falsePositive, metrics.trueNegative, metrics.falseNegative], score === 0 ? [0, 0, 5, 4] : [4, 5, 0, 0]);
  }
});

test('the actual offline command preserves the corpus and its target-free summary boundary', async () => {
  let stdout = '', stderr = '', network = 0;
  const code = await runCli(['risk-calibrate', '--summary-json'], {
    stdin: Readable.from([JSON.stringify(REVIEWED_RISK_DATASET)]),
    stdout: new Writable({ write(chunk, _encoding, done) { stdout += chunk.toString(); done(); } }),
    stderr: new Writable({ write(chunk, _encoding, done) { stderr += chunk.toString(); done(); } }),
    now: () => options.generatedAt,
    runUnifiedLookup: async () => { network++; throw new Error('Unexpected collection.'); },
    fetchHomepage: async () => { network++; throw new Error('Unexpected collection.'); },
  });
  assert.equal(code, 0); assert.equal(stderr, ''); assert.equal(network, 0);
  const actual = parseRiskCalibrationSummaryReport(stdout), expected = buildRiskCalibrationSummaryReport(replay());
  assert.deepEqual(actual.summary, expected.summary);
  assert.deepEqual(actual.thresholds, expected.thresholds);
  assert.deepEqual(actual.strata, expected.strata);
  assert.deepEqual(actual.privacy, { targetsRetained: 0, identifiersRetained: 0, rawEvidenceRetained: 0 });
  for (const { record, reviewBasis } of REVIEWED_RISK_EXAMPLES) {
    assert.equal(stdout.includes(record.domain), false); assert.equal(stdout.includes(reviewBasis), false);
  }
  assert.doesNotMatch(stdout, /"records"|"evidence"|"factors"/u);
});
