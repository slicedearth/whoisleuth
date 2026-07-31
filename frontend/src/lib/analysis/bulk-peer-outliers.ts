import type { ScanResult } from './bulk-result-model.ts';
import { rowsToCsv } from './utils.ts';

export type BulkPeerDimensionId =
  | 'activity'
  | 'address_set'
  | 'certificate_fingerprint'
  | 'cname_set'
  | 'dnssec'
  | 'favicon'
  | 'form_destination'
  | 'mail_posture'
  | 'nameserver_set'
  | 'official_asset_host_set'
  | 'registrar'
  | 'source_coverage'
  | 'technology_set'
  | 'tls_issuer'
  | 'tls_spki'
  | 'tracking_identifier_set';

export type BulkPeerDimension = Readonly<{
  id: BulkPeerDimensionId;
  label: string;
  observedCount: number;
  excludedCount: number;
  baselineValue: string;
  baselineCount: number;
  outlierFrequencyMaximum: number;
}>;

export type BulkPeerOutlier = Readonly<{
  dimension: BulkPeerDimensionId;
  label: string;
  value: string;
  frequency: number;
  observedCount: number;
  baselineValue: string;
}>;

export type BulkPeerOutlierRow = Readonly<{
  domain: string;
  findings: readonly BulkPeerOutlier[];
}>;

export type BulkPeerOutlierMatrix = Readonly<{
  version: 1;
  cohortSize: number;
  dimensions: readonly BulkPeerDimension[];
  rows: readonly BulkPeerOutlierRow[];
  excludedRows: number;
  limitations: readonly string[];
}>;

const MAX_ROWS = 500;
const MIN_COHORT = 3;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;

const DIMENSION_LABELS: Readonly<Record<BulkPeerDimensionId, string>> = Object.freeze({
  activity: 'Website activity',
  address_set: 'Observed address set',
  certificate_fingerprint: 'Leaf certificate fingerprint',
  cname_set: 'CNAME set',
  dnssec: 'DNSSEC publication',
  favicon: 'Favicon fingerprint',
  form_destination: 'External form destination',
  mail_posture: 'Mail posture',
  nameserver_set: 'Nameserver set',
  official_asset_host_set: 'Official asset host set',
  registrar: 'Registrar',
  source_coverage: 'Source coverage',
  technology_set: 'Technology identifier set',
  tls_issuer: 'TLS issuer label',
  tls_spki: 'TLS public-key fingerprint',
  tracking_identifier_set: 'Tracking identifier set',
});

function text(value: unknown, maximum = 300): string {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizedSet(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const values = [...new Set(value
    .map((item) => text(item, 180).toLowerCase().replace(/\.$/u, ''))
    .filter(Boolean))]
    .sort();
  return values.length ? values.join(' | ') : null;
}

function mailPosture(row: ScanResult): string | null {
  const hasMx = row.saved.hasMx;
  const hasNullMx = row.saved.hasNullMx;
  const hasSpf = row.saved.hasSpf;
  const hasDmarc = row.saved.hasDmarc;
  if ([hasMx, hasNullMx, hasSpf, hasDmarc].every((value) => value === null || value === undefined)) return null;
  return [
    hasNullMx === true ? 'null MX' : hasMx === true ? 'MX present' : hasMx === false ? 'no MX observed' : 'MX unknown',
    hasSpf === true ? 'SPF' : hasSpf === false ? 'no SPF observed' : 'SPF unknown',
    hasDmarc === true ? 'DMARC' : hasDmarc === false ? 'no DMARC observed' : 'DMARC unknown',
  ].join(' · ');
}

function sourceCoverage(row: ScanResult): string | null {
  const values = row.sourceCoverage
    .map((item) => `${text(item.source, 40)}:${text(item.state, 40)}`)
    .filter((item) => !item.endsWith(':'))
    .sort();
  return values.length ? values.join(' | ') : null;
}

function dimensionValue(row: ScanResult, dimension: BulkPeerDimensionId): string | null {
  if (dimension === 'registrar') return text(row.registrar, 180) || null;
  if (dimension === 'nameserver_set') return normalizedSet(row.nameservers);
  if (dimension === 'mail_posture') return mailPosture(row);
  if (dimension === 'activity') return text(row.activity, 80) || null;
  if (dimension === 'dnssec') return text(row.dnssec, 80) || null;
  if (dimension === 'favicon') return text(row.faviconHash, 128) || null;
  if (dimension === 'form_destination') {
    return row.hasExternalFormAction === null
      ? null
      : row.hasExternalFormAction ? 'External form action observed' : 'No external form action observed';
  }
  if (dimension === 'address_set') {
    return normalizedSet([...(row.dns?.records.a ?? []), ...(row.dns?.records.aaaa ?? [])]);
  }
  if (dimension === 'cname_set') return normalizedSet(row.dns?.records.cname);
  if (dimension === 'certificate_fingerprint') {
    return text(row.relationship.certificateFingerprint, 128).toLowerCase() || null;
  }
  if (dimension === 'official_asset_host_set') {
    return normalizedSet(row.relationship.officialAssetHosts);
  }
  if (dimension === 'tracking_identifier_set') {
    return normalizedSet(row.relationship.trackingIdentifiers);
  }
  if (dimension === 'technology_set') {
    return normalizedSet(row.comparisonEvidence?.technology.ids);
  }
  if (dimension === 'tls_issuer') {
    return text(row.comparisonEvidence?.tls.issuerLabel, 240).toLowerCase() || null;
  }
  if (dimension === 'tls_spki') {
    return text(row.comparisonEvidence?.tls.spkiSha256, 64).toLowerCase() || null;
  }
  return sourceCoverage(row);
}

function frequencyMap(values: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const value of values) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  return frequencies;
}

export function buildBulkPeerOutlierMatrix(rows: readonly ScanResult[]): BulkPeerOutlierMatrix {
  const cohort = rows.slice(0, MAX_ROWS);
  const truncated = rows.length > cohort.length;
  const dimensions = (Object.keys(DIMENSION_LABELS) as BulkPeerDimensionId[]);
  const dimensionSummaries: BulkPeerDimension[] = [];
  const rowFindings = new Map<string, BulkPeerOutlier[]>();

  if (cohort.length >= MIN_COHORT) {
    for (const dimension of dimensions) {
      const observations = cohort.flatMap((row) => {
        const value = dimensionValue(row, dimension);
        return value ? [{ domain: row.domain, value }] : [];
      });
      const frequencies = frequencyMap(observations.map((item) => item.value));
      const ranked = [...frequencies.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      const baseline = ranked[0];
      if (!baseline || observations.length < MIN_COHORT) continue;
      const majorityRequired = Math.ceil(observations.length * 0.5);
      const outlierMaximum = Math.max(1, Math.floor(observations.length * 0.2));
      dimensionSummaries.push({
        id: dimension,
        label: DIMENSION_LABELS[dimension],
        observedCount: observations.length,
        excludedCount: cohort.length - observations.length,
        baselineValue: baseline[0],
        baselineCount: baseline[1],
        outlierFrequencyMaximum: outlierMaximum,
      });
      if (baseline[1] < majorityRequired) continue;
      for (const observation of observations) {
        const frequency = frequencies.get(observation.value) ?? 0;
        if (observation.value === baseline[0] || frequency > outlierMaximum) continue;
        const findings = rowFindings.get(observation.domain) ?? [];
        findings.push({
          dimension,
          label: DIMENSION_LABELS[dimension],
          value: observation.value,
          frequency,
          observedCount: observations.length,
          baselineValue: baseline[0],
        });
        rowFindings.set(observation.domain, findings);
      }
    }
  }

  const outputRows = cohort
    .flatMap((row) => {
      const findings = rowFindings.get(row.domain);
      return findings?.length
        ? [{
            domain: row.domain,
            findings: findings.sort((left, right) => left.label.localeCompare(right.label)),
          }]
        : [];
    })
    .sort((left, right) => right.findings.length - left.findings.length || left.domain.localeCompare(right.domain));

  return {
    version: 1,
    cohortSize: cohort.length,
    dimensions: dimensionSummaries,
    rows: outputRows,
    excludedRows: rows.length - cohort.length,
    limitations: [
      'Outliers are low-frequency values relative only to the current analyst-selected and filtered cohort.',
      'An uncommon value does not establish maliciousness, ownership, control, or misconfiguration.',
      'Unavailable and unrecorded values are excluded rather than treated as differences.',
      'The matrix uses existing compact Bulk evidence and does not start additional requests.',
      ...(truncated ? [`The comparison was capped at ${MAX_ROWS} rows.`] : []),
    ],
  };
}

export function buildBulkPeerOutlierExport(
  matrix: BulkPeerOutlierMatrix,
  generatedAt: string,
): Readonly<{ content: string; filename: string }> {
  const rows: unknown[][] = [[
    'domain',
    'dimension',
    'observed_value',
    'local_frequency',
    'observed_cohort',
    'cohort_baseline',
  ]];
  for (const row of matrix.rows) {
    for (const finding of row.findings) {
      rows.push([
        row.domain,
        finding.label,
        finding.value,
        finding.frequency,
        finding.observedCount,
        finding.baselineValue,
      ]);
    }
  }
  return {
    content: rowsToCsv(rows),
    filename: `whoisleuth-bulk-peer-outliers-${generatedAt.slice(0, 10)}.csv`,
  };
}
