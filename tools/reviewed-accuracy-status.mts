#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TECHNOLOGY_REVIEWED_FIXTURES } from '../fixtures/technology-reviewed-fixtures.mts';

type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{ stdout?: WritableLike; stderr?: WritableLike }>;

export type ReviewedAccuracyCorpusKey =
  | 'lookalike-analysis'
  | 'page-similarity'
  | 'technology-detection'
  | 'service-deprovision-cues'
  | 'certificate-grouping';

export type ReviewedAccuracyCorpusStatus = Readonly<{
  key: ReviewedAccuracyCorpusKey;
  label: string;
  reviewedCases: number;
  reviewedPositiveCases: number;
  reviewedBenignCases: number;
  readiness: 'unproven' | 'limited' | 'measured';
  limitation: string;
  nextStep: string;
}>;

export const REVIEWED_ACCURACY_STATUS_SCHEMA = 'whoisleuth.reviewed-accuracy-status';
export const REVIEWED_ACCURACY_STATUS_VERSION = 1;
export const MINIMUM_LIMITED_CASES = 5;
export const MINIMUM_LIMITED_CASES_PER_CLASS = 1;
export const MINIMUM_MEASURED_CASES = 20;
export const MINIMUM_MEASURED_CASES_PER_CLASS = 5;

const CORPORA: readonly Readonly<{
  key: ReviewedAccuracyCorpusKey;
  label: string;
  reviewedCases: () => Readonly<{ positive: number; benign: number }>;
  limitation: string;
  nextStep: string;
}>[] = Object.freeze([
  Object.freeze({
    key: 'lookalike-analysis',
    label: 'Lookalike analysis',
    reviewedCases: () => ({ positive: 0, benign: 0 }),
    limitation: 'Synthetic confusable calibration does not establish precision on reviewed real-world observations.',
    nextStep: 'Review minimised positive and benign-collision examples with a documented redistribution basis.',
  }),
  Object.freeze({
    key: 'page-similarity',
    label: 'Page similarity',
    reviewedCases: () => ({ positive: 0, benign: 0 }),
    limitation: 'Component comparison is deterministic, but no reviewed real-world corpus measures useful matches or collisions.',
    nextStep: 'Retain only minimised component observations and reviewed component-level expectations.',
  }),
  Object.freeze({
    key: 'technology-detection',
    label: 'Technology detection',
    reviewedCases: () => ({ positive: TECHNOLOGY_REVIEWED_FIXTURES.length, benign: 0 }),
    limitation: 'Synthetic catalogue fixtures do not establish coverage on the wider web.',
    nextStep: 'Use the existing technology review tool to add minimised, licensed observations.',
  }),
  Object.freeze({
    key: 'service-deprovision-cues',
    label: 'Service deprovision cues',
    reviewedCases: () => ({ positive: 0, benign: 0 }),
    limitation: 'Provider cues remain investigative prompts and have no measured false-positive rate.',
    nextStep: 'Review minimised active, unresolved, deprovision-cue, and benign provider responses.',
  }),
  Object.freeze({
    key: 'certificate-grouping',
    label: 'Certificate grouping',
    reviewedCases: () => ({ positive: 0, benign: 0 }),
    limitation: 'Grouping is structural and bounded, but usefulness has not been measured against reviewed investigations.',
    nextStep: 'Review minimised co-occurrence, wildcard, renewal, and unrelated-certificate examples.',
  }),
]);

function readiness(positive: number, benign: number): ReviewedAccuracyCorpusStatus['readiness'] {
  const reviewedCases = positive + benign;
  if (reviewedCases >= MINIMUM_MEASURED_CASES
    && positive >= MINIMUM_MEASURED_CASES_PER_CLASS
    && benign >= MINIMUM_MEASURED_CASES_PER_CLASS) return 'measured';
  if (reviewedCases >= MINIMUM_LIMITED_CASES
    && positive >= MINIMUM_LIMITED_CASES_PER_CLASS
    && benign >= MINIMUM_LIMITED_CASES_PER_CLASS) return 'limited';
  return 'unproven';
}

export function buildReviewedAccuracyStatus(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new TypeError('Accuracy status generation time must be valid.');
  const corpora = CORPORA.map((corpus): ReviewedAccuracyCorpusStatus => {
    const reviewedCases = corpus.reviewedCases();
    const total = reviewedCases.positive + reviewedCases.benign;
    return Object.freeze({
      key: corpus.key,
      label: corpus.label,
      reviewedCases: total,
      reviewedPositiveCases: reviewedCases.positive,
      reviewedBenignCases: reviewedCases.benign,
      readiness: readiness(reviewedCases.positive, reviewedCases.benign),
      limitation: corpus.limitation,
      nextStep: corpus.nextStep,
    });
  });
  return Object.freeze({
    schema: REVIEWED_ACCURACY_STATUS_SCHEMA,
    version: REVIEWED_ACCURACY_STATUS_VERSION,
    generatedAt: now.toISOString(),
    thresholds: Object.freeze({
      limited: Object.freeze({ total: MINIMUM_LIMITED_CASES, perClass: MINIMUM_LIMITED_CASES_PER_CLASS }),
      measured: Object.freeze({ total: MINIMUM_MEASURED_CASES, perClass: MINIMUM_MEASURED_CASES_PER_CLASS }),
    }),
    corpora: Object.freeze(corpora),
    summary: Object.freeze({
      measured: corpora.filter((corpus) => corpus.readiness === 'measured').length,
      limited: corpora.filter((corpus) => corpus.readiness === 'limited').length,
      unproven: corpora.filter((corpus) => corpus.readiness === 'unproven').length,
    }),
    limitation: 'Case counts describe the checked-in reviewed corpora only. They do not establish general accuracy, recall, safety, ownership, intent, or maliciousness.',
  });
}

function humanReport(report: ReturnType<typeof buildReviewedAccuracyStatus>): string {
  const lines = ['Reviewed accuracy status', `Generated: ${report.generatedAt}`, ''];
  for (const corpus of report.corpora) {
    lines.push(`${corpus.label}: ${corpus.readiness} (${corpus.reviewedCases} reviewed case${corpus.reviewedCases === 1 ? '' : 's'})`);
    lines.push(`  Balance: ${corpus.reviewedPositiveCases} positive, ${corpus.reviewedBenignCases} benign or collision case${corpus.reviewedBenignCases === 1 ? '' : 's'}`);
    lines.push(`  Limitation: ${corpus.limitation}`);
    lines.push(`  Next: ${corpus.nextStep}`);
  }
  lines.push('', report.limitation, '');
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  try {
    if (args.some((argument) => argument !== '--json') || args.filter((argument) => argument === '--json').length > 1) {
      throw new TypeError('Usage: node tools/reviewed-accuracy-status.mts [--json]');
    }
    const report = buildReviewedAccuracyStatus();
    (options.stdout || process.stdout).write(args.includes('--json')
      ? `${JSON.stringify(report, null, 2)}\n`
      : humanReport(report));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reviewed accuracy status failed.';
    (options.stderr || process.stderr).write(`${message.replace(/[\r\n]+/gu, ' ').slice(0, 500)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}
