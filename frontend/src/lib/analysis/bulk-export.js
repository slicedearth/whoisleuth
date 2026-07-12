// Framework-neutral helpers for shaping bulk-scan results into CSV columns.
// Kept out of the route script so the column contract is node --test-able and
// the export stays formula-safe via the shared toCsvValue helper.

// Observed CT hostnames are a list inside a single CSV cell; this pipe keeps
// them one field (a comma would be re-quoted by toCsvValue but read as a list
// by spreadsheets). Documented so importers can split on it deterministically.
export const CT_HOSTNAME_CSV_DELIMITER = '|';

/**
 * The four optional Certificate Transparency columns for one bulk row, in
 * header order: [ct_first_observed, ct_last_observed, ct_certificate_count,
 * ct_hostnames]. Ordinary (non-CT) rows produce four empty strings so the
 * columns stay stable and aligned across the whole export. Never introduces a
 * spreadsheet-formula trigger of its own; the caller still passes every value
 * through toCsvValue for neutralization and quoting.
 * @param {{ firstObservedAt?: string|null, lastObservedAt?: string|null, certificateCount?: number|null, hostnames?: string[] } | null | undefined} ct
 * @returns {[string, string, string, string]}
 */
export function ctCsvFields(ct) {
  if (!ct) return ['', '', '', ''];
  return [
    ct.firstObservedAt || '',
    ct.lastObservedAt || '',
    ct.certificateCount == null ? '' : String(ct.certificateCount),
    Array.isArray(ct.hostnames) ? ct.hostnames.join(CT_HOSTNAME_CSV_DELIMITER) : '',
  ];
}
