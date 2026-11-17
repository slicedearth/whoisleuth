import { parseBoundedJson } from '../analysis/bounded-json.mts';
import { normalizeDomain } from '../evidence/domain-name.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { sha256IdentityHex } from '../evidence/record-identity.mts';
import { canonicalIpAddress } from '../contracts/ip-address.mts';
import {
  EXTERNAL_FINDINGS_SCHEMA, EXTERNAL_FINDINGS_VERSION, MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
  MAX_EXTERNAL_FINDINGS, MAX_EXTERNAL_FINDINGS_PER_DOMAIN, MAX_EXTERNAL_FINDING_DOMAINS,
  parseExternalFindingsDocument, type ExternalFinding, type ExternalFindingsDocument,
} from './external-findings-import.mts';
import type { ExternalFindingConversionReport } from './external-findings-converters.mts';
import { RECON_JSONL_FORMATS } from '../contracts/external-observation-interchange.mts';

export { RECON_JSONL_FORMATS };
export type ReconJsonlFormat = typeof RECON_JSONL_FORMATS[number];
const MAX_ROW_BYTES = 64 * 1024;
const MAX_ROWS = 500;
const DNS_FIELDS = ['a', 'aaaa', 'cname', 'ns', 'mx', 'txt', 'caa'] as const;

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= maximum
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) ? value.trim() : null;
}

function dnsFindings(row: Record<string, unknown>, base: ExternalFinding): ExternalFinding[] {
  const values: ExternalFinding[] = [];
  for (const field of DNS_FIELDS) {
    const entries = row[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 32) throw new TypeError('DNS answer array is malformed or exceeds 32 values.');
    for (const raw of entries) {
      let value = text(raw, 500);
      if (!value || (field === 'a' || field === 'aaaa')
        && (!canonicalIpAddress(value) || (field === 'a') !== !value.includes(':'))) throw new TypeError('DNS answer is invalid.');
      const type = field.toUpperCase();
      if (['cname', 'ns', 'mx'].includes(field)) {
        if (/[/:@?#]/u.test(value)) throw new TypeError('DNS target must be an exact hostname.');
        const hostname = normalizeDomain(value);
        if (!hostname) throw new TypeError('DNS target is invalid.');
        value = hostname;
      }
      values.push({ ...base, category: 'dns', summary: `dnsx ${type}: ${value}`,
        ...(field === 'mx' ? { limitations: [...base.limitations, 'The producer MX field contains hostnames only; mail preference values were not supplied.'] } : {}),
        structuredObservation: { sourceSchema: 'whoisleuth.dns-observation-rows', sourceVersion: 1,
          field: type, value, issuer: null, notAfter: null, eventId: null, logId: null,
          certificateSha256: null, dnsNameCount: null, namesComplete: null } });
    }
  }
  if (!values.length) values.push({ ...base, category: 'dns',
    summary: `dnsx reported ${text(row.status_code, 40) || 'no retained answer status'}; no supported answer values were included.`,
    limitations: [...base.limitations, 'Requested record types and negative-answer scope are unknown; an empty value list does not establish DNS removal.'] });
  return values;
}

function httpFinding(row: Record<string, unknown>, base: ExternalFinding): ExternalFinding[] {
  if (typeof row.failed !== 'boolean') throw new TypeError('HTTP result requires an explicit failed flag.');
  const status = Number(row.status_code);
  if (!row.failed && (!Number.isInteger(status) || status < 100 || status > 599)) throw new TypeError('HTTP response status is invalid.');
  const title = text(row.title, 300);
  const server = text(row.webserver, 160);
  return [{ ...base, category: 'http', completeness: row.failed ? 'partial' : 'unknown',
    summary: row.failed ? 'httpx reported an unsuccessful HTTP observation.'
      : `httpx HTTP ${status}${title ? ` · ${title}` : ''}${server ? ` · server ${server}` : ''}.`,
    limitations: [...base.limitations, 'URL paths, queries, redirects, raw bodies, headers, cookies and local file paths are excluded. A response status does not establish page completeness or hostname ownership.'] }];
}

/** Explicit producer selection, bounded JSONL framing, no collection or code execution. */
export function convertReconJsonl(input: string, format: ReconJsonlFormat): ExternalFindingConversionReport {
  if (!RECON_JSONL_FORMATS.includes(format)) throw new TypeError('Select one supported reconnaissance producer.');
  if (typeof input !== 'string' || !input.trim() || new TextEncoder().encode(input).byteLength > MAX_EXTERNAL_FINDINGS_IMPORT_BYTES) {
    throw new TypeError('Reconnaissance JSONL must be non-empty and no larger than 384 KiB.');
  }
  const producer = format === 'dnsx-jsonl' ? 'dnsx' : 'httpx';
  const source = { name: `${producer} · supplied JSONL`, reference: null, collectedAt: null };
  const accepted: ExternalFinding[] = [], exclusions: { row: number; reason: string }[] = [];
  const seen = new Set<string>(), domains = new Map<string, number>();
  let inputRows = 0, rejected = 0, duplicates = 0, truncated = false;
  for (const [index, line] of input.replace(/^\ufeff/u, '').split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    if (++inputRows > MAX_ROWS) throw new TypeError('Reconnaissance JSONL is limited to 500 rows.');
    try {
      const raw = parseBoundedJson(line, { label: 'Reconnaissance row', maximumBytes: MAX_ROW_BYTES,
        limits: { maximumDepth: 16, maximumKeys: 2_000, maximumValues: 4_000, maximumContainerItems: 500 } });
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Expected one JSON object.');
      const row = raw as Record<string, unknown>;
      const observedAt = normalizeExplicitIsoTimestamp(row.timestamp);
      if (!observedAt) throw new TypeError('An explicit observation timestamp is required.');
      let hostname: string | null;
      if (producer === 'httpx') {
        const url = new URL(text(row.url, 8_192) || '');
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('HTTP URL is invalid.');
        hostname = normalizeDomain(url.hostname);
      } else {
        const supplied = text(row.host, 253);
        if (!supplied || /[/:@?#]/u.test(supplied)) throw new TypeError('DNS host must be a hostname, not a URL.');
        hostname = normalizeDomain(supplied);
      }
      if (!hostname) throw new TypeError('An exact DNS hostname is required.');
      // Identify the complete original row, not a truncated presentation.
      const reference = `sha256-jsonl-row:${sha256IdentityHex(new TextEncoder().encode(line))}`;
      const base: ExternalFinding = { domain: hostname, category: 'other', evidenceClass: 'deployment_observation',
        observedAt, summary: '', completeness: 'unknown', reference, structuredObservation: null,
        limitations: ['Supplied producer identity is not authenticated. Collection options, resolver vantage and completeness are unknown; WHOISleuth made no request.',
          `Original JSONL row SHA-256: ${reference.slice('sha256-jsonl-row:'.length)}. The digest covers complete UTF-8 row text, excluding its line ending; keep the original file.`] };
      const candidates = producer === 'dnsx' ? dnsFindings(row, base) : httpFinding(row, base);
      // Use the same strict parser as manual findings, before admitting a row.
      const validated = candidates.map(finding => parseExternalFindingsDocument({
        schema: EXTERNAL_FINDINGS_SCHEMA, schemaVersion: EXTERNAL_FINDINGS_VERSION, source, findings: [finding],
      }).findings[0]!);
      for (const finding of validated) {
        const key = JSON.stringify(finding);
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);
        const count = domains.get(finding.domain) || 0;
        if (accepted.length >= MAX_EXTERNAL_FINDINGS || count >= MAX_EXTERNAL_FINDINGS_PER_DOMAIN
          || (!count && domains.size >= MAX_EXTERNAL_FINDING_DOMAINS)) {
          truncated = true;
          if (exclusions.length < 20) exclusions.push({ row: index + 1, reason: 'Finding exceeds the retained findings or domain limit.' });
          continue;
        }
        accepted.push(finding); domains.set(finding.domain, count + 1);
      }
    } catch (error) {
      rejected++;
      if (exclusions.length < 20) exclusions.push({ row: index + 1,
        reason: error instanceof TypeError ? error.message.slice(0, 160) : 'Malformed or unsupported producer row.' });
    }
  }
  if (!accepted.length) throw new TypeError('No supported reconnaissance observation with an exact hostname and timestamp was found.');
  const document: ExternalFindingsDocument = parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA, schemaVersion: EXTERNAL_FINDINGS_VERSION, source, findings: accepted,
  });
  return { format, document, inputRows, accepted: document.findings.length, rejected, duplicates, truncated, exclusions };
}
