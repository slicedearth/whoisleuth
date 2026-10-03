import { lexicalSegments, normalizeHeaderDomain, addressDomains, type AuthenticationMethod, type AuthenticationState } from './mail-header-identity.mts';
import { MAX_AUTHENTICATION_HEADERS, MAX_AUTHENTICATION_CLAUSES, MAX_AUTHENTICATION_VALUE_LENGTH,
  MAIL_AUTHENTICATION_METHODS, MAIL_AUTHENTICATION_PROPERTIES,
  type MailAuthenticationClaim, type MailAuthenticationHeader, type MailAuthenticationProperty,
  type MailAuthenticationReview } from '../contracts/mail-authentication.mts';

type HeaderInput = Readonly<{ name: string; value: string }>;
const KEYWORD = /^[a-z][a-z0-9_-]{0,31}$/iu;
const RESULTS: Readonly<Record<MailAuthenticationClaim['method'], readonly string[]>> = {
  spf: ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'],
  dkim: ['pass', 'fail', 'policy', 'neutral', 'none', 'temperror', 'permerror'],
  dmarc: ['pass', 'fail', 'none', 'temperror', 'permerror'],
  arc: ['pass', 'fail', 'none'],
};

/** Remove comments, never quoted content. Keep separators so tokens cannot join. */
function withoutComments(value: string): string | null {
  let depth = 0, quoted = false, escaped = false, output = '';
  for (const character of value) {
    if (escaped) { if (!depth) output += character; escaped = false; continue; }
    if (character === '\\' && (depth || quoted)) { if (!depth) output += character; escaped = true; continue; }
    if (depth) { if (character === '(') depth++; else if (character === ')') depth--; continue; }
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '(') { depth = 1; output += ' '; }
    else if (!quoted && character === ')') return null;
    else output += character;
  }
  return depth || quoted || escaped ? null : output;
}

// Only the restricted, non-personal identifier projection enters a report.
function serviceId(value: string): string | null {
  return /^[a-z0-9_.-]{1,253}$/iu.test(value) ? value : null;
}

function unquote(value: string): string {
  return value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/gu, '$1') : value;
}

function domainProperty(value: string): string | null {
  const direct = normalizeHeaderDomain(value) ?? normalizeHeaderDomain(value.startsWith('@') ? value.slice(1) : '');
  if (direct) return direct;
  const domains = addressDomains([value]);
  return domains.length === 1 ? domains[0]! : null;
}

function properties(value: string) {
  const result = new Map<string, string[]>();
  let rest = value.trim(), count = 0;
  while (rest) {
    if (++count > MAX_AUTHENTICATION_CLAUSES) return { result, complete: false };
    const match = /^([a-z][a-z0-9_-]*(?:\s*\.\s*[a-z][a-z0-9_-]*)?)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s";]+)(?=\s|$)/iu.exec(rest);
    if (!match) return { result, complete: false };
    const key = match[1]!.replaceAll(/\s/gu, '').toLowerCase();
    const values = result.get(key) ?? [];
    values.push(unquote(match[2]!)); result.set(key, values);
    rest = rest.slice(match[0].length).trim();
  }
  return { result, complete: true };
}

function domainsFromProperties(values: ReadonlyMap<string, readonly string[]>) {
  const domains: Array<{ property: MailAuthenticationProperty; domain: string }> = [];
  const duplicateProperties: MailAuthenticationProperty[] = [];
  let omitted = false;
  for (const property of MAIL_AUTHENTICATION_PROPERTIES) {
    const supplied = values.get(property);
    if (!supplied) continue;
    if (supplied.length !== 1) { duplicateProperties.push(property); continue; }
    const domain = domainProperty(supplied[0]!);
    if (domain) domains.push({ property, domain }); else omitted = true;
  }
  return { domains, duplicateProperties, omitted };
}

function readHeader(input: HeaderInput, part: number, headerIndex: number, duplicateOf: number | null): MailAuthenticationHeader {
  const headerName = input.name as MailAuthenticationHeader['headerName'];
  const base = { part, headerIndex, headerName, duplicateOf, receiverTrust: 'not_established' as const };
  const issues = new Set<string>();
  const invalid = (issue: string): MailAuthenticationHeader => ({ ...base, authservId: null, state: 'malformed', claims: [], issues: [issue] });
  if (input.value.length > MAX_AUTHENTICATION_VALUE_LENGTH) return invalid('Header value exceeds the authentication review bound.');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]|\p{Default_Ignorable_Code_Point}/u.test(input.value)) return invalid('Header value contains unsupported control characters.');
  const segments = lexicalSegments(input.value, ';');
  if (!segments) return invalid('Header has unbalanced quoting or comments.');
  const clauses = segments.slice(0, MAX_AUTHENTICATION_CLAUSES + 1).map(withoutComments);
  if (clauses.some(value => value === null)) return invalid('Header comments could not be parsed.');
  if (segments.length > MAX_AUTHENTICATION_CLAUSES + 1) issues.add('Some clauses exceed the authentication review bound.');
  if (headerName === 'received-spf') {
    const first = /^\s*([a-z][a-z0-9_-]*)\b(.*)$/iu.exec(clauses.shift()! ?? '');
    if (!first || !KEYWORD.test(first[1]!)) return invalid('The reported SPF result is malformed.');
    const supplied = properties([first[2], ...clauses].join(' '));
    const receiver = supplied.result.get('receiver');
    const authservId = receiver?.length === 1 ? serviceId(receiver[0]!) : null;
    if (!supplied.complete) issues.add('Some SPF properties could not be parsed.');
    if (receiver && (receiver.length !== 1 || !authservId)) issues.add('The receiver identifier is ambiguous or outside the retained identifier format.');
    const renamed = new Map(supplied.result);
    for (const [key, property] of [['envelope-from', 'smtp.mailfrom'], ['helo', 'smtp.helo']] as const) {
      if (supplied.result.has(key)) renamed.set(property, supplied.result.get(key)!);
    }
    const projected = domainsFromProperties(renamed);
    if (projected.omitted) issues.add('Some identity properties cannot be represented as domains.');
    if (projected.duplicateProperties.length) issues.add('Repeated identity properties were retained as ambiguous, without selecting a value.');
    const result = first[1]!.toLowerCase();
    if (!RESULTS.spf.includes(result)) issues.add('The reported SPF result is unsupported.');
    return { ...base, authservId, state: issues.size ? 'partial' : 'parsed', claims: [{ method: 'spf', methodVersion: 1, result,
      state: RESULTS.spf.includes(result) ? 'reported' : 'unsupported', domains: projected.domains, duplicateProperties: projected.duplicateProperties }], issues: [...issues] };
  }
  const first = /^\s*("(?:[^"\\]|\\.)*"|[^\s";]+)(?:\s+(\d{1,9}))?\s*$/u.exec(clauses.shift()! ?? '');
  if (!first) return invalid('The authentication service identifier or header version is malformed.');
  const authservId = serviceId(unquote(first[1]!));
  if (!authservId) issues.add('The service identifier is outside the retained non-personal identifier format.');
  if (first[2] && first[2] !== '1') return { ...base, authservId, state: 'unsupported', claims: [], issues: ['The header declares an unsupported authentication-results version.'] };
  if (clauses.length === 1 && clauses[0]!.trim().toLowerCase() === 'none') return { ...base, authservId, state: 'none', claims: [], issues: [...issues] };
  const claims: MailAuthenticationClaim[] = [];
  if (!clauses.length) issues.add('The header does not contain a result clause.');
  for (const clause of clauses) {
    const match = /^\s*([a-z][a-z0-9_-]*)(?:\s*\/\s*(\d{1,9}))?\s*=\s*([a-z][a-z0-9_-]*)(?=\s|$)(.*)$/iu.exec(clause!);
    if (!match || !KEYWORD.test(match[1]!) || !KEYWORD.test(match[3]!)) { issues.add('A result clause is malformed.'); continue; }
    const method = match[1]!.toLowerCase();
    if (!MAIL_AUTHENTICATION_METHODS.includes(method as MailAuthenticationClaim['method'])) { issues.add('A reported authentication method is outside this review.'); continue; }
    const supplied = properties(match[4]!);
    const projected = domainsFromProperties(supplied.result);
    if (!supplied.complete) issues.add('Some result properties could not be parsed.');
    if (projected.omitted) issues.add('Some identity properties cannot be represented as domains.');
    if (projected.duplicateProperties.length) issues.add('Repeated identity properties were retained as ambiguous, without selecting a value.');
    const known = method as MailAuthenticationClaim['method'], result = match[3]!.toLowerCase(), methodVersion = Number(match[2] ?? 1);
    const state = methodVersion === 1 && RESULTS[known].includes(result) ? 'reported' : 'unsupported';
    if (state === 'unsupported') issues.add('A method version or result is unsupported.');
    claims.push({ method: known, methodVersion, result, state, domains: projected.domains, duplicateProperties: projected.duplicateProperties });
  }
  return { ...base, authservId, state: issues.size ? claims.length ? 'partial' : 'malformed' : 'parsed', claims, issues: [...issues] };
}

/** Physical header order is preserved. Equal service names never imply trust. */
export function reviewMailAuthentication(fields: readonly HeaderInput[], part = 1, maximumHeaders = MAX_AUTHENTICATION_HEADERS): MailAuthenticationReview {
  if (!Number.isSafeInteger(part) || part < 1 || !Number.isSafeInteger(maximumHeaders) || maximumHeaders < 0 || maximumHeaders > MAX_AUTHENTICATION_HEADERS) throw new TypeError('Invalid authentication review bounds.');
  const headers: MailAuthenticationHeader[] = [], previous = new Map<string, number>();
  let omittedHeaders = 0;
  for (const [index, field] of fields.entries()) {
    if (!['authentication-results', 'received-spf'].includes(field.name)) continue;
    if (headers.length >= maximumHeaders) { omittedHeaders++; continue; }
    // Do not retain an oversized raw value in the temporary duplicate index.
    const key = field.value.length <= MAX_AUTHENTICATION_VALUE_LENGTH ? `${field.name}:${field.value}` : null;
    const duplicateOf = key === null ? null : previous.get(key) ?? null;
    headers.push(readHeader(field, part, index + 1, duplicateOf));
    if (key !== null && duplicateOf === null) previous.set(key, index + 1);
  }
  return { headers, omittedHeaders };
}

export function selectReceiverTrust(review: MailAuthenticationReview, selected: readonly string[]): MailAuthenticationReview {
  if (!Array.isArray(selected) || selected.length > MAX_AUTHENTICATION_HEADERS || new Set(selected).size !== selected.length
    || selected.some(value => !/^[1-9]\d{0,5}:[1-9]\d{0,5}$/u.test(value)
      || !review.headers.some(header => `${header.part}:${header.headerIndex}` === value && header.authservId !== null && ['parsed', 'partial', 'none'].includes(header.state)))) {
    throw new TypeError('Select each recognised receiver header by part:header-index; unidentified, malformed and unsupported headers cannot be trusted.');
  }
  return { ...review, headers: review.headers.map(header => ({ ...header, receiverTrust: selected.includes(`${header.part}:${header.headerIndex}`) ? 'analyst_selected' : 'not_established' })) };
}

export function authenticationHeaderLabel(header: MailAuthenticationHeader): string {
  return `Part ${header.part}, header ${header.headerIndex} · ${header.headerName} · ${header.authservId ?? 'service unidentified'}`;
}

/** Compatibility summary only: all parsed sources, with no receiver-trust verdict. */
export function aggregateMailAuthentication(review: MailAuthenticationReview): Readonly<Record<AuthenticationMethod, Readonly<{ state: AuthenticationState; observations: number }>>> {
  const known = new Set<string>(['fail', 'neutral', 'none', 'pass', 'permerror', 'softfail', 'temperror']);
  return Object.fromEntries(MAIL_AUTHENTICATION_METHODS.map(method => {
    const claims = review.headers.flatMap(header => header.claims.filter(claim => claim.method === method));
    const states = new Set(claims.map(claim => claim.state === 'reported' && known.has(claim.result) ? claim.result as AuthenticationState : 'unknown'));
    return [method, { state: states.size > 1 ? 'mixed' : [...states][0] ?? 'unknown', observations: claims.length }];
  })) as Readonly<Record<AuthenticationMethod, Readonly<{ state: AuthenticationState; observations: number }>>>;
}
