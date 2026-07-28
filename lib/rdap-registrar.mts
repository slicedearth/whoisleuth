import net from 'node:net';

import { cached } from './lookup-cache.mts';
import { rdapAttempt } from './rdap-attempts.mts';
import { MAX_RDAP_ENDPOINT_LENGTH } from './rdap-bootstrap.mts';
import {
  fetchRdapWithTimeout,
  type RdapFetch,
  type RdapFetchResult,
} from './rdap-transport.mts';
import type {
  LooseRdapRecord,
  NormalizedRdapDomainRecord,
  RegistryRdapLinkSource,
} from './rdap-types.mts';
import {
  canonicalRdapDomain,
  validateRdapResponse,
} from './rdap-validation.mts';

const REGISTRAR_RDAP_TIMEOUT_MS = 7_000;

function recordOrNull(value: unknown): LooseRdapRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as LooseRdapRecord)
    : null;
}

function registrarRdapError(
  endpoint: string,
  outcome: string,
  options: { status?: number | null; detail?: string | null; selected?: boolean } = {},
) {
  const attempt = rdapAttempt(endpoint, outcome, options);
  const detail = attempt.detail || 'The registrar RDAP request failed.';
  return Object.assign(new Error(detail), {
    registrarRdap: {
      status: 'error',
      detail,
      endpoint: attempt.endpoint,
      transportSecurity: attempt.transportSecurity,
      upstreamStatus: attempt.status,
      fetchedAt: null,
      attempt,
    },
  });
}

function domainEndpointIdentity(raw: string, domain: string): string | null {
  try {
    const url = new URL(raw);
    const canonical = canonicalRdapDomain(domain);
    const path = url.pathname.replace(/\/+$/, '');
    const encodedDomain = path.match(/\/domain\/([^/]+)$/i)?.[1];
    if (!canonical || !encodedDomain) return null;
    const pathDomain = canonicalRdapDomain(decodeURIComponent(encodedDomain));
    if (pathDomain !== canonical) return null;
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}/domain/${canonical}`;
  } catch {
    return null;
  }
}

export function selectRegistrarRdapLink(
  domain: string,
  links: unknown,
  registryEndpoint: string | null = null,
): string | null {
  const canonical = canonicalRdapDomain(domain);
  if (!canonical || !Array.isArray(links)) return null;
  const registryIdentity = registryEndpoint
    ? domainEndpointIdentity(registryEndpoint, canonical)
    : null;

  for (const linkValue of links) {
    const link = linkValue as LooseRdapRecord;
    if (!link || typeof link !== 'object' || Array.isArray(link)) continue;
    if (link.rel !== 'related' || typeof link.href !== 'string') continue;
    if (
      link.href.length > MAX_RDAP_ENDPOINT_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(link.href)
    ) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    if (url.port || url.search || url.hash) continue;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(hostname)) continue;

    const type =
      typeof link.type === 'string'
        ? (link.type.split(';', 1)[0] ?? '').trim().toLowerCase()
        : '';
    if (type && type !== 'application/rdap+json') continue;

    const identity = domainEndpointIdentity(url.href, canonical);
    if (!identity || identity === registryIdentity) continue;
    return url.href;
  }
  return null;
}

type DomainParser = (
  type: 'domain',
  data: unknown,
) => NormalizedRdapDomainRecord | null;

export async function fetchRegistrarRdapRecordWithParser(
  domain: string,
  registryRecord: RegistryRdapLinkSource | null | undefined,
  parseRdap: DomainParser,
  options: { fetchUpstream?: RdapFetch } = {},
) {
  const canonical = canonicalRdapDomain(domain);
  if (!canonical) throw new Error('A valid domain is required for registrar RDAP.');
  const fetchUpstream = options.fetchUpstream || fetchRdapWithTimeout;

  return cached(`rdap-registrar:domain:${canonical}`, async () => {
    const registryParsed = recordOrNull(registryRecord?.parsed);
    const registryEndpoint =
      typeof registryRecord?.rdapServer === 'string' ? registryRecord.rdapServer : null;
    const endpoint = selectRegistrarRdapLink(
      canonical,
      registryParsed?.links,
      registryEndpoint,
    );
    if (!endpoint) {
      return {
        status: 'unsupported',
        detail: 'The registry did not publish a registrar RDAP link for this domain.',
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    }

    let upstream: RdapFetchResult;
    try {
      upstream = await fetchUpstream(
        endpoint,
        { headers: { Accept: 'application/rdap+json' } },
        REGISTRAR_RDAP_TIMEOUT_MS,
      );
    } catch (cause) {
      const error =
        cause && typeof cause === 'object' && !Array.isArray(cause)
          ? (cause as LooseRdapRecord)
          : {};
      const detail =
        typeof error.message === 'string' ? error.message : 'request failed';
      const outcome =
        error.name === 'AbortError' || /timed? out|time limit/i.test(detail)
          ? 'timeout'
          : /exceeded \d+ bytes/i.test(detail)
            ? 'invalid_response'
            : 'network_error';
      throw registrarRdapError(endpoint, outcome, { detail });
    }

    const selectedEndpoint = upstream.finalUrl || endpoint;
    if (
      selectRegistrarRdapLink(
        canonical,
        [{ rel: 'related', href: selectedEndpoint }],
        registryEndpoint,
      ) !== selectedEndpoint
    ) {
      throw registrarRdapError(selectedEndpoint, 'invalid_response', {
        status: upstream.status,
        detail:
          'The registrar endpoint redirected outside the eligible HTTPS domain-object URL boundary.',
      });
    }

    if (upstream.status !== 404 && !upstream.ok) {
      const outcome =
        upstream.status === 429
          ? 'rate_limited'
          : upstream.status >= 500
            ? 'server_error'
            : 'client_error';
      throw registrarRdapError(selectedEndpoint, outcome, {
        status: upstream.status,
        detail: `The registrar endpoint returned HTTP ${upstream.status}.`,
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(upstream.text);
    } catch {
      throw registrarRdapError(selectedEndpoint, 'invalid_json', {
        status: upstream.status,
        detail: 'The registrar endpoint returned invalid JSON.',
      });
    }

    const fetchedAt = new Date().toISOString();
    if (upstream.status === 404) {
      const attempt = rdapAttempt(selectedEndpoint, 'not_found', {
        status: upstream.status,
        detail: 'The registrar endpoint reported no matching object.',
        selected: true,
      });
      return {
        status: 'not_found',
        detail: 'The registrar RDAP service reported no matching object.',
        endpoint: selectedEndpoint,
        transportSecurity: 'https',
        upstreamStatus: upstream.status,
        fetchedAt,
        data,
        parsed: null,
        attempt,
      };
    }

    const parsed = parseRdap('domain', data);
    const validation = validateRdapResponse('domain', canonical, parsed);
    if (!validation.valid) {
      throw registrarRdapError(selectedEndpoint, 'invalid_response', {
        status: upstream.status,
        detail: validation.detail,
      });
    }

    const attempt = rdapAttempt(selectedEndpoint, 'success', {
      status: upstream.status,
      detail: 'The registrar endpoint returned the requested RDAP object.',
      selected: true,
    });
    return {
      status: 'success',
      detail: null,
      endpoint: selectedEndpoint,
      transportSecurity: 'https',
      upstreamStatus: upstream.status,
      fetchedAt,
      data,
      parsed,
      attempt,
    };
  });
}
