import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { exactKeys } from './bounded-contract-normalizers.mts';

export const ZONE_INTENT_INPUT_SCHEMA = 'whoisleuth.zone-intent.input';
export const ZONE_INTENT_REVIEW_SCHEMA = 'whoisleuth.zone-intent.review';
export const ZONE_INTENT_REVIEW_VERSION = 1;
export const MAX_ZONE_TEXT_BYTES = 1024 * 1024;
export const MAX_ZONE_RECORDS = 5_000;
export const MAX_ZONE_COMPARISONS = 2_000;

type UnknownRecord = Record<string, unknown>;
type ZoneRecordType = 'A' | 'AAAA' | 'CAA' | 'CDNSKEY' | 'CDS' | 'CNAME' | 'CSYNC' | 'DS' | 'HTTPS' | 'MX' | 'NS' | 'SRV' | 'SVCB' | 'TLSA' | 'TXT';
type ObservationState = 'observed' | 'partial' | 'unavailable' | 'unsupported';

const ROOT_KEYS = new Set(['schema', 'version', 'origin', 'desired', 'observed']);
const DESIRED_KEYS = new Set(['format', 'zoneText', 'records']);
const OBSERVED_KEYS = new Set(['state', 'source', 'observedAt', 'records']);
const RECORD_KEYS = new Set(['owner', 'ttl', 'type', 'value']);
const SUPPORTED_TYPES = new Set<ZoneRecordType>([
  'A', 'AAAA', 'CAA', 'CDNSKEY', 'CDS', 'CNAME', 'CSYNC', 'DS', 'HTTPS', 'MX', 'NS', 'SRV', 'SVCB', 'TLSA', 'TXT',
]);

type ZoneRecord = Readonly<{
  owner: string;
  ttl: number | null;
  type: ZoneRecordType;
  value: string;
  valueTreatment: 'normalised' | 'sha256';
}>;

type RejectedRecord = Readonly<{
  line: number | null;
  reason: string;
}>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as UnknownRecord;
}

function boundedText(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded text without control characters.`);
  }
  const normalised = value.replace(/\s+/gu, ' ').trim();
  if (!normalised || normalised.length > maximum) throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  return normalised;
}

function timestamp(value: unknown, label: string): string {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function domainName(value: unknown, origin: string | null, label: string): string {
  const supplied = boundedText(value, label, 253).toLowerCase();
  const absolute = supplied.endsWith('.');
  const text = supplied.replace(/\.$/u, '');
  const candidate = text === '@'
    ? origin
    : !origin || absolute || text === origin || text.endsWith(`.${origin}`)
      ? text
      : `${text}.${origin}`;
  const ascii = domainToASCII(candidate ?? '');
  if (!ascii || !ascii.includes('.') || ascii.length > 253 || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid domain name.`);
  }
  return ascii;
}

function ownerName(value: unknown, origin: string, label: string): string {
  const supplied = boundedText(value, label, 253).toLowerCase();
  const absolute = supplied.endsWith('.');
  const text = supplied.replace(/\.$/u, '');
  const candidate = text === '@'
    ? origin
    : absolute || text === origin || text.endsWith(`.${origin}`)
      ? text
      : `${text}.${origin}`;
  if (!candidate || candidate.length > 253 || candidate.split('.').some((part) => (
    !part
    || part.length > 63
    || (part !== '*' && !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/u.test(part))
  ))) throw new TypeError(`${label} must be a valid DNS owner name.`);
  return candidate;
}

function integerToken(value: string, minimum: number, maximum: number, label: string): number {
  if (!/^\d+$/u.test(value)) throw new TypeError(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new TypeError(`${label} is outside its supported range.`);
  return parsed;
}

function canonicalText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function txtDigest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function normaliseRdata(type: ZoneRecordType, rawValue: string, origin: string | null): Pick<ZoneRecord, 'value' | 'valueTreatment'> {
  const value = canonicalText(rawValue);
  const tokens = value.split(' ');
  const host = (input: string, label: string) => domainName(input, origin, label);
  if (type === 'A' || type === 'AAAA') {
    const family = type === 'A' ? 4 : 6;
    if (tokens.length !== 1 || isIP(tokens[0] ?? '') !== family) throw new TypeError(`${type} data must contain one valid address.`);
    return { value: (tokens[0] as string).toLowerCase(), valueTreatment: 'normalised' };
  }
  if (type === 'CNAME' || type === 'NS') {
    if (tokens.length !== 1) throw new TypeError(`${type} data must contain one hostname.`);
    return { value: host(tokens[0] as string, `${type} target`), valueTreatment: 'normalised' };
  }
  if (type === 'MX') {
    if (tokens.length !== 2) throw new TypeError('MX data must contain preference and exchange.');
    return { value: `${integerToken(tokens[0] as string, 0, 65_535, 'MX preference')} ${host(tokens[1] as string, 'MX exchange')}`, valueTreatment: 'normalised' };
  }
  if (type === 'CAA') {
    if (tokens.length < 3) throw new TypeError('CAA data must contain flags, tag, and value.');
    const flags = integerToken(tokens[0] as string, 0, 255, 'CAA flags');
    const tag = (tokens[1] as string).toLowerCase();
    if (!/^[a-z0-9-]{1,15}$/u.test(tag)) throw new TypeError('CAA tag is invalid.');
    const caaValue = tokens.slice(2).join(' ').replace(/^"|"$/gu, '');
    if (!caaValue || caaValue.length > 500) throw new TypeError('CAA value is invalid.');
    return { value: `${flags} ${tag} ${caaValue}`, valueTreatment: 'normalised' };
  }
  if (type === 'DS' || type === 'CDS') {
    if (tokens.length !== 4 || !/^[a-f0-9]{2,128}$/iu.test(tokens[3] ?? '')) throw new TypeError(`${type} data is invalid.`);
    return {
      value: `${integerToken(tokens[0] as string, 0, 65_535, `${type} key tag`)} ${integerToken(tokens[1] as string, 0, 255, `${type} algorithm`)} ${integerToken(tokens[2] as string, 0, 255, `${type} digest type`)} ${(tokens[3] as string).toLowerCase()}`,
      valueTreatment: 'normalised',
    };
  }
  if (type === 'CDNSKEY') {
    if (tokens.length !== 4 || !/^[a-z0-9+/=]{1,4096}$/iu.test(tokens[3] ?? '')) throw new TypeError('CDNSKEY data is invalid.');
    return {
      value: `${integerToken(tokens[0] as string, 0, 65_535, 'CDNSKEY flags')} ${integerToken(tokens[1] as string, 0, 255, 'CDNSKEY protocol')} ${integerToken(tokens[2] as string, 0, 255, 'CDNSKEY algorithm')} ${tokens[3]}`,
      valueTreatment: 'normalised',
    };
  }
  if (type === 'CSYNC') {
    if (tokens.length < 3) throw new TypeError('CSYNC data must contain serial, flags, and record types.');
    const types = [...new Set(tokens.slice(2).map((token) => token.toUpperCase()))].sort();
    if (types.some((token) => !/^[A-Z][A-Z0-9-]{0,15}$/u.test(token))) throw new TypeError('CSYNC record types are invalid.');
    return { value: `${integerToken(tokens[0] as string, 0, 0xffff_ffff, 'CSYNC serial')} ${integerToken(tokens[1] as string, 0, 65_535, 'CSYNC flags')} ${types.join(' ')}`, valueTreatment: 'normalised' };
  }
  if (type === 'SRV') {
    if (tokens.length !== 4) throw new TypeError('SRV data must contain priority, weight, port, and target.');
    return {
      value: `${integerToken(tokens[0] as string, 0, 65_535, 'SRV priority')} ${integerToken(tokens[1] as string, 0, 65_535, 'SRV weight')} ${integerToken(tokens[2] as string, 0, 65_535, 'SRV port')} ${host(tokens[3] as string, 'SRV target')}`,
      valueTreatment: 'normalised',
    };
  }
  if (type === 'TLSA') {
    if (tokens.length !== 4 || !/^[a-f0-9]{2,8192}$/iu.test(tokens[3] ?? '')) throw new TypeError('TLSA data is invalid.');
    return {
      value: `${integerToken(tokens[0] as string, 0, 3, 'TLSA usage')} ${integerToken(tokens[1] as string, 0, 1, 'TLSA selector')} ${integerToken(tokens[2] as string, 0, 2, 'TLSA matching type')} ${(tokens[3] as string).toLowerCase()}`,
      valueTreatment: 'normalised',
    };
  }
  if (type === 'SVCB' || type === 'HTTPS') {
    if (tokens.length < 2) throw new TypeError(`${type} data must contain priority and target.`);
    const priority = integerToken(tokens[0] as string, 0, 65_535, `${type} priority`);
    const target = tokens[1] === '.' ? '.' : host(tokens[1] as string, `${type} target`);
    const parameters = tokens.slice(2);
    if (parameters.length > 24 || parameters.some((token) => token.length > 500)) throw new TypeError(`${type} parameters exceed the supported bound.`);
    return { value: `${priority} ${target}${parameters.length ? ` ${parameters.join(' ')}` : ''}`, valueTreatment: 'normalised' };
  }
  if (type === 'TXT') {
    const joined = value.replace(/(?:^|\s)"|"(?:\s|$)/gu, '');
    if (!joined || joined.length > 16_384) throw new TypeError('TXT data is invalid or too large.');
    return { value: txtDigest(joined), valueTreatment: 'sha256' };
  }
  throw new TypeError(`Unsupported record type ${type}.`);
}

function normaliseRecord(value: unknown, origin: string, label: string): ZoneRecord {
  const source = record(value, label);
  exactKeys(source, RECORD_KEYS, label);
  const typeText = boundedText(source.type, `${label}.type`, 16).toUpperCase();
  if (!SUPPORTED_TYPES.has(typeText as ZoneRecordType)) throw new TypeError(`${label}.type is unsupported.`);
  const type = typeText as ZoneRecordType;
  const owner = ownerName(source.owner, origin, `${label}.owner`);
  const ttl = source.ttl === null || source.ttl === undefined
    ? null
    : integerToken(String(source.ttl), 0, 0x7fff_ffff, `${label}.ttl`);
  const normalised = normaliseRdata(type, boundedText(source.value, `${label}.value`, 16_384), origin);
  return Object.freeze({ owner, ttl, type, ...normalised });
}

function stripComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    else if (char === ';' && !quoted) return line.slice(0, index);
  }
  return line;
}

function stripGroupingParentheses(line: string): string {
  let output = '';
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) { output += char; escaped = false; continue; }
    if (char === '\\') { output += char; escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === '(' || char === ')')) output += ' ';
    else output += char;
  }
  return output;
}

function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; current += char; continue; }
    if (/\s/u.test(char) && !quoted) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += char;
  }
  if (escaped || quoted) throw new TypeError('Unterminated quoted or escaped zone value.');
  if (current) tokens.push(current);
  return tokens;
}

function parseBindZone(zoneText: unknown, initialOrigin: string): { records: ZoneRecord[]; rejected: RejectedRecord[]; truncated: boolean } {
  if (typeof zoneText !== 'string' || Buffer.byteLength(zoneText, 'utf8') > MAX_ZONE_TEXT_BYTES) {
    throw new TypeError(`Zone text is limited to ${MAX_ZONE_TEXT_BYTES} bytes.`);
  }
  const logical: Array<{ line: number; text: string; ownerOmitted: boolean }> = [];
  let buffer = '';
  let startLine = 0;
  let depth = 0;
  let ownerOmitted = false;
  const lines = zoneText.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const clean = stripComment(raw);
    if (!buffer && !clean.trim()) continue;
    if (!buffer) { startLine = index + 1; ownerOmitted = /^\s/u.test(clean); }
    let quoted = false;
    let escaped = false;
    for (const char of clean) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
      if (!quoted && char === '(') depth += 1;
      if (!quoted && char === ')') depth -= 1;
      if (depth < 0) throw new TypeError(`Zone line ${index + 1} closes an unopened parenthesis.`);
    }
    buffer += `${buffer ? ' ' : ''}${stripGroupingParentheses(clean)}`;
    if (depth === 0) {
      logical.push({ line: startLine, text: buffer.trim(), ownerOmitted });
      buffer = '';
    }
  }
  if (depth !== 0 || buffer) throw new TypeError('Zone text ends inside a parenthesised record.');

  let origin = initialOrigin;
  let lastOwner = initialOrigin;
  const records: ZoneRecord[] = [];
  const rejected: RejectedRecord[] = [];
  let truncated = false;
  for (const entry of logical) {
    try {
      const tokens = tokenise(entry.text);
      if (!tokens.length) continue;
      const directive = tokens[0]?.toUpperCase();
      if (directive === '$ORIGIN') {
        if (tokens.length !== 2) throw new TypeError('$ORIGIN requires one domain name.');
        origin = domainName(tokens[1], null, '$ORIGIN');
        lastOwner = origin;
        continue;
      }
      if (directive === '$TTL') continue;
      if (directive?.startsWith('$')) throw new TypeError(`${directive} is deliberately unsupported.`);
      let offset = 0;
      const ownerToken = entry.ownerOmitted ? lastOwner : tokens[offset++];
      if (!ownerToken) throw new TypeError('Record owner is missing.');
      const owner = ownerName(ownerToken, origin, 'record owner');
      lastOwner = owner;
      let ttl: number | null = null;
      if (/^\d+$/u.test(tokens[offset] ?? '')) ttl = integerToken(tokens[offset++] as string, 0, 0x7fff_ffff, 'record TTL');
      if ((tokens[offset] ?? '').toUpperCase() === 'IN') offset += 1;
      const typeText = (tokens[offset++] ?? '').toUpperCase();
      if (!SUPPORTED_TYPES.has(typeText as ZoneRecordType)) throw new TypeError(`Record type ${typeText || '(missing)'} is unsupported.`);
      const rawValue = tokens.slice(offset).join(' ');
      const normalised = normaliseRdata(typeText as ZoneRecordType, rawValue, origin);
      if (records.length >= MAX_ZONE_RECORDS) { truncated = true; continue; }
      records.push(Object.freeze({ owner, ttl, type: typeText as ZoneRecordType, ...normalised }));
    } catch (error) {
      if (rejected.length < 100) rejected.push(Object.freeze({
        line: entry.line,
        reason: String(error instanceof Error ? error.message : error).slice(0, 240),
      }));
    }
  }
  return { records, rejected, truncated };
}

function deduplicate(records: readonly ZoneRecord[]): ZoneRecord[] {
  const byKey = new Map<string, ZoneRecord>();
  for (const item of records) byKey.set(`${item.owner}\u0000${item.type}\u0000${item.value}`, item);
  return [...byKey.values()].sort((left, right) => (
    left.owner.localeCompare(right.owner) || left.type.localeCompare(right.type) || left.value.localeCompare(right.value)
  ));
}

function parseDesired(value: unknown, origin: string): { records: ZoneRecord[]; rejected: RejectedRecord[]; truncated: boolean } {
  const source = record(value, 'desired');
  exactKeys(source, DESIRED_KEYS, 'desired');
  if (source.format === 'bind') return parseBindZone(source.zoneText, origin);
  if (source.format !== 'records') throw new TypeError('desired.format must be bind or records.');
  if (!Array.isArray(source.records) || source.records.length > MAX_ZONE_RECORDS) throw new TypeError(`desired.records is limited to ${MAX_ZONE_RECORDS} records.`);
  return { records: source.records.map((item, index) => normaliseRecord(item, origin, `desired.records[${index}]`)), rejected: [], truncated: false };
}

function recordGroups(records: readonly ZoneRecord[]): Map<string, { owner: string; type: ZoneRecordType; values: string[]; ttls: number[] }> {
  const groups = new Map<string, { owner: string; type: ZoneRecordType; values: string[]; ttls: number[] }>();
  for (const item of records) {
    const key = `${item.owner}\u0000${item.type}`;
    const group = groups.get(key) ?? { owner: item.owner, type: item.type, values: [], ttls: [] };
    group.values.push(item.value);
    if (item.ttl !== null) group.ttls.push(item.ttl);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.values = [...new Set(group.values)].sort();
    group.ttls = [...new Set(group.ttls)].sort((left, right) => left - right);
  }
  return groups;
}

export function reviewZoneIntent(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = record(inputRaw, 'Zone intent input');
  if (input.schema !== ZONE_INTENT_INPUT_SCHEMA || input.version !== 1) throw new TypeError(`Zone intent input must use ${ZONE_INTENT_INPUT_SCHEMA} version 1.`);
  exactKeys(input, ROOT_KEYS, 'Zone intent input');
  const origin = domainName(input.origin, null, 'origin');
  const desiredResult = parseDesired(input.desired, origin);
  const desired = deduplicate(desiredResult.records);
  const observedInput = record(input.observed, 'observed');
  exactKeys(observedInput, OBSERVED_KEYS, 'observed');
  const state = observedInput.state;
  if (state !== 'observed' && state !== 'partial' && state !== 'unavailable' && state !== 'unsupported') throw new TypeError('observed.state is unsupported.');
  const source = boundedText(observedInput.source, 'observed.source', 120);
  const observedAt = timestamp(observedInput.observedAt, 'observed.observedAt');
  if (!Array.isArray(observedInput.records) || observedInput.records.length > MAX_ZONE_RECORDS) throw new TypeError(`observed.records is limited to ${MAX_ZONE_RECORDS} records.`);
  const observed = deduplicate(observedInput.records.map((item, index) => normaliseRecord(item, origin, `observed.records[${index}]`)));
  const desiredGroups = recordGroups(desired);
  const observedGroups = recordGroups(observed);
  const allKeys = [...new Set([...desiredGroups.keys(), ...observedGroups.keys()])].sort();
  const comparisonsTruncated = allKeys.length > MAX_ZONE_COMPARISONS;
  const keys = allKeys.slice(0, MAX_ZONE_COMPARISONS);
  const comparisons = keys.map((key) => {
    const expected = desiredGroups.get(key);
    const actual = observedGroups.get(key);
    const owner = expected?.owner ?? actual?.owner ?? origin;
    const type = expected?.type ?? actual?.type ?? 'A';
    const expectedValues = expected?.values ?? [];
    const observedValues = actual?.values ?? [];
    const aligned = expectedValues.length === observedValues.length && expectedValues.every((item, index) => item === observedValues[index]);
    const comparisonState = state !== 'observed'
      ? state
      : aligned ? 'aligned' : !actual ? 'missing' : !expected ? 'unexpected' : 'different';
    return Object.freeze({
      owner,
      type,
      state: comparisonState,
      desiredValues: Object.freeze(expectedValues),
      observedValues: Object.freeze(observedValues),
      desiredTtls: Object.freeze(expected?.ttls ?? []),
      observedTtls: Object.freeze(actual?.ttls ?? []),
      source,
      observedAt,
    });
  });
  const counts = Object.freeze({
    aligned: comparisons.filter((item) => item.state === 'aligned').length,
    different: comparisons.filter((item) => item.state === 'different').length,
    missing: comparisons.filter((item) => item.state === 'missing').length,
    unexpected: comparisons.filter((item) => item.state === 'unexpected').length,
    incomplete: comparisons.filter((item) => ['partial', 'unavailable', 'unsupported'].includes(item.state)).length,
  });
  return Object.freeze({
    schema: ZONE_INTENT_REVIEW_SCHEMA,
    version: ZONE_INTENT_REVIEW_VERSION,
    generatedAt: timestamp(generatedAtValue, 'generatedAt'),
    origin,
    desired: Object.freeze({
      records: Object.freeze(desired),
      rejected: Object.freeze(desiredResult.rejected),
      truncated: desiredResult.truncated,
    }),
    observation: Object.freeze({ state: state as ObservationState, source, observedAt, records: Object.freeze(observed) }),
    comparisons: Object.freeze(comparisons),
    counts,
    complete: state === 'observed' && !desiredResult.truncated && desiredResult.rejected.length === 0 && !comparisonsTruncated,
    truncated: desiredResult.truncated || comparisonsTruncated,
    limitations: Object.freeze([
      'This local review parses only a bounded, deliberately supported subset of DNS master-file syntax and never applies a DNS change.',
      'TXT values are represented only by SHA-256 digests so tokens and other published text are not copied into the result.',
      'Partial, unavailable, unsupported, rejected, or truncated input cannot establish that a desired record is absent.',
      'A matching review does not prove global propagation, DNSSEC validity, service health, ownership, control, intent, or safety.',
    ]),
  });
}

export type { ObservationState, ZoneRecord, ZoneRecordType };
