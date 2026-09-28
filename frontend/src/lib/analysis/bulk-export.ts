import type { ScanResult } from './bulk-result-model.ts';
import type { buildCoverageReport } from './coverage.ts';
import { rowsToCsv } from './utils.ts';

// Observed CT hostnames are a list inside a single CSV cell; this pipe keeps
// them one field (a comma would be re-quoted by toCsvValue but read as a list
// by spreadsheets). Documented so importers can split on it deterministically.
export const CT_HOSTNAME_CSV_DELIMITER = '|';

/** Group counts may overlap; candidate rows retain their individual outcomes. */
export function buildBulkCoverageCsv(report: ReturnType<typeof buildCoverageReport>): string {
  const groups = (dimension: string, values: typeof report.mutationGroups) => values.map(group => [
    dimension, group.label, group.total, group.registered, group.available, group.unknown,
    group.profileListed, group.profileListedShare, '', '', '', '', '', '',
  ]);
  return rowsToCsv([
    ['dimension', 'group', 'total', 'registered', 'available', 'unknown', 'profile_listed_overlapping',
      'profile_listed_share', 'domain', 'outcome', 'profile_listed', 'priority', 'action', 'rationale'],
    ...groups('mutation', report.mutationGroups),
    ...groups('tld', report.tldGroups),
    ...report.plan.map(row => ['candidate', '', '', '', '', '', '', '', row.domain, row.status,
      row.profileListed ? 'true' : 'false', row.priority, row.actionLabel, row.rationale]),
  ]);
}

/** Complete result export. Cells share the formula-safe CSV writer. */
export function buildBulkResultsCsv(selected: readonly ScanResult[]): string {
  const header = [
    'domain', 'unicode_domain', 'idn_scripts', 'idn_mixed_script', 'idn_official_skeleton_matches',
    'availability', 'confidence', 'profile_context_state', 'profile_context_limitation', 'profile_status',
    'registrar', 'activity', ...BULK_SCORE_CSV_HEADERS, 'mutations', 'error', 'dns_status', 'dnssec',
    'dns_a', 'dns_aaaa', 'dns_cname', 'dns_caa', 'technology_ids', 'tls_issuer', 'tls_spki_sha256',
    'ct_first_observed', 'ct_last_observed', 'ct_certificate_count', 'ct_hostnames',
  ];
  const rows = selected.map(row => {
    const contextReady = row.saved.profileContext.sourceState === 'ready';
    return [
      row.domain, row.idn?.hasIdn ? row.idn.unicodeDomain : '', row.idn?.scripts?.join('|') || '',
      row.idn?.mixedScript ? 'true' : 'false',
      contextReady ? row.idn?.referenceMatches?.map(match => match.asciiDomain).join('|') || '' : '',
      row.availability, row.confidence, row.saved.profileContext.sourceState, row.saved.profileContext.limitation,
      contextReady ? row.trusted || '' : '', row.registrar, row.activity, ...bulkScoreCsvFields(row),
      row.mutationTypes.join('|'), row.error, row.dns?.status || '', row.dnssec || '',
      row.dns?.records.a.join('|') || '', row.dns?.records.aaaa.join('|') || '', row.dns?.records.cname.join('|') || '',
      row.dns?.records.caa.map(item => `${item.critical} ${item.tag} ${item.value}`).join('|') || '',
      row.comparisonEvidence?.technology.ids.join('|') || '', row.comparisonEvidence?.tls.issuerLabel || '',
      row.comparisonEvidence?.tls.spkiSha256 || '', ...ctCsvFields(row.ct),
    ];
  });
  return rowsToCsv([header, ...rows]);
}

export const BULK_SCORE_CSV_HEADERS = Object.freeze([
  'risk',
  'risk_model_version',
  'risk_factors',
  'opportunity',
  'opportunity_model_version',
] as const);

export type BulkScoreCsvInput = Readonly<{
  risk?: number | null;
  opportunity?: number | null;
  saved?: Readonly<{
    riskModelVersion?: number | null;
    opportunityModelVersion?: number | null;
    riskFactors?: readonly Readonly<{ label: string; points: number }>[];
  }>;
}>;

export type BulkScoreCsvFields = [number | '', number | '', string, number | '', number | ''];

/** Keeps the retained score/model cells aligned even when Opportunity is hidden in Bulk's UI. */
export function bulkScoreCsvFields(result: BulkScoreCsvInput): BulkScoreCsvFields {
  return [
    typeof result.risk === 'number' && Number.isFinite(result.risk) ? result.risk : '',
    typeof result.saved?.riskModelVersion === 'number' && Number.isFinite(result.saved.riskModelVersion)
      ? result.saved.riskModelVersion
      : '',
    result.saved?.riskFactors?.map((factor) => (
      `${factor.label} ${Number(factor.points) >= 0 ? '+' : ''}${factor.points}`
    )).join('; ') || '',
    typeof result.opportunity === 'number' && Number.isFinite(result.opportunity) ? result.opportunity : '',
    typeof result.saved?.opportunityModelVersion === 'number' && Number.isFinite(result.saved.opportunityModelVersion)
      ? result.saved.opportunityModelVersion
      : '',
  ];
}

export type CertificateTransparencyCsvInput = {
  firstObservedAt?: string | null;
  lastObservedAt?: string | null;
  certificateCount?: number | null;
  hostnames?: string[];
};

export type CertificateTransparencyCsvFields = [string, string, string, string];

/**
 * The four optional Certificate Transparency columns for one bulk row, in
 * header order: [ct_first_observed, ct_last_observed, ct_certificate_count,
 * ct_hostnames]. Ordinary (non-CT) rows produce four empty strings so the
 * columns stay stable and aligned across the whole export. Never introduces a
 * spreadsheet-formula trigger of its own; the caller still passes every value
 * through toCsvValue for neutralization and quoting.
 */
export function ctCsvFields(
  ct: CertificateTransparencyCsvInput | null | undefined,
): CertificateTransparencyCsvFields {
  if (!ct) return ['', '', '', ''];
  return [
    ct.firstObservedAt || '',
    ct.lastObservedAt || '',
    ct.certificateCount == null ? '' : String(ct.certificateCount),
    Array.isArray(ct.hostnames) ? ct.hostnames.join(CT_HOSTNAME_CSV_DELIMITER) : '',
  ];
}
