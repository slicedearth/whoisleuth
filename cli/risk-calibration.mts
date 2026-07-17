import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';

import { CliUsageError } from './arguments.mts';
import type { BoundedTextStream } from './bulk.mts';
import { RISK_MUTATION_TYPES, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import type { RiskExplanation, RiskInput } from '../lib/risk-scoring.mts';

export const RISK_CALIBRATION_DATASET_SCHEMA = 'whoisleuth.risk-calibration-dataset';
export const RISK_CALIBRATION_DATASET_VERSION = 1;
export const RISK_CALIBRATION_REPORT_SCHEMA = 'whoisleuth.cli.risk-calibration';
export const RISK_CALIBRATION_REPORT_VERSION = 1;
export const MAX_RISK_CALIBRATION_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RISK_CALIBRATION_RECORDS = 500;
export const MAX_RISK_CALIBRATION_STRING_LENGTH = 256;
export const RISK_CALIBRATION_THRESHOLDS = Object.freeze(
  [...new Set([40, 50, 60, RISK_REVIEW_THRESHOLD, 80, 90])].sort((a, b) => a - b),
);

const MAX_MUTATIONS = 30;
const MAX_PROVIDERS = 10;
const MAX_FINDINGS_PER_PROVIDER = 100;
const MAX_TIMESTAMP_LENGTH = 64;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DISPOSITIONS = new Set([
  'unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action',
]);
const POSITIVE_DISPOSITIONS = new Set(['confirmed_abuse']);
const NEGATIVE_DISPOSITIONS = new Set(['false_positive', 'expected']);
const AVAILABILITY_STATES = new Set(['registered', 'for_sale', 'expiring', 'available', 'unknown', 'error']);
const ACTIVITY_STATES = new Set(['active', 'parked', 'unreachable', 'no_site']);
const BOOLEAN_FIELDS = [
  'faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField',
  'hasMx', 'hasSpf', 'hasDmarc', 'privacyProtected',
] as const;
const MUTATION_TYPES = new Set(RISK_MUTATION_TYPES);

type UnknownRecord = Record<string, any>;
type CalibrationDisposition = 'unreviewed' | 'suspicious' | 'confirmed_abuse' | 'false_positive' | 'expected' | 'closed_no_action';
type MetricClass = 'positive' | 'negative' | 'excluded';
type CalibrationRecord = {
  id: string;
  domain: string;
  analystDisposition: CalibrationDisposition;
  evidence: RiskInput;
};
type CalibrationDataset = {
  schema: typeof RISK_CALIBRATION_DATASET_SCHEMA;
  version: typeof RISK_CALIBRATION_DATASET_VERSION;
  records: CalibrationRecord[];
};
type ExplainRiskScore = (input: RiskInput) => RiskExplanation | null;

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
  return boundedString(value, field, MAX_TIMESTAMP_LENGTH);
}

function projectThreatIntelligence(value: unknown, field: string): UnknownRecord | undefined {
  if (value === null || value === undefined) return undefined;
  const envelope = object(value, field);
  if (!Array.isArray(envelope.providers)) throw new CliUsageError(`${field}.providers must be an array.`);
  if (envelope.providers.length > MAX_PROVIDERS) throw new CliUsageError(`${field}.providers exceeds the ${MAX_PROVIDERS}-provider limit.`);
  return {
    providers: envelope.providers.map((item: unknown, providerIndex: number) => {
      const prefix = `${field}.providers[${providerIndex}]`;
      const provider = object(item, prefix);
      const identity = object(provider.provider, `${prefix}.provider`);
      const observation = provider.observation === null || provider.observation === undefined
        ? null
        : object(provider.observation, `${prefix}.observation`);
      if (!Array.isArray(provider.findings)) throw new CliUsageError(`${prefix}.findings must be an array.`);
      if (provider.findings.length > MAX_FINDINGS_PER_PROVIDER) {
        throw new CliUsageError(`${prefix}.findings exceeds the ${MAX_FINDINGS_PER_PROVIDER}-finding limit.`);
      }
      return {
        provider: { id: boundedString(identity.id, `${prefix}.provider.id`, 64) },
        state: boundedString(provider.state, `${prefix}.state`, 32),
        observation: observation ? { observedAt: optionalTimestamp(observation.observedAt, `${prefix}.observation.observedAt`) } : undefined,
        findings: provider.findings.map((findingValue: unknown, findingIndex: number) => {
          const findingPrefix = `${prefix}.findings[${findingIndex}]`;
          const finding = object(findingValue, findingPrefix);
          return {
            category: boundedString(finding.category, `${findingPrefix}.category`, 64),
            firstObservedAt: optionalTimestamp(finding.firstObservedAt, `${findingPrefix}.firstObservedAt`),
            lastObservedAt: optionalTimestamp(finding.lastObservedAt, `${findingPrefix}.lastObservedAt`),
          };
        }),
      };
    }),
  };
}

function projectEvidence(value: unknown, field: string): RiskInput {
  const source = object(value, field);
  const availability = boundedString(source.availability ?? source.state, `${field}.availability`, 32);
  if (!AVAILABILITY_STATES.has(availability)) throw new CliUsageError(`${field}.availability is unsupported.`);
  const result: RiskInput = { availability };

  for (const name of BOOLEAN_FIELDS) {
    const candidate = source[name];
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate !== 'boolean') throw new CliUsageError(`${field}.${name} must be true or false when present.`);
    result[name] = candidate;
  }

  if (source.activityStatus !== null && source.activityStatus !== undefined) {
    const activity = boundedString(source.activityStatus, `${field}.activityStatus`, 32);
    if (!ACTIVITY_STATES.has(activity)) throw new CliUsageError(`${field}.activityStatus is unsupported.`);
    result.activityStatus = activity;
  }
  if (source.phishingLanguageMatch !== null && source.phishingLanguageMatch !== undefined) {
    result.phishingLanguageMatch = boundedString(source.phishingLanguageMatch, `${field}.phishingLanguageMatch`);
  }
  if (source.domainAgeDays !== null && source.domainAgeDays !== undefined) {
    if (typeof source.domainAgeDays !== 'number' || !Number.isFinite(source.domainAgeDays)
      || source.domainAgeDays < 0 || source.domainAgeDays > 100_000) {
      throw new CliUsageError(`${field}.domainAgeDays must be a finite number from 0 to 100000.`);
    }
    result.domainAgeDays = source.domainAgeDays;
  }
  if (source.mutationTypes !== null && source.mutationTypes !== undefined) {
    if (!Array.isArray(source.mutationTypes)) throw new CliUsageError(`${field}.mutationTypes must be an array.`);
    if (source.mutationTypes.length > MAX_MUTATIONS) throw new CliUsageError(`${field}.mutationTypes exceeds the ${MAX_MUTATIONS}-item limit.`);
    result.mutationTypes = [...new Set(source.mutationTypes.map((item: unknown, index: number) => {
      const mutation = boundedString(item, `${field}.mutationTypes[${index}]`, 64);
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
  return Buffer.concat(chunks).toString('utf8');
}

export function parseRiskCalibrationDataset(text: unknown): CalibrationDataset {
  if (typeof text !== 'string') throw new CliUsageError('Risk calibration input must be a JSON document.');
  if (Buffer.byteLength(text, 'utf8') > MAX_RISK_CALIBRATION_INPUT_BYTES) {
    throw new CliUsageError(`Risk calibration input is limited to ${MAX_RISK_CALIBRATION_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new CliUsageError('Risk calibration input must be valid JSON.');
  }
  const document = object(parsed, 'Risk calibration input');
  if (document.schema !== RISK_CALIBRATION_DATASET_SCHEMA || document.version !== RISK_CALIBRATION_DATASET_VERSION) {
    throw new CliUsageError(`Risk calibration input must use ${RISK_CALIBRATION_DATASET_SCHEMA} version ${RISK_CALIBRATION_DATASET_VERSION}.`);
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
    const id = boundedString(record.id, `${prefix}.id`, 128);
    if (ids.has(id)) throw new CliUsageError(`${prefix}.id must be unique.`);
    ids.add(id);
    const domain = boundedString(record.domain, `${prefix}.domain`, 253).toLowerCase().replace(/\.$/, '');
    if (!DOMAIN_RE.test(domain) || isIP(domain)) throw new CliUsageError(`${prefix}.domain must be a valid ASCII DNS hostname, not an IP address.`);
    const analystDisposition = boundedString(record.analystDisposition, `${prefix}.analystDisposition`, 32);
    if (!DISPOSITIONS.has(analystDisposition)) throw new CliUsageError(`${prefix}.analystDisposition is unsupported.`);
    return {
      id,
      domain,
      analystDisposition: analystDisposition as CalibrationDisposition,
      evidence: projectEvidence(record.evidence, `${prefix}.evidence`),
    };
  });
  return {
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function metricsForThreshold(records: UnknownRecord[], threshold: number): UnknownRecord {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  for (const record of records) {
    if (!record.includedInMetrics) continue;
    const flagged = record.score >= threshold;
    if (record.metricClass === 'positive') flagged ? truePositive += 1 : falseNegative += 1;
    else flagged ? falsePositive += 1 : trueNegative += 1;
  }
  return {
    threshold,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    specificity: ratio(trueNegative, trueNegative + falsePositive),
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
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

export function buildRiskCalibrationReport(
  dataset: CalibrationDataset,
  explainRiskScore: ExplainRiskScore,
  options: { generatedAt?: string; modelVersion: number; reviewThreshold: number },
): UnknownRecord {
  const records = dataset.records.map((record) => {
    const explained = explainRiskScore(record.evidence);
    const classification = metricClass(record.analystDisposition);
    const includedInMetrics = classification !== 'excluded' && explained !== null;
    return {
      id: record.id,
      domain: record.domain,
      analystDisposition: record.analystDisposition,
      metricClass: classification,
      includedInMetrics,
      exclusionReason: includedInMetrics ? null : explained === null ? 'not_scored' : 'contextual_disposition',
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
  return {
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: RISK_CALIBRATION_REPORT_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    dataset: { schema: dataset.schema, version: dataset.version, recordCount: records.length },
    riskModelVersion: options.modelVersion,
    currentReviewThreshold: options.reviewThreshold,
    summary: { total: records.length, positive, negative, excluded, scoreBands: bands },
    thresholds: RISK_CALIBRATION_THRESHOLDS.map((threshold) => metricsForThreshold(records, threshold)),
    records,
    interpretation: {
      authority: 'analyst_context_only',
      statement: 'This offline replay compares heuristic Risk scores with analyst dispositions. It does not prove maliciousness or safety.',
      automaticTuning: false,
      networkRequests: false,
      persisted: false,
    },
  };
}

export type { CalibrationDataset, CalibrationDisposition, CalibrationRecord, ExplainRiskScore };
