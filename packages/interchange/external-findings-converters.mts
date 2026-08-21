import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDINGS,
  parseExternalFindingsDocument,
  type ExternalFindingCategory,
  type ExternalFindingsDocument,
} from './external-findings-import.mts';
import {
  CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
  DNS_OBSERVATION_ROWS_SCHEMA,
  DOMAIN_OBSERVATION_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_VERSION,
  MAX_CONVERSION_INPUT_ROWS,
  SUPPORTED_OBSERVATION_ROWS_VERSION,
} from '../contracts/external-observation-interchange.mts';

export {
  CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
  DNS_OBSERVATION_ROWS_SCHEMA,
  DOMAIN_OBSERVATION_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_VERSION,
  MAX_CONVERSION_INPUT_ROWS,
  SUPPORTED_OBSERVATION_ROWS_VERSION,
};
export const EXTERNAL_FINDING_CSV_COLUMNS = [
  'domain',
  'category',
  'summary',
  'observed_at',
  'completeness',
  'limitation',
  'reference',
] as const;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const MAX_CSV_COLUMNS = EXTERNAL_FINDING_CSV_COLUMNS.length;
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const DNS_TYPES = new Set(['A', 'AAAA', 'CAA', 'CNAME', 'DS', 'MX', 'NS', 'SOA', 'SVCB', 'HTTPS', 'TXT']);

export type ExternalFindingConversionFormat =
  | 'certificate-observations-v1'
  | 'dns-observations-v1'
  | 'domain-observations-v1';

export type ExternalFindingConversionReport = Readonly<{
  format: ExternalFindingConversionFormat;
  document: ExternalFindingsDocument;
  inputRows: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  truncated: boolean;
  exclusions: readonly Readonly<{ row: number; reason: string }>[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sourceName(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' && !CONTROL_RE.test(value)
    ? value.replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';
  return candidate || fallback.replace(/\s+/g, ' ').trim().slice(0, 80) || 'External findings';
}

function rowsDocument(rows: readonly unknown[], source: string): ExternalFindingsDocument {
  if (!rows.length || rows.length > MAX_EXTERNAL_FINDINGS) {
    throw new Error(`Converted findings must contain between 1 and ${MAX_EXTERNAL_FINDINGS} rows.`);
  }
  const findings = rows.map((raw, index) => {
    const item = record(raw);
    if (!item) throw new Error(`Converted finding row ${index + 1} must be an object.`);
    const limitation = typeof item.limitation === 'string' && item.limitation.trim()
      ? [item.limitation]
      : Array.isArray(item.limitations)
        ? item.limitations
        : [];
    return {
      domain: item.domain,
      category: item.category,
      evidenceClass: item.evidenceClass ?? 'provider_report',
      summary: item.summary,
      observedAt: item.observed_at ?? item.observedAt,
      completeness: item.completeness ?? 'unknown',
      limitations: limitation,
      reference: item.reference ?? null,
      structuredObservation: item.structuredObservation ?? null,
    };
  });
  return parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: source, reference: null, collectedAt: null },
    findings,
  });
}

export function convertExternalFindingRows(value: unknown, fallbackSource = 'External findings'): ExternalFindingsDocument {
  if (Array.isArray(value)) return rowsDocument(value, sourceName(null, fallbackSource));
  const root = record(value);
  if (
    !root
    || root.schema !== EXTERNAL_FINDING_ROWS_SCHEMA
    || root.schemaVersion !== EXTERNAL_FINDING_ROWS_VERSION
    || !Array.isArray(root.rows)
  ) {
    throw new Error(`Converted JSON must be an array or ${EXTERNAL_FINDING_ROWS_SCHEMA} schema version ${EXTERNAL_FINDING_ROWS_VERSION}.`);
  }
  const source = record(root.source);
  return rowsDocument(root.rows, sourceName(source?.name, fallbackSource));
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function requiredText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function supportedRowsRoot(
  value: unknown,
  schema: string,
): Readonly<{ rows: readonly unknown[]; source: string }> {
  const root = record(value);
  if (
    !root
    || root.schema !== schema
    || root.schemaVersion !== SUPPORTED_OBSERVATION_ROWS_VERSION
    || !Array.isArray(root.observations)
  ) {
    throw new Error(`${schema} schema version ${SUPPORTED_OBSERVATION_ROWS_VERSION} is required.`);
  }
  const source = record(root.source);
  return {
    rows: root.observations.slice(0, MAX_CONVERSION_INPUT_ROWS),
    source: sourceName(source?.name, 'External observations'),
  };
}

function mappedDomainObservation(value: unknown): Record<string, unknown> | null {
  const item = record(value);
  if (!item) return null;
  const source = requiredText(item.source, 80);
  const status = requiredText(item.status, 80);
  const observedAt = timestamp(item.observedAt);
  if (!source || !status || !observedAt) return null;
  return {
    domain: item.domain,
    category: 'registration',
    summary: `${source} reported domain state: ${status}.`,
    observedAt,
    completeness: item.completeness ?? 'unknown',
    limitations: ['Imported state is an external observation and was not independently verified by WHOISleuth.'],
    reference: item.reference ?? null,
    structuredObservation: {
      sourceSchema: DOMAIN_OBSERVATION_ROWS_SCHEMA,
      sourceVersion: SUPPORTED_OBSERVATION_ROWS_VERSION,
      field: 'status',
      value: status,
      issuer: null,
      notAfter: null,
    },
  };
}

function mappedDnsObservation(value: unknown): Record<string, unknown> | null {
  const item = record(value);
  if (!item) return null;
  const type = requiredText(item.type, 10)?.toUpperCase();
  const recordValue = requiredText(item.value, 500);
  const observedAt = timestamp(item.observedAt);
  if (!type || !DNS_TYPES.has(type) || !recordValue || !observedAt) return null;
  return {
    domain: item.domain,
    category: 'dns',
    summary: `External ${type} observation: ${recordValue}`,
    observedAt,
    completeness: item.completeness ?? 'unknown',
    limitations: ['Imported DNS data was not queried or independently verified by WHOISleuth.'],
    reference: item.reference ?? null,
    structuredObservation: {
      sourceSchema: DNS_OBSERVATION_ROWS_SCHEMA,
      sourceVersion: SUPPORTED_OBSERVATION_ROWS_VERSION,
      field: type,
      value: recordValue,
      issuer: null,
      notAfter: null,
    },
  };
}

function mappedCertificateObservation(value: unknown): Record<string, unknown> | null {
  const item = record(value);
  if (!item) return null;
  const fingerprint = requiredText(item.fingerprintSha256, 64);
  const observedAt = timestamp(item.observedAt);
  if (!fingerprint || !SHA256_RE.test(fingerprint) || !observedAt) return null;
  const issuer = requiredText(item.issuer, 160);
  const notAfter = timestamp(item.notAfter);
  return {
    domain: item.domain,
    category: 'certificate',
    summary: `External certificate SHA-256 ${fingerprint.toLowerCase()}${issuer ? `; issuer ${issuer}` : ''}${notAfter ? `; not after ${notAfter}` : ''}.`,
    observedAt,
    completeness: item.completeness ?? 'unknown',
    limitations: ['Imported certificate metadata was not fetched or independently verified by WHOISleuth.'],
    reference: item.reference ?? null,
    structuredObservation: {
      sourceSchema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
      sourceVersion: SUPPORTED_OBSERVATION_ROWS_VERSION,
      field: 'fingerprintSha256',
      value: fingerprint.toLowerCase(),
      issuer,
      notAfter,
    },
  };
}

export function convertSupportedExternalFindings(
  value: unknown,
  format: ExternalFindingConversionFormat,
): ExternalFindingConversionReport {
  const config = format === 'domain-observations-v1'
    ? { schema: DOMAIN_OBSERVATION_ROWS_SCHEMA, map: mappedDomainObservation }
    : format === 'dns-observations-v1'
      ? { schema: DNS_OBSERVATION_ROWS_SCHEMA, map: mappedDnsObservation }
      : { schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA, map: mappedCertificateObservation };
  const root = supportedRowsRoot(value, config.schema);
  const accepted: Array<ExternalFindingsDocument['findings'][number]> = [];
  const exclusions: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let rejected = 0;
  for (let index = 0; index < root.rows.length; index += 1) {
    const mapped = config.map(root.rows[index]);
    if (!mapped) {
      rejected += 1;
      if (exclusions.length < 20) exclusions.push({ row: index + 1, reason: 'Malformed or unsupported row.' });
      continue;
    }
    try {
      const finding = rowsDocument([mapped], root.source).findings[0];
      if (!finding) throw new Error('No normalised finding.');
      const key = JSON.stringify(finding);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      if (accepted.length >= MAX_EXTERNAL_FINDINGS) continue;
      accepted.push(finding);
    } catch {
      rejected += 1;
      if (exclusions.length < 20) exclusions.push({ row: index + 1, reason: 'Row failed the strict findings contract.' });
    }
  }
  if (!accepted.length) throw new Error('The selected observation document did not contain a valid supported row.');
  const document = parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: root.source, reference: null, collectedAt: null },
    findings: accepted,
  });
  const inspectedRows = root.rows.length;
  const inputRoot = record(value);
  const originalRows = Array.isArray(inputRoot?.observations)
    ? inputRoot.observations.length
    : inspectedRows;
  return {
    format,
    document,
    inputRows: originalRows,
    accepted: document.findings.length,
    rejected,
    duplicates,
    truncated: originalRows > inspectedRows || accepted.length >= MAX_EXTERNAL_FINDINGS,
    exclusions,
  };
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field) throw new Error('CSV quotes must begin at the start of a field.');
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
      if (row.length > MAX_CSV_COLUMNS) throw new Error('CSV rows have too many columns.');
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > MAX_EXTERNAL_FINDINGS + 1) throw new Error(`CSV imports are limited to ${MAX_EXTERNAL_FINDINGS} findings.`);
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((item) => item.trim()));
}

export function convertExternalFindingsCsv(value: string, fallbackSource = 'External CSV findings'): ExternalFindingsDocument {
  if (CONTROL_RE.test(value.replace(/[\r\n\t]/g, ''))) {
    throw new Error('CSV contains unsupported control characters.');
  }
  const rows = parseCsvRows(value);
  const headers = rows.shift()?.map((item) => item.trim().toLowerCase()) ?? [];
  if (
    headers.length !== EXTERNAL_FINDING_CSV_COLUMNS.length
    || headers.some((header, index) => header !== EXTERNAL_FINDING_CSV_COLUMNS[index])
  ) {
    throw new Error(`CSV header must be: ${EXTERNAL_FINDING_CSV_COLUMNS.join(',')}.`);
  }
  const objects = rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  return rowsDocument(objects, sourceName(null, fallbackSource));
}

export type { ExternalFindingCategory };
