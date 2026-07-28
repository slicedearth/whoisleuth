import { cached } from './lookup-cache.mts';
import {
  findRdapBases,
  uniqueRdapBases,
} from './rdap-bootstrap.mts';
import { rdapAttempt, rdapFailure } from './rdap-attempts.mts';
import {
  fetchRdapWithTimeout,
  type RdapFetch,
} from './rdap-transport.mts';
import type {
  LooseRdapRecord,
  NormalizedRdapRecordFor,
  RdapAttempt,
  RdapLookupRecord,
} from './rdap-types.mts';
import { validateRdapResponse } from './rdap-validation.mts';

const UPSTREAM_TIMEOUT_MS = 7_000;
const UPSTREAM_TOTAL_DEADLINE_MS = 12_000;
const MAX_RDAP_ENDPOINTS = 3;

export type RdapParser = <T extends string>(
  type: T,
  data: unknown,
) => NormalizedRdapRecordFor<T> | null;

function errorProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (value as LooseRdapRecord)[key];
}

function rdapPathFor(type: string, value: string): string {
  if (type === 'domain') return `domain/${value}`;
  if (type === 'ipv4' || type === 'ipv6') return `ip/${value}`;
  if (type === 'asn') return `autnum/${value.replace(/^AS/i, '')}`;
  throw new Error(`Unsupported RDAP type: ${type}`);
}

/**
 * Query the bounded bootstrap candidate set while retaining every attempted
 * endpoint as separately attributed transport evidence.
 */
export async function fetchRdapFromBasesWithParser<const T extends string>(
  type: T,
  value: string,
  bases: unknown,
  parseRdap: RdapParser,
  fetchUpstream: RdapFetch = fetchRdapWithTimeout,
): Promise<RdapLookupRecord<NormalizedRdapRecordFor<T>> | null> {
  const candidates = uniqueRdapBases(bases).slice(0, MAX_RDAP_ENDPOINTS);
  if (candidates.length === 0) return null;

  const startedAt = Date.now();
  const attempts: RdapAttempt[] = [];
  for (const base of candidates) {
    const elapsed = Date.now() - startedAt;
    const remaining = UPSTREAM_TOTAL_DEADLINE_MS - elapsed;
    if (remaining <= 0) break;

    const url = `${base.replace(/\/$/, '')}/${rdapPathFor(type, value)}`;
    try {
      const upstream = await fetchUpstream(
        url,
        { headers: { Accept: 'application/rdap+json' } },
        Math.min(UPSTREAM_TIMEOUT_MS, remaining),
      );

      if (upstream.status !== 404 && !upstream.ok) {
        const outcome =
          upstream.status === 429
            ? 'rate_limited'
            : upstream.status >= 500
              ? 'server_error'
              : 'client_error';
        attempts.push(
          rdapAttempt(url, outcome, {
            status: upstream.status,
            detail: `The endpoint returned HTTP ${upstream.status}.`,
          }),
        );
        continue;
      }

      let data: unknown;
      try {
        data = JSON.parse(upstream.text);
      } catch {
        attempts.push(
          rdapAttempt(url, 'invalid_json', {
            status: upstream.status,
            detail: 'The endpoint returned invalid JSON.',
          }),
        );
        continue;
      }

      if (upstream.status === 404) {
        attempts.push(
          rdapAttempt(url, 'not_found', {
            status: upstream.status,
            detail: 'The authoritative endpoint reported no matching object.',
            selected: true,
          }),
        );
        return {
          rdapServer: url,
          transportSecurity: /^https:\/\//i.test(url) ? 'https' : 'http',
          upstreamStatus: upstream.status,
          fetchedAt: new Date().toISOString(),
          data,
          parsed: null,
          attempts,
        };
      }

      const parsed = parseRdap(type, data);
      const validation = validateRdapResponse(type, value, parsed);
      if (!validation.valid) {
        attempts.push(
          rdapAttempt(url, 'invalid_response', {
            status: upstream.status,
            detail: validation.detail,
          }),
        );
        continue;
      }

      attempts.push(
        rdapAttempt(url, 'success', {
          status: upstream.status,
          detail: 'The endpoint returned the requested RDAP object.',
          selected: true,
        }),
      );
      return {
        rdapServer: url,
        transportSecurity: /^https:\/\//i.test(url) ? 'https' : 'http',
        upstreamStatus: upstream.status,
        fetchedAt: new Date().toISOString(),
        data,
        parsed,
        attempts,
      };
    } catch (cause) {
      const detail = String(errorProperty(cause, 'message') || 'request failed');
      const outcome =
        errorProperty(cause, 'name') === 'AbortError' ||
        /timed? out|time limit/i.test(detail)
          ? 'timeout'
          : 'network_error';
      attempts.push(rdapAttempt(url, outcome, { detail }));
    }
  }

  const detail = attempts.length
    ? attempts
        .map(
          (attempt) =>
            `${attempt.endpoint} ${rdapFailure(attempt.outcome, attempt.status)}`,
        )
        .join('; ')
    : 'the total upstream deadline expired';
  throw Object.assign(
    new Error(
      `RDAP lookup failed across ${candidates.length} endpoint(s): ${detail}`,
    ),
    { attempts },
  );
}

export async function fetchRdapRecordWithParser<const T extends string>(
  type: T,
  value: string,
  parseRdap: RdapParser,
): Promise<RdapLookupRecord<NormalizedRdapRecordFor<T>> | null> {
  return cached(`rdap:${type}:${value}`, async () => {
    const bases = await findRdapBases(type, value);
    return fetchRdapFromBasesWithParser(type, value, bases, parseRdap);
  });
}
