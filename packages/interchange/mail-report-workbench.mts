import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from '../evidence/artifact-integrity.mts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from '../../lib/bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAIL_REPORT_SCHEMA, MAIL_REPORT_VERSION } from '../contracts/analyst-interchange.mts';
import { MAX_PROFILE_VALUES, MAX_PROFILE_VALUE_INPUTS } from '../contracts/workspace-portability.mts';
import { extractBoundedZipEntries } from './bounded-zip-extraction.mts';
import { decompressBoundedGzip } from './bounded-gzip.mts';
import { neutralizeUnsafeRetainedText } from './retained-text.mts';

export { MAIL_REPORT_SCHEMA, MAIL_REPORT_VERSION } from '../contracts/analyst-interchange.mts';

export const MAX_MAIL_REPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_MAIL_REPORT_EXPANDED_BYTES = 20 * 1024 * 1024;
export const MAX_MAIL_REPORT_ARCHIVE_ENTRIES = 32;
export const MAX_MAIL_REPORT_INPUT_FILES = 16;
export const MAX_MAIL_REPORT_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_MAIL_REPORT_REVIEW_REPORTS = MAX_MAIL_REPORT_INPUT_FILES * MAX_MAIL_REPORT_ARCHIVE_ENTRIES;
export const MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES = MAX_MAIL_REPORT_EXPANDED_BYTES;
export const MAX_DMARC_RECORDS = 50_000;
export const MAX_TLS_POLICIES = 10_000;
export const MAX_TLS_FAILURE_DETAILS = 10_000;
export const MAX_TLS_MX_HOSTS = 10_000;
const MAX_MAIL_REPORT_JSON_CONTAINER_ITEMS = 100_000;

export type MailInputCoverage = Readonly<{ supplied: number; inspected: number; retained: number; rejected: number }>;
type MailContainer = Readonly<{ format: 'plain' | 'gzip' | 'zip'; entries: MailInputCoverage }>;
type MailSource = Readonly<{ name: string; bytes: number; digestSha256: string; container: MailContainer }>;

export type DmarcAggregateRecord = Readonly<{
  sourceIp: string | null;
  count: number;
  disposition: string | null;
  dkim: string | null;
  spf: string | null;
  headerFrom: string | null;
}>;

export type DmarcAggregateReport = Readonly<{
  kind: 'dmarc';
  source: MailSource;
  organization: string | null;
  reportId: string | null;
  domain: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalMessages: number;
  records: readonly DmarcAggregateRecord[];
  recordCoverage: MailInputCoverage;
  truncated: boolean;
}>;

export type TlsAggregatePolicy = Readonly<{
  policyType: string | null;
  policyDomain: string | null;
  mxHosts: readonly string[];
  successfulSessions: number;
  failedSessions: number;
  failureTypes: readonly Readonly<{ type: string; count: number }>[];
  failureDetailCoverage: MailInputCoverage;
  mxHostCoverage: MailInputCoverage;
}>;

export type TlsAggregateReport = Readonly<{
  kind: 'tls-rpt';
  source: MailSource;
  organization: string | null;
  reportId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  policies: readonly TlsAggregatePolicy[];
  policyCoverage: MailInputCoverage;
  successfulSessions: number;
  failedSessions: number;
  truncated: boolean;
}>;

export type ParsedMailReport = DmarcAggregateReport | TlsAggregateReport;

export type MailReportReview = Readonly<{
  schema: typeof MAIL_REPORT_SCHEMA;
  version: typeof MAIL_REPORT_VERSION;
  generatedAt: string;
  reports: readonly ParsedMailReport[];
  summary: Readonly<{
    dmarcReports: number;
    tlsReports: number;
    dmarcMessages: number;
    dmarcDkimPass: number;
    dmarcSpfPass: number;
    dmarcBothFailed: number;
    tlsSuccessfulSessions: number;
    tlsFailedSessions: number;
    truncatedReports: number;
  }>;
  profileScope: Readonly<{
    state: 'complete' | 'partial' | 'unscoped';
    officialDomains: readonly string[];
    outsideScopeDomains: readonly string[];
    unresolvedScopeDomains: readonly string[];
    coverage: MailInputCoverage;
  }>;
  limitations: readonly string[];
  integrity: Readonly<{ algorithm: 'SHA-256'; canonicalization: typeof SORTED_JSON_V2; digestSha256: string }>;
}>;

type ExpandedFile = Readonly<{ name: string; bytes: Uint8Array; container: MailContainer }>;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function gunzipBounded(bytes: Uint8Array): Uint8Array {
  return decompressBoundedGzip(bytes, {
    maximumOutputBytes: MAX_MAIL_REPORT_EXPANDED_BYTES,
    exceededMessage: 'Expanded mail report exceeds the decompression limit.',
    invalidMessage: 'The gzip mail report could not be safely decompressed.',
    emptyMessage: 'The gzip mail report was empty.',
  });
}

function safeArchivePath(value: string): boolean {
  if (!value || value.length > 512 || value.startsWith('/') || value.includes('\\') || CONTROL_RE.test(value)) return false;
  const segments = (value.endsWith('/') ? value.slice(0, -1) : value).split('/');
  return !segments.some((segment) => !segment || segment === '.' || segment === '..' || ['__proto__', 'prototype', 'constructor'].includes(segment));
}

function unpackArchive(bytes: Uint8Array): ExpandedFile[] {
  let entries = 0;
  let declaredBytes = 0;
  const seen = new Set<string>();
  let unpacked: ReadonlyMap<string, Uint8Array>;
  try {
    unpacked = extractBoundedZipEntries(bytes, {
      inspect(file) {
        entries += 1;
        if (entries > MAX_MAIL_REPORT_ARCHIVE_ENTRIES) throw new Error(`Mail report archives are limited to ${MAX_MAIL_REPORT_ARCHIVE_ENTRIES} entries.`);
        if (!safeArchivePath(file.name)) throw new Error('The mail report archive contains an unsafe path.');
        const key = file.name.toLowerCase();
        if (seen.has(key)) throw new Error('The mail report archive repeats an entry path.');
        seen.add(key);
        if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error('The mail report archive contains invalid size metadata.');
        declaredBytes += file.originalSize;
        if (declaredBytes > MAX_MAIL_REPORT_EXPANDED_BYTES) throw new Error('Expanded mail reports exceed the decompression limit.');
        return {
          key,
          selected: !file.name.endsWith('/') && /\.(?:xml|json)$/i.test(file.name),
          maximumBytes: MAX_MAIL_REPORT_EXPANDED_BYTES,
          exceededMessage: 'Expanded mail report exceeds the decompression limit.',
        };
      },
      keyForName: (name) => name.toLowerCase(),
      maximumEntries: MAX_MAIL_REPORT_ARCHIVE_ENTRIES,
      maximumSelectedBytes: MAX_MAIL_REPORT_EXPANDED_BYTES,
      selectedBytesExceededMessage: 'Expanded mail reports exceed the decompression limit.',
      metadataMismatchMessage: 'The mail report archive contains inconsistent ZIP metadata.',
    }).files;
  } catch (cause) {
    if (cause instanceof Error && /limited|unsafe|repeats|invalid|inconsistent|exceed/.test(cause.message)) throw cause;
    throw new Error('The ZIP mail report archive could not be safely decompressed.');
  }
  const container: MailContainer = { format: 'zip', entries: { supplied: entries, inspected: entries, retained: unpacked.size, rejected: 0 } };
  const output = [...unpacked].map(([name, value]) => ({ name, bytes: value, container }));
  if (!output.length) throw new Error('The ZIP archive did not contain any XML or JSON mail reports.');
  return output;
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) && [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);
}

function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function expandMailReportFile(name: string, input: Uint8Array): ExpandedFile[] {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > MAX_MAIL_REPORT_FILE_BYTES) {
    throw new TypeError(`Mail report files must be between 1 byte and ${MAX_MAIL_REPORT_FILE_BYTES} bytes.`);
  }
  if (looksLikeZip(input)) return unpackArchive(input);
  const entries = { supplied: 1, inspected: 1, retained: 1, rejected: 0 };
  if (looksLikeGzip(input)) return [{ name: name.replace(/\.gz$/i, '') || 'report', bytes: gunzipBounded(input), container: { format: 'gzip', entries } }];
  return [{ name: name.slice(0, 180) || 'report', bytes: input.slice(), container: { format: 'plain', entries } }];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, ' ')
    .replace(/&gt;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function removeXmlMarkup(value: string): string {
  let output = '';
  let insideMarkup = false;
  for (const character of value) {
    if (character === '<') {
      insideMarkup = true;
      output += ' ';
    } else if (character === '>') {
      insideMarkup = false;
      output += ' ';
    } else if (!insideMarkup) {
      output += character;
    }
  }
  return output;
}

function cleanText(value: unknown, maximum = 300): string | null {
  const normalized = neutralizeUnsafeRetainedText(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, maximum);
  return normalized || null;
}

function lexicalXmlElements(xml: string): string {
  let elements = xml.startsWith('\ufeff') ? xml.slice(1) : xml;
  if (elements.startsWith('<?xml')) {
    const declaration = /^<\?xml[\t\n\r ]+version[\t\n\r ]*=[\t\n\r ]*(["'])1\.[01]\1(?:[\t\n\r ]+encoding[\t\n\r ]*=[\t\n\r ]*(["'])[Uu][Tt][Ff]-8\2)?(?:[\t\n\r ]+standalone[\t\n\r ]*=[\t\n\r ]*(["'])(?:yes|no)\3)?[\t\n\r ]*\?>/u.exec(elements);
    if (!declaration) throw new TypeError('DMARC XML declaration is malformed.');
    elements = elements.slice(declaration[0].length);
  }
  if (/<!--|<!\[CDATA\[|<\?/u.test(elements)) {
    throw new TypeError('DMARC XML comments, CDATA, and processing instructions are not accepted.');
  }
  if (/<!/u.test(elements)) throw new TypeError('DMARC XML declarations are not accepted.');
  return elements;
}

function xmlBlocks(xml: string, tag: string, maximum: number, counted?: () => void): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`<(\\/?)(?:[A-Za-z_][\\w.-]*:)?${escaped}(?=\\s|\\/?>)([^<>]*)>`, 'gi');
  const values: string[] = [];
  let openOffset: number | null = null;
  for (let match = expression.exec(xml); match; match = expression.exec(xml)) {
    const closing = match[1] === '/';
    const suffix = match[2] ?? '';
    if (closing) {
      if (!/^\s*$/u.test(suffix) || openOffset === null) {
        throw new TypeError(`DMARC XML ${tag} elements must be balanced and non-nested.`);
      }
      counted?.();
      if (values.length < maximum) values.push(xml.slice(openOffset, match.index));
      openOffset = null;
      continue;
    }
    if (openOffset !== null) {
      throw new TypeError(`DMARC XML ${tag} elements must be balanced and non-nested.`);
    }
    if (/\/\s*$/u.test(suffix)) {
      counted?.();
      if (values.length < maximum) values.push('');
      continue;
    }
    openOffset = expression.lastIndex;
  }
  if (openOffset !== null) throw new TypeError(`DMARC XML ${tag} elements must be balanced and non-nested.`);
  return values;
}

function singletonXmlBlock(xml: string, tag: string, label: string): string {
  const blocks = xmlBlocks(xml, tag, 2);
  if (blocks.length > 1) throw new TypeError(`${label} must appear at most once.`);
  return blocks[0] ?? '';
}

function requiredSingletonXmlBlock(xml: string, tag: string, label: string): string {
  const block = singletonXmlBlock(xml, tag, label);
  if (!block.trim()) throw new TypeError(`${label} must appear once with content.`);
  return block;
}

function singletonXmlValue(xml: string, tag: string, label: string, maximum = 300): string | null {
  const blocks = xmlBlocks(xml, tag, 2);
  if (blocks.length > 1) throw new TypeError(`${label} must appear at most once.`);
  return cleanText(decodeXml(removeXmlMarkup(blocks[0] ?? '')), maximum);
}

function boundedCount(value: unknown, label: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d{1,10}$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new TypeError(`${label} must be an integer from 0 to 1000000000.`);
  }
  return parsed;
}

function authenticationResult(value: unknown, label: string): 'pass' | 'fail' {
  const normalized = cleanText(value, 20)?.toLowerCase();
  if (normalized !== 'pass' && normalized !== 'fail') {
    throw new TypeError(`${label} must be pass or fail.`);
  }
  return normalized;
}

function dispositionResult(value: unknown): 'none' | 'quarantine' | 'reject' {
  const normalized = cleanText(value, 40)?.toLowerCase();
  if (normalized !== 'none' && normalized !== 'quarantine' && normalized !== 'reject') {
    throw new TypeError('DMARC disposition must be none, quarantine, or reject.');
  }
  return normalized;
}

function epoch(value: string | null): string | null {
  if (!value || !/^\d{1,12}$/.test(value)) return null;
  const date = new Date(Number(value) * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function sourceFor(file: ExpandedFile): Promise<MailSource> {
  const digestInput = new Uint8Array(file.bytes.byteLength);
  digestInput.set(file.bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return {
    name: cleanText(file.name, 180) ?? 'report',
    bytes: file.bytes.byteLength,
    container: file.container,
    digestSha256: `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`,
  };
}

async function parseDmarcAggregateReport(file: ExpandedFile): Promise<DmarcAggregateReport> {
  const rawXml = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(rawXml)) throw new TypeError('DMARC XML containing document types or entities is not accepted.');
  const xml = lexicalXmlElements(rawXml);
  const feedback = requiredSingletonXmlBlock(xml, 'feedback', 'DMARC feedback root');
  let suppliedRecords = 0;
  const allBlocks = xmlBlocks(feedback, 'record', MAX_DMARC_RECORDS, () => { suppliedRecords += 1; });
  if (!allBlocks.length) throw new TypeError('DMARC feedback must contain at least one record.');
  const truncated = suppliedRecords > allBlocks.length;
  const records = allBlocks.map((block): DmarcAggregateRecord => {
    const row = requiredSingletonXmlBlock(block, 'row', 'DMARC record row');
    const evaluated = singletonXmlBlock(row, 'policy_evaluated', 'DMARC policy evaluation');
    const identifiers = singletonXmlBlock(block, 'identifiers', 'DMARC identifiers');
    return {
      sourceIp: singletonXmlValue(row, 'source_ip', 'DMARC source IP', 64),
      count: boundedCount(singletonXmlValue(row, 'count', 'DMARC message count', 20), 'DMARC message count'),
      disposition: dispositionResult(singletonXmlValue(evaluated, 'disposition', 'DMARC disposition', 40)),
      dkim: authenticationResult(singletonXmlValue(evaluated, 'dkim', 'DMARC DKIM result', 20), 'DMARC DKIM result'),
      spf: authenticationResult(singletonXmlValue(evaluated, 'spf', 'DMARC SPF result', 20), 'DMARC SPF result'),
      headerFrom: singletonXmlValue(identifiers, 'header_from', 'DMARC header-from domain', 253)?.toLowerCase() ?? null,
    };
  });
  const metadata = singletonXmlBlock(feedback, 'report_metadata', 'DMARC report metadata');
  const dateRange = singletonXmlBlock(metadata, 'date_range', 'DMARC report date range');
  const policy = singletonXmlBlock(feedback, 'policy_published', 'DMARC published policy');
  return Object.freeze({
    kind: 'dmarc',
    source: await sourceFor(file),
    organization: singletonXmlValue(metadata, 'org_name', 'DMARC reporting organization', 200),
    reportId: singletonXmlValue(metadata, 'report_id', 'DMARC report identifier', 300),
    domain: singletonXmlValue(policy, 'domain', 'DMARC policy domain', 253)?.toLowerCase() ?? null,
    periodStart: epoch(singletonXmlValue(dateRange, 'begin', 'DMARC period start', 20)),
    periodEnd: epoch(singletonXmlValue(dateRange, 'end', 'DMARC period end', 20)),
    totalMessages: records.reduce((total, record) => total + record.count, 0),
    records: Object.freeze(records),
    recordCoverage: { supplied: suppliedRecords, inspected: records.length, retained: records.length, rejected: 0 },
    truncated,
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown, maximum: number, maximumInputs = maximum * 2): Readonly<{ values: string[]; coverage: MailInputCoverage }> {
  const input = Array.isArray(value) ? value : [];
  const values = new Set<string>();
  let inspected = 0;
  let rejected = 0;
  for (const raw of input.slice(0, maximumInputs)) {
    if (values.size >= maximum) break;
    inspected += 1;
    const normalized = typeof raw === 'string' ? cleanText(raw, 253)?.toLowerCase() : null;
    if (normalized && typeof raw === 'string' && normalized === raw.trim().toLowerCase()) values.add(normalized);
    else rejected += 1;
  }
  return { values: [...values], coverage: { supplied: input.length, inspected, retained: values.size, rejected } };
}

function reportTimestamp(value: unknown): string | null {
  const normalized = cleanText(value, 64);
  return normalized ? normalizeExplicitIsoTimestamp(normalized) : null;
}

async function parseTlsAggregateReport(file: ExpandedFile): Promise<TlsAggregateReport> {
  const document = parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), {
    label: 'TLS-RPT report',
    maximumBytes: MAX_MAIL_REPORT_EXPANDED_BYTES,
    limits: { ...boundedJsonLimitsForBytes(file.bytes.byteLength), maximumContainerItems: MAX_MAIL_REPORT_JSON_CONTAINER_ITEMS },
  });
  const root = object(document);
  const rawPolicies = Array.isArray(root.policies) ? root.policies : [];
  if (!Array.isArray(root.policies)) throw new TypeError('The JSON does not contain a TLS-RPT policies array.');
  const policies = rawPolicies.slice(0, MAX_TLS_POLICIES).map((value): TlsAggregatePolicy => {
    const item = object(value);
    const published = object(item.policy);
    const summary = object(item.summary);
    const rawFailures = Array.isArray(item['failure-details']) ? item['failure-details'] : [];
    const inspectedFailures = rawFailures.slice(0, MAX_TLS_FAILURE_DETAILS);
    const counts = new Map<string, number>();
    for (const raw of inspectedFailures) {
      const failure = object(raw);
      const type = cleanText(failure['result-type'], 100) ?? 'unclassified';
      counts.set(type, (counts.get(type) ?? 0) + boundedCount(failure['failed-session-count'], 'TLS-RPT failed session count'));
    }
    const mx = strings(published['mx-host'], MAX_TLS_MX_HOSTS);
    return {
      policyType: cleanText(published['policy-type'], 80),
      policyDomain: cleanText(published['policy-domain'], 253)?.toLowerCase() ?? null,
      mxHosts: Object.freeze(mx.values),
      mxHostCoverage: mx.coverage,
      successfulSessions: boundedCount(summary['total-successful-session-count'], 'TLS-RPT successful session count'),
      failedSessions: boundedCount(summary['total-failure-session-count'], 'TLS-RPT failure session count'),
      failureTypes: Object.freeze([...counts].map(([type, count]) => Object.freeze({ type, count })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))),
      failureDetailCoverage: { supplied: rawFailures.length, inspected: inspectedFailures.length, retained: inspectedFailures.length, rejected: 0 },
    };
  });
  const dateRange = object(root['date-range']);
  const periodStart = reportTimestamp(dateRange['start-datetime']);
  const periodEnd = reportTimestamp(dateRange['end-datetime']);
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw new TypeError('TLS-RPT date range must contain ordered timestamps with explicit timezones.');
  }
  return Object.freeze({
    kind: 'tls-rpt',
    source: await sourceFor(file),
    organization: cleanText(root['organization-name'], 200),
    reportId: cleanText(root['report-id'], 300),
    periodStart,
    periodEnd,
    policies: Object.freeze(policies),
    policyCoverage: { supplied: rawPolicies.length, inspected: policies.length, retained: policies.length, rejected: 0 },
    successfulSessions: policies.reduce((total, item) => total + item.successfulSessions, 0),
    failedSessions: policies.reduce((total, item) => total + item.failedSessions, 0),
    truncated: rawPolicies.length > policies.length || policies.some((policy) => (
      policy.failureDetailCoverage.supplied > policy.failureDetailCoverage.inspected
      || policy.mxHostCoverage.supplied > policy.mxHostCoverage.inspected
      || policy.mxHostCoverage.rejected > 0
    )),
  });
}

export async function parseMailReportFiles(name: string, input: Uint8Array): Promise<ParsedMailReport[]> {
  const expanded = expandMailReportFile(name, input);
  const reports: ParsedMailReport[] = [];
  for (const file of expanded) {
    const first = new TextDecoder().decode(file.bytes.slice(0, 200)).trimStart();
    reports.push(first.startsWith('<') ? await parseDmarcAggregateReport(file) : await parseTlsAggregateReport(file));
  }
  return reports;
}

export async function buildMailReportReview(
  reports: readonly ParsedMailReport[],
  officialDomains: readonly string[] = [],
  generatedAt = new Date().toISOString(),
): Promise<MailReportReview> {
  const normalizedGeneratedAt = normalizeExplicitIsoTimestamp(generatedAt);
  if (!normalizedGeneratedAt) throw new TypeError('Mail report review time must include an explicit timezone.');
  assertMailReviewCapacity(reports);
  const bounded = [...reports];
  const dmarc = bounded.filter((report): report is DmarcAggregateReport => report.kind === 'dmarc');
  const tls = bounded.filter((report): report is TlsAggregateReport => report.kind === 'tls-rpt');
  const scope = strings(officialDomains, MAX_PROFILE_VALUES, MAX_PROFILE_VALUE_INPUTS);
  const official = scope.values.sort();
  const scopeState = scope.coverage.supplied > scope.coverage.inspected || scope.coverage.rejected > 0 ? 'partial' : official.length ? 'complete' : 'unscoped';
  const observedDomains = [...new Set([
    ...dmarc.map((report) => report.domain),
    ...tls.flatMap((report) => report.policies.map((policy) => policy.policyDomain)),
  ].filter((value): value is string => Boolean(value)))].sort();
  const unsigned = {
    schema: MAIL_REPORT_SCHEMA,
    version: MAIL_REPORT_VERSION,
    generatedAt: normalizedGeneratedAt,
    reports: bounded,
    summary: {
      dmarcReports: dmarc.length,
      tlsReports: tls.length,
      dmarcMessages: dmarc.reduce((total, report) => total + report.totalMessages, 0),
      dmarcDkimPass: dmarc.reduce((total, report) => report.records.reduce((sum, record) => sum + (record.dkim === 'pass' ? record.count : 0), total), 0),
      dmarcSpfPass: dmarc.reduce((total, report) => report.records.reduce((sum, record) => sum + (record.spf === 'pass' ? record.count : 0), total), 0),
      dmarcBothFailed: dmarc.reduce((total, report) => report.records.reduce((sum, record) => sum + (record.dkim === 'fail' && record.spf === 'fail' ? record.count : 0), total), 0),
      tlsSuccessfulSessions: tls.reduce((total, report) => total + report.successfulSessions, 0),
      tlsFailedSessions: tls.reduce((total, report) => total + report.failedSessions, 0),
      truncatedReports: bounded.filter((report) => report.truncated).length,
    },
    profileScope: {
      state: scopeState,
      officialDomains: official,
      outsideScopeDomains: scopeState === 'complete' ? observedDomains.filter((domain) => !official.includes(domain)) : [],
      unresolvedScopeDomains: scopeState === 'partial' ? observedDomains.filter((domain) => !official.includes(domain)) : [],
      coverage: scope.coverage,
    },
    limitations: [
      ...(bounded.some((report) => report.truncated) ? ['Summary counts cover retained rows and policies only. Uninspected input may contain additional outcomes; failure-detail totals can be lower than a submitted policy summary.'] : []),
      ...(scopeState === 'partial' ? [`Profile scope inspected ${scope.coverage.inspected} of ${scope.coverage.supplied} domain values and rejected ${scope.coverage.rejected} invalid values. Domains absent from this partial scope are unresolved, not outside the profile.`] : []),
      'Reports are parsed locally and are not independently authenticated or verified against a reporting provider.',
      'Authentication and transport outcomes describe the submitted aggregate reports, not current domain safety or sender intent.',
      'No DNS, SMTP, mailbox, provider, or target request is made during this review.',
    ],
  } as const;
  return Object.freeze({ ...unsigned, integrity: Object.freeze({ algorithm: 'SHA-256', canonicalization: SORTED_JSON_V2, digestSha256: await sha256ArtifactDigestV2(unsigned) }) });
}

function assertMailReviewCapacity(reports: readonly ParsedMailReport[]): void {
  if (reports.length > MAX_MAIL_REPORT_REVIEW_REPORTS) throw new RangeError(`The review supports ${MAX_MAIL_REPORT_REVIEW_REPORTS} unique aggregate reports; no reports were added.`);
  let bytes = 0;
  for (const report of reports) {
    if (!Number.isSafeInteger(report.source.bytes) || report.source.bytes < 1) throw new TypeError('A mail report has invalid source-byte metadata.');
    bytes += report.source.bytes;
    if (bytes > MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES) throw new RangeError(`The review supports ${MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES / (1024 * 1024)} MiB of expanded report sources; no reports were added.`);
  }
}

export type MailReportInputFile = Readonly<{ name: string; bytes: Uint8Array }>;
export type MailReportImportResult = Readonly<{ review: MailReportReview; loadedReports: number; duplicateReports: number }>;

/** The import is atomic to its caller; duplicate sources do not consume capacity. */
export async function importMailReportReview(
  files: readonly MailReportInputFile[],
  retained: readonly ParsedMailReport[],
  officialDomains: readonly string[],
  generatedAt?: string,
): Promise<MailReportImportResult> {
  if (!files.length || files.length > MAX_MAIL_REPORT_INPUT_FILES) throw new RangeError(`Select between 1 and ${MAX_MAIL_REPORT_INPUT_FILES} files at once.`);
  let inputBytes = 0;
  for (const file of files) {
    if (!(file.bytes instanceof Uint8Array)) throw new TypeError('Mail report input must contain file bytes.');
    inputBytes += file.bytes.byteLength;
    if (inputBytes > MAX_MAIL_REPORT_INPUT_BYTES) throw new RangeError(`Selected files are limited to ${MAX_MAIL_REPORT_INPUT_BYTES / (1024 * 1024)} MiB in total.`);
  }
  assertMailReviewCapacity(retained);
  const next = [...retained];
  const seen = new Set(next.map((report) => `${report.kind}:${report.source.digestSha256}`));
  let loadedReports = 0;
  let duplicateReports = 0;
  for (const file of files) {
    const parsed = await parseMailReportFiles(file.name, file.bytes);
    loadedReports += parsed.length;
    for (const report of parsed) {
      const key = `${report.kind}:${report.source.digestSha256}`;
      if (seen.has(key)) { duplicateReports += 1; continue; }
      next.push(report);
      assertMailReviewCapacity(next);
      seen.add(key);
    }
  }
  return { review: await buildMailReportReview(next, officialDomains, generatedAt), loadedReports, duplicateReports };
}
