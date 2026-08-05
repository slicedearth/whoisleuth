import { Buffer } from 'node:buffer';

import { CliUsageError } from './errors.mts';
import { buildRegistryDoctorReport } from './registry-doctor.mts';
import type { UnknownRecord } from './saved-lookup.mts';

export const REGISTRY_COHORT_SCHEMA = 'whoisleuth.cli.registry-cohort';
export const REGISTRY_COHORT_VERSION = 1;
export const MAX_REGISTRY_COHORT_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_REGISTRY_COHORT_SAMPLES = 500;
export const MIN_REGISTRY_COHORT_SAMPLE = 5;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function documents(text: string): UnknownRecord[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_REGISTRY_COHORT_INPUT_BYTES) {
    throw new CliUsageError(`Registry cohort input is limited to ${MAX_REGISTRY_COHORT_INPUT_BYTES} bytes.`);
  }
  const trimmed = text.replace(/^\uFEFF/u, '').trim();
  if (!trimmed) throw new CliUsageError('Registry cohort input is empty.');
  let values: unknown[];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new CliUsageError('Registry cohort input must be valid JSON or JSONL.'); }
    if (!Array.isArray(parsed)) throw new CliUsageError('Registry cohort JSON input must be an array.');
    values = parsed;
  } else {
    const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim());
    values = lines.map((line, index) => {
      try { return JSON.parse(line); } catch { throw new CliUsageError(`Registry cohort JSONL line ${index + 1} is invalid.`); }
    });
  }
  if (!values.length || values.length > MAX_REGISTRY_COHORT_SAMPLES) {
    throw new CliUsageError(`Registry cohort input must contain from 1 to ${MAX_REGISTRY_COHORT_SAMPLES} saved Lookups.`);
  }
  const output = values.map(record);
  if (output.some((item) => !Object.keys(item).length)) throw new CliUsageError('Every registry cohort item must be one saved Lookup object.');
  return output;
}

export function buildRegistryCohortReport(text: string, generatedAt = new Date().toISOString()) {
  const reports = documents(text).map((item) => buildRegistryDoctorReport(JSON.stringify(item), generatedAt));
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = `${report.suffix}\u0000${report.profile.id}`;
    const group = groups.get(key) ?? [];
    group.push(report);
    groups.set(key, group);
  }
  const cohorts = [...groups.values()].map((group) => {
    const sample = group[0];
    if (!sample) throw new CliUsageError('Registry cohort grouping failed.');
    const sampleCount = group.length;
    const investigate = group.reduce((total, item) => total + item.summary.investigate, 0);
    const publicationReviewItems = group.reduce((total, item) => total + item.publication.reviewItems, 0);
    return Object.freeze({
      suffix: sample.suffix,
      profileId: sample.profile.id,
      sampleCount,
      state: sampleCount < MIN_REGISTRY_COHORT_SAMPLE
        ? 'insufficient_sample' as const
        : investigate || publicationReviewItems
          ? 'review' as const
          : 'consistent' as const,
      sourceAlignment: Object.freeze({
        investigate,
        expectedConstraints: group.reduce((total, item) => total + item.summary.expectedConstraints, 0),
        observed: group.reduce((total, item) => total + item.summary.observed, 0),
      }),
      publication: Object.freeze({
        reviewItems: publicationReviewItems,
        objectIdentifiersObserved: group.filter((item) => item.publication.objectIdentifier.state === 'observed').length,
        baseConformanceObserved: group.filter((item) => item.publication.baseConformance.state === 'observed').length,
        selfLinksObserved: group.filter((item) => item.publication.selfLink.state === 'observed').length,
        redactionMetadataObserved: group.filter((item) => item.publication.redactionMetadata.state === 'observed').length,
      }),
    });
  }).sort((left, right) => left.suffix.localeCompare(right.suffix) || left.profileId.localeCompare(right.profileId));
  return Object.freeze({
    schema: REGISTRY_COHORT_SCHEMA,
    version: REGISTRY_COHORT_VERSION,
    generatedAt,
    sampleCount: reports.length,
    minimumCohortSample: MIN_REGISTRY_COHORT_SAMPLE,
    cohorts: Object.freeze(cohorts),
    limitations: Object.freeze([
      'The report intentionally omits domains, queries and raw evidence. It groups saved observations only by suffix and capability profile.',
      `Cohorts with fewer than ${MIN_REGISTRY_COHORT_SAMPLE} observations remain insufficient sample and must not drive catalogue changes.`,
      'Repeated observations from one environment are not representative by themselves. Review fixture provenance and source health before changing a parser or access profile.',
    ]),
  });
}

export function formatRegistryCohortReport(report: ReturnType<typeof buildRegistryCohortReport>): string {
  const output = [
    'Registry quality cohort',
    `Saved observations  ${report.sampleCount}`,
    `Minimum sample      ${report.minimumCohortSample}`,
    '',
  ];
  for (const cohort of report.cohorts) {
    output.push(`.${cohort.suffix} · ${cohort.profileId} [${cohort.state.replaceAll('_', ' ')}]`);
    output.push(`  Samples: ${cohort.sampleCount}`);
    output.push(`  Source review items: ${cohort.sourceAlignment.investigate}`);
    output.push(`  Publication review items: ${cohort.publication.reviewItems}`);
  }
  output.push('', 'Limitations:');
  for (const limitation of report.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}
