import { compareRdapPublications, compareRegistrySources } from './registry-comparison.mts';
import { buildRegistryInsights } from './registry-insights.mts';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = 21;

type UnknownRecord = Record<string, unknown>;
type LookupEvidenceOptions = { generatedAt?: string; idnAnalysis?: unknown };

const REGISTRAR_RDAP_STATUSES = new Set([
  'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
]);
const NETWORK_CONTEXT_STATUSES = new Set(['success', 'partial', 'not_found', 'unsupported', 'error']);
const NETWORK_ADDRESS_SOURCES = new Set(['tls_connection', 'dns_a', 'dns_aaaa']);
const REVERSE_DNS_STATUSES = new Set(['success', 'partial', 'not_found', 'unsupported', 'skipped', 'error']);
const SECURITY_TXT_STATES = new Set(['present', 'stale', 'partial', 'absent', 'malformed', 'unsupported', 'unavailable']);

function recordOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

function boundedInteger(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : null;
}

function boundedHttpStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

function boundedTimestamp(value: unknown): string | null {
  const text = boundedString(value, 64);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function boundedEndpoint(value: unknown): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function boundedStringList(value: unknown, count: number, length: number): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, count)
    .map((item) => boundedString(item, length))
    .filter((item): item is string => item !== null))];
}

function boundedHostname(value: unknown): string | null {
  const text = boundedString(value, 253)?.toLowerCase().replace(/\.+$/u, '') || null;
  if (!text || !text.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))) {
    return null;
  }
  return text;
}

function boundedPublishedUri(value: unknown, protocols: string[]): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!protocols.includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function boundedUriList(value: unknown, protocols: string[]): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, 10)
    .map((item) => boundedPublishedUri(item, protocols))
    .filter((item): item is string => item !== null))];
}

function securityTxtSource(value: unknown) {
  const source = recordOrNull(value);
  if (
    !source
    || source.securityTxtVersion !== 1
    || typeof source.state !== 'string'
    || !SECURITY_TXT_STATES.has(source.state)
  ) return null;
  return {
    securityTxtVersion: 1,
    version: source.version === 1 ? 1 : null,
    state: source.state,
    status: boundedString(source.status, 40),
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: source.source === 'security_txt' ? 'security_txt' : null,
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: source.complete === true,
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    detail: boundedString(source.detail, 300),
    requestedUrl: boundedPublishedUri(source.requestedUrl, ['https:']),
    finalUrl: boundedPublishedUri(source.finalUrl, ['https:']),
    httpStatus: boundedHttpStatus(source.httpStatus),
    redirectCount: boundedInteger(source.redirectCount, 3),
    expiresAt: boundedTimestamp(source.expiresAt),
    signed: source.signed === true,
    canonicalMatches: typeof source.canonicalMatches === 'boolean' ? source.canonicalMatches : null,
    contacts: boundedUriList(source.contacts, ['https:', 'mailto:', 'tel:']),
    policies: boundedUriList(source.policies, ['https:']),
    encryption: boundedUriList(source.encryption, ['https:', 'dns:', 'openpgp4fpr:']),
    canonical: boundedUriList(source.canonical, ['https:']),
    preferredLanguages: boundedStringList(source.preferredLanguages, 10, 40),
  };
}

function networkAttempt(value: unknown) {
  const attempt = recordOrNull(value) || {};
  const endpoint = boundedEndpoint(attempt.endpoint);
  return {
    endpoint,
    transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
    status: boundedHttpStatus(attempt.status),
    outcome: boundedString(attempt.outcome, 40),
    detail: boundedString(attempt.detail, 240),
    selected: attempt.selected === true,
  };
}

function networkSource(value: unknown) {
  const source = recordOrNull(value);
  if (
    !source
    || source.contextVersion !== 1
    || typeof source.status !== 'string'
    || !NETWORK_CONTEXT_STATUSES.has(source.status)
  ) return null;
  const endpoint = recordOrNull(source.endpoint);
  const rdap = recordOrNull(source.rdap);
  const network = recordOrNull(source.network);
  const diagnostics = recordOrNull(source.diagnostics);
  const rdapEndpoint = boundedEndpoint(rdap?.endpoint);
  return {
    contextVersion: 1,
    version: source.version === 1 ? 1 : null,
    status: source.status,
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: source.source === 'ip_rdap' ? 'ip_rdap' : null,
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: source.complete === true,
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    diagnostics: diagnostics ? {
      requestCount: boundedInteger(diagnostics.requestCount, 1),
      addressSource: typeof diagnostics.addressSource === 'string'
        && NETWORK_ADDRESS_SOURCES.has(diagnostics.addressSource)
        ? diagnostics.addressSource
        : null,
      httpStatus: boundedHttpStatus(diagnostics.httpStatus),
      cidrCount: boundedInteger(diagnostics.cidrCount, 16),
    } : null,
    detail: boundedString(source.detail, 300),
    endpoint: endpoint ? {
      address: boundedString(endpoint.address, 64),
      family: endpoint.family === 4 || endpoint.family === 6 ? endpoint.family : null,
      selectedFrom: typeof endpoint.selectedFrom === 'string'
        && NETWORK_ADDRESS_SOURCES.has(endpoint.selectedFrom)
        ? endpoint.selectedFrom
        : null,
    } : null,
    rdap: rdap ? {
      endpoint: rdapEndpoint,
      transportSecurity: rdapEndpoint ? rdapEndpoint.startsWith('https:') ? 'https' : 'http' : null,
      httpStatus: boundedHttpStatus(rdap.httpStatus),
      fetchedAt: boundedTimestamp(rdap.fetchedAt),
      attempts: (Array.isArray(rdap.attempts) ? rdap.attempts : []).slice(0, 3).map(networkAttempt),
    } : null,
    network: network ? {
      handle: boundedString(network.handle, 300),
      name: boundedString(network.name, 300),
      holder: boundedString(network.holder, 300),
      cidrs: boundedStringList(network.cidrs, 16, 96),
      startAddress: boundedString(network.startAddress, 64),
      endAddress: boundedString(network.endAddress, 64),
      country: /^[a-z]{2}$/i.test(String(network.country || '')) ? String(network.country).toUpperCase() : null,
      networkType: boundedString(network.networkType, 160),
      databaseUpdatedAt: boundedTimestamp(network.databaseUpdatedAt),
    } : null,
  };
}

function reverseDnsSource(value: unknown) {
  const source = recordOrNull(value);
  if (!source
    || source.version !== 1
    || source.source !== 'reverse_dns'
    || typeof source.status !== 'string'
    || !REVERSE_DNS_STATUSES.has(source.status)) {
    return null;
  }
  const records = recordOrNull(source.records);
  const diagnostics = recordOrNull(source.diagnostics);
  const ptrDiagnostics = recordOrNull(diagnostics?.ptr);
  const ptr = [...new Set((Array.isArray(records?.ptr) ? records.ptr : [])
    .slice(0, 8)
    .map(boundedHostname)
    .filter((item): item is string => item !== null))].sort();
  return {
    version: 1,
    status: source.status,
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: 'reverse_dns',
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: source.complete === true,
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    diagnostics: ptrDiagnostics ? {
      ptr: {
        status: boundedString(ptrDiagnostics.status, 40),
        error: boundedString(ptrDiagnostics.error, 180),
        truncated: ptrDiagnostics.truncated === true,
        discarded: boundedInteger(ptrDiagnostics.discarded, 1000),
      },
    } : null,
    records: { ptr },
  };
}

function rdapSource(rdap: unknown) {
  const source = recordOrNull(rdap) || {};
  if (source.error) return {
    status: 'error',
    error: String(source.error),
    attempts: cloneJson(source.attempts || []),
  };
  return {
    status: source.upstreamStatus === 404 ? 'not_found' : 'success',
    endpoint: source.rdapServer || null,
    transportSecurity: source.transportSecurity || null,
    httpStatus: source.upstreamStatus ?? null,
    fetchedAt: source.fetchedAt || null,
    attempts: cloneJson(source.attempts || []),
    parsed: cloneJson(source.parsed),
    raw: cloneJson(source.data),
  };
}

function whoisSource(whois: unknown) {
  const source = recordOrNull(whois) || {};
  if (source.error) return { status: 'error', error: String(source.error) };
  const parsed = recordOrNull(source.parsed);
  const chain = Array.isArray(source.chain) ? source.chain : [];
  const firstHop = recordOrNull(chain[0]);
  return {
    status: parsed?.chainStatus || 'unknown',
    queriedAt: firstHop?.queriedAt || null,
    authoritativeHop: parsed?.authoritativeHop || null,
    failedHop: parsed?.failedHop || null,
    conflictingHop: parsed?.conflictingHop || null,
    parsed: cloneJson(parsed),
    chain: cloneJson(chain),
  };
}

function registrarPublicationComparison(body: UnknownRecord, registryParsed: UnknownRecord | null) {
  const rdap = recordOrNull(body.rdap);
  const registrar = recordOrNull(rdap?.registrarRdap);
  const diagnostics = recordOrNull(body.diagnostics);
  const rdapDiagnostics = recordOrNull(diagnostics?.rdap);
  const registrarDiagnostics = recordOrNull(rdapDiagnostics?.registrar);
  if (!registrar && !registrarDiagnostics) return null;

  const reportedStatus = registrar?.status ?? registrarDiagnostics?.status;
  const parsed = recordOrNull(registrar?.parsed);
  const registrarStatus = typeof reportedStatus === 'string' && REGISTRAR_RDAP_STATUSES.has(reportedStatus)
    ? (reportedStatus === 'success' && !parsed ? 'partial' : reportedStatus)
    : 'error';
  return compareRdapPublications(registryParsed, parsed, {
    registryStatus: rdapDiagnostics?.status,
    registrarStatus,
  });
}

export function buildLookupEvidence(response: unknown, options: LookupEvidenceOptions = {}) {
  const { generatedAt = new Date().toISOString(), idnAnalysis = null } = options;
  const body = recordOrNull(response) || {};
  const rdap = recordOrNull(body.rdap);
  const whois = recordOrNull(body.whois);
  const diagnostics = recordOrNull(body.diagnostics);
  const rdapDiagnostics = recordOrNull(diagnostics?.rdap);
  const whoisDiagnostics = recordOrNull(diagnostics?.whois);
  const rdapParsed = rdap && !rdap.error ? recordOrNull(rdap.parsed) : null;
  const whoisParsed = whois && !whois.error ? recordOrNull(whois.parsed) : null;
  const registrarRdap = recordOrNull(rdap?.registrarRdap);
  const registrarRdapParsed = recordOrNull(registrarRdap?.parsed);
  // Rebuild the pure interpretation from bounded source fields instead of
  // trusting a supplied derived object. This adds no collection or network
  // work and lets saved or fast responses carry current source-health-aware
  // interpretation in a deliberate analyst-created export.
  const registryInsights = buildRegistryInsights({
    rdapParsed,
    rdapStatus: rdapDiagnostics?.status,
    rdapFetchedAt: rdap?.fetchedAt,
    whoisParsed,
    whoisStatus: whoisDiagnostics?.status,
    whoisQueriedAt: recordOrNull(Array.isArray(whois?.chain) ? whois.chain[0] : null)?.queriedAt,
    registrarRdapParsed,
    registrarRdapStatus: registrarRdap?.status ?? recordOrNull(rdapDiagnostics?.registrar)?.status,
    registrarRdapFetchedAt: registrarRdap?.fetchedAt,
  });
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    application: { name: 'WHOISleuth' },
    query: {
      submitted: body.query || null,
      type: body.type || null,
      inputHostname: body.inputHostname || null,
      registrableDomain: body.registrableDomain || null,
      isSubdomain: body.isSubdomain === true,
    },
    diagnostics: cloneJson(body.diagnostics),
    sources: {
      rdap: rdapSource(rdap),
      whois: whoisSource(whois),
      reverseDns: reverseDnsSource(body.reverseDns),
      network: networkSource(body.networkContext),
      securityTxt: securityTxtSource(body.securityTxt),
    },
    analysis: {
      availability: cloneJson(body.availability),
      idn: cloneJson(idnAnalysis),
      registryInsights,
      registryComparison: compareRegistrySources(rdapParsed, whoisParsed, {
        rdapStatus: rdapDiagnostics?.status,
        whoisStatus: whoisDiagnostics?.status,
      }),
      registrarPublicationComparison: registrarPublicationComparison(body, rdapParsed),
    },
  };
}

export function evidenceFilename(response: unknown, now = Date.now()) {
  const record = recordOrNull(response);
  const rawTarget = record?.registrableDomain || record?.inputHostname || record?.query || 'lookup';
  const target = String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lookup';
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `whoisleuth-evidence-${target}-${timestamp}.json`;
}
