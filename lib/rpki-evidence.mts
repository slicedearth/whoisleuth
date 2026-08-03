import { parseIpPrefix, prefixContains, type IpPrefix } from './ip-prefix.mts';

const RPKI_EVIDENCE_SCHEMA = 'whoisleuth.rpki-route-review';
const RPKI_EVIDENCE_VERSION = 1;
const MAX_RPKI_RECORDS = 100_000;
const MAX_RPKI_MATCHES = 50;

type RouteOriginAuthorization = Readonly<{
  prefix: string;
  parsedPrefix: IpPrefix;
  maxLength: number;
  asn: number;
}>;

type RpkiEvidenceReport = Readonly<{
  schema: typeof RPKI_EVIDENCE_SCHEMA;
  version: typeof RPKI_EVIDENCE_VERSION;
  state: 'valid' | 'invalid' | 'not_found' | 'partial' | 'invalid_input';
  routePrefix: string | null;
  originAsn: number | null;
  coveringAuthorizationCount: number;
  matchingAuthorizationCount: number;
  rejectedCount: number;
  truncated: boolean;
  matches: readonly Readonly<{ prefix: string; maxLength: number; asn: number; state: 'valid' | 'asn_mismatch' | 'max_length_exceeded' }>[];
  limitations: readonly string[];
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeAsn(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim().replace(/^AS/iu, '') : value;
  const number = Number(text);
  return Number.isInteger(number) && number >= 0 && number <= 4_294_967_295 ? number : null;
}

function normalizeAuthorization(value: unknown): RouteOriginAuthorization | null {
  const source = record(value);
  if (!source) return null;
  const prefix = typeof source.prefix === 'string' ? source.prefix : typeof source.route === 'string' ? source.route : '';
  const parsedPrefix = parseIpPrefix(prefix);
  const asn = normalizeAsn(source.asn ?? source.asID ?? source.origin);
  const maxLengthValue = source.maxLength ?? source.max_length ?? parsedPrefix?.length;
  const maxLength = Number(maxLengthValue);
  const maximum = parsedPrefix?.family === 4 ? 32 : 128;
  if (!parsedPrefix || asn === null || !Number.isInteger(maxLength)
    || maxLength < parsedPrefix.length || maxLength > maximum) return null;
  return Object.freeze({ prefix: `${parsedPrefix.address}/${parsedPrefix.length}`, parsedPrefix, maxLength, asn });
}

function authorizationRows(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const source = record(value);
  if (!source) return null;
  if (Array.isArray(source.roas)) return source.roas;
  if (Array.isArray(source.vrps)) return source.vrps;
  if (Array.isArray(source.validated_route_origins)) return source.validated_route_origins;
  return null;
}

function reviewRpkiRoute(input: Readonly<{
  routePrefix: unknown;
  originAsn: unknown;
  authorizations: unknown;
}>): RpkiEvidenceReport {
  const route = parseIpPrefix(input.routePrefix);
  const originAsn = normalizeAsn(input.originAsn);
  const rows = authorizationRows(input.authorizations);
  const baseLimitations = Object.freeze([
    'This offline review evaluates an explicitly supplied route prefix and origin ASN against an analyst-supplied VRP snapshot.',
    'It does not collect BGP announcements, establish route ownership, or prove that the snapshot was current or complete.',
  ]);
  if (!route || originAsn === null || !rows) {
    return Object.freeze({
      schema: RPKI_EVIDENCE_SCHEMA,
      version: RPKI_EVIDENCE_VERSION,
      state: 'invalid_input',
      routePrefix: null,
      originAsn,
      coveringAuthorizationCount: 0,
      matchingAuthorizationCount: 0,
      rejectedCount: 0,
      truncated: false,
      matches: Object.freeze([]),
      limitations: baseLimitations,
    });
  }

  const truncated = rows.length > MAX_RPKI_RECORDS;
  const normalized = rows.slice(0, MAX_RPKI_RECORDS).map(normalizeAuthorization);
  const rejectedCount = normalized.filter((item) => item === null).length + Math.max(0, rows.length - MAX_RPKI_RECORDS);
  const authorizations = normalized.filter((item): item is RouteOriginAuthorization => item !== null);
  const covering = authorizations.filter((item) => prefixContains(item.parsedPrefix, route));
  const matches = covering
    .sort((left, right) => right.parsedPrefix.length - left.parsedPrefix.length || left.asn - right.asn)
    .slice(0, MAX_RPKI_MATCHES)
    .map((item) => Object.freeze({
      prefix: item.prefix,
      maxLength: item.maxLength,
      asn: item.asn,
      state: item.asn !== originAsn ? 'asn_mismatch' as const
        : route.length > item.maxLength ? 'max_length_exceeded' as const
          : 'valid' as const,
    }));
  const matchingAuthorizationCount = matches.filter((item) => item.state === 'valid').length;
  const state = covering.length === 0
    ? 'not_found'
    : matchingAuthorizationCount > 0
      ? truncated || rejectedCount > 0 || covering.length > MAX_RPKI_MATCHES ? 'partial'
      : 'valid'
      : 'invalid';
  return Object.freeze({
    schema: RPKI_EVIDENCE_SCHEMA,
    version: RPKI_EVIDENCE_VERSION,
    state,
    routePrefix: `${route.address}/${route.length}`,
    originAsn,
    coveringAuthorizationCount: covering.length,
    matchingAuthorizationCount,
    rejectedCount,
    truncated,
    matches: Object.freeze(matches),
    limitations: baseLimitations,
  });
}

export {
  MAX_RPKI_RECORDS,
  RPKI_EVIDENCE_SCHEMA,
  RPKI_EVIDENCE_VERSION,
  reviewRpkiRoute,
};
export type { RouteOriginAuthorization, RpkiEvidenceReport };
