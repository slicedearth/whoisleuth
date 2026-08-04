import {
  REGISTRY_CAPABILITIES_VERSION,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  registryStandardsCoverageSnapshot,
} from '../../../../lib/registry-capabilities.mts';
import type {
  RegistryCompatibilityRow,
} from '../../../../lib/registry-capabilities.mts';

export const MAX_REGISTRY_SUPPORT_ROWS = 500;
export const MAX_REGISTRY_SUPPORT_FILTER_LENGTH = 100;
export const MAX_REGISTRY_SUPPORT_LOOKUP_LENGTH = 253;
export const REGISTRY_SUPPORT_SORT_KEYS = Object.freeze([
  'suffix',
  'coverage',
  'registry_class',
  'service_path',
  'rdap_access',
  'whois_access',
  'whois_query',
] as const);
export type RegistrySupportSortKey = typeof REGISTRY_SUPPORT_SORT_KEYS[number];
export const REGISTRY_SERVICE_COVERAGE_FILTERS = Object.freeze([
  'all',
  'both',
  'rdap_only',
  'whois_only',
  'neither',
] as const);
export type RegistryServiceCoverage = Exclude<typeof REGISTRY_SERVICE_COVERAGE_FILTERS[number], 'all'>;

const COVERAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  discovery_only: 'Discovery only',
  access_documented: 'Access documented',
  fixture_verified: 'Fixture verified',
});

const ACCESS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'iana-bootstrap': 'IANA bootstrap discovery',
  'iana-referral': 'IANA referral discovery',
  'no-iana-service': 'No service published by IANA',
  'registry-policy-restricted': 'Registry policy restricted',
  'source-ip-authorization-required': 'Source-IP authorisation required',
});

export function registrySupportLabel(value: unknown): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 128)
    : '';
  if (!text) return 'Unknown';
  return text.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function registryAccessLabel(value: unknown): string {
  return typeof value === 'string' && Object.hasOwn(ACCESS_LABELS, value)
    ? ACCESS_LABELS[value] ?? 'Unknown'
    : 'Unknown';
}

export function registryCoverageLabel(value: unknown): string {
  return typeof value === 'string' && Object.hasOwn(COVERAGE_LABELS, value)
    ? COVERAGE_LABELS[value] ?? 'Unknown'
    : 'Unknown';
}

export function registryServiceCoverage(
  row: Pick<RegistryCompatibilityRow, 'rdapAccessProfile' | 'whoisAccessProfile'>,
): RegistryServiceCoverage {
  const rdapAvailable = row.rdapAccessProfile !== 'no-iana-service';
  const whoisAvailable = row.whoisAccessProfile !== 'no-iana-service';
  if (rdapAvailable && whoisAvailable) return 'both';
  if (rdapAvailable) return 'rdap_only';
  if (whoisAvailable) return 'whois_only';
  return 'neither';
}

export function registryServiceCoverageLabel(value: unknown): string {
  return ({
    both: 'RDAP and WHOIS paths',
    rdap_only: 'RDAP only',
    whois_only: 'WHOIS path only',
    neither: 'No IANA-published service',
  } as Readonly<Record<string, string>>)[String(value)] ?? 'Unknown';
}

export function registrySupportCatalogue() {
  const sourceRows = registryCompatibilityMatrix();
  const rows = sourceRows.slice(0, MAX_REGISTRY_SUPPORT_ROWS);
  const standardsCoverage = registryStandardsCoverageSnapshot();
  const serviceCoverage = {
    both: rows.filter((row) => registryServiceCoverage(row) === 'both').length,
    rdapOnly: rows.filter((row) => registryServiceCoverage(row) === 'rdap_only').length,
    whoisOnly: rows.filter((row) => registryServiceCoverage(row) === 'whois_only').length,
    neither: rows.filter((row) => registryServiceCoverage(row) === 'neither').length,
  };
  return {
    version: REGISTRY_CAPABILITIES_VERSION,
    rows,
    truncated: sourceRows.length > rows.length,
    standardsCoverage,
    summary: {
      profiles: rows.length,
      fixtureVerified: rows.filter((row) => row.coverageState === 'fixture_verified').length,
      accessDocumented: rows.filter((row) => row.coverageState === 'access_documented').length,
      serviceCoverage,
    },
  };
}

export function inspectRegistrySupport(value: unknown): {
  state: 'invalid' | 'empty';
  profile: null;
} | {
  state: 'resolved';
  profile: RegistryCompatibilityRow;
} {
  if (typeof value !== 'string' || value.length > MAX_REGISTRY_SUPPORT_LOOKUP_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)) {
    return { state: 'invalid', profile: null };
  }
  const trimmed = value.trim();
  if (!trimmed) return { state: 'empty', profile: null };
  const profile = registryCapabilityFor(trimmed);
  return profile
    ? { state: 'resolved', profile }
    : { state: 'invalid', profile: null };
}

export function filterRegistrySupportRows(
  rows: readonly RegistryCompatibilityRow[] | null,
  query: unknown,
  coverage: unknown,
  serviceCoverage: unknown = 'all',
): RegistryCompatibilityRow[] {
  const boundedRows = Array.isArray(rows) ? rows.slice(0, MAX_REGISTRY_SUPPORT_ROWS) : [];
  const normalizedQuery = typeof query === 'string'
    ? query.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_REGISTRY_SUPPORT_FILTER_LENGTH).toLowerCase()
    : '';
  const searchableQuery = (normalizedQuery.startsWith('.') ? normalizedQuery.slice(1) : normalizedQuery)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const normalizedCoverage = ['fixture_verified', 'access_documented'].includes(String(coverage))
    ? String(coverage)
    : 'all';
  const normalizedServiceCoverage = (REGISTRY_SERVICE_COVERAGE_FILTERS as readonly string[])
    .includes(String(serviceCoverage))
    ? String(serviceCoverage)
    : 'all';
  return boundedRows.filter((row) => {
    if (normalizedCoverage !== 'all' && row.coverageState !== normalizedCoverage) return false;
    if (normalizedServiceCoverage !== 'all' && registryServiceCoverage(row) !== normalizedServiceCoverage) return false;
    if (!searchableQuery) return true;
    return [
      row.suffixes[0], row.id, row.registryClass, row.coverageState,
      row.whoisQueryProfile, row.whoisParserProfile,
      row.whoisAccessProfile, row.rdapAccessProfile, row.limitation,
      ...row.fixtureScenarios,
    ].filter(Boolean).some((value) => String(value).toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .includes(searchableQuery));
  });
}

export function sortRegistrySupportRows(
  rows: readonly RegistryCompatibilityRow[] | null,
  sortKey: unknown,
  direction: unknown,
): RegistryCompatibilityRow[] {
  const boundedRows = Array.isArray(rows) ? rows.slice(0, MAX_REGISTRY_SUPPORT_ROWS) : [];
  const requestedKey = String(sortKey);
  const normalizedKey: RegistrySupportSortKey = (
    (REGISTRY_SUPPORT_SORT_KEYS as readonly string[]).includes(requestedKey)
      ? requestedKey
      : 'suffix'
  ) as RegistrySupportSortKey;
  const multiplier = direction === 'desc' ? -1 : 1;
  const valueFor = (row: RegistryCompatibilityRow): string | null => {
    if (normalizedKey === 'coverage') return row.coverageState;
    if (normalizedKey === 'registry_class') return row.registryClass;
    if (normalizedKey === 'service_path') return registryServiceCoverage(row);
    if (normalizedKey === 'rdap_access') return row.rdapAccessProfile;
    if (normalizedKey === 'whois_access') return row.whoisAccessProfile;
    if (normalizedKey === 'whois_query') return row.whoisQueryProfile;
    return row.suffixes[0] ?? null;
  };
  return boundedRows.sort((left, right) => {
    const comparison = String(valueFor(left) || '').localeCompare(String(valueFor(right) || ''), 'en', {
      sensitivity: 'base',
      numeric: true,
    });
    if (comparison) return comparison * multiplier;
    return String(left.suffixes[0] || '').localeCompare(String(right.suffixes[0] || ''), 'en', {
      sensitivity: 'base',
      numeric: true,
    }) * multiplier;
  });
}
