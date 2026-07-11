// Pure bulk-result triage helpers. Keeping matching and count logic outside
// bulk.js makes the UI inexpensive to update per incoming scan result and
// gives the filter semantics direct unit-test coverage.

import { computeRiskScore } from './scoring.js';

export const REGISTERED_AVAILABILITY_STATES = new Set(['registered', 'for_sale', 'expiring']);

const SIGNAL_MATCHERS = {
  favicon: (record) => record.faviconMatch === true,
  password: (record) => record.hasPasswordField === true,
  phishing: (record) => Boolean(record.phishingLanguageMatch),
  asset_reuse: (record) => record.reusesOfficialAssets === true,
};

/** @param {object} record */
export function getBulkTriageBuckets(record) {
  const buckets = ['all'];
  if (record.availability === 'available') buckets.push('available');
  if (REGISTERED_AVAILABILITY_STATES.has(record.availability)) buckets.push('registered');
  const riskScore = computeRiskScore(record);
  if (riskScore !== null && riskScore >= 70) buckets.push('high_risk');
  if (record.availability === 'error') buckets.push('errors');
  return buckets;
}

/** @param {object[]} records */
export function countBulkTriage(records) {
  const counts = { all: 0, available: 0, registered: 0, high_risk: 0, errors: 0 };
  for (const record of records) {
    for (const bucket of getBulkTriageBuckets(record)) counts[bucket] += 1;
  }
  return counts;
}

/**
 * @param {object} record
 * @param {{ state: string, mutation: string, signals: Set<string> }} filters
 */
export function matchesBulkTriage(record, filters) {
  const { state, mutation, signals } = filters;
  if (state === 'available' && record.availability !== 'available') return false;
  if (state === 'registered' && !REGISTERED_AVAILABILITY_STATES.has(record.availability)) return false;
  if (state === 'high_risk' && (computeRiskScore(record) ?? -1) < 70) return false;
  if (state === 'errors' && record.availability !== 'error') return false;

  if (mutation && (!Array.isArray(record.mutationTypes) || !record.mutationTypes.includes(mutation))) return false;
  for (const signal of signals) {
    if (!SIGNAL_MATCHERS[signal]?.(record)) return false;
  }
  return true;
}

/**
 * @param {Map<string, number>} counts
 * @param {Record<string, string>} labels
 */
export function mutationTriageOptions(counts, labels) {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([value, count]) => ({ value, label: labels[value] || value, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
