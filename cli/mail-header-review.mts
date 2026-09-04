import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { isValidAsciiDomainName } from '../lib/hostname.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { CliUsageError } from './errors.mts';

export const CLI_MAIL_HEADER_REVIEW_SCHEMA = 'whoisleuth.cli.mail-header-review';
export const CLI_MAIL_HEADER_REVIEW_VERSION = 1;
export const MAX_MAIL_HEADER_INPUT_BYTES = 256 * 1024;
export const MAX_MAIL_HEADER_FIELDS = 512;
export const MAX_MAIL_HEADER_LINE_BYTES = 4 * 1024;
export const MAX_MAIL_HEADER_VALUE_LENGTH = 16 * 1024;
export const MAX_MAIL_RECEIVED_HOPS = 64;
export const MAX_MAIL_REVIEW_DOMAINS = 128;

type HeaderField = Readonly<{ name: string; value: string }>;
type AuthenticationMethod = 'arc' | 'dkim' | 'dmarc' | 'spf';
type AuthenticationState = 'fail' | 'mixed' | 'neutral' | 'none' | 'pass' | 'permerror' | 'softfail' | 'temperror' | 'unknown';
type DomainRole = 'authentication_service' | 'dkim_signer' | 'from' | 'message_id' | 'received_by' | 'received_from' | 'reply_to' | 'return_path';

const UNSAFE_HEADER_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,78}$/u;
const AUTHENTICATION_METHODS = Object.freeze(['spf', 'dkim', 'dmarc', 'arc'] as const);
const AUTHENTICATION_STATES = new Set<string>(['fail', 'neutral', 'none', 'pass', 'permerror', 'softfail', 'temperror']);

function boundedHeaderSection(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new CliUsageError('Mail-header review requires one UTF-8 message or header block.');
  const candidate = value.slice(0, MAX_MAIL_HEADER_INPUT_BYTES * 2 + 4);
  const crlf = candidate.indexOf('\r\n\r\n');
  const lf = candidate.indexOf('\n\n');
  const separator = crlf < 0 ? lf : lf < 0 ? crlf : Math.min(crlf, lf);
  const header = separator >= 0 ? candidate.slice(0, separator) : candidate;
  const bytes = Buffer.byteLength(header, 'utf8');
  if (bytes < 1 || bytes > MAX_MAIL_HEADER_INPUT_BYTES || (separator < 0 && value.length > candidate.length)) {
    throw new CliUsageError(`Mail headers are limited to ${MAX_MAIL_HEADER_INPUT_BYTES} bytes before the message body.`);
  }
  return header;
}

function parseHeaderFields(value: unknown): Readonly<{ fields: readonly HeaderField[]; bytes: number }> {
  const header = boundedHeaderSection(value);
  const physicalLines = header.split(/\r\n|\n/u);
  if (physicalLines.at(-1) === '') physicalLines.pop();
  const fields: Array<{ name: string; value: string }> = [];
  for (const [index, line] of physicalLines.entries()) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MAIL_HEADER_LINE_BYTES) {
      throw new CliUsageError(`Mail header line ${index + 1} exceeds the ${MAX_MAIL_HEADER_LINE_BYTES}-byte limit.`);
    }
    if (UNSAFE_HEADER_CONTROL_RE.test(line)) throw new CliUsageError(`Mail header line ${index + 1} contains unsafe control characters.`);
    if (/^[ \t]/u.test(line)) {
      const previous = fields.at(-1);
      if (!previous) throw new CliUsageError('Mail headers contain a continuation without a preceding field.');
      const continuation = line.trim();
      const combined = continuation ? `${previous.value} ${continuation}` : previous.value;
      if (combined.length > MAX_MAIL_HEADER_VALUE_LENGTH) throw new CliUsageError(`Mail header ${previous.name} exceeds its unfolded value limit.`);
      previous.value = combined;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 1) throw new CliUsageError(`Mail header line ${index + 1} is malformed.`);
    const name = line.slice(0, separator);
    const fieldValue = line.slice(separator + 1).trim();
    if (!HEADER_NAME_RE.test(name)) throw new CliUsageError(`Mail header line ${index + 1} has an invalid field name.`);
    if (fieldValue.length > MAX_MAIL_HEADER_VALUE_LENGTH) throw new CliUsageError(`Mail header ${name} exceeds its unfolded value limit.`);
    fields.push({ name: name.toLowerCase(), value: fieldValue });
    if (fields.length > MAX_MAIL_HEADER_FIELDS) throw new CliUsageError(`Mail headers contain more than ${MAX_MAIL_HEADER_FIELDS} fields.`);
  }
  if (!fields.length) throw new CliUsageError('Mail-header review did not find any header fields.');
  return Object.freeze({
    fields: Object.freeze(fields.map((field) => Object.freeze({ ...field }))),
    bytes: Buffer.byteLength(header, 'utf8'),
  });
}

function fieldsNamed(fields: readonly HeaderField[], name: string): string[] {
  return fields.filter((field) => field.name === name).map((field) => field.value);
}

function normalizeHeaderDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  return isValidAsciiDomainName(normalized, { requireLowercase: true }) ? normalized : null;
}

function addressDomains(values: readonly string[]): string[] {
  const domains = new Set<string>();
  for (const value of values) {
    const bracketed = [...value.matchAll(/<([^<>]{1,320})>/gu)].map((match) => match[1] ?? '');
    for (const candidate of bracketed.length ? bracketed : [value]) {
      for (const match of candidate.matchAll(/@([A-Za-z0-9.-]{1,253})/gu)) {
        const domain = normalizeHeaderDomain(match[1] ?? '');
        if (domain) domains.add(domain);
        if (domains.size >= MAX_MAIL_REVIEW_DOMAINS) return [...domains].sort();
      }
    }
  }
  return [...domains].sort();
}

function messageIdDomains(values: readonly string[]): string[] {
  return addressDomains(values.map((value) => value.replace(/[<>]/gu, '')));
}

function authenticationState(
  values: readonly string[],
  method: AuthenticationMethod,
  directValues: readonly string[] = [],
): Readonly<{ state: AuthenticationState; observations: number }> {
  const states = new Set<string>();
  let observations = 0;
  const expression = new RegExp(`(?:^|[\\s;])${method}=([a-z0-9_-]+)`, 'giu');
  for (const value of values) {
    for (const match of value.matchAll(expression)) {
      observations += 1;
      const raw = (match[1] ?? '').toLowerCase();
      states.add(AUTHENTICATION_STATES.has(raw) ? raw : 'unknown');
    }
  }
  for (const value of directValues) {
    const raw = (value.trim().split(/\s/u, 1)[0] ?? '').toLowerCase();
    if (!raw) continue;
    observations += 1;
    states.add(AUTHENTICATION_STATES.has(raw) ? raw : 'unknown');
  }
  return Object.freeze({
    state: observations === 0 ? 'unknown' : states.size === 1 ? [...states][0] as AuthenticationState : 'mixed',
    observations,
  });
}

function authenticationServiceDomains(values: readonly string[]): string[] {
  const output = new Set<string>();
  for (const value of values) {
    const service = normalizeHeaderDomain((value.split(';', 1)[0] ?? '').split(/\s/u, 1)[0] ?? '');
    if (service) output.add(service);
  }
  return [...output].sort().slice(0, MAX_MAIL_REVIEW_DOMAINS);
}

function dkimSigningDomains(values: readonly string[]): string[] {
  const output = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/(?:^|;)\s*d=([^;\s]+)/giu)) {
      const domain = normalizeHeaderDomain(match[1] ?? '');
      if (domain) output.add(domain);
    }
  }
  return [...output].sort().slice(0, MAX_MAIL_REVIEW_DOMAINS);
}

function reportedDate(values: readonly string[]): string | null {
  if (values.length !== 1 || values[0]!.length > 240) return null;
  const parsed = Date.parse(values[0]!);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function receivedHost(value: string, keyword: 'by' | 'from'): string | null {
  const expression = keyword === 'from' ? /(?:^|\s)from\s+([^\s(;]+)/iu : /(?:^|\s)by\s+([^\s(;]+)/iu;
  const match = expression.exec(value);
  return normalizeHeaderDomain(match?.[1] ?? '');
}

function receivedTransport(value: string): string | null {
  const match = /(?:^|\s)with\s+([A-Za-z0-9_-]{1,40})/iu.exec(value);
  return match?.[1]?.toUpperCase() ?? null;
}

function receivedTimestamp(value: string): string | null {
  const separator = value.lastIndexOf(';');
  if (separator < 0) return null;
  const raw = value.slice(separator + 1).trim();
  if (!raw || raw.length > 240) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function exactAlignment(left: readonly string[], right: readonly string[]): 'aligned' | 'divergent' | 'unavailable' {
  if (!left.length || !right.length) return 'unavailable';
  return left.some((domain) => right.includes(domain)) ? 'aligned' : 'divergent';
}

function addDomainRoles(store: Map<string, Set<DomainRole>>, domains: readonly string[], role: DomainRole): void {
  for (const domain of domains) {
    if (!store.has(domain) && store.size >= MAX_MAIL_REVIEW_DOMAINS) return;
    const roles = store.get(domain) ?? new Set<DomainRole>();
    roles.add(role);
    store.set(domain, roles);
  }
}

export function buildCliMailHeaderReview(value: unknown, generatedAt = new Date().toISOString()) {
  const normalizedGeneratedAt = normalizeExplicitIsoTimestamp(generatedAt);
  if (!normalizedGeneratedAt) throw new CliUsageError('Mail-header review generation time must be a valid ISO 8601 timestamp.');
  const parsed = parseHeaderFields(value);
  const fromDomains = addressDomains(fieldsNamed(parsed.fields, 'from'));
  const replyToDomains = addressDomains(fieldsNamed(parsed.fields, 'reply-to'));
  const returnPathDomains = addressDomains(fieldsNamed(parsed.fields, 'return-path'));
  const messageIdentifierDomains = messageIdDomains(fieldsNamed(parsed.fields, 'message-id'));
  const authenticationResults = fieldsNamed(parsed.fields, 'authentication-results');
  const receivedSpf = fieldsNamed(parsed.fields, 'received-spf');
  const authentication = Object.fromEntries(AUTHENTICATION_METHODS.map((method) => [
    method,
    authenticationState(authenticationResults, method, method === 'spf' ? receivedSpf : []),
  ])) as Readonly<Record<AuthenticationMethod, Readonly<{ state: AuthenticationState; observations: number }>>>;
  const authServiceDomains = authenticationServiceDomains(authenticationResults);
  const signerDomains = dkimSigningDomains(fieldsNamed(parsed.fields, 'dkim-signature'));
  const receivedValues = fieldsNamed(parsed.fields, 'received');
  const omittedReceivedHops = Math.max(0, receivedValues.length - MAX_MAIL_RECEIVED_HOPS);
  const receivedHops = receivedValues.slice(0, MAX_MAIL_RECEIVED_HOPS).map((header, index) => Object.freeze({
    position: index + 1,
    order: 'most_recent_first' as const,
    fromDomain: receivedHost(header, 'from'),
    byDomain: receivedHost(header, 'by'),
    transport: receivedTransport(header),
    reportedAt: receivedTimestamp(header),
  }));
  const roles = new Map<string, Set<DomainRole>>();
  addDomainRoles(roles, fromDomains, 'from');
  addDomainRoles(roles, replyToDomains, 'reply_to');
  addDomainRoles(roles, returnPathDomains, 'return_path');
  addDomainRoles(roles, messageIdentifierDomains, 'message_id');
  addDomainRoles(roles, authServiceDomains, 'authentication_service');
  addDomainRoles(roles, signerDomains, 'dkim_signer');
  for (const hop of receivedHops) {
    if (hop.fromDomain) addDomainRoles(roles, [hop.fromDomain], 'received_from');
    if (hop.byDomain) addDomainRoles(roles, [hop.byDomain], 'received_by');
  }
  const domains = [...roles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, domainRoles]) => Object.freeze({
    domain,
    roles: Object.freeze([...domainRoles].sort()),
  }));
  const digest = createHash('sha256').update(boundedHeaderSection(value), 'utf8').digest('hex');
  return Object.freeze({
    schema: CLI_MAIL_HEADER_REVIEW_SCHEMA,
    version: CLI_MAIL_HEADER_REVIEW_VERSION,
    generatedAt: normalizedGeneratedAt,
    provenance: Object.freeze({
      input: 'analyst_selected_header_block' as const,
      headerBytes: parsed.bytes,
      headerFields: parsed.fields.length,
      headerDigestSha256: `sha256:${digest}`,
      bodyRetained: false as const,
      attachmentsRetained: false as const,
      localPartsRetained: false as const,
    }),
    identity: Object.freeze({
      reportedAt: reportedDate(fieldsNamed(parsed.fields, 'date')),
      fromDomains: Object.freeze(fromDomains),
      replyToDomains: Object.freeze(replyToDomains),
      returnPathDomains: Object.freeze(returnPathDomains),
      messageIdentifierDomains: Object.freeze(messageIdentifierDomains),
    }),
    authentication: Object.freeze(authentication),
    routing: Object.freeze({
      receivedHops: Object.freeze(receivedHops),
      omittedReceivedHops,
      complete: omittedReceivedHops === 0,
    }),
    alignment: Object.freeze({
      fromToReplyTo: exactAlignment(fromDomains, replyToDomains),
      fromToReturnPath: exactAlignment(fromDomains, returnPathDomains),
      fromToDkimSigner: exactAlignment(fromDomains, signerDomains),
    }),
    domains: Object.freeze(domains),
    limitations: Object.freeze([
      'This review parses analyst-selected message headers offline. It makes no DNS, SMTP, HTTP, registry or provider request.',
      'Authentication results are claims reported in the supplied headers; they are not independently validated here.',
      'Exact-domain alignment is descriptive. Divergence can be legitimate and does not establish spoofing, abuse or maliciousness.',
      'Display names, subjects, address local parts, message bodies, attachments and raw header values are not retained in the output.',
      ...(omittedReceivedHops ? [`${omittedReceivedHops} older Received header${omittedReceivedHops === 1 ? ' was' : 's were'} omitted by the ${MAX_MAIL_RECEIVED_HOPS}-hop bound.`] : []),
    ]),
  });
}

export function formatCliMailHeaderReview(document: ReturnType<typeof buildCliMailHeaderReview>): string {
  const lines = [
    'Offline mail-header review',
    `Header identity    ${document.provenance.headerDigestSha256}`,
    `Header fields      ${document.provenance.headerFields}`,
    `Reported date      ${document.identity.reportedAt ?? 'Unavailable'}`,
    `From domains       ${document.identity.fromDomains.join(', ') || 'Unavailable'}`,
    `Reply-To domains   ${document.identity.replyToDomains.join(', ') || 'Unavailable'}`,
    `Return-Path        ${document.identity.returnPathDomains.join(', ') || 'Unavailable'}`,
    '',
    'Reported authentication',
    ...AUTHENTICATION_METHODS.map((method) => `  ${method.toUpperCase().padEnd(6)} ${document.authentication[method].state} (${document.authentication[method].observations} observation${document.authentication[method].observations === 1 ? '' : 's'})`),
    '',
    'Exact-domain alignment',
    `  From / Reply-To     ${document.alignment.fromToReplyTo}`,
    `  From / Return-Path  ${document.alignment.fromToReturnPath}`,
    `  From / DKIM signer  ${document.alignment.fromToDkimSigner}`,
    '',
    `Received path      ${document.routing.receivedHops.length} retained${document.routing.omittedReceivedHops ? ` · ${document.routing.omittedReceivedHops} omitted` : ''}`,
  ];
  for (const hop of document.routing.receivedHops) {
    lines.push(`  ${hop.position}. ${hop.fromDomain ?? 'unknown'} → ${hop.byDomain ?? 'unknown'}${hop.transport ? ` · ${hop.transport}` : ''}${hop.reportedAt ? ` · ${hop.reportedAt}` : ''}`);
  }
  lines.push('', `Header domains     ${document.domains.length}`);
  for (const domain of document.domains) lines.push(`  ${domain.domain}  ${domain.roles.join(', ')}`);
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}
