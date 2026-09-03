import { Buffer } from 'node:buffer';
import { getDomain } from 'tldts';

import { scanBoundedJson } from '../lib/bounded-json.mts';
import { isValidAsciiDomainName } from '../lib/hostname.mts';
import { isRecord, recordOrEmpty } from '../lib/json-record.mts';
import { CliUsageError } from './errors.mts';

export const CLI_MAIL_REVIEW_SCHEMA = 'whoisleuth.cli.mail-review';
export const CLI_MAIL_REVIEW_VERSION = 3;
export const MAX_MAIL_REVIEW_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_MAIL_REVIEW_ROWS = 500;

type UnknownRecord = Record<string, unknown>;
type MailState = 'authenticated_mail' | 'evidence_incomplete' | 'mail_auth_gap' | 'mail_auth_incomplete' | 'no_explicit_mx' | 'null_mx';
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const UNSAFE_TEXT_GLOBAL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]+/gu;

const record = recordOrEmpty;

function text(value: unknown, maximum = 500): string {
  return typeof value === 'string'
    ? value.replace(UNSAFE_TEXT_GLOBAL_RE, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new CliUsageError(`${label} must be a valid bounded timestamp.`);
  }
  return new Date(value).toISOString();
}

function booleanOrNull(value: unknown, label: string): boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  throw new CliUsageError(`${label} must be true, false, or null.`);
}

const DNS_STATES = new Set([
  'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped',
  'disabled', 'not_applicable', 'unavailable', 'rate_limited',
]);

type ParsedMxValues = Readonly<{ hosts: readonly string[]; nullMx: boolean }>;

function parseMxValues(value: unknown, label: string): ParsedMxValues {
  if (!Array.isArray(value) || value.length > 100) {
    throw new CliUsageError(`${label} must be a bounded MX string array.`);
  }
  const hosts = new Set<string>();
  let nullMx = false;
  for (const [index, candidate] of value.entries()) {
    const itemLabel = `${label} item ${index + 1}`;
    if (typeof candidate !== 'string' || candidate.length < 1 || candidate.length > 300
      || candidate.trim() !== candidate || UNSAFE_TEXT_RE.test(candidate)) {
      throw new CliUsageError(`${itemLabel} is not a safe canonical MX value.`);
    }
    const match = /^(?:(\d{1,5}) )?([^\s]+)$/u.exec(candidate);
    if (!match || (match[1] !== undefined && Number(match[1]) > 65_535)) {
      throw new CliUsageError(`${itemLabel} is not a valid MX priority and hostname.`);
    }
    const exchange = match[2];
    if (!exchange) throw new CliUsageError(`${itemLabel} is missing its MX hostname.`);
    if (exchange === '.') {
      nullMx = true;
      continue;
    }
    const hostname = exchange.replace(/\.$/u, '').toLowerCase();
    if (!isValidAsciiDomainName(hostname, { requireDot: true, requireLowercase: true })) {
      throw new CliUsageError(`${itemLabel} is not a valid ASCII MX hostname.`);
    }
    hosts.add(hostname);
  }
  if (nullMx && hosts.size) throw new CliUsageError(`${label} mixes a null MX marker with mail hosts.`);
  return Object.freeze({ hosts: Object.freeze([...hosts].sort()), nullMx });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateMxEvidence(
  availability: UnknownRecord,
  summary: UnknownRecord,
  label: string,
  hasMx: boolean | null,
  hasNullMx: boolean | null,
): readonly string[] {
  const direct = parseMxValues(availability.mxHosts, `${label} availability MX hosts`);
  const summarized = parseMxValues(summary.mx, `${label} DNS summary MX hosts`);
  if (!sameStrings(direct.hosts, summarized.hosts)) {
    throw new CliUsageError(`${label} has inconsistent availability and DNS summary MX hosts.`);
  }
  if ((direct.nullMx || summarized.nullMx) && hasNullMx !== true) {
    throw new CliUsageError(`${label} has a null MX marker without matching null-MX evidence.`);
  }
  if (hasNullMx === true && (hasMx !== false || summarized.hosts.length > 0)) {
    throw new CliUsageError(`${label} has contradictory null-MX and mail-host evidence.`);
  }
  return summarized.hosts;
}

function validateMailRow(value: unknown, index: number, expectedVersion: number | null): UnknownRecord {
  const item = record(value);
  const label = `Mail review row ${index + 1}`;
  const version = Number(item.version);
  if (item.schema !== 'whoisleuth.cli.bulk.item' || ![2, 3].includes(version)
    || (expectedVersion !== null && version !== expectedVersion)) {
    throw new CliUsageError(`${label} must use the matching WHOISleuth Bulk item schema version 2 or 3.`);
  }
  timestamp(item.generatedAt, `${label} generation time`);
  if (version === 3
    && (!(item.observedAt === null || (typeof item.observedAt === 'string' && timestamp(item.observedAt, `${label} observation time`)))
      || !['current_run', 'resumed_checkpoint'].includes(String(item.collectionOrigin)))) {
    throw new CliUsageError(`${label} has invalid version 3 collection provenance.`);
  }
  if (item.ok === false) {
    if (typeof item.query !== 'string' || !item.query || item.query.length > 2_048
      || typeof item.error !== 'string' || !item.error || item.error.length > 500) {
      throw new CliUsageError(`${label} contains an invalid failed result.`);
    }
    return item;
  }
  const availability = record(item.availability);
  const diagnostics = record(item.diagnostics);
  const summary = record(item.dnsSummary);
  const domain = item.registrableDomain;
  const inputHostname = item.inputHostname;
  if (item.ok !== true || item.type !== 'domain' || typeof item.query !== 'string' || !item.query
    || typeof domain !== 'string' || !isValidAsciiDomainName(domain, { requireDot: true, requireLowercase: true })
    || typeof inputHostname !== 'string' || !isValidAsciiDomainName(inputHostname, { requireDot: true, requireLowercase: true })
    || getDomain(inputHostname, { allowPrivateDomains: true }) !== domain
    || typeof item.isSubdomain !== 'boolean' || !['fast', 'deep'].includes(String(item.mode))
    || !isRecord(item.availability) || !isRecord(item.diagnostics) || !isRecord(item.dnsSummary)) {
    throw new CliUsageError(`${label} does not match a completed domain Bulk result.`);
  }
  const dns = record(availability.dns);
  const dnsStatus = text(summary.status, 40).toLowerCase();
  if (!DNS_STATES.has(dnsStatus) || text(dns.status, 40).toLowerCase() !== dnsStatus) {
    throw new CliUsageError(`${label} has missing or inconsistent DNS source status.`);
  }
  for (const key of ['a', 'aaaa', 'ns', 'mx']) {
    if (!Array.isArray(summary[key]) || summary[key].length > 100) {
      throw new CliUsageError(`${label} has an invalid bounded DNS ${key} summary.`);
    }
  }
  const summaryNullMx = booleanOrNull(summary.hasNullMx, `${label} null-MX summary`);
  const summarySpf = booleanOrNull(summary.hasSpf, `${label} SPF summary`);
  const summaryDmarc = booleanOrNull(summary.hasDmarc, `${label} DMARC summary`);
  const availabilityMx = booleanOrNull(availability.hasMx, `${label} MX state`);
  const availabilityNullMx = booleanOrNull(availability.hasNullMx, `${label} null-MX state`);
  const availabilitySpf = booleanOrNull(availability.hasSpf, `${label} SPF state`);
  const availabilityDmarc = booleanOrNull(availability.hasDmarc, `${label} DMARC state`);
  if (availabilityNullMx !== summaryNullMx || availabilitySpf !== summarySpf || availabilityDmarc !== summaryDmarc) {
    throw new CliUsageError(`${label} has contradictory DNS and availability mail states.`);
  }
  const summarizedMx = validateMxEvidence(availability, summary, label, availabilityMx, availabilityNullMx);
  if (availabilityMx !== (summarizedMx.length ? true : availabilityNullMx === null ? null : false)) {
    throw new CliUsageError(`${label} has contradictory MX evidence.`);
  }
  return {
    ...item,
    availability: { ...availability, mxHosts: summarizedMx },
    dnsSummary: { ...summary, mx: summarizedMx },
  };
}

function allProviderDomains(hosts: readonly string[]): string[] {
  return [...new Set(hosts.flatMap((host) => {
    const domain = getDomain(host, { allowPrivateDomains: true });
    return domain ? [domain.toLowerCase()] : [];
  }))].sort();
}

function providerDomains(hosts: readonly string[]): { domains: string[]; omitted: number } {
  const domains = allProviderDomains(hosts);
  return { domains: domains.slice(0, 20), omitted: Math.max(0, domains.length - 20) };
}

function mailState(input: Readonly<{
  dnsStatus: string;
  hasMx: boolean | null;
  hasNullMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
}>): MailState {
  if (input.dnsStatus !== 'success') return 'evidence_incomplete';
  if (input.hasNullMx === true) return 'null_mx';
  if (input.hasMx === true) {
    if (input.hasSpf === true && input.hasDmarc === true) return 'authenticated_mail';
    if (input.hasSpf === false || input.hasDmarc === false) return 'mail_auth_gap';
    return 'mail_auth_incomplete';
  }
  if (input.hasMx === false && input.hasNullMx === false) return 'no_explicit_mx';
  return 'evidence_incomplete';
}

function normalizeMailRow(value: unknown) {
  const item = record(value);
  if (item.ok !== true) return null;
  const availability = record(item.availability);
  const summary = record(item.dnsSummary);
  const domain = text(item.registrableDomain, 253).toLowerCase().replace(/\.$/u, '');
  const dnsStatus = text(summary.status, 40).toLowerCase();
  const hosts = Array.isArray(availability.mxHosts)
    ? availability.mxHosts.filter((value): value is string => typeof value === 'string')
    : [];
  const hasMx = boolean(availability.hasMx);
  const hasNullMx = boolean(availability.hasNullMx);
  const hasSpf = boolean(availability.hasSpf);
  const hasDmarc = boolean(availability.hasDmarc);
  const state = mailState({ dnsStatus, hasMx, hasNullMx, hasSpf, hasDmarc });
  const providers = providerDomains(hosts);
  return {
    domain,
    state,
    dnsStatus,
    hasMx,
    hasNullMx,
    hasSpf,
    hasDmarc,
    mxHosts: hosts,
    providerDomains: providers.domains,
    providerDomainsOmitted: providers.omitted,
    providerDomainsTruncated: providers.omitted > 0,
    limitations: [
      ...(dnsStatus === 'partial' ? ['DNS evidence was partial.'] : []),
      ...(state === 'no_explicit_mx' ? ['No explicit MX is not equivalent to a null MX or proof that delivery is impossible.'] : []),
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
  let containerVersion: number | null = null;
  try {
    scanBoundedJson(textInput);
    const parsed = JSON.parse(textInput);
    const document = record(parsed);
    if (document.schema === 'whoisleuth.cli.bulk' && [2, 3].includes(Number(document.version)) && Array.isArray(document.results)) {
      values = document.results;
      containerVersion = Number(document.version);
      timestamp(document.generatedAt, 'Mail review Bulk generation time');
    } else if (document.schema === 'whoisleuth.cli.bulk.item' && [2, 3].includes(Number(document.version))) {
      values = [document];
    } else {
      throw new CliUsageError('Mail review requires WHOISleuth Bulk JSON schema version 2 or 3.');
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    try {
      values = textInput.split(/\r?\n/u).filter(Boolean).map((line) => {
        scanBoundedJson(line);
        return JSON.parse(line);
      });
    } catch {
      throw new CliUsageError('Mail review input must be valid WHOISleuth Bulk JSON or JSONL.');
    }
  }
  if (!values.length || values.length > MAX_MAIL_REVIEW_ROWS) {
    throw new CliUsageError(`Mail review supports between 1 and ${MAX_MAIL_REVIEW_ROWS} Bulk rows.`);
  }
  return values.map((value, index) => validateMailRow(value, index, containerVersion));
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
  const providerMap = new Map<string, string[]>();
  for (const row of rows) {
    // Row presentation is capped at 20 providers, but correlation operates on
    // the complete already-validated MX set (itself bounded to 100 entries).
    for (const provider of allProviderDomains(row.mxHosts)) {
      const domains = providerMap.get(provider) ?? [];
      domains.push(row.domain);
      providerMap.set(provider, domains);
    }
  }
  const allProviderRelationships = [...providerMap.entries()]
    .filter(([, domains]) => new Set(domains).size >= 2)
    .map(([providerDomain, domains]) => {
      const uniqueDomains = [...new Set(domains)].sort();
      const omittedDomains = Math.max(0, uniqueDomains.length - 100);
      return {
        providerDomain,
        domains: uniqueDomains.slice(0, 100),
        domainCount: uniqueDomains.length,
        domainsTruncated: omittedDomains > 0,
        omittedDomains,
        method: 'Shared registrable domain of an observed MX hostname',
        limitation: 'Shared mail providers are common and do not establish common ownership, control, intent, safety, or maliciousness.',
      };
    })
    .sort((left, right) => left.providerDomain.localeCompare(right.providerDomain));
  const providerRelationships = allProviderRelationships.slice(0, 100);
  const providerCoverage = {
    complete: rows.every((row) => !row.providerDomainsTruncated)
      && allProviderRelationships.length <= 100
      && allProviderRelationships.every((relationship) => !relationship.domainsTruncated),
    rowsWithOmittedProviders: rows.filter((row) => row.providerDomainsTruncated).length,
    omittedProviderDomains: rows.reduce((sum, row) => sum + row.providerDomainsOmitted, 0),
    relationshipCount: allProviderRelationships.length,
    retainedRelationshipCount: providerRelationships.length,
    omittedRelationships: Math.max(0, allProviderRelationships.length - 100),
    omittedRelationshipDomains: allProviderRelationships.reduce((sum, relationship) => sum + relationship.omittedDomains, 0),
  };
  return {
    schema: CLI_MAIL_REVIEW_SCHEMA,
    version: CLI_MAIL_REVIEW_VERSION,
    generatedAt,
    counts,
    rows,
    providerRelationships,
    providerCoverage,
    limitations: [
      'This review is passive and uses DNS evidence already retained in a WHOISleuth Bulk result; it makes no network request.',
      'Null MX, no explicit MX, receiving mail, authentication gaps, and incomplete evidence remain separate states.',
      'SMTP delivery, mailbox existence, catch-all behaviour, banner collection, and message acceptance were not tested.',
      ...(!providerCoverage.complete
        ? ['Mail-provider relationship coverage reached a configured row, relationship, or domain bound; omitted relationships remain unknown.']
        : []),
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
    '',
  ];
  for (const row of document.rows) {
    lines.push(`${row.domain}  ${row.state.replaceAll('_', ' ')}`);
    lines.push(`  MX providers  ${row.providerDomains.join(', ') || 'None observed'}${row.providerDomainsOmitted ? ` · +${row.providerDomainsOmitted} omitted` : ''}`);
    lines.push(`  SPF / DMARC   ${row.hasSpf === null ? 'unknown' : row.hasSpf ? 'observed' : 'not observed'} / ${row.hasDmarc === null ? 'unknown' : row.hasDmarc ? 'observed' : 'not observed'}`);
  }
  if (document.providerRelationships.length) {
    lines.push('', 'Shared mail-provider relationships');
    for (const relationship of document.providerRelationships) {
      lines.push(`${relationship.providerDomain}  ${relationship.domains.join(', ')}${relationship.omittedDomains ? ` · +${relationship.omittedDomains} omitted` : ''}`);
    }
  }
  if (!document.providerCoverage.complete) {
    lines.push('', `Provider coverage partial  ${document.providerCoverage.omittedProviderDomains} row providers · ${document.providerCoverage.omittedRelationships} relationships · ${document.providerCoverage.omittedRelationshipDomains} relationship domains omitted`);
  }
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}

export { buildCliMailReview, formatCliMailReview, mailState, normalizeMailRow };
