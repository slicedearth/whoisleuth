import { Buffer } from 'node:buffer';
import { getDomain } from 'tldts';

import { analyzeTlsaEvidence, type TlsaEvidenceReport } from '../lib/tlsa-evidence.mts';
import { CliUsageError } from './errors.mts';

export const CLI_MAIL_REVIEW_SCHEMA = 'whoisleuth.cli.mail-review';
export const CLI_MAIL_REVIEW_VERSION = 2;
export const MAX_MAIL_REVIEW_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_MAIL_REVIEW_ROWS = 500;

type UnknownRecord = Record<string, unknown>;
type MailState = 'authenticated_mail' | 'evidence_incomplete' | 'mail_auth_gap' | 'mail_auth_incomplete' | 'no_explicit_mx' | 'null_mx';

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, maximum = 500): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function mxHosts(availability: UnknownRecord, summary: UnknownRecord): string[] {
  const direct = Array.isArray(availability.mxHosts) ? availability.mxHosts : [];
  const summarized = Array.isArray(summary.mx) ? summary.mx : [];
  const output = new Set<string>();
  for (const candidate of [...direct, ...summarized].slice(0, 200)) {
    const normalized = text(candidate, 300).replace(/^\d+\s+/u, '').replace(/\.$/u, '').toLowerCase();
    if (normalized && normalized.length <= 253) output.add(normalized);
    if (output.size >= 50) break;
  }
  return [...output];
}

function providerDomains(hosts: readonly string[]): string[] {
  return [...new Set(hosts.flatMap((host) => {
    const labels = host.split('.').filter(Boolean);
    const domain = getDomain(host, { allowPrivateDomains: true })
      ?? (labels.length >= 2 ? labels.slice(-2).join('.') : null);
    return domain ? [domain.toLowerCase()] : [];
  }))].sort().slice(0, 20);
}

function mailState(input: Readonly<{
  dnsStatus: string;
  hasMx: boolean | null;
  hasNullMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
}>): MailState {
  if (!['success', 'partial'].includes(input.dnsStatus)) return 'evidence_incomplete';
  if (input.hasNullMx === true) return 'null_mx';
  if (input.hasMx === true) {
    if (input.hasSpf === true && input.hasDmarc === true) return 'authenticated_mail';
    if (input.hasSpf === false || input.hasDmarc === false) return 'mail_auth_gap';
    return 'mail_auth_incomplete';
  }
  if (input.hasMx === false && input.hasNullMx === false) return 'no_explicit_mx';
  return 'evidence_incomplete';
}

function alignMailDaneEvidence(report: TlsaEvidenceReport, hosts: readonly string[]): TlsaEvidenceReport {
  const aligned = report.service?.transport === 'tcp'
    && report.service.port === 25
    && hosts.includes(report.service.hostname);
  if (aligned || report.state === 'invalid') return report;
  return Object.freeze({
    ...report,
    state: 'invalid' as const,
    limitations: Object.freeze([
      ...report.limitations,
      'The TLSA service name did not identify port 25 on an MX hostname retained for this domain.',
    ]),
  });
}

function normalizeMailRow(value: unknown) {
  const item = record(value);
  if (item.ok !== true) return null;
  const availability = record(item.availability);
  const summary = record(item.dnsSummary);
  const domain = text(item.registrableDomain ?? item.query ?? availability.domain, 253).toLowerCase().replace(/\.$/u, '');
  if (!domain || !domain.includes('.')) return null;
  const dns = record(availability.dns);
  const dnsStatus = text(summary.status ?? dns.status, 40).toLowerCase() || 'unavailable';
  const hosts = mxHosts(availability, summary);
  const hasMx = boolean(availability.hasMx) ?? (hosts.length ? true : null);
  const hasNullMx = boolean(availability.hasNullMx) ?? boolean(summary.hasNullMx);
  const hasSpf = boolean(availability.hasSpf) ?? boolean(summary.hasSpf);
  const hasDmarc = boolean(availability.hasDmarc) ?? boolean(summary.hasDmarc);
  const state = mailState({ dnsStatus, hasMx, hasNullMx, hasSpf, hasDmarc });
  const tlsaInput = record(item.tlsaEvidence);
  const dane = Object.keys(tlsaInput).length
    ? alignMailDaneEvidence(analyzeTlsaEvidence({
        serviceName: tlsaInput.serviceName,
        dnssecState: tlsaInput.dnssecState,
        pkixValidationState: tlsaInput.pkixValidationState,
        records: tlsaInput.records,
        certificateDerBase64: tlsaInput.certificateDerBase64,
        spkiDerBase64: tlsaInput.spkiDerBase64,
        authorityMaterials: tlsaInput.authorityMaterials,
      }), hosts)
    : null;
  return {
    domain,
    state,
    dnsStatus,
    hasMx,
    hasNullMx,
    hasSpf,
    hasDmarc,
    mxHosts: hosts,
    providerDomains: providerDomains(hosts),
    dane,
    limitations: [
      ...(dnsStatus === 'partial' ? ['DNS evidence was partial.'] : []),
      ...(state === 'no_explicit_mx' ? ['No explicit MX is not equivalent to a null MX or proof that delivery is impossible.'] : []),
      ...(dane?.state === 'matched' ? [] : dane ? ['Supplied TLSA evidence did not establish one complete DNSSEC-validated match.'] : ['No TLSA evidence was supplied for offline DANE comparison.']),
      'Mail configuration does not establish use, control, intent, safety, or maliciousness.',
    ],
  };
}

function parseInput(textValue: unknown): UnknownRecord[] {
  if (typeof textValue !== 'string' || Buffer.byteLength(textValue, 'utf8') > MAX_MAIL_REVIEW_INPUT_BYTES) {
    throw new CliUsageError(`Mail review input is limited to ${MAX_MAIL_REVIEW_INPUT_BYTES} bytes.`);
  }
  const textInput = textValue.replace(/^\uFEFF/u, '').trim();
  if (!textInput) throw new CliUsageError('Mail review requires one Bulk JSON or JSONL document.');
  let values: unknown[];
  try {
    const parsed = JSON.parse(textInput);
    const document = record(parsed);
    if (document.schema === 'whoisleuth.cli.bulk' && [2, 3].includes(Number(document.version)) && Array.isArray(document.results)) {
      values = document.results;
    } else if (document.schema === 'whoisleuth.cli.bulk.item' && [2, 3].includes(Number(document.version))) {
      values = [document];
    } else {
      throw new CliUsageError('Mail review requires WHOISleuth Bulk JSON schema version 2 or 3.');
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    try {
      values = textInput.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      throw new CliUsageError('Mail review input must be valid WHOISleuth Bulk JSON or JSONL.');
    }
  }
  if (!values.length || values.length > MAX_MAIL_REVIEW_ROWS) {
    throw new CliUsageError(`Mail review supports between 1 and ${MAX_MAIL_REVIEW_ROWS} Bulk rows.`);
  }
  const rows = values.map((value) => record(value));
  if (rows.some((value) => value.schema !== 'whoisleuth.cli.bulk.item' || ![2, 3].includes(Number(value.version)))) {
    throw new CliUsageError('Every Mail review row must use WHOISleuth Bulk item schema version 2 or 3.');
  }
  return rows;
}

function buildCliMailReview(textValue: unknown, generatedAt = new Date().toISOString()) {
  const inputRows = parseInput(textValue);
  const rows = inputRows.map(normalizeMailRow).filter((row): row is NonNullable<ReturnType<typeof normalizeMailRow>> => Boolean(row));
  if (!rows.length) throw new CliUsageError('Mail review input contains no completed domain results.');
  const counts: Record<MailState, number> = {
    authenticated_mail: 0,
    evidence_incomplete: 0,
    mail_auth_gap: 0,
    mail_auth_incomplete: 0,
    no_explicit_mx: 0,
    null_mx: 0,
  };
  for (const row of rows) counts[row.state] += 1;
  const daneCounts: Record<TlsaEvidenceReport['state'] | 'not_supplied', number> = {
    matched: 0,
    different: 0,
    partial: 0,
    untrusted: 0,
    unavailable: 0,
    invalid: 0,
    not_supplied: 0,
  };
  for (const row of rows) daneCounts[row.dane?.state ?? 'not_supplied'] += 1;
  const providerMap = new Map<string, string[]>();
  for (const row of rows) {
    for (const provider of row.providerDomains) {
      const domains = providerMap.get(provider) ?? [];
      domains.push(row.domain);
      providerMap.set(provider, domains);
    }
  }
  const providerRelationships = [...providerMap.entries()]
    .filter(([, domains]) => new Set(domains).size >= 2)
    .map(([providerDomain, domains]) => ({
      providerDomain,
      domains: [...new Set(domains)].sort().slice(0, 100),
      method: 'Shared registrable domain of an observed MX hostname',
      limitation: 'Shared mail providers are common and do not establish common ownership, control, intent, safety, or maliciousness.',
    }))
    .sort((left, right) => left.providerDomain.localeCompare(right.providerDomain))
    .slice(0, 100);
  return {
    schema: CLI_MAIL_REVIEW_SCHEMA,
    version: CLI_MAIL_REVIEW_VERSION,
    generatedAt,
    counts,
    daneCounts,
    rows,
    providerRelationships,
    limitations: [
      'This review is passive and uses DNS evidence already retained in a WHOISleuth Bulk result; it makes no network request.',
      'Null MX, no explicit MX, receiving mail, authentication gaps, and incomplete evidence remain separate states.',
      'Optional TLSA evidence is compared offline. A DANE match requires separately validated DNSSEC evidence from the same observation.',
      'SMTP delivery, mailbox existence, catch-all behaviour, banner collection, and message acceptance were not tested.',
    ],
  };
}

function formatCliMailReview(document: ReturnType<typeof buildCliMailReview>): string {
  const lines = [
    'Passive mail exposure review',
    `Domains          ${document.rows.length}`,
    `Authenticated    ${document.counts.authenticated_mail}`,
    `Auth gaps        ${document.counts.mail_auth_gap}`,
    `Null MX          ${document.counts.null_mx}`,
    `No explicit MX   ${document.counts.no_explicit_mx}`,
    `Incomplete       ${document.counts.evidence_incomplete + document.counts.mail_auth_incomplete}`,
    `DANE matched     ${document.daneCounts.matched}`,
    '',
  ];
  for (const row of document.rows) {
    lines.push(`${row.domain}  ${row.state.replaceAll('_', ' ')}`);
    lines.push(`  MX providers  ${row.providerDomains.join(', ') || 'None observed'}`);
    lines.push(`  SPF / DMARC   ${row.hasSpf === null ? 'unknown' : row.hasSpf ? 'observed' : 'not observed'} / ${row.hasDmarc === null ? 'unknown' : row.hasDmarc ? 'observed' : 'not observed'}`);
    lines.push(`  DANE / TLSA   ${row.dane?.state ?? 'not supplied'}`);
  }
  if (document.providerRelationships.length) {
    lines.push('', 'Shared mail-provider relationships');
    for (const relationship of document.providerRelationships) {
      lines.push(`${relationship.providerDomain}  ${relationship.domains.join(', ')}`);
    }
  }
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export { alignMailDaneEvidence, buildCliMailReview, formatCliMailReview, mailState, normalizeMailRow };
