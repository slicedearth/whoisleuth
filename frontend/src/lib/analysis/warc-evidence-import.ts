import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  parseExternalFindingsDocument,
  type ExternalFindingsDocument,
} from './external-findings-import.ts';
import { normalizeDomain } from './case-model.ts';

export const MAX_WARC_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_WARC_RECORDS = 100;
export const MAX_WARC_RECORD_BYTES = 1024 * 1024;
export const MAX_WARC_FINDINGS = 25;

export type WarcImportReport = Readonly<{
  document: ExternalFindingsDocument;
  archiveDigestSha256: string;
  records: number;
  responses: number;
  accepted: number;
  excluded: number;
  exclusions: readonly string[];
}>;

type HeaderMap = Map<string, string>;
type ParsedRecord = Readonly<{
  headers: HeaderMap;
  block: Uint8Array;
}>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SHA_HEX_RE = /^[a-f0-9]+$/iu;
const BASE32_RE = /^[a-z2-7]+$/iu;
const MAX_EXCLUSIONS = 20;
const MAX_TITLE_LENGTH = 240;

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes);
}

function headerMap(lines: readonly string[], label: string): HeaderMap {
  const headers = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`${label} contains a malformed header.`);
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!/^[a-z0-9-]{1,64}$/u.test(name) || !value || value.length > 4096 || CONTROL_RE.test(value)) {
      throw new Error(`${label} contains an invalid header.`);
    }
    if (headers.has(name)) throw new Error(`${label} repeats the ${name} header.`);
    headers.set(name, value);
  }
  return headers;
}

function recordSeparator(source: string, start: number): { index: number; length: number } | null {
  const crlf = source.indexOf('\r\n\r\n', start);
  const lf = source.indexOf('\n\n', start);
  if (crlf < 0 && lf < 0) return null;
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseWarcRecords(bytes: Uint8Array): ParsedRecord[] {
  const source = decodeLatin1(bytes);
  const records: ParsedRecord[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    while (source.startsWith('\r\n', offset) || source.startsWith('\n', offset)) {
      offset += source.startsWith('\r\n', offset) ? 2 : 1;
    }
    if (offset >= bytes.byteLength) break;
    if (!source.startsWith('WARC/1.0', offset) && !source.startsWith('WARC/1.1', offset)) {
      throw new Error(`WARC record ${records.length + 1} does not begin with a supported WARC version.`);
    }
    const separator = recordSeparator(source, offset);
    if (!separator || separator.index - offset > 64 * 1024) {
      throw new Error(`WARC record ${records.length + 1} has no bounded header block.`);
    }
    const lines = source.slice(offset, separator.index).split(/\r?\n/u);
    lines.shift();
    const headers = headerMap(lines, `WARC record ${records.length + 1}`);
    const contentLength = Number(headers.get('content-length'));
    if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > MAX_WARC_RECORD_BYTES) {
      throw new Error(`WARC record ${records.length + 1} has an invalid or excessive Content-Length.`);
    }
    const blockStart = separator.index + separator.length;
    const blockEnd = blockStart + contentLength;
    if (blockEnd > bytes.byteLength) throw new Error(`WARC record ${records.length + 1} is truncated.`);
    records.push(Object.freeze({
      headers,
      block: bytes.slice(blockStart, blockEnd),
    }));
    if (records.length > MAX_WARC_RECORDS) {
      throw new Error(`WARC imports are limited to ${MAX_WARC_RECORDS} records.`);
    }
    offset = blockEnd;
  }
  if (!records.length) throw new Error('The selected file contains no WARC records.');
  return records;
}

function parseHttpResponse(block: Uint8Array, recordNumber: number): Readonly<{
  status: number;
  headers: HeaderMap;
  body: Uint8Array;
}> {
  const source = decodeLatin1(block);
  const separator = recordSeparator(source, 0);
  if (!separator || separator.index > 64 * 1024) {
    throw new Error(`WARC response ${recordNumber} has no bounded HTTP header block.`);
  }
  const lines = source.slice(0, separator.index).split(/\r?\n/u);
  const statusLine = lines.shift() ?? '';
  const match = /^HTTP\/1\.[01]\s+([1-5][0-9]{2})(?:\s|$)/u.exec(statusLine);
  if (!match) throw new Error(`WARC response ${recordNumber} has an invalid HTTP status line.`);
  return Object.freeze({
    status: Number(match[1]),
    headers: headerMap(lines, `WARC response ${recordNumber}`),
    body: block.slice(separator.index + separator.length),
  });
}

function safeTarget(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > 2048 || CONTROL_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function cleanTitle(html: string): string | null {
  const match = /<title(?:\s[^>]*)?>([\s\S]{1,4096}?)<\/title\s*>/iu.exec(html);
  if (!match?.[1]) return null;
  const title = match[1]
    .replace(/<[^>]{0,512}>/gu, ' ')
    .replace(/&(?:amp|#38);/giu, '&')
    .replace(/&(?:lt|#60);/giu, '<')
    .replace(/&(?:gt|#62);/giu, '>')
    .replace(/&(?:quot|#34);/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return title && !CONTROL_RE.test(title) ? title : null;
}

function base32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

async function sha(bytes: Uint8Array, algorithm: 'SHA-1' | 'SHA-256'): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new Error('Browser cryptography is unavailable for WARC integrity verification.');
  const digest = await globalThis.crypto.subtle.digest(algorithm, bytes as Uint8Array<ArrayBuffer>);
  return new Uint8Array(digest);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifyBlockDigest(block: Uint8Array, value: string | undefined): Promise<'verified' | 'missing' | 'unsupported' | 'mismatch'> {
  if (!value) return 'missing';
  const separator = value.indexOf(':');
  if (separator <= 0) return 'unsupported';
  const name = value.slice(0, separator).toLowerCase();
  const expected = value.slice(separator + 1).replace(/=+$/u, '');
  if (!['sha1', 'sha256'].includes(name) || (!SHA_HEX_RE.test(expected) && !BASE32_RE.test(expected))) {
    return 'unsupported';
  }
  const calculated = await sha(block, name === 'sha1' ? 'SHA-1' : 'SHA-256');
  const encoded = SHA_HEX_RE.test(expected) && expected.length === calculated.length * 2
    ? hex(calculated)
    : base32(calculated);
  return encoded.toLowerCase() === expected.toLowerCase() ? 'verified' : 'mismatch';
}

function addExclusion(exclusions: string[], value: string): void {
  if (!exclusions.includes(value) && exclusions.length < MAX_EXCLUSIONS) exclusions.push(value);
}

export async function parseWarcEvidenceArchive(
  input: ArrayBuffer,
  fileName = 'evidence.warc',
): Promise<WarcImportReport> {
  if (!input.byteLength || input.byteLength > MAX_WARC_IMPORT_BYTES) {
    throw new Error(`WARC imports must be between 1 byte and ${MAX_WARC_IMPORT_BYTES} bytes.`);
  }
  if (!fileName.toLowerCase().endsWith('.warc')) {
    throw new Error('Portable archive import currently accepts uncompressed .warc files only.');
  }
  const bytes = new Uint8Array(input);
  const archiveDigestSha256 = hex(await sha(bytes, 'SHA-256'));
  const records = parseWarcRecords(bytes);
  const exclusions: string[] = [];
  const findings: Array<Record<string, unknown>> = [];
  let responses = 0;
  let earliestTimestamp = Number.POSITIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const type = record.headers.get('warc-type')?.toLowerCase();
    if (type !== 'response') {
      addExclusion(exclusions, type === 'request'
        ? 'Request records, request bodies, cookies, and authorization material were excluded.'
        : `WARC ${type || 'unknown'} records were excluded.`);
      continue;
    }
    responses += 1;
    const target = safeTarget(record.headers.get('warc-target-uri'));
    if (!target) {
      addExclusion(exclusions, 'A response with an invalid, credentialed, or unsupported target URI was excluded.');
      continue;
    }
    const domain = normalizeDomain(target.hostname);
    if (!domain) {
      addExclusion(exclusions, 'A response outside the supported domain target model was excluded.');
      continue;
    }
    const warcDate = record.headers.get('warc-date');
    const observedAt = warcDate && Number.isFinite(Date.parse(warcDate))
      ? new Date(warcDate).toISOString()
      : null;
    if (!observedAt) {
      addExclusion(exclusions, 'A response without a valid WARC-Date was excluded.');
      continue;
    }
    earliestTimestamp = Math.min(earliestTimestamp, Date.parse(observedAt));
    const http = parseHttpResponse(record.block, index + 1);
    if (
      http.headers.has('set-cookie')
      || http.headers.has('cookie')
      || http.headers.has('authorization')
      || http.headers.has('proxy-authorization')
    ) {
      addExclusion(exclusions, 'A response containing cookie or authorization material was excluded.');
      continue;
    }
    if (/attachment/iu.test(http.headers.get('content-disposition') ?? '')) {
      addExclusion(exclusions, 'A downloadable response was excluded.');
      continue;
    }
    if (http.headers.has('content-encoding') && http.headers.get('content-encoding') !== 'identity') {
      addExclusion(exclusions, 'A compressed response body was excluded.');
      continue;
    }
    const mediaType = (http.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
    if (!['text/html', 'application/xhtml+xml'].includes(mediaType ?? '')) {
      addExclusion(exclusions, 'A non-HTML response body was excluded.');
      continue;
    }
    if (http.body.byteLength > 512 * 1024) {
      addExclusion(exclusions, 'An HTML response body exceeded the 512 KiB review bound and was excluded.');
      continue;
    }
    let html: string;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(http.body);
    } catch {
      addExclusion(exclusions, 'A response body that was not valid UTF-8 HTML was excluded.');
      continue;
    }
    const digestState = await verifyBlockDigest(record.block, record.headers.get('warc-block-digest'));
    if (digestState === 'mismatch') {
      addExclusion(exclusions, 'A response whose supported WARC-Block-Digest did not match was excluded.');
      continue;
    }
    if (findings.length >= MAX_WARC_FINDINGS) {
      addExclusion(exclusions, `Only the first ${MAX_WARC_FINDINGS} supported page responses were retained.`);
      continue;
    }
    const title = cleanTitle(html);
    findings.push({
      domain,
      category: 'page',
      summary: [
        `Reviewed WARC page response from ${target.origin}.`,
        title ? `Observed title "${title}".` : '',
        `HTTP status ${http.status}.`,
        `Archive SHA-256 ${archiveDigestSha256}.`,
      ].filter(Boolean).join(' '),
      observedAt,
      completeness: digestState === 'verified' ? 'complete' : 'partial',
      limitations: [
        'Imported locally from an analyst-selected WARC response; WHOISleuth did not collect or independently refresh the target.',
        digestState === 'verified'
          ? 'The supported WARC-Block-Digest matched the retained response block.'
          : digestState === 'missing'
            ? 'The response did not declare a WARC-Block-Digest, so record-level integrity was not verified.'
            : 'The response used an unsupported WARC-Block-Digest representation, so record-level integrity was not verified.',
        'Only normalized origin, title, status, observation time, completeness, limitations, and archive digest were retained.',
      ],
      reference: `urn:sha256:${archiveDigestSha256}`,
    });
  }
  if (!findings.length) {
    throw new Error(`The WARC archive contained no importable HTML response evidence. ${exclusions[0] ?? ''}`.trim());
  }
  const document = parseExternalFindingsDocument({
    schema: EXTERNAL_FINDINGS_SCHEMA,
    schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: {
      name: 'Portable WARC evidence',
      reference: `urn:sha256:${archiveDigestSha256}`,
      collectedAt: Number.isFinite(earliestTimestamp) ? new Date(earliestTimestamp).toISOString() : null,
    },
    findings,
  });
  return Object.freeze({
    document,
    archiveDigestSha256,
    records: records.length,
    responses,
    accepted: document.findings.length,
    excluded: Math.max(0, records.length - document.findings.length),
    exclusions: Object.freeze(exclusions),
  });
}
