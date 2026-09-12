// Ordinary collection retains a hostname, not a pasted URL's private path or query.
// Registration classification and network-address safety remain separate.
import { isValidAsciiHostname } from '../contracts/domain-name.mts';
import { MAX_OUTBOUND_HTTP_URL_CHARACTERS } from '../contracts/http-url.mts';
export const MAX_LOOKUP_INPUT_CHARACTERS = 2 * 1024 * 1024;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;
const CONTROL = /[\u0000-\u001f\u007f]/u;
export type WebObservationMode = 'selected_url';

export function validWebObservationMode(value: unknown): value is WebObservationMode | undefined {
  return value === undefined || value === 'selected_url';
}

/** A separate deliberate action; ordinary URL input never selects its path. */
export function prepareSelectedLookupUrl(value: unknown, hostname?: string): string {
  if (typeof value !== 'string' || value.includes('\\')) throw new TypeError('Select a valid HTTP(S) URL.');
  const parsed = parseCredentialFreeHttpUrl(value, MAX_OUTBOUND_HTTP_URL_CHARACTERS);
  if (!parsed || parsed.port || !isValidAsciiHostname(parsed.hostname)
    || /^\d+\.\d+\.\d+\.\d+$/u.test(parsed.hostname)
    || hostname !== undefined && parsed.hostname !== hostname) {
    throw new TypeError('Selected URL must use the submitted hostname and a default HTTP(S) port, without credentials.');
  }
  parsed.hash = '';
  const url = parsed.toString();
  if (url.length > MAX_OUTBOUND_HTTP_URL_CHARACTERS) throw new TypeError('Selected URL exceeds the request bound.');
  return url;
}

/** Older results collected supporting evidence at the registrable domain. */
export function lookupObservationHostname(availability: Readonly<{ observationHostname?: unknown; domain?: unknown }>): string | null {
  const value = availability.observationHostname === undefined ? availability.domain : availability.observationHostname;
  return typeof value === 'string' && isValidAsciiHostname(value) && value === value.toLowerCase() ? value : null;
}

function validLookupObservationHostname(
  value: unknown,
  query: Readonly<{ inputHostname?: unknown; registrableDomain?: unknown; submitted?: unknown }>,
): boolean {
  return typeof value === 'string' && isValidAsciiHostname(value) && value === value.toLowerCase()
    && value === (query.inputHostname ?? query.submitted ?? query.registrableDomain)
    && typeof query.registrableDomain === 'string'
    && (value === query.registrableDomain || value.endsWith(`.${query.registrableDomain}`));
}

/** Bind collection identities without treating an omitted historical identity as new evidence. */
export function validLookupObservationScope(
  availability: Readonly<{ observationHostname?: unknown; webObservationMode?: unknown; http?: unknown; dns?: unknown }>,
  query: Readonly<{ inputHostname?: unknown; registrableDomain?: unknown; submitted?: unknown }>,
): boolean {
  if (availability.observationHostname !== undefined && !validLookupObservationHostname(availability.observationHostname, query)) return false;
  if (!validWebObservationMode(availability.webObservationMode)) return false;
  if (availability.webObservationMode === 'selected_url') {
    if (!validLookupObservationHostname(availability.observationHostname, query)) return false;
    const http = availability.http;
    const requestUrl = http && typeof http === 'object' && !Array.isArray(http) ? Reflect.get(http, 'requestUrl') : null;
    const parsed = parseCredentialFreeHttpUrl(requestUrl, MAX_OUTBOUND_HTTP_URL_CHARACTERS);
    if (!parsed || parsed.hostname !== availability.observationHostname || parsed.port || parsed.search || parsed.hash) return false;
  }
  const dns = availability.dns;
  const delegation = dns && typeof dns === 'object' && !Array.isArray(dns) ? Reflect.get(dns, 'delegation') : null;
  const registrationDomain = delegation && typeof delegation === 'object' && !Array.isArray(delegation) ? Reflect.get(delegation, 'domain') : null;
  return registrationDomain == null || (typeof registrationDomain === 'string'
    && isValidAsciiHostname(registrationDomain) && registrationDomain === query.registrableDomain);
}

export function parseCredentialFreeHttpUrl(value: unknown, maximumLength: number): URL | null {
  if (typeof value !== 'string' || !value || value.length > maximumLength
    || value.trim() !== value || CONTROL.test(value)) return null;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !parsed.username && !parsed.password && parsed.hostname ? parsed : null;
  } catch {
    return null;
  }
}

export function prepareLookupCollectionTarget(value: string): string {
  if (value.length > MAX_LOOKUP_INPUT_CHARACTERS || CONTROL.test(value) || value.includes('\\')) {
    throw new TypeError('Lookup input exceeds its bound or contains control characters.');
  }
  const raw = value.trim();
  if (!raw) throw new TypeError('Enter a domain, IP address or ASN.');
  const absolute = URL_SCHEME.test(raw);
  // An unbracketed IPv6 literal is not a URL with a port. Use the same URL
  // parser to admit its syntax, then leave address safety and ASN bounds to
  // the classifier; malformed colon-separated text must not become a request.
  if (!absolute && !/[\s/@?#\\]/u.test(raw)) {
    if (/^(?:AS)?\d+$/iu.test(raw)) return raw;
    if ((raw.match(/:/gu)?.length ?? 0) > 1 && !raw.startsWith('[')) {
      if (!parseCredentialFreeHttpUrl(`https://[${raw}]`, MAX_LOOKUP_INPUT_CHARACTERS + 10)) {
        throw new TypeError('Enter a valid IPv6 address without a scope identifier.');
      }
      return raw;
    }
  }
  const parsed = parseCredentialFreeHttpUrl(absolute ? raw : `https://${raw}`,
    MAX_LOOKUP_INPUT_CHARACTERS + 'https://'.length);
  if (!parsed) throw new TypeError('Enter a valid domain, IP, or ASN. URLs must use HTTP(S) without credentials.');
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(parsed.hostname)) {
    const authority = (absolute ? raw.slice(raw.indexOf('://') + 3) : raw).split(/[/?#]/u)[0]!;
    const originalHost = authority.split(':')[0]!.replace(/\.$/u, '');
    if (originalHost !== parsed.hostname) throw new TypeError('Use a complete canonical IP address, not an abbreviated or encoded address.');
  }
  // WHATWG URLs bracket IPv6; the existing classifier accepts the bare address.
  return parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
}
