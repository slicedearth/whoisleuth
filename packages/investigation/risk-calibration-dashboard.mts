import {
  parseRiskCalibrationSummaryReport,
  RISK_CALIBRATION_SUMMARY_MAX_BYTES,
  RISK_CALIBRATION_SUMMARY_MIN_STRATUM_SAMPLE,
  type RiskCalibrationSummaryReport,
  type RiskCalibrationThresholdSummary,
} from '../../lib/risk-calibration-summary.mts';
import { RISK_MODEL_VERSION } from '../../lib/risk-scoring.mts';

export { RISK_CALIBRATION_SUMMARY_MAX_BYTES };

export type RiskCalibrationDashboard = Readonly<{
  report: RiskCalibrationSummaryReport;
  currentModelVersion: number;
  modelCompatibility: 'current' | 'older' | 'newer';
  includedLabels: number;
  sampleSufficiency: 'reviewed' | 'insufficient';
  strata: RiskCalibrationSummaryReport['strata'];
}>;

export function parseRiskCalibrationDashboard(raw: string): RiskCalibrationDashboard {
  const report = parseRiskCalibrationSummaryReport(raw);
  const modelCompatibility = report.riskModelVersion === RISK_MODEL_VERSION
    ? 'current'
    : report.riskModelVersion < RISK_MODEL_VERSION
      ? 'older'
      : 'newer';
  return Object.freeze({
    report,
    currentModelVersion: RISK_MODEL_VERSION,
    modelCompatibility,
    includedLabels: report.summary.positive + report.summary.negative,
    sampleSufficiency: report.summary.positive >= RISK_CALIBRATION_SUMMARY_MIN_STRATUM_SAMPLE
      && report.summary.negative >= RISK_CALIBRATION_SUMMARY_MIN_STRATUM_SAMPLE
      ? 'reviewed'
      : 'insufficient',
    strata: Object.freeze([...report.strata].sort((left, right) => (
      left.dimension.localeCompare(right.dimension, 'en-AU')
      || left.value.localeCompare(right.value, 'en-AU')
    ))),
  });
}

export function calibrationRateLabel(value: number | null): string {
  if (value === null) return 'Unmeasured';
  const percent = value * 100;
  return `${percent.toLocaleString('en-AU', { maximumFractionDigits: 1 })}%`;
}

export function calibrationIntervalLabel(
  value: RiskCalibrationThresholdSummary['confidence95']['precision'],
): string {
  if (value === null) return '95% interval unavailable';
  return `95% ${calibrationRateLabel(value.lower)}–${calibrationRateLabel(value.upper)}`;
}

export function calibrationStratumLabel(dimension: 'review_reason' | 'scan_depth', value: string): string {
  const label = value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
  return dimension === 'scan_depth' ? `${label} scan` : label;
}
