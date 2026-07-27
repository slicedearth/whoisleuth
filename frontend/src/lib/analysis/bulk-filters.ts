// Pure bulk-result triage helpers. Keeping matching and count logic outside
// the Bulk route makes the UI inexpensive to update per incoming scan result and
// gives the filter semantics direct unit-test coverage.

import { computeRiskScore } from './scoring.ts';
import type { RiskInput } from './scoring.ts';

export type BulkTriageBucket = 'all' | 'available' | 'registered' | 'high_risk' | 'errors';
export type BulkSignal = 'favicon' | 'password' | 'phishing' | 'asset_reuse';

export type BulkTriageRecord = RiskInput & {
  availability?: string | null;
  mutationTypes?: string[] | null;
  faviconMatch?: boolean | null;
  hasPasswordField?: boolean | null;
  phishingLanguageMatch?: string | null;
  reusesOfficialAssets?: boolean | null;
};

export type BulkTriageFilters = {
  state: string;
  mutation: string;
  signals: ReadonlySet<string>;
};

export type MutationTriageOption = {
  value: string;
  label: string;
  count: number;
};

export const REGISTERED_AVAILABILITY_STATES: ReadonlySet<string> = new Set([
  'registered',
  'for_sale',
  'expiring',
]);

const SIGNAL_MATCHERS: Readonly<Record<BulkSignal, (record: BulkTriageRecord) => boolean>> = {
  favicon: (record) => record.faviconMatch === true,
  password: (record) => record.hasPasswordField === true,
  phishing: (record) => Boolean(record.phishingLanguageMatch),
  asset_reuse: (record) => record.reusesOfficialAssets === true,
};

function isBulkSignal(value: string): value is BulkSignal {
  return value in SIGNAL_MATCHERS;
}

export function getBulkTriageBuckets(record: BulkTriageRecord): BulkTriageBucket[] {
  const buckets: BulkTriageBucket[] = ['all'];
  if (record.availability === 'available') buckets.push('available');
  if (typeof record.availability === 'string' && REGISTERED_AVAILABILITY_STATES.has(record.availability)) {
    buckets.push('registered');
  }
  const riskScore = computeRiskScore(record);
  if (riskScore !== null && riskScore >= 70) buckets.push('high_risk');
  if (record.availability === 'error') buckets.push('errors');
  return buckets;
}

export function countBulkTriage(records: readonly BulkTriageRecord[]): Record<BulkTriageBucket, number> {
  const counts: Record<BulkTriageBucket, number> = {
    all: 0,
    available: 0,
    registered: 0,
    high_risk: 0,
    errors: 0,
  };
  for (const record of records) {
    for (const bucket of getBulkTriageBuckets(record)) counts[bucket] += 1;
  }
  return counts;
}

export function matchesBulkTriage(record: BulkTriageRecord, filters: BulkTriageFilters): boolean {
  const { state, mutation, signals } = filters;
  if (state === 'available' && record.availability !== 'available') return false;
  if (
    state === 'registered'
    && (typeof record.availability !== 'string' || !REGISTERED_AVAILABILITY_STATES.has(record.availability))
  ) return false;
  if (state === 'high_risk' && (computeRiskScore(record) ?? -1) < 70) return false;
  if (state === 'errors' && record.availability !== 'error') return false;

  if (mutation && (!Array.isArray(record.mutationTypes) || !record.mutationTypes.includes(mutation))) return false;
  for (const signal of signals) {
    if (!isBulkSignal(signal) || !SIGNAL_MATCHERS[signal](record)) return false;
  }
  return true;
}

export function mutationTriageOptions(
  counts: ReadonlyMap<string, number>,
  labels: Readonly<Record<string, string>>,
): MutationTriageOption[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([value, count]) => ({ value, label: labels[value] || value, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
