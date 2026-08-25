import { ANALYST_REVIEW_REASON_VALUES } from './analyst-taxonomy.mts';
import { scanBoundedJson } from './bounded-json.mts';
import { RISK_REVIEW_THRESHOLD } from './risk-scoring.mts';
import {
  MAX_RISK_CALIBRATION_RECORDS,
  MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS,
  MAX_RISK_CALIBRATION_JSON_DEPTH,
  MAX_RISK_CALIBRATION_JSON_KEYS,
  MAX_RISK_CALIBRATION_JSON_VALUES,
  MAX_RISK_CALIBRATION_MODEL_VERSION,
  MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH,
  MAX_RISK_CALIBRATION_SUMMARY_BYTES,
  MAX_RISK_CALIBRATION_SUMMARY_STRATA,
  MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_REPORT_CONFIDENCE_KEYS,
  RISK_CALIBRATION_REPORT_DATASET_KEYS,
  RISK_CALIBRATION_REPORT_INTERPRETATION_KEYS,
  RISK_CALIBRATION_REPORT_INTERVAL_KEYS,
  RISK_CALIBRATION_REPORT_METRIC_KEYS,
  RISK_CALIBRATION_REPORT_MODEL_COMPARISON_KEYS,
  RISK_CALIBRATION_REPORT_PRIVACY_KEYS,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS,
  RISK_CALIBRATION_REPORT_STRATUM_KEYS,
  RISK_CALIBRATION_REPORT_SUMMARY_KEYS,
  RISK_CALIBRATION_REPORT_VERSION,
  RISK_CALIBRATION_REPORT_V3_SUMMARY_ROOT_KEYS,
  SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS,
  type RiskCalibrationDatasetVersion,
} from '../packages/contracts/risk-calibration.mts';

export const RISK_CALIBRATION_SUMMARY_SCHEMA = RISK_CALIBRATION_REPORT_SCHEMA;
export const RISK_CALIBRATION_SUMMARY_VERSION = RISK_CALIBRATION_REPORT_VERSION;
export const RISK_CALIBRATION_SUMMARY_MAX_BYTES = MAX_RISK_CALIBRATION_SUMMARY_BYTES;
export const RISK_CALIBRATION_SUMMARY_MAX_RECORDS = MAX_RISK_CALIBRATION_RECORDS;
export const RISK_CALIBRATION_SUMMARY_MIN_STRATUM_SAMPLE = 20;
export const RISK_CALIBRATION_SUMMARY_THRESHOLDS = Object.freeze(
  [...new Set([40, 50, 60, RISK_REVIEW_THRESHOLD, 80, 90])].sort((left, right) => left - right),
);
export const RISK_CALIBRATION_SUMMARY_INTERPRETATION = 'This offline replay compares heuristic Risk scores with analyst dispositions. It does not prove maliciousness or safety.';

type JsonRecord = Record<string, unknown>;
type ConfidenceInterval = Readonly<{ lower: number; upper: number }>;

export type RiskCalibrationThresholdSummary = Readonly<{
  threshold: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  falsePositiveRate: number | null;
  f1: number | null;
  balancedAccuracy: number | null;
  confidence95: Readonly<{
    precision: ConfidenceInterval | null;
    recall: ConfidenceInterval | null;
    specificity: ConfidenceInterval | null;
  }>;
}>;

export type RiskCalibrationSummaryReport = Readonly<{
  schema: typeof RISK_CALIBRATION_SUMMARY_SCHEMA;
  version: typeof RISK_CALIBRATION_SUMMARY_VERSION;
  mode: 'summary';
  generatedAt: string;
  dataset: Readonly<{
    schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
    version: RiskCalibrationDatasetVersion;
    recordCount: number;
  }>;
  riskModelVersion: number;
  currentReviewThreshold: number;
  summary: Readonly<{
    total: number;
    positive: number;
    negative: number;
    excluded: number;
    scoreBands: Readonly<{
      not_scored: number;
      '0_39': number;
      '40_69': number;
      '70_100': number;
    }>;
  }>;
  thresholds: readonly RiskCalibrationThresholdSummary[];
  strata: readonly Readonly<{
    dimension: 'review_reason' | 'scan_depth';
    value: string;
    sampleCount: number;
    insufficientSample: boolean;
    metrics: RiskCalibrationThresholdSummary;
  }>[];
  modelComparison: Readonly<{
    available: boolean;
    previousModelVersion: number | null;
    currentModelVersion: number;
    scoresChanged: number;
    bandsChanged: number;
    thresholdClassificationsChanged: number;
  }>;
  privacy: Readonly<{
    targetsRetained: 0;
    identifiersRetained: 0;
    rawEvidenceRetained: 0;
  }>;
  interpretation: Readonly<{
    authority: 'analyst_context_only';
    statement: typeof RISK_CALIBRATION_SUMMARY_INTERPRETATION;
    automaticTuning: false;
    networkRequests: false;
    persisted: false;
  }>;
}>;

const ROOT_KEYS = new Set(RISK_CALIBRATION_REPORT_V3_SUMMARY_ROOT_KEYS);
const DATASET_KEYS = new Set(RISK_CALIBRATION_REPORT_DATASET_KEYS);
const SUMMARY_KEYS = new Set(RISK_CALIBRATION_REPORT_SUMMARY_KEYS);
const SCORE_BAND_KEYS = new Set(RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS);
const METRIC_KEYS = new Set(RISK_CALIBRATION_REPORT_METRIC_KEYS);
const CONFIDENCE_KEYS = new Set(RISK_CALIBRATION_REPORT_CONFIDENCE_KEYS);
const INTERVAL_KEYS = new Set(RISK_CALIBRATION_REPORT_INTERVAL_KEYS);
const STRATUM_KEYS = new Set(RISK_CALIBRATION_REPORT_STRATUM_KEYS);
const MODEL_COMPARISON_KEYS = new Set(RISK_CALIBRATION_REPORT_MODEL_COMPARISON_KEYS);
const PRIVACY_KEYS = new Set(RISK_CALIBRATION_REPORT_PRIVACY_KEYS);
const INTERPRETATION_KEYS = new Set(RISK_CALIBRATION_REPORT_INTERPRETATION_KEYS);
const REVIEW_REASON_VALUES = new Set([...ANALYST_REVIEW_REASON_VALUES, 'not_recorded']);
const SCAN_DEPTH_VALUES = new Set(['deep', 'fast', 'unknown']);
const CONTROL_RE = /[\x00-\x1f\x7f]/u;

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: ReadonlySet<string>, label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
}

function boundedCount(value: unknown, label: string, maximum = RISK_CALIBRATION_SUMMARY_MAX_RECORDS): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer.`);
  }
  return Number(value);
}

function modelVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_RISK_CALIBRATION_MODEL_VERSION) {
    throw new Error(`${label} must be a supported positive model version.`);
  }
  return Number(value);
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length > MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH
    || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid date and time.`);
  }
  const canonical = new Date(value).toISOString();
  if (canonical !== value) throw new Error(`${label} must use canonical UTC ISO-8601 form.`);
  return canonical;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function wilson95(successes: number, total: number): ConfidenceInterval | null {
  if (!total) return null;
  const z = 1.96;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total)) / denominator;
  return Object.freeze({
    lower: Number(Math.max(0, center - margin).toFixed(4)),
    upper: Number(Math.min(1, center + margin).toFixed(4)),
  });
}

function exactRatio(value: unknown, expected: number | null, label: string): number | null {
  if (value !== expected) throw new Error(`${label} is inconsistent with the retained confusion counts.`);
  return expected;
}

function interval(value: unknown, expected: ConfidenceInterval | null, label: string): ConfidenceInterval | null {
  if (expected === null) {
    if (value !== null) throw new Error(`${label} must be null when its denominator is zero.`);
    return null;
  }
  const candidate = object(value, label);
  exactKeys(candidate, INTERVAL_KEYS, label);
  if (candidate.lower !== expected.lower || candidate.upper !== expected.upper) {
    throw new Error(`${label} is inconsistent with the retained confusion counts.`);
  }
  return Object.freeze({ lower: expected.lower, upper: expected.upper });
}

function thresholdMetrics(
  value: unknown,
  label: string,
  expectedThreshold: number,
  expectedTotal: number,
  expectedPositive: number | null = null,
  expectedNegative: number | null = null,
): RiskCalibrationThresholdSummary {
  const metric = object(value, label);
  exactKeys(metric, METRIC_KEYS, label);
  if (metric.threshold !== expectedThreshold) throw new Error(`${label} has an unexpected threshold.`);
  const truePositive = boundedCount(metric.truePositive, `${label} true-positive count`, expectedTotal);
  const falseNegative = boundedCount(metric.falseNegative, `${label} false-negative count`, expectedTotal);
  const trueNegative = boundedCount(metric.trueNegative, `${label} true-negative count`, expectedTotal);
  const falsePositive = boundedCount(metric.falsePositive, `${label} false-positive count`, expectedTotal);
  if (truePositive + falsePositive + trueNegative + falseNegative !== expectedTotal
    || (expectedPositive !== null && truePositive + falseNegative !== expectedPositive)
    || (expectedNegative !== null && trueNegative + falsePositive !== expectedNegative)) {
    throw new Error(`${label} has inconsistent class counts.`);
  }
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const specificity = ratio(trueNegative, trueNegative + falsePositive);
  const falsePositiveRate = ratio(falsePositive, falsePositive + trueNegative);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? null
    : Number(((2 * precision * recall) / (precision + recall)).toFixed(4));
  const balancedAccuracy = recall === null || specificity === null
    ? null
    : Number(((recall + specificity) / 2).toFixed(4));
  const confidence = object(metric.confidence95, `${label} confidence intervals`);
  exactKeys(confidence, CONFIDENCE_KEYS, `${label} confidence intervals`);
  return Object.freeze({
    threshold: expectedThreshold,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: exactRatio(metric.precision, precision, `${label} precision`),
    recall: exactRatio(metric.recall, recall, `${label} recall`),
    specificity: exactRatio(metric.specificity, specificity, `${label} specificity`),
    falsePositiveRate: exactRatio(metric.falsePositiveRate, falsePositiveRate, `${label} false-positive rate`),
    f1: exactRatio(metric.f1, f1, `${label} F1`),
    balancedAccuracy: exactRatio(metric.balancedAccuracy, balancedAccuracy, `${label} balanced accuracy`),
    confidence95: Object.freeze({
      precision: interval(confidence.precision, wilson95(truePositive, truePositive + falsePositive), `${label} precision interval`),
      recall: interval(confidence.recall, wilson95(truePositive, truePositive + falseNegative), `${label} recall interval`),
      specificity: interval(confidence.specificity, wilson95(trueNegative, trueNegative + falsePositive), `${label} specificity interval`),
    }),
  });
}

export function parseRiskCalibrationSummaryReport(raw: string): RiskCalibrationSummaryReport {
  if (typeof raw !== 'string') throw new Error('Risk calibration summary must be JSON text.');
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes < 1 || bytes > RISK_CALIBRATION_SUMMARY_MAX_BYTES) {
    throw new Error(`Risk calibration summary must be between 1 byte and ${RISK_CALIBRATION_SUMMARY_MAX_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    const withoutBom = raw.replace(/^\uFEFF/u, '');
    scanBoundedJson(withoutBom, {
      maximumDepth: MAX_RISK_CALIBRATION_JSON_DEPTH,
      maximumKeys: MAX_RISK_CALIBRATION_JSON_KEYS,
      maximumValues: MAX_RISK_CALIBRATION_JSON_VALUES,
      maximumContainerItems: MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS,
    });
    parsed = JSON.parse(withoutBom);
  } catch (reason) {
    const message = reason instanceof Error
      ? reason.message.replace(/^Artefact (?:input|JSON)/u, 'Risk calibration summary')
      : 'Risk calibration summary is not valid JSON.';
    throw new Error(message);
  }
  const root = object(parsed, 'Risk calibration summary');
  exactKeys(root, ROOT_KEYS, 'Risk calibration summary');
  if (root.schema !== RISK_CALIBRATION_SUMMARY_SCHEMA
    || root.version !== RISK_CALIBRATION_SUMMARY_VERSION
    || root.mode !== 'summary') {
    throw new Error('Risk calibration summary has an unsupported schema, version, or mode.');
  }

  const dataset = object(root.dataset, 'Risk calibration dataset metadata');
  exactKeys(dataset, DATASET_KEYS, 'Risk calibration dataset metadata');
  if (dataset.schema !== RISK_CALIBRATION_DATASET_SCHEMA
    || typeof dataset.version !== 'number'
    || !SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS.includes(dataset.version as RiskCalibrationDatasetVersion)) {
    throw new Error('Risk calibration dataset metadata has an unsupported schema or version.');
  }
  const recordCount = boundedCount(dataset.recordCount, 'Risk calibration dataset record count');
  if (recordCount < 1) throw new Error('Risk calibration dataset metadata must describe at least one record.');
  const riskModelVersion = modelVersion(root.riskModelVersion, 'Risk model version');
  if (!RISK_CALIBRATION_SUMMARY_THRESHOLDS.includes(Number(root.currentReviewThreshold))) {
    throw new Error('Current review threshold is not part of the fixed calibration threshold set.');
  }
  const currentReviewThreshold = Number(root.currentReviewThreshold);

  const rawSummary = object(root.summary, 'Risk calibration summary counts');
  exactKeys(rawSummary, SUMMARY_KEYS, 'Risk calibration summary counts');
  const total = boundedCount(rawSummary.total, 'Total record count');
  const positive = boundedCount(rawSummary.positive, 'Positive label count', total);
  const negative = boundedCount(rawSummary.negative, 'Negative label count', total);
  const excluded = boundedCount(rawSummary.excluded, 'Excluded label count', total);
  if (total !== recordCount || positive + negative + excluded !== total) {
    throw new Error('Risk calibration summary label counts are inconsistent.');
  }
  const rawBands = object(rawSummary.scoreBands, 'Risk calibration score bands');
  exactKeys(rawBands, SCORE_BAND_KEYS, 'Risk calibration score bands');
  const scoreBands = Object.freeze({
    not_scored: boundedCount(rawBands.not_scored, 'Not-scored count', total),
    '0_39': boundedCount(rawBands['0_39'], 'Low-band count', total),
    '40_69': boundedCount(rawBands['40_69'], 'Review-band count', total),
    '70_100': boundedCount(rawBands['70_100'], 'High-band count', total),
  });
  if (Object.values(scoreBands).reduce((sum, count) => sum + count, 0) !== total) {
    throw new Error('Risk calibration score-band counts are inconsistent.');
  }
  if (scoreBands.not_scored > excluded) {
    throw new Error('Risk calibration not-scored count cannot exceed excluded labels.');
  }

  if (!Array.isArray(root.thresholds) || root.thresholds.length !== RISK_CALIBRATION_SUMMARY_THRESHOLDS.length) {
    throw new Error('Risk calibration summary must contain the fixed threshold set exactly once.');
  }
  const thresholds = Object.freeze(root.thresholds.map((value, index) => thresholdMetrics(
    value,
    `Threshold ${index + 1}`,
    RISK_CALIBRATION_SUMMARY_THRESHOLDS[index]!,
    positive + negative,
    positive,
    negative,
  )));

  if (!Array.isArray(root.strata) || root.strata.length > MAX_RISK_CALIBRATION_SUMMARY_STRATA) {
    throw new Error('Risk calibration strata must be a bounded array.');
  }
  const seenStrata = new Set<string>();
  const strata = Object.freeze(root.strata.map((value, index) => {
    const label = `Stratum ${index + 1}`;
    const stratum = object(value, label);
    exactKeys(stratum, STRATUM_KEYS, label);
    if (stratum.dimension !== 'review_reason' && stratum.dimension !== 'scan_depth') {
      throw new Error(`${label} has an unsupported dimension.`);
    }
    if (typeof stratum.value !== 'string'
      || !stratum.value
      || stratum.value.length > MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH
      || CONTROL_RE.test(stratum.value)) {
      throw new Error(`${label} has an invalid value.`);
    }
    const allowedValues = stratum.dimension === 'review_reason' ? REVIEW_REASON_VALUES : SCAN_DEPTH_VALUES;
    if (!allowedValues.has(stratum.value)) throw new Error(`${label} has an unsupported value.`);
    const key = `${stratum.dimension}\u0000${stratum.value}`;
    if (seenStrata.has(key)) throw new Error(`${label} is duplicated.`);
    seenStrata.add(key);
    const sampleCount = boundedCount(stratum.sampleCount, `${label} sample count`, positive + negative);
    if (stratum.insufficientSample !== (sampleCount < RISK_CALIBRATION_SUMMARY_MIN_STRATUM_SAMPLE)) {
      throw new Error(`${label} has an inconsistent sample-sufficiency state.`);
    }
    return Object.freeze({
      dimension: stratum.dimension,
      value: stratum.value,
      sampleCount,
      insufficientSample: stratum.insufficientSample,
      metrics: thresholdMetrics(stratum.metrics, `${label} metrics`, currentReviewThreshold, sampleCount),
    });
  }));
  for (const dimension of ['review_reason', 'scan_depth'] as const) {
    const dimensionTotal = strata
      .filter((stratum) => stratum.dimension === dimension)
      .reduce((sum, stratum) => sum + stratum.sampleCount, 0);
    if (dimensionTotal !== positive + negative) {
      throw new Error(`Risk calibration ${dimension.replace('_', '-')} strata do not cover every included label exactly once.`);
    }
  }

  const comparison = object(root.modelComparison, 'Risk model comparison');
  exactKeys(comparison, MODEL_COMPARISON_KEYS, 'Risk model comparison');
  if (typeof comparison.available !== 'boolean') throw new Error('Risk model comparison availability must be true or false.');
  const currentModelVersion = modelVersion(comparison.currentModelVersion, 'Compared current model version');
  if (currentModelVersion !== riskModelVersion) throw new Error('Risk model comparison does not match the report model version.');
  const previousModelVersion = comparison.previousModelVersion === null
    ? null
    : modelVersion(comparison.previousModelVersion, 'Compared previous model version');
  const scoresChanged = boundedCount(comparison.scoresChanged, 'Changed-score count', total);
  const bandsChanged = boundedCount(comparison.bandsChanged, 'Changed-band count', total);
  const thresholdClassificationsChanged = boundedCount(comparison.thresholdClassificationsChanged, 'Changed-threshold count', total);
  if ((!comparison.available && (previousModelVersion !== null || scoresChanged || bandsChanged || thresholdClassificationsChanged))
    || (comparison.available && previousModelVersion === null)
    || bandsChanged > scoresChanged
    || thresholdClassificationsChanged > scoresChanged) {
    throw new Error('Risk model comparison availability and counts are inconsistent.');
  }

  const privacy = object(root.privacy, 'Risk calibration privacy declaration');
  exactKeys(privacy, PRIVACY_KEYS, 'Risk calibration privacy declaration');
  if (privacy.targetsRetained !== 0 || privacy.identifiersRetained !== 0 || privacy.rawEvidenceRetained !== 0) {
    throw new Error('Risk calibration summary must retain zero targets, identifiers, and raw evidence.');
  }
  const interpretation = object(root.interpretation, 'Risk calibration interpretation');
  exactKeys(interpretation, INTERPRETATION_KEYS, 'Risk calibration interpretation');
  if (interpretation.authority !== 'analyst_context_only'
    || interpretation.statement !== RISK_CALIBRATION_SUMMARY_INTERPRETATION
    || interpretation.automaticTuning !== false
    || interpretation.networkRequests !== false
    || interpretation.persisted !== false) {
    throw new Error('Risk calibration interpretation is inconsistent with the offline diagnostic boundary.');
  }

  return Object.freeze({
    schema: RISK_CALIBRATION_SUMMARY_SCHEMA,
    version: RISK_CALIBRATION_SUMMARY_VERSION,
    mode: 'summary',
    generatedAt: canonicalTimestamp(root.generatedAt, 'Risk calibration generation time'),
    dataset: Object.freeze({
      schema: RISK_CALIBRATION_DATASET_SCHEMA,
      version: dataset.version as RiskCalibrationDatasetVersion,
      recordCount,
    }),
    riskModelVersion,
    currentReviewThreshold,
    summary: Object.freeze({ total, positive, negative, excluded, scoreBands }),
    thresholds,
    strata,
    modelComparison: Object.freeze({
      available: comparison.available,
      previousModelVersion,
      currentModelVersion,
      scoresChanged,
      bandsChanged,
      thresholdClassificationsChanged,
    }),
    privacy: Object.freeze({ targetsRetained: 0, identifiersRetained: 0, rawEvidenceRetained: 0 }),
    interpretation: Object.freeze({
      authority: 'analyst_context_only',
      statement: RISK_CALIBRATION_SUMMARY_INTERPRETATION,
      automaticTuning: false,
      networkRequests: false,
      persisted: false,
    }),
  });
}

export function buildRiskCalibrationSummaryReport(source: unknown): RiskCalibrationSummaryReport {
  const report = object(source, 'Risk calibration report');
  const projected = {
    schema: RISK_CALIBRATION_SUMMARY_SCHEMA,
    version: RISK_CALIBRATION_SUMMARY_VERSION,
    mode: 'summary',
    generatedAt: report.generatedAt,
    dataset: report.dataset,
    riskModelVersion: report.riskModelVersion,
    currentReviewThreshold: report.currentReviewThreshold,
    summary: report.summary,
    thresholds: report.thresholds,
    strata: report.strata,
    modelComparison: report.modelComparison,
    privacy: { targetsRetained: 0, identifiersRetained: 0, rawEvidenceRetained: 0 },
    interpretation: report.interpretation,
  };
  return parseRiskCalibrationSummaryReport(JSON.stringify(projected));
}
