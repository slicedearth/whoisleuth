// Pure filter and grouping projections for compact Bulk observations. These
// helpers never infer missing evidence, issue requests, or qualify shared
// infrastructure as ownership or coordination.

import { classifyBulkSourceCoverage } from './bulk-source-coverage.ts';

export const BULK_GROUP_LIMIT = 200;
export const BULK_GROUP_DOMAIN_LIMIT = 2_000;

export type BulkSourceFilter = '' | 'complete' | 'limited' | 'unrecorded';
export type BulkAgeFilter = '' | 'new_30' | 'new_365' | 'older_365' | 'unknown';
export type BulkMailFilter = '' | 'mail' | 'no_mail' | 'authenticated' | 'auth_gap' | 'unknown';
export type BulkGroupBy = '' | 'mutation' | 'tld' | 'registrar' | 'nameserver';

export type BulkTriageSource = {
  source: string;
  state: string;
};

export type BulkTriageRow = {
  domain: string;
  availability: string;
  registrar: string;
  mutationTypes: string[];
  nameservers: string[];
  sourceCoverage: BulkTriageSource[];
  createdDate: string | null;
  hasMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
  caseDisposition: string;
};

export type BulkAdvancedFilters = {
  source: BulkSourceFilter;
  lifecycle: string;
  age: BulkAgeFilter;
  mail: BulkMailFilter;
  registrar: string;
  caseDisposition: string;
};

export type BulkTriageGroup = {
  key: string;
  label: string;
  domains: string[];
};

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
function text(value: unknown, maximum = 300): string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_RE.test(value)
    ? value.trim()
    : '';
}

function sourceClass(row: BulkTriageRow): Exclude<BulkSourceFilter, ''> {
  return classifyBulkSourceCoverage(row.domain, row.sourceCoverage);
}

function ageClass(row: BulkTriageRow, nowMs: number): Exclude<BulkAgeFilter, ''> {
  const createdMs = row.createdDate ? Date.parse(row.createdDate) : Number.NaN;
  if (!Number.isFinite(createdMs) || createdMs > nowMs) return 'unknown';
  const days = (nowMs - createdMs) / 86_400_000;
  if (days <= 30) return 'new_30';
  if (days <= 365) return 'new_365';
  return 'older_365';
}

function matchesMail(row: BulkTriageRow, filter: BulkMailFilter): boolean {
  if (!filter) return true;
  if (filter === 'unknown') return row.hasMx === null || row.hasSpf === null || row.hasDmarc === null;
  if (filter === 'mail') return row.hasMx === true;
  if (filter === 'no_mail') return row.hasMx === false;
  if (filter === 'authenticated') return row.hasMx === true && row.hasSpf === true && row.hasDmarc === true;
  return row.hasMx === true && (row.hasSpf === false || row.hasDmarc === false);
}

export function matchesBulkAdvancedFilters(
  row: BulkTriageRow,
  filters: BulkAdvancedFilters,
  nowMs = Date.now(),
): boolean {
  if (filters.source && sourceClass(row) !== filters.source) return false;
  if (filters.lifecycle && row.availability !== filters.lifecycle) return false;
  if (filters.age && ageClass(row, nowMs) !== filters.age) return false;
  if (!matchesMail(row, filters.mail)) return false;
  if (filters.registrar && row.registrar !== filters.registrar) return false;
  if (filters.caseDisposition && row.caseDisposition !== filters.caseDisposition) return false;
  return true;
}

export function bulkAdvancedFilterOptions(rows: readonly BulkTriageRow[]) {
  const lifecycle = new Set<string>();
  const registrars = new Set<string>();
  const caseDispositions = new Set<string>();
  for (const row of rows.slice(0, BULK_GROUP_DOMAIN_LIMIT)) {
    const lifecycleValue = text(row.availability, 40);
    const registrar = text(row.registrar);
    const disposition = text(row.caseDisposition, 40);
    if (lifecycleValue) lifecycle.add(lifecycleValue);
    if (registrar && registrar !== '—') registrars.add(registrar);
    if (disposition) caseDispositions.add(disposition);
  }
  return {
    lifecycle: [...lifecycle].sort(),
    registrars: [...registrars].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
    caseDispositions: [...caseDispositions].sort(),
  };
}

function registrableEnding(domain: string): string {
  const labels = domain.toLowerCase().split('.').filter(Boolean);
  return labels.length ? `.${labels.at(-1)}` : '';
}

function nameserverKey(row: BulkTriageRow): string {
  return [...new Set(row.nameservers.map((value) => text(value, 253).toLowerCase().replace(/\.$/u, '')).filter(Boolean))]
    .sort()
    .join(' + ');
}

function groupValues(row: BulkTriageRow, groupBy: BulkGroupBy): Array<{ key: string; label: string }> {
  if (groupBy === 'mutation') {
    return [...new Set(row.mutationTypes.map((value) => text(value, 80)).filter(Boolean))]
      .map((value) => ({ key: value, label: value.replaceAll('_', ' ') }));
  }
  if (groupBy === 'tld') {
    const value = registrableEnding(row.domain);
    return value ? [{ key: value, label: value }] : [];
  }
  if (groupBy === 'registrar') {
    const value = text(row.registrar);
    return value && value !== '—' ? [{ key: value.toLowerCase(), label: value }] : [];
  }
  if (groupBy === 'nameserver') {
    const value = nameserverKey(row);
    return value ? [{ key: value, label: value }] : [];
  }
  return [];
}

export function buildBulkTriageGroups(rows: readonly BulkTriageRow[], groupBy: BulkGroupBy) {
  if (!groupBy) return { groups: [] as BulkTriageGroup[], excluded: 0, truncated: false, overlapping: false };
  const groups = new Map<string, BulkTriageGroup>();
  let excluded = 0;
  let truncated = rows.length > BULK_GROUP_DOMAIN_LIMIT;
  for (const row of rows.slice(0, BULK_GROUP_DOMAIN_LIMIT)) {
    const values = groupValues(row, groupBy);
    if (!values.length) {
      excluded += 1;
      continue;
    }
    for (const value of values) {
      if (!groups.has(value.key)) {
        if (groups.size >= BULK_GROUP_LIMIT) {
          truncated = true;
          continue;
        }
        groups.set(value.key, { key: value.key, label: value.label, domains: [] });
      }
      const group = groups.get(value.key);
      if (group && group.domains.length < BULK_GROUP_DOMAIN_LIMIT && !group.domains.includes(row.domain)) {
        group.domains.push(row.domain);
      }
    }
  }
  return {
    groups: [...groups.values()].sort((left, right) => right.domains.length - left.domains.length || left.label.localeCompare(right.label)),
    excluded,
    truncated,
    overlapping: groupBy === 'mutation',
  };
}
