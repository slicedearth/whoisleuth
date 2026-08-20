import { Buffer } from 'node:buffer';
import { decodeBoundedUtf8 } from '../lib/bounded-file.mts';
import { isValidAsciiDomainName } from '../lib/hostname.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import { canonicalRegistrableDomain } from '../lib/registrable-domain.mts';
import { ANALYST_REVIEW_REASON_VALUES, analystInteroperabilityTags } from '../lib/analyst-taxonomy.mts';
import {
  buildRiskCalibrationSummaryReport,
  parseRiskCalibrationSummaryReport,
  RISK_CALIBRATION_SUMMARY_INTERPRETATION,
  RISK_CALIBRATION_SUMMARY_THRESHOLDS,
  type RiskCalibrationSummaryReport,
} from '../lib/risk-calibration-summary.mts';
import {
  MAX_RISK_CALIBRATION_ACTIVITY_LENGTH,
  MAX_RISK_CALIBRATION_AVAILABILITY_LENGTH,
  MAX_RISK_CALIBRATION_DISPOSITION_LENGTH,
  MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS,
  MAX_RISK_CALIBRATION_DOMAIN_LENGTH,
  MAX_RISK_CALIBRATION_FINDING_CATEGORY_LENGTH,
  MAX_RISK_CALIBRATION_FINDINGS_PER_PROVIDER,
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS,
  MAX_RISK_CALIBRATION_JSON_DEPTH,
  MAX_RISK_CALIBRATION_JSON_KEYS,
  MAX_RISK_CALIBRATION_JSON_VALUES,
  MAX_RISK_CALIBRATION_MUTATIONS,
  MAX_RISK_CALIBRATION_PROVIDER_ID_LENGTH,
  MAX_RISK_CALIBRATION_PROVIDER_STATE_LENGTH,
  MAX_RISK_CALIBRATION_PROVIDERS,
  MAX_RISK_CALIBRATION_RECORD_ID_LENGTH,
  MAX_RISK_CALIBRATION_RECORDS,
  MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH,
  MAX_RISK_CALIBRATION_SCAN_DEPTH_LENGTH,
  MAX_RISK_CALIBRATION_STRING_LENGTH,
  MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_VERSION,
  serializeRiskCalibrationSnapshot,
  snapshotRiskCalibrationReportForSerialization,
  SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS,
  type RiskCalibrationDataset,
  type RiskCalibrationDisposition,
  type RiskCalibrationEvidence,
  type RiskCalibrationRecord,
  type RiskCalibrationThreatIntelligence,
} from '../packages/contracts/risk-calibration.mts';

import { CliUsageError } from './arguments.mts';
import type { BoundedTextStream } from './bulk.mts';
import { RISK_MUTATION_TYPES } from '../lib/risk-scoring.mts';
import type { RiskExplanation, RiskInput } from '../lib/risk-scoring.mts';
import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_ENVELOPE_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';

export {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_RECORDS,
  MAX_RISK_CALIBRATION_STRING_LENGTH,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_VERSION,
  SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS,
} from '../packages/contracts/risk-calibration.mts';
export const RISK_CALIBRATION_THRESHOLDS = RISK_CALIBRATION_SUMMARY_THRESHOLDS;

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const DISPOSITIONS = new Set([
  'unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action',
]);
const POSITIVE_DISPOSITIONS = new Set(['confirmed_abuse']);
const NEGATIVE_DISPOSITIONS = new Set(['false_positive', 'expected']);
const AVAILABILITY_STATES = new Set(['registered', 'for_sale', 'expiring', 'available', 'unknown', 'error']);
const ACTIVITY_STATES = new Set(['active', 'parked', 'unreachable', 'no_site']);
const BOOLEAN_FIELDS = [
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField',
  'hasMx', 'hasSpf', 'hasDmarc', 'privacyProtected', 'hasExternalFormAction',
  'idnReferenceMatch', 'pageBaselineMatch', 'hasActiveBrandProfile',
] as const;
const REVIEW_REASON_CODES = ANALYST_REVIEW_REASON_VALUES;
const MUTATION_TYPES = new Set(RISK_MUTATION_TYPES);

type UnknownRecord = Record<string, unknown>;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type ProjectedThreatIntelligence = RiskCalibrationThreatIntelligence;
type CalibrationEvidence = Mutable<RiskCalibrationEvidence>;
type CalibrationDisposition = RiskCalibrationDisposition;
type MetricClass = 'positive' | 'negative' | 'excluded';
type CalibrationRecord = {
  -readonly [Key in keyof RiskCalibrationRecord]: Key extends 'evidence'
    ? CalibrationEvidence
    : RiskCalibrationRecord[Key];
};
type CalibrationDataset = {
  -readonly [Key in keyof RiskCalibrationDataset]: Key extends 'records'
    ? CalibrationRecord[]
    : RiskCalibrationDataset[Key];
};
type ExplainRiskScore = (input: RiskInput) => RiskExplanation | null;
type CalibrationScoredRecord = {
  includedInMetrics: boolean;
  metricClass: MetricClass;
  score: number | null;
};
type ThresholdMetrics = {
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
  confidence95: {
    precision: { lower: number; upper: number } | null;
    recall: { lower: number; upper: number } | null;
    specificity: { lower: number; upper: number } | null;
  };
};
type CalibrationReportRecord = CalibrationScoredRecord & {
  id: string;
  domain: string;
  analystDisposition: CalibrationDisposition;
  reviewReasonCode: string | null;
  interoperabilityTags: string[];
  exclusionReason: 'not_scored' | 'contextual_disposition' | null;
  modelVersion: number;
  band: string;
  factors: RiskExplanation['factors'];
};
type RiskCalibrationReport = {
  schema: typeof RISK_CALIBRATION_REPORT_SCHEMA;
  version: typeof RISK_CALIBRATION_REPORT_VERSION;
  mode: 'detailed';
  generatedAt: string;
  dataset: {
    schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
    version: 1 | typeof RISK_CALIBRATION_DATASET_VERSION;
    recordCount: number;
  };
  riskModelVersion: number;
  currentReviewThreshold: number;
  summary: {
    total: number;
    positive: number;
    negative: number;
    excluded: number;
    scoreBands: Record<string, number>;
  };
  thresholds: ThresholdMetrics[];
  strata: Array<{
    dimension: 'review_reason' | 'scan_depth';
    value: string;
    sampleCount: number;
    insufficientSample: boolean;
    metrics: ThresholdMetrics;
  }>;
  modelComparison: {
    available: boolean;
    previousModelVersion: number | null;
    currentModelVersion: number;
    scoresChanged: number;
    bandsChanged: number;
    thresholdClassificationsChanged: number;
  };
  records: CalibrationReportRecord[];
  interpretation: {
    authority: 'analyst_context_only';
    statement: string;
    automaticTuning: false;
    networkRequests: false;
    persisted: false;
  };
};

function object(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliUsageError(`${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function boundedString(value: unknown, field: string, maximum = MAX_RISK_CALIBRATION_STRING_LENGTH): string {
  if (typeof value !== 'string' || !value.trim()) throw new CliUsageError(`${field} must be non-empty text.`);
  const trimmed = value.trim();
  if (trimmed.length > maximum || CONTROL_RE.test(value)) throw new CliUsageError(`${field} exceeds its text limit or contains control characters.`);
  return trimmed;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return boundedString(value, field, MAX_RISK_CALIBRATION_TIMESTAMP_LENGTH);
}

function projectThreatIntelligence(value: unknown, field: string): ProjectedThreatIntelligence | undefined {
  if (value === null || value === undefined) return undefined;
  const envelope = object(value, field);
  if (!Array.isArray(envelope.providers)) throw new CliUsageError(`${field}.providers must be an array.`);
  if (envelope.providers.length > MAX_RISK_CALIBRATION_PROVIDERS) throw new CliUsageError(`${field}.providers exceeds the ${MAX_RISK_CALIBRATION_PROVIDERS}-provider limit.`);
  return {
    providers: envelope.providers.map((item: unknown, providerIndex: number) => {
      const prefix = `${field}.providers[${providerIndex}]`;
      const provider = object(item, prefix);
      const identity = object(provider.provider, `${prefix}.provider`);
      const observation = provider.observation === null || provider.observation === undefined
        ? null
        : object(provider.observation, `${prefix}.observation`);
      if (!Array.isArray(provider.findings)) throw new CliUsageError(`${prefix}.findings must be an array.`);
      if (provider.findings.length > MAX_RISK_CALIBRATION_FINDINGS_PER_PROVIDER) {
        throw new CliUsageError(`${prefix}.findings exceeds the ${MAX_RISK_CALIBRATION_FINDINGS_PER_PROVIDER}-finding limit.`);
      }
      const observedAt = observation
        ? optionalTimestamp(observation.observedAt, `${prefix}.observation.observedAt`)
        : undefined;
      return {
        provider: { id: boundedString(identity.id, `${prefix}.provider.id`, MAX_RISK_CALIBRATION_PROVIDER_ID_LENGTH) },
        state: boundedString(provider.state, `${prefix}.state`, MAX_RISK_CALIBRATION_PROVIDER_STATE_LENGTH),
        ...(observation ? { observation: observedAt ? { observedAt } : {} } : {}),
        findings: provider.findings.map((findingValue: unknown, findingIndex: number) => {
          const findingPrefix = `${prefix}.findings[${findingIndex}]`;
          const finding = object(findingValue, findingPrefix);
          const firstObservedAt = optionalTimestamp(finding.firstObservedAt, `${findingPrefix}.firstObservedAt`);
          const lastObservedAt = optionalTimestamp(finding.lastObservedAt, `${findingPrefix}.lastObservedAt`);
          return {
            category: boundedString(finding.category, `${findingPrefix}.category`, MAX_RISK_CALIBRATION_FINDING_CATEGORY_LENGTH),
            ...(firstObservedAt ? { firstObservedAt } : {}),
            ...(lastObservedAt ? { lastObservedAt } : {}),
          };
        }),
      };
    }),
  };
}

function projectEvidence(value: unknown, field: string): CalibrationEvidence {
  const source = object(value, field);
  const availability = boundedString(source.availability ?? source.state, `${field}.availability`, MAX_RISK_CALIBRATION_AVAILABILITY_LENGTH);
  if (!AVAILABILITY_STATES.has(availability)) throw new CliUsageError(`${field}.availability is unsupported.`);
  const result: CalibrationEvidence = {
    availability: availability as RiskCalibrationEvidence['availability'],
  };

  for (const name of BOOLEAN_FIELDS) {
    const candidate = source[name];
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate !== 'boolean') throw new CliUsageError(`${field}.${name} must be true or false when present.`);
    result[name] = candidate;
  }

  if (source.activityStatus !== null && source.activityStatus !== undefined) {
    const activity = boundedString(source.activityStatus, `${field}.activityStatus`, MAX_RISK_CALIBRATION_ACTIVITY_LENGTH);
    if (!ACTIVITY_STATES.has(activity)) throw new CliUsageError(`${field}.activityStatus is unsupported.`);
    result.activityStatus = activity as NonNullable<RiskCalibrationEvidence['activityStatus']>;
  }
  if (source.scanDepth !== null && source.scanDepth !== undefined) {
    const depth = boundedString(source.scanDepth, `${field}.scanDepth`, MAX_RISK_CALIBRATION_SCAN_DEPTH_LENGTH);
    if (depth !== 'fast' && depth !== 'deep') throw new CliUsageError(`${field}.scanDepth must be fast or deep.`);
    Object.assign(result, { scanDepth: depth });
  }
  if (source.observedAt !== null && source.observedAt !== undefined) {
    const observedAt = optionalTimestamp(source.observedAt, `${field}.observedAt`);
    if (observedAt) Object.assign(result, { observedAt });
  }
  if (source.phishingLanguageMatch !== null && source.phishingLanguageMatch !== undefined) {
    result.phishingLanguageMatch = boundedString(source.phishingLanguageMatch, `${field}.phishingLanguageMatch`);
  }
  if (source.domainAgeDays !== null && source.domainAgeDays !== undefined) {
    if (typeof source.domainAgeDays !== 'number' || !Number.isFinite(source.domainAgeDays)
      || source.domainAgeDays < 0 || source.domainAgeDays > MAX_RISK_CALIBRATION_DOMAIN_AGE_DAYS) {
      throw new CliUsageError(`${field}.domainAgeDays must be a finite number from 0 to 100000.`);
    }
    result.domainAgeDays = source.domainAgeDays;
  }
  if (source.mutationTypes !== null && source.mutationTypes !== undefined) {
    if (!Array.isArray(source.mutationTypes)) throw new CliUsageError(`${field}.mutationTypes must be an array.`);
    if (source.mutationTypes.length > MAX_RISK_CALIBRATION_MUTATIONS) throw new CliUsageError(`${field}.mutationTypes exceeds the ${MAX_RISK_CALIBRATION_MUTATIONS}-item limit.`);
    result.mutationTypes = [...new Set(source.mutationTypes.map((item: unknown, index: number) => {
      const mutation = boundedString(item, `${field}.mutationTypes[${index}]`, MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH);
      if (!MUTATION_TYPES.has(mutation)) throw new CliUsageError(`${field}.mutationTypes[${index}] is unsupported.`);
      return mutation;
    }))];
  }
  const threatIntelligence = projectThreatIntelligence(source.threatIntelligence, `${field}.threatIntelligence`);
  if (threatIntelligence) result.threatIntelligence = threatIntelligence;
  return result;
}

export async function readRiskCalibrationInputBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_RISK_CALIBRATION_INPUT_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Risk calibration input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  try {
    return decodeBoundedUtf8(Buffer.concat(chunks), 'Risk calibration input');
  } catch (cause) {
    throw new CliUsageError(cause instanceof Error ? cause.message : 'Risk calibration input must contain valid UTF-8 text.');
  }
}

export function parseRiskCalibrationDataset(text: unknown): CalibrationDataset {
  if (typeof text !== 'string') throw new CliUsageError('Risk calibration input must be a JSON document.');
  if (Buffer.byteLength(text, 'utf8') > MAX_RISK_CALIBRATION_INPUT_BYTES) {
    throw new CliUsageError(`Risk calibration input is limited to ${MAX_RISK_CALIBRATION_INPUT_BYTES} bytes.`);
  }
  const normalized = text.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized, {
      maximumDepth: MAX_RISK_CALIBRATION_JSON_DEPTH,
      maximumKeys: MAX_RISK_CALIBRATION_JSON_KEYS,
      maximumValues: MAX_RISK_CALIBRATION_JSON_VALUES,
      maximumContainerItems: MAX_RISK_CALIBRATION_JSON_CONTAINER_ITEMS,
    });
    parsed = JSON.parse(normalized);
  } catch {
    throw new CliUsageError('Risk calibration input must be valid bounded JSON without duplicate keys.');
  }
  const document = object(parsed, 'Risk calibration input');
  const documentVersion = typeof document.version === 'number' && Number.isInteger(document.version)
    ? document.version
    : null;
  if (document.schema !== RISK_CALIBRATION_DATASET_SCHEMA
    || documentVersion === null
    || !SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS.includes(documentVersion as 1 | 2)) {
    throw new CliUsageError(`Risk calibration input must use ${RISK_CALIBRATION_DATASET_SCHEMA} version ${SUPPORTED_RISK_CALIBRATION_DATASET_VERSIONS.join(' or ')}.`);
  }
  if (!Array.isArray(document.records) || !document.records.length) {
    throw new CliUsageError('Risk calibration input must contain a non-empty records array.');
  }
  if (document.records.length > MAX_RISK_CALIBRATION_RECORDS) {
    throw new CliUsageError(`Risk calibration input exceeds the ${MAX_RISK_CALIBRATION_RECORDS}-record limit.`);
  }

  const ids = new Set<string>();
  const records = document.records.map((value: unknown, index: number): CalibrationRecord => {
    const prefix = `records[${index}]`;
    const record = object(value, prefix);
    const id = boundedString(record.id, `${prefix}.id`, MAX_RISK_CALIBRATION_RECORD_ID_LENGTH);
    if (ids.has(id)) throw new CliUsageError(`${prefix}.id must be unique.`);
    ids.add(id);
    const domain = boundedString(record.domain, `${prefix}.domain`, MAX_RISK_CALIBRATION_DOMAIN_LENGTH).toLowerCase().replace(/\.$/, '');
    if (!isValidAsciiDomainName(domain, { requireDot: true })) throw new CliUsageError(`${prefix}.domain must be a valid ASCII DNS hostname, not an IP address.`);
    const analystDisposition = boundedString(record.analystDisposition, `${prefix}.analystDisposition`, MAX_RISK_CALIBRATION_DISPOSITION_LENGTH);
    if (!DISPOSITIONS.has(analystDisposition)) throw new CliUsageError(`${prefix}.analystDisposition is unsupported.`);
    let reviewReasonCode: string | undefined;
    if (record.reviewReasonCode !== null && record.reviewReasonCode !== undefined) {
      reviewReasonCode = boundedString(record.reviewReasonCode, `${prefix}.reviewReasonCode`, MAX_RISK_CALIBRATION_REVIEW_REASON_LENGTH);
      if (!REVIEW_REASON_CODES.has(reviewReasonCode)) throw new CliUsageError(`${prefix}.reviewReasonCode is unsupported.`);
    }
    return {
      id,
      domain,
      analystDisposition: analystDisposition as CalibrationDisposition,
      ...(reviewReasonCode ? { reviewReasonCode } : {}),
      evidence: projectEvidence(record.evidence, `${prefix}.evidence`),
    };
  });
  return {
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: documentVersion as 1 | typeof RISK_CALIBRATION_DATASET_VERSION,
    records,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function wilson95(successes: number, total: number): { lower: number; upper: number } | null {
  if (!total) return null;
  const z = 1.96;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total)) / denominator;
  return { lower: Number(Math.max(0, center - margin).toFixed(4)), upper: Number(Math.min(1, center + margin).toFixed(4)) };
}

function metricsForThreshold(records: readonly CalibrationScoredRecord[], threshold: number): ThresholdMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const record of records) {
    if (!record.includedInMetrics || record.score === null) continue;
    const flagged = record.score >= threshold;
    if (record.metricClass === 'positive') flagged ? truePositive += 1 : falseNegative += 1;
    else flagged ? falsePositive += 1 : trueNegative += 1;
  }
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const specificity = ratio(trueNegative, trueNegative + falsePositive);
  return {
    threshold,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision,
    recall,
    specificity,
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
    f1: precision === null || recall === null || precision + recall === 0
      ? null
      : Number(((2 * precision * recall) / (precision + recall)).toFixed(4)),
    balancedAccuracy: recall === null || specificity === null
      ? null
      : Number(((recall + specificity) / 2).toFixed(4)),
    confidence95: {
      precision: wilson95(truePositive, truePositive + falsePositive),
      recall: wilson95(truePositive, truePositive + falseNegative),
      specificity: wilson95(trueNegative, trueNegative + falsePositive),
    },
  };
}

function metricClass(disposition: CalibrationDisposition): MetricClass {
  if (POSITIVE_DISPOSITIONS.has(disposition)) return 'positive';
  if (NEGATIVE_DISPOSITIONS.has(disposition)) return 'negative';
  return 'excluded';
}

function scoreBand(score: number | null): string {
  if (score === null) return 'not_scored';
  if (score >= 70) return '70_100';
  if (score >= 40) return '40_69';
  return '0_39';
}

function scoringEvidence(record: CalibrationRecord): RiskInput {
  const threatIntelligence = record.evidence.threatIntelligence;
  const scoringDomain = canonicalRegistrableDomain(record.domain);
  return {
    ...record.evidence,
    domain: scoringDomain ?? record.domain,
    ...(threatIntelligence && scoringDomain ? {
      threatIntelligence: {
        version: THREAT_INTELLIGENCE_ENVELOPE_VERSION,
        providers: threatIntelligence.providers.map((provider) => ({
          ...provider,
          schema: THREAT_INTELLIGENCE_SCHEMA,
          version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
          target: {
            type: 'domain',
            value: scoringDomain,
            exposure: 'registrable_domain',
          },
        })),
      },
    } : {}),
  };
}

export function buildRiskCalibrationReport(
  dataset: CalibrationDataset,
  explainRiskScore: ExplainRiskScore,
  options: {
    generatedAt?: string;
    modelVersion: number;
    reviewThreshold: number;
    previousModelVersion?: number;
    explainPreviousRiskScore?: ExplainRiskScore;
  },
): RiskCalibrationReport {
  const records: CalibrationReportRecord[] = dataset.records.map((record) => {
    const explained = explainRiskScore(scoringEvidence(record));
    const classification = metricClass(record.analystDisposition);
    const includedInMetrics = classification !== 'excluded' && explained !== null;
    return {
      id: record.id,
      domain: record.domain,
      analystDisposition: record.analystDisposition,
      reviewReasonCode: record.reviewReasonCode ?? null,
      interoperabilityTags: analystInteroperabilityTags(record.analystDisposition, record.reviewReasonCode),
      metricClass: classification,
      includedInMetrics,
      exclusionReason: includedInMetrics
        ? null
        : explained === null
          ? 'not_scored' as const
          : 'contextual_disposition' as const,
      modelVersion: explained?.modelVersion ?? options.modelVersion,
      score: explained?.score ?? null,
      band: scoreBand(explained?.score ?? null),
      factors: explained?.factors ?? [],
    };
  });
  const bands = { not_scored: 0, '0_39': 0, '40_69': 0, '70_100': 0 };
  for (const record of records) bands[record.band as keyof typeof bands] += 1;
  const positive = records.filter((record) => record.metricClass === 'positive' && record.score !== null).length;
  const negative = records.filter((record) => record.metricClass === 'negative' && record.score !== null).length;
  const excluded = records.length - positive - negative;
  const strata: RiskCalibrationReport['strata'] = [];
  const appendStrata = (dimension: 'review_reason' | 'scan_depth', values: Map<string, CalibrationScoredRecord[]>): void => {
    for (const [value, members] of [...values].sort(([left], [right]) => left.localeCompare(right))) {
      const sampleCount = members.filter((member) => member.includedInMetrics).length;
      strata.push({
        dimension,
        value,
        sampleCount,
        insufficientSample: sampleCount < 20,
        metrics: metricsForThreshold(members, options.reviewThreshold),
      });
    }
  };
  const byDepth = new Map<string, CalibrationScoredRecord[]>();
  const byReason = new Map<string, CalibrationScoredRecord[]>();
  for (let index = 0; index < dataset.records.length; index += 1) {
    const source = dataset.records[index];
    const scored = records[index];
    if (!source || !scored) continue;
    const depth = source.evidence.scanDepth === 'deep' || source.evidence.scanDepth === 'fast' ? source.evidence.scanDepth : 'unknown';
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), scored]);
    const reason = source.reviewReasonCode ?? 'not_recorded';
    byReason.set(reason, [...(byReason.get(reason) ?? []), scored]);
  }
  appendStrata('scan_depth', byDepth);
  appendStrata('review_reason', byReason);

  let scoresChanged = 0;
  let bandsChanged = 0;
  let thresholdClassificationsChanged = 0;
  if (options.explainPreviousRiskScore) {
    for (let index = 0; index < dataset.records.length; index += 1) {
      const source = dataset.records[index];
      const current = records[index];
      if (!source || !current) continue;
      const previous = options.explainPreviousRiskScore(scoringEvidence(source));
      if (previous?.score !== current.score) scoresChanged += 1;
      if (scoreBand(previous?.score ?? null) !== current.band) bandsChanged += 1;
      if (((previous?.score ?? -1) >= options.reviewThreshold) !== ((current.score ?? -1) >= options.reviewThreshold)) {
        thresholdClassificationsChanged += 1;
      }
    }
  }
  return {
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: RISK_CALIBRATION_REPORT_VERSION,
    mode: 'detailed',
    generatedAt: options.generatedAt || new Date().toISOString(),
    dataset: { schema: dataset.schema, version: dataset.version, recordCount: records.length },
    riskModelVersion: options.modelVersion,
    currentReviewThreshold: options.reviewThreshold,
    summary: { total: records.length, positive, negative, excluded, scoreBands: bands },
    thresholds: RISK_CALIBRATION_THRESHOLDS.map((threshold) => metricsForThreshold(records, threshold)),
    strata,
    modelComparison: {
      available: Boolean(options.explainPreviousRiskScore),
      previousModelVersion: options.explainPreviousRiskScore ? options.previousModelVersion ?? null : null,
      currentModelVersion: options.modelVersion,
      scoresChanged,
      bandsChanged,
      thresholdClassificationsChanged,
    },
    records,
    interpretation: {
      authority: 'analyst_context_only',
      statement: RISK_CALIBRATION_SUMMARY_INTERPRETATION,
      automaticTuning: false,
      networkRequests: false,
      persisted: false,
    },
  };
}

export function serializeRiskCalibrationReport(
  report: RiskCalibrationReport | RiskCalibrationSummaryReport,
): string {
  try {
    const snapshot = snapshotRiskCalibrationReportForSerialization(report);
    const serialised = serializeRiskCalibrationSnapshot(snapshot);
    if (snapshot.mode === 'summary') parseRiskCalibrationSummaryReport(serialised);
    else buildRiskCalibrationSummaryReport(snapshot.document);
    return serialised;
  } catch (cause) {
    throw new CliUsageError(cause instanceof Error
      ? cause.message
      : 'Risk calibration output must use the current detailed or summary report contract.');
  }
}

export type {
  CalibrationDataset,
  CalibrationDisposition,
  CalibrationRecord,
  ExplainRiskScore,
  RiskCalibrationReport,
};
