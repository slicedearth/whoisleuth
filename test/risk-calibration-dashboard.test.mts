import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
} from '../cli/risk-calibration.mts';
import {
  calibrationIntervalLabel,
  calibrationRateLabel,
  parseRiskCalibrationDashboard,
  RISK_CALIBRATION_SUMMARY_MAX_BYTES,
} from '../frontend/src/lib/analysis/risk-calibration-dashboard.ts';
import { buildRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';
import { explainRiskScore, explainRiskScoreV7, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';

const NOW = '2026-08-10T00:00:00.000Z';

function calibrationDataset() {
  return {
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records: Array.from({ length: 40 }, (_, index) => ({
      id: `review-${index}`,
      domain: `review-${index}.example.test`,
      analystDisposition: index < 20 ? 'confirmed_abuse' : 'expected',
      reviewReasonCode: index < 20 ? 'confirmed_credential_abuse' : 'authorized_or_owned',
      evidence: index < 20
        ? { availability: 'registered', scanDepth: 'deep', mutationTypes: ['dictionary'], hasPasswordField: true }
        : { availability: 'registered', scanDepth: 'fast' },
    })),
  };
}

function summaryReport() {
  const dataset = parseRiskCalibrationDataset(JSON.stringify(calibrationDataset()));
  return buildRiskCalibrationSummaryReport(buildRiskCalibrationReport(dataset, explainRiskScore, {
    generatedAt: NOW,
    modelVersion: RISK_MODEL_VERSION,
    reviewThreshold: RISK_REVIEW_THRESHOLD,
    previousModelVersion: 7,
    explainPreviousRiskScore: explainRiskScoreV7,
  }));
}

describe('browser-local Risk calibration dashboard', () => {
  test('accepts the target-free summary and derives current model and sample states', () => {
    const summary = summaryReport();
    const dashboard = parseRiskCalibrationDashboard(JSON.stringify(summary));
    assert.equal(dashboard.modelCompatibility, 'current');
    assert.equal(dashboard.currentModelVersion, RISK_MODEL_VERSION);
    assert.equal(dashboard.includedLabels, 40);
    assert.equal(dashboard.sampleSufficiency, 'reviewed');
    assert.equal(dashboard.strata.length, 4);
    const current = summary.thresholds.find((metric) => metric.threshold === RISK_REVIEW_THRESHOLD);
    assert.ok(current);
    assert.equal(calibrationRateLabel(current.precision), 'Unmeasured');
    assert.equal(calibrationIntervalLabel(current.confidence95.precision), '95% interval unavailable');
    assert.equal(calibrationRateLabel(1), '100%');
    assert.equal(calibrationIntervalLabel({ lower: 0.4, upper: 0.6 }), '95% 40%–60%');
    assert.doesNotMatch(JSON.stringify(summary), /review-0|example\.test|"records"|"evidence"/iu);
  });

  test('distinguishes older and newer report models without comparing them as current', () => {
    const summary = summaryReport();
    const older = {
      ...summary,
      riskModelVersion: RISK_MODEL_VERSION - 1,
      modelComparison: {
        available: false,
        previousModelVersion: null,
        currentModelVersion: RISK_MODEL_VERSION - 1,
        scoresChanged: 0,
        bandsChanged: 0,
        thresholdClassificationsChanged: 0,
      },
    };
    const newer = {
      ...older,
      riskModelVersion: RISK_MODEL_VERSION + 1,
      modelComparison: { ...older.modelComparison, currentModelVersion: RISK_MODEL_VERSION + 1 },
    };
    assert.equal(parseRiskCalibrationDashboard(JSON.stringify(older)).modelCompatibility, 'older');
    assert.equal(parseRiskCalibrationDashboard(JSON.stringify(newer)).modelCompatibility, 'newer');
  });

  test('rejects full reports, retained targets, inconsistent metrics, and oversized text', () => {
    const summary = summaryReport();
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({ ...summary, records: [] })), /unsupported or missing fields/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      dataset: { ...summary.dataset, recordCount: 0 },
    })), /at least one record/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      privacy: { ...summary.privacy, identifiersRetained: 1 },
    })), /retain zero targets/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      thresholds: summary.thresholds.map((metric, index) => index === 0 ? { ...metric, precision: 0.1234 } : metric),
    })), /inconsistent with the retained confusion counts/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      strata: summary.strata.filter((stratum) => stratum.dimension === 'scan_depth'),
    })), /review-reason strata do not cover every included label/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      modelComparison: { ...summary.modelComparison, scoresChanged: 0, bandsChanged: 1 },
    })), /availability and counts are inconsistent/iu);
    assert.throws(() => parseRiskCalibrationDashboard(JSON.stringify({
      ...summary,
      summary: {
        ...summary.summary,
        scoreBands: {
          ...summary.summary.scoreBands,
          not_scored: 1,
          '0_39': summary.summary.scoreBands['0_39'] - 1,
        },
      },
    })), /not-scored count cannot exceed excluded labels/iu);
    const raw = JSON.stringify(summary);
    assert.throws(() => parseRiskCalibrationDashboard(raw.replace(
      '"schema":',
      `"schema":"${summary.schema}","schema":`,
    )), /duplicate object key/iu);
    assert.throws(() => parseRiskCalibrationDashboard('x'.repeat(RISK_CALIBRATION_SUMMARY_MAX_BYTES + 1)), /between 1 byte/iu);
  });
});
