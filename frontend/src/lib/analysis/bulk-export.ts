// Framework-neutral helpers for shaping bulk-scan results into CSV columns.
// Kept out of the route script so the column contract is node --test-able and
// the export stays formula-safe via the shared toCsvValue helper.

// Observed CT hostnames are a list inside a single CSV cell; this pipe keeps
// them one field (a comma would be re-quoted by toCsvValue but read as a list
// by spreadsheets). Documented so importers can split on it deterministically.
export const CT_HOSTNAME_CSV_DELIMITER = '|';

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
