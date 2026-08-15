import { Gunzip, unzipSync } from 'fflate';
import { sha256ArtifactDigest } from './artifact-integrity.ts';
import { parseBoundedJson } from '../bounded-json.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const MAIL_REPORT_SCHEMA = 'whoisleuth.mail-report-review';
export const MAIL_REPORT_VERSION = 1;
export const MAX_MAIL_REPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_MAIL_REPORT_EXPANDED_BYTES = 20 * 1024 * 1024;
export const MAX_MAIL_REPORT_ARCHIVE_ENTRIES = 32;
export const MAX_MAIL_REPORT_INPUT_FILES = 16;
export const MAX_MAIL_REPORT_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_DMARC_RECORDS = 10_000;
export const MAX_TLS_POLICIES = 1_000;
export const MAX_TLS_FAILURE_DETAILS = 10_000;

type MailSource = Readonly<{ name: string; bytes: number; digestSha256: string }>;

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
  truncated: boolean;
}>;

export type TlsAggregatePolicy = Readonly<{
  policyType: string | null;
  policyDomain: string | null;
  mxHosts: readonly string[];
  successfulSessions: number;
  failedSessions: number;
  failureTypes: readonly Readonly<{ type: string; count: number }>[];
}>;

export type TlsAggregateReport = Readonly<{
  kind: 'tls-rpt';
  source: MailSource;
  organization: string | null;
  reportId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  policies: readonly TlsAggregatePolicy[];
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
  profileScope: Readonly<{ officialDomains: readonly string[]; outsideScopeDomains: readonly string[] }>;
  limitations: readonly string[];
  integrity: Readonly<{ algorithm: 'SHA-256'; digestSha256: string }>;
}>;

type ExpandedFile = Readonly<{ name: string; bytes: Uint8Array }>;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function gunzipBounded(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const gunzip = new Gunzip((chunk) => {
      total += chunk.byteLength;
      if (total > MAX_MAIL_REPORT_EXPANDED_BYTES) throw new Error('Expanded mail report exceeds the decompression limit.');
      chunks.push(chunk.slice());
    });
    gunzip.push(bytes, true);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('decompression limit')) throw cause;
    throw new Error('The gzip mail report could not be safely decompressed.');
  }
  if (!total) throw new Error('The gzip mail report was empty.');
  return concat(chunks, total);
}

function safeArchivePath(value: string): boolean {
  if (!value || value.length > 512 || value.startsWith('/') || value.includes('\\') || CONTROL_RE.test(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => !segment || segment === '.' || segment === '..' || ['__proto__', 'prototype', 'constructor'].includes(segment));
}

function unpackArchive(bytes: Uint8Array): ExpandedFile[] {
  let entries = 0;
  let declaredBytes = 0;
  const seen = new Set<string>();
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter(file) {
        entries += 1;
        if (entries > MAX_MAIL_REPORT_ARCHIVE_ENTRIES) throw new Error(`Mail report archives are limited to ${MAX_MAIL_REPORT_ARCHIVE_ENTRIES} entries.`);
        if (!safeArchivePath(file.name)) throw new Error('The mail report archive contains an unsafe path.');
        const key = file.name.toLowerCase();
        if (seen.has(key)) throw new Error('The mail report archive repeats an entry path.');
        seen.add(key);
        if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error('The mail report archive contains invalid size metadata.');
        declaredBytes += file.originalSize;
        if (declaredBytes > MAX_MAIL_REPORT_EXPANDED_BYTES) throw new Error('Expanded mail reports exceed the decompression limit.');
        return !file.name.endsWith('/') && /\.(?:xml|json)$/i.test(file.name);
      },
    });
  } catch (cause) {
    if (cause instanceof Error && /limited|unsafe|repeats|invalid|exceed/.test(cause.message)) throw cause;
    throw new Error('The ZIP mail report archive could not be safely decompressed.');
  }
  const output = Object.entries(unpacked).map(([name, value]) => ({ name, bytes: value }));
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
  if (looksLikeGzip(input)) return [{ name: name.replace(/\.gz$/i, '') || 'report', bytes: gunzipBounded(input) }];
  return [{ name: name.slice(0, 180) || 'report', bytes: input.slice() }];
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
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
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

function xmlBlocks(xml: string, tag: string, maximum: number): string[] {
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
      if (values.length < maximum) values.push(xml.slice(openOffset, match.index));
      openOffset = null;
      continue;
    }
    if (openOffset !== null) {
      throw new TypeError(`DMARC XML ${tag} elements must be balanced and non-nested.`);
    }
    if (/\/\s*$/u.test(suffix)) {
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
  const allBlocks = xmlBlocks(feedback, 'record', MAX_DMARC_RECORDS + 1);
  if (!allBlocks.length) throw new TypeError('DMARC feedback must contain at least one record.');
  const truncated = allBlocks.length > MAX_DMARC_RECORDS;
  const records = allBlocks.slice(0, MAX_DMARC_RECORDS).map((block): DmarcAggregateRecord => {
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
    truncated,
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maximum * 2).map((item) => cleanText(item, 253)?.toLowerCase()).filter((item): item is string => Boolean(item)))].slice(0, maximum);
}

function reportTimestamp(value: unknown): string | null {
  const normalized = cleanText(value, 64);
  return normalized ? normalizeExplicitIsoTimestamp(normalized) : null;
}

async function parseTlsAggregateReport(file: ExpandedFile): Promise<TlsAggregateReport> {
  const document = parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), {
    label: 'TLS-RPT report',
    maximumBytes: MAX_MAIL_REPORT_EXPANDED_BYTES,
  });
  const root = object(document);
  const rawPolicies = Array.isArray(root.policies) ? root.policies : [];
  if (!Array.isArray(root.policies)) throw new TypeError('The JSON does not contain a TLS-RPT policies array.');
  const policies = rawPolicies.slice(0, MAX_TLS_POLICIES).map((value): TlsAggregatePolicy => {
    const item = object(value);
    const published = object(item.policy);
    const summary = object(item.summary);
    const rawFailures = Array.isArray(item['failure-details']) ? item['failure-details'] : [];
    const counts = new Map<string, number>();
    for (const raw of rawFailures.slice(0, MAX_TLS_FAILURE_DETAILS)) {
      const failure = object(raw);
      const type = cleanText(failure['result-type'], 100) ?? 'unclassified';
      counts.set(type, (counts.get(type) ?? 0) + boundedCount(failure['failed-session-count'], 'TLS-RPT failed session count'));
    }
    return {
      policyType: cleanText(published['policy-type'], 80),
      policyDomain: cleanText(published['policy-domain'], 253)?.toLowerCase() ?? null,
      mxHosts: Object.freeze(strings(published['mx-host'], 50)),
      successfulSessions: boundedCount(summary['total-successful-session-count'], 'TLS-RPT successful session count'),
      failedSessions: boundedCount(summary['total-failure-session-count'], 'TLS-RPT failure session count'),
      failureTypes: Object.freeze([...counts].map(([type, count]) => Object.freeze({ type, count })).sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)).slice(0, 100)),
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
    successfulSessions: policies.reduce((total, item) => total + item.successfulSessions, 0),
    failedSessions: policies.reduce((total, item) => total + item.failedSessions, 0),
    truncated: rawPolicies.length > MAX_TLS_POLICIES || rawPolicies.some((value) => Array.isArray(object(value)['failure-details']) && (object(value)['failure-details'] as unknown[]).length > MAX_TLS_FAILURE_DETAILS),
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
  const bounded = reports.slice(0, MAX_MAIL_REPORT_ARCHIVE_ENTRIES);
  const dmarc = bounded.filter((report): report is DmarcAggregateReport => report.kind === 'dmarc');
  const tls = bounded.filter((report): report is TlsAggregateReport => report.kind === 'tls-rpt');
  const official = [...new Set(officialDomains.slice(0, 50).map((value) => cleanText(value, 253)?.toLowerCase()).filter((value): value is string => Boolean(value)))].sort();
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
      dmarcDkimPass: dmarc.flatMap((report) => report.records).reduce((total, record) => total + (record.dkim === 'pass' ? record.count : 0), 0),
      dmarcSpfPass: dmarc.flatMap((report) => report.records).reduce((total, record) => total + (record.spf === 'pass' ? record.count : 0), 0),
      dmarcBothFailed: dmarc.flatMap((report) => report.records).reduce((total, record) => total + (record.dkim === 'fail' && record.spf === 'fail' ? record.count : 0), 0),
      tlsSuccessfulSessions: tls.reduce((total, report) => total + report.successfulSessions, 0),
      tlsFailedSessions: tls.reduce((total, report) => total + report.failedSessions, 0),
      truncatedReports: bounded.filter((report) => report.truncated).length,
    },
    profileScope: {
      officialDomains: official,
      outsideScopeDomains: official.length ? observedDomains.filter((domain) => !official.includes(domain)) : [],
    },
    limitations: [
      'Reports are parsed locally and are not independently authenticated or verified against a reporting provider.',
      'Authentication and transport outcomes describe the submitted aggregate reports, not current domain safety or sender intent.',
      'No DNS, SMTP, mailbox, provider, or target request is made during this review.',
    ],
  } as const;
  return Object.freeze({ ...unsigned, integrity: Object.freeze({ algorithm: 'SHA-256', digestSha256: await sha256ArtifactDigest(unsigned) }) });
}
