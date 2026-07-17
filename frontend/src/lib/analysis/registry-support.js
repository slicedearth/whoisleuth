import {
  REGISTRY_CAPABILITIES_VERSION,
  registryCompatibilityMatrix,
} from '../../../../lib/registry-capabilities.mts';

export const MAX_REGISTRY_SUPPORT_ROWS = 500;
export const MAX_REGISTRY_SUPPORT_FILTER_LENGTH = 100;

const COVERAGE_LABELS = Object.freeze({
  discovery_only: 'Discovery only',
  access_documented: 'Access documented',
  fixture_verified: 'Fixture verified',
});

const ACCESS_LABELS = Object.freeze({
  'iana-bootstrap': 'IANA bootstrap discovery',
  'iana-referral': 'IANA referral discovery',
  'no-iana-service': 'No service published by IANA',
  'source-ip-authorization-required': 'Source-IP authorization required',
});

/** @param {unknown} value */
export function registrySupportLabel(value) {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 128)
    : '';
  if (!text) return 'Unknown';
  return text.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/** @param {unknown} value */
export function registryAccessLabel(value) {
  return typeof value === 'string' && Object.hasOwn(ACCESS_LABELS, value)
    ? ACCESS_LABELS[value]
    : 'Unknown';
}

/** @param {unknown} value */
export function registryCoverageLabel(value) {
  return typeof value === 'string' && Object.hasOwn(COVERAGE_LABELS, value)
    ? COVERAGE_LABELS[value]
    : 'Unknown';
}

export function registrySupportCatalogue() {
  const sourceRows = registryCompatibilityMatrix();
  const rows = sourceRows.slice(0, MAX_REGISTRY_SUPPORT_ROWS);
  return {
    version: REGISTRY_CAPABILITIES_VERSION,
    rows,
    truncated: sourceRows.length > rows.length,
    summary: {
      profiles: rows.length,
      fixtureVerified: rows.filter((row) => row.coverageState === 'fixture_verified').length,
      accessDocumented: rows.filter((row) => row.coverageState === 'access_documented').length,
      fallbacks: rows.filter((row) => Boolean(row.fallbackProfile)).length,
    },
  };
}

/**
 * @param {ReturnType<typeof registryCompatibilityMatrix>} rows
 * @param {unknown} query
 * @param {unknown} coverage
 */
export function filterRegistrySupportRows(rows, query, coverage) {
  const boundedRows = Array.isArray(rows) ? rows.slice(0, MAX_REGISTRY_SUPPORT_ROWS) : [];
  const normalizedQuery = typeof query === 'string'
    ? query.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_REGISTRY_SUPPORT_FILTER_LENGTH).toLowerCase()
    : '';
  const searchableQuery = normalizedQuery.startsWith('.') ? normalizedQuery.slice(1) : normalizedQuery;
  const normalizedCoverage = ['fixture_verified', 'access_documented'].includes(String(coverage))
    ? String(coverage)
    : 'all';
  return boundedRows.filter((row) => {
    if (normalizedCoverage !== 'all' && row.coverageState !== normalizedCoverage) return false;
    if (!searchableQuery) return true;
    return [
      row.suffixes[0], row.id, row.registryClass, row.coverageState,
      row.whoisQueryProfile, row.whoisParserProfile, row.fallbackProfile,
      row.whoisAccessProfile, row.rdapAccessProfile, row.limitation,
      ...row.fixtureScenarios,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(searchableQuery));
  });
}
