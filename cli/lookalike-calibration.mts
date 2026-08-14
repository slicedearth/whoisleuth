import { Buffer } from 'node:buffer';

import { scanBoundedJson } from '../lib/bounded-json.mts';

const LOOKALIKE_CALIBRATION_INPUT_SCHEMA = 'whoisleuth.lookalike-calibration-input';
const LOOKALIKE_CALIBRATION_SCHEMA = 'whoisleuth.lookalike-calibration';
const LOOKALIKE_CALIBRATION_VERSION = 1;
const MAX_LOOKALIKE_CALIBRATION_BYTES = 2 * 1024 * 1024;
const MAX_LOOKALIKE_CALIBRATION_RECORDS = 5_000;
const MIN_LOOKALIKE_CALIBRATION_SAMPLE = 20;

const DISPOSITIONS = ['suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action'] as const;
type Disposition = typeof DISPOSITIONS[number];
type UnknownRecord = Record<string, unknown>;

type LookalikeCalibrationReport = Readonly<{
  schema: typeof LOOKALIKE_CALIBRATION_SCHEMA;
  version: typeof LOOKALIKE_CALIBRATION_VERSION;
  generatedAt: string;
  summary: Readonly<{
    reviewedCandidates: number;
    mutationFamilies: number;
    sampleState: 'insufficient' | 'reviewed';
    reviewLeadRate: number;
    falsePositiveRate: number;
    expectedRate: number;
  }>;
  families: readonly Readonly<{
    id: string;
    reviewedCandidates: number;
    sampleState: 'insufficient' | 'reviewed';
    dispositions: Readonly<Record<Disposition, number>>;
    reviewLeadRate: number;
    falsePositiveRate: number;
  }>[];
  privacy: Readonly<{ candidateIdsRetained: 0; domainsRetained: 0; notesRetained: 0 }>;
  limitations: readonly string[];
}>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function token(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be text.`);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(normalized)) throw new TypeError(`${field} must be a bounded identifier.`);
  return normalized;
}

function ratio(value: number, total: number): number {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function emptyCounts(): Record<Disposition, number> {
  return { suspicious: 0, confirmed_abuse: 0, false_positive: 0, expected: 0, closed_no_action: 0 };
}

function buildLookalikeCalibration(raw: string, generatedAt = new Date().toISOString()): LookalikeCalibrationReport {
  if (Buffer.byteLength(raw, 'utf8') > MAX_LOOKALIKE_CALIBRATION_BYTES) {
    throw new TypeError(`Lookalike calibration input is limited to ${MAX_LOOKALIKE_CALIBRATION_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    scanBoundedJson(raw);
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Lookalike calibration input must be valid bounded JSON without duplicate keys.');
  }
  const input = record(parsed);
  if (input.schema !== LOOKALIKE_CALIBRATION_INPUT_SCHEMA || input.version !== LOOKALIKE_CALIBRATION_VERSION) {
    throw new TypeError(`Lookalike calibration input must use ${LOOKALIKE_CALIBRATION_INPUT_SCHEMA} version ${LOOKALIKE_CALIBRATION_VERSION}.`);
  }
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_LOOKALIKE_CALIBRATION_RECORDS) {
    throw new TypeError(`Lookalike calibration input must contain from 1 to ${MAX_LOOKALIKE_CALIBRATION_RECORDS} reviewed records.`);
  }
  const ids = new Set<string>();
  const familyCounts = new Map<string, Record<Disposition, number>>();
  const totalCounts = emptyCounts();
  for (let index = 0; index < input.records.length; index++) {
    const item = record(input.records[index]);
    const id = token(item.id, `records[${index}].id`);
    if (ids.has(id)) throw new TypeError(`Lookalike calibration record id "${id}" is duplicated.`);
    ids.add(id);
    if (typeof item.disposition !== 'string' || !DISPOSITIONS.includes(item.disposition as Disposition)) {
      throw new TypeError(`records[${index}].disposition is not a supported reviewed disposition.`);
    }
    const disposition = item.disposition as Disposition;
    if (!Array.isArray(item.mutationFamilies) || item.mutationFamilies.length < 1 || item.mutationFamilies.length > 12) {
      throw new TypeError(`records[${index}].mutationFamilies must contain from 1 to 12 identifiers.`);
    }
    const families = [...new Set(item.mutationFamilies.map((value) => token(value, `records[${index}].mutationFamilies`)))];
    totalCounts[disposition] += 1;
    for (const family of families) {
      const counts = familyCounts.get(family) || emptyCounts();
      counts[disposition] += 1;
      familyCounts.set(family, counts);
    }
  }
  const families = [...familyCounts.entries()].map(([id, dispositions]) => {
    const reviewedCandidates = Object.values(dispositions).reduce((sum, count) => sum + count, 0);
    return {
      id,
      reviewedCandidates,
      sampleState: reviewedCandidates >= MIN_LOOKALIKE_CALIBRATION_SAMPLE ? 'reviewed' as const : 'insufficient' as const,
      dispositions,
      reviewLeadRate: ratio(dispositions.suspicious + dispositions.confirmed_abuse, reviewedCandidates),
      falsePositiveRate: ratio(dispositions.false_positive, reviewedCandidates),
    };
  }).sort((left, right) => right.reviewedCandidates - left.reviewedCandidates || left.id.localeCompare(right.id));
  const reviewedCandidates = input.records.length;
  return {
    schema: LOOKALIKE_CALIBRATION_SCHEMA,
    version: LOOKALIKE_CALIBRATION_VERSION,
    generatedAt,
    summary: {
      reviewedCandidates,
      mutationFamilies: families.length,
      sampleState: reviewedCandidates >= MIN_LOOKALIKE_CALIBRATION_SAMPLE ? 'reviewed' : 'insufficient',
      reviewLeadRate: ratio(totalCounts.suspicious + totalCounts.confirmed_abuse, reviewedCandidates),
      falsePositiveRate: ratio(totalCounts.false_positive, reviewedCandidates),
      expectedRate: ratio(totalCounts.expected, reviewedCandidates),
    },
    families,
    privacy: { candidateIdsRetained: 0, domainsRetained: 0, notesRetained: 0 },
    limitations: [
      'This offline report summarises analyst dispositions for the supplied reviewed sample and never changes mutation generation, ordering, Risk, or filtering automatically.',
      'Suspicious and confirmed-abuse dispositions are counted as review leads, not proof of maliciousness; expected and false-positive dispositions are not proof of safety.',
      `A family remains an insufficient sample below ${MIN_LOOKALIKE_CALIBRATION_SAMPLE} reviewed candidates, and even larger local samples may not generalize across brands, languages, registries, or time.`,
      'Candidate identifiers, domains, notes, and evidence are intentionally omitted from output. Retain the reviewed source dataset under an appropriate local privacy policy.',
    ],
  };
}

function formatLookalikeCalibration(report: LookalikeCalibrationReport): string {
  const output = [
    'Lookalike review-yield calibration',
    `Reviewed candidates ${report.summary.reviewedCandidates}`,
    `Mutation families   ${report.summary.mutationFamilies}`,
    `Sample state        ${report.summary.sampleState}`,
    `Review-lead rate    ${(report.summary.reviewLeadRate * 100).toFixed(1)}%`,
    `False-positive rate ${(report.summary.falsePositiveRate * 100).toFixed(1)}%`,
    '',
  ];
  for (const family of report.families) {
    output.push(`${family.id} [${family.sampleState}]`);
    output.push(`  ${family.reviewedCandidates} reviewed · ${(family.reviewLeadRate * 100).toFixed(1)}% review leads · ${(family.falsePositiveRate * 100).toFixed(1)}% false positives`);
  }
  output.push('', 'Limitations:');
  for (const limitation of report.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export {
  LOOKALIKE_CALIBRATION_INPUT_SCHEMA,
  LOOKALIKE_CALIBRATION_SCHEMA,
  LOOKALIKE_CALIBRATION_VERSION,
  MAX_LOOKALIKE_CALIBRATION_BYTES,
  MAX_LOOKALIKE_CALIBRATION_RECORDS,
  MIN_LOOKALIKE_CALIBRATION_SAMPLE,
  buildLookalikeCalibration,
  formatLookalikeCalibration,
};
export type { LookalikeCalibrationReport };
