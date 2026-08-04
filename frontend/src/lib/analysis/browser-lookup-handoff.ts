import { normalizeDomain } from './case-model.ts';

export const BROWSER_HANDOFF_DESTINATION_KINDS = ['lookup', 'local_companion', 'external_https'] as const;
export type BrowserHandoffDestinationKind = typeof BROWSER_HANDOFF_DESTINATION_KINDS[number];
export type BrowserHandoffDisclosureFormat = 'domain' | 'sanitized_url';
export type BrowserHandoffVisibility = 'this_deployment' | 'local_device' | 'third_party';

export type BrowserLookupHandoff = Readonly<{
  domain: string;
  path: string;
  sanitizedUrl: string;
  disclosedValue: string;
  destinationKind: BrowserHandoffDestinationKind;
  destinationLabel: string;
  destinationUrl: string;
  visibility: BrowserHandoffVisibility;
  opensNewContext: boolean;
  discarded: readonly string[];
  limitations: readonly string[];
}>;

type BrowserLookupHandoffOptions = Readonly<{
  destinationKind?: BrowserHandoffDestinationKind;
  endpoint?: unknown;
  disclosureFormat?: BrowserHandoffDisclosureFormat;
}>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function normalizedEndpointHostname(endpoint: URL): string {
  const hostname = endpoint.hostname.toLowerCase();
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function destinationEndpoint(kind: BrowserHandoffDestinationKind, raw: unknown): URL | null {
  if (kind === 'lookup') return null;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) {
    throw new Error('Enter the exact companion or service endpoint before preparing this handoff.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw.trim());
  } catch {
    throw new Error('Enter a valid absolute endpoint URL.');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('The endpoint cannot contain credentials, a query, or a fragment.');
  }
  if (kind === 'local_companion') {
    if (!['http:', 'https:'].includes(endpoint.protocol) || !LOOPBACK_HOSTS.has(normalizedEndpointHostname(endpoint))) {
      throw new Error('A local companion endpoint must use HTTP(S) on localhost or a loopback address.');
    }
  } else if (endpoint.protocol !== 'https:') {
    throw new Error('An external handoff endpoint must use HTTPS.');
  }
  return endpoint;
}

function destinationDetails(
  kind: BrowserHandoffDestinationKind,
  endpoint: URL | null,
  disclosedValue: string,
): Pick<BrowserLookupHandoff, 'path' | 'destinationLabel' | 'destinationUrl' | 'visibility' | 'opensNewContext'> {
  if (kind === 'lookup') {
    const path = `/lookup?q=${encodeURIComponent(disclosedValue)}&depth=deep#query`;
    return {
      path,
      destinationLabel: 'WHOISleuth Deep Lookup',
      destinationUrl: path,
      visibility: 'this_deployment',
      opensNewContext: false,
    };
  }
  if (!endpoint) throw new Error('The handoff endpoint is unavailable.');
  endpoint.searchParams.set('target', disclosedValue);
  return {
    path: '',
    destinationLabel: kind === 'local_companion' ? 'Configured local companion' : 'Configured external service',
    destinationUrl: endpoint.toString(),
    visibility: kind === 'local_companion' ? 'local_device' : 'third_party',
    opensNewContext: true,
  };
}

export function buildBrowserLookupHandoff(
  value: unknown,
  options: BrowserLookupHandoffOptions = {},
): BrowserLookupHandoff {
  const raw = typeof value === 'string' ? value.trim() : '';
  const domain = normalizeDomain(raw);
  if (!domain) throw new Error('Enter a valid domain or HTTP(S) URL.');
  let parsed: URL | null = null;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    parsed = null;
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Enter a valid domain or HTTP(S) URL.');
  }
  const destinationKind = BROWSER_HANDOFF_DESTINATION_KINDS.includes(options.destinationKind ?? 'lookup')
    ? options.destinationKind ?? 'lookup'
    : 'lookup';
  const disclosureFormat = options.disclosureFormat === 'sanitized_url' ? 'sanitized_url' : 'domain';
  const sanitizedUrl = `${parsed.protocol}//${domain}/`;
  const disclosedValue = disclosureFormat === 'sanitized_url' ? sanitizedUrl : domain;
  const endpoint = destinationEndpoint(destinationKind, options.endpoint);
  const destination = destinationDetails(destinationKind, endpoint, disclosedValue);
  const discarded = [
    parsed?.username || parsed?.password ? 'credentials' : '',
    parsed?.port ? 'port' : '',
    parsed?.pathname && parsed.pathname !== '/' ? 'path' : '',
    parsed?.search ? 'query' : '',
    parsed?.hash ? 'fragment' : '',
  ].filter(Boolean);
  return {
    domain,
    sanitizedUrl,
    disclosedValue,
    destinationKind,
    ...destination,
    discarded,
    limitations: [
      'The handoff contains only the displayed normalised hostname or sanitised HTTP(S) origin. It never includes URL credentials, port, path, query, fragment, or browser-local identifiers.',
      destinationKind === 'lookup'
        ? 'Opening the handoff fills Lookup but does not start collection. Review the target and collection plan before submitting.'
        : 'Opening the handoff discloses the displayed value to the exact displayed endpoint. WHOISleuth does not discover, validate, submit to, or monitor that service.',
    ],
  };
}
