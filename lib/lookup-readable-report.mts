import { buildLookupEvidence } from './evidence-export.mts';
import { formatLookupEvidenceMarkdown } from './evidence-report-markdown.mts';
import {
  createLookupViewModel,
  isJsonObject,
  type JsonObject,
  type LookupHttpResponse,
} from './lookup-response-contract.mts';

export const LOOKUP_READABLE_REPORT_VERSION = 1;
export const MAX_LOOKUP_READABLE_REPORT_BYTES = 64 * 1024;

type LookupReadableReportOptions = {
  generatedAt?: string;
  risk?: unknown;
};

function selectedObjectValues(value: JsonObject, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, value[key]]));
}

function projectedRegistrar(value: unknown): Record<string, unknown> | null {
  if (!isJsonObject(value)) return null;
  return selectedObjectValues(value, ['name', 'org', 'handle']);
}

function projectedRegistryPublication(
  value: JsonObject,
  { includeSourceHandle = true }: { includeSourceHandle?: boolean } = {},
): Record<string, unknown> {
  const lifecycle = isJsonObject(value.lifecycle)
    ? selectedObjectValues(value.lifecycle, [
        'createdDate',
        'createdDateIso',
        'expiryDate',
        'expiryDateIso',
        'updatedDate',
        'updatedDateIso',
      ])
    : {};
  const projected = selectedObjectValues(value, [
    'domain',
    'domainName',
    'handle',
    'registryDomainId',
    'registrarIanaId',
    'createdDate',
    'createdDateIso',
    'expiryDate',
    'expiryDateIso',
    'updatedDate',
    'updatedDateIso',
    'dnssec',
    'statuses',
    'nameservers',
    'chainStatus',
    'authoritativeHop',
    'failedHop',
    'conflictingHop',
    'serverTruncated',
  ]);
  if (!includeSourceHandle) {
    delete projected.handle;
    delete projected.registryDomainId;
  }
  projected.lifecycle = lifecycle;
  projected.registrar = projectedRegistrar(value.registrar);
  return projected;
}

function projectedAvailability(value: JsonObject): Record<string, unknown> {
  const dns = isJsonObject(value.dns)
    ? selectedObjectValues(value.dns, ['status', 'observedAt'])
    : {};
  const httpSource = isJsonObject(value.http) ? value.http : {};
  const httpResponse = isJsonObject(httpSource.response)
    ? selectedObjectValues(httpSource.response, ['status', 'contentType'])
    : {};
  const tlsSource = isJsonObject(value.tls) ? value.tls : {};
  const tlsAuthorization = isJsonObject(tlsSource.authorization)
    ? selectedObjectValues(tlsSource.authorization, ['authorized'])
    : {};
  const tlsHostname = isJsonObject(tlsSource.hostname)
    ? selectedObjectValues(tlsSource.hostname, ['matches'])
    : {};
  const tlsValidity = isJsonObject(tlsSource.validity)
    ? selectedObjectValues(tlsSource.validity, ['status'])
    : {};
  const tlsCertificate = isJsonObject(tlsSource.certificate)
    ? selectedObjectValues(tlsSource.certificate, ['fingerprintSha256'])
    : {};

  return {
    ...selectedObjectValues(value, [
      'state',
      'confidence',
      'detail',
      'activityStatus',
      'websiteProbeStatus',
      'websiteProbeDetail',
      'deepScanComplete',
      'hasMx',
      'hasSpf',
      'hasDmarc',
      'nameservers',
      'mxHosts',
      'pageTitle',
      'hasPasswordField',
    ]),
    dns,
    http: {
      ...selectedObjectValues(httpSource, ['status', 'observedAt', 'finalUrl', 'redirectCount']),
      response: httpResponse,
    },
    tls: {
      ...selectedObjectValues(tlsSource, ['status', 'observedAt', 'protocol']),
      authorization: tlsAuthorization,
      hostname: tlsHostname,
      validity: tlsValidity,
      certificate: tlsCertificate,
    },
  };
}

function projectedDiagnostics(value: JsonObject): Record<string, unknown> {
  const rdap = isJsonObject(value.rdap) ? value.rdap : {};
  const registrar = isJsonObject(rdap.registrar) ? rdap.registrar : {};
  const registryAccess = isJsonObject(value.registryAccess) ? value.registryAccess : {};
  return {
    ...selectedObjectValues(value, ['version']),
    rdap: {
      ...selectedObjectValues(rdap, ['status']),
      registrar: selectedObjectValues(registrar, ['status']),
    },
    whois: isJsonObject(value.whois)
      ? selectedObjectValues(value.whois, ['status'])
      : {},
    availability: isJsonObject(value.availability)
      ? selectedObjectValues(value.availability, ['status'])
      : {},
    registryAccess: selectedObjectValues(registryAccess, [
      'authority',
      'suffix',
      'whoisAccessProfile',
      'rdapAccessProfile',
      'limitation',
    ]),
  };
}

function projectedNetworkContext(value: JsonObject): Record<string, unknown> {
  const endpoint = isJsonObject(value.endpoint) ? value.endpoint : {};
  const rdap = isJsonObject(value.rdap) ? value.rdap : {};
  const network = isJsonObject(value.network) ? value.network : {};
  return {
    ...selectedObjectValues(value, [
      'contextVersion',
      'version',
      'status',
      'observedAt',
      'scanMode',
      'source',
      'durationMs',
      'complete',
      'truncated',
      'limitations',
      'detail',
    ]),
    endpoint: selectedObjectValues(endpoint, ['address', 'family', 'selectedFrom']),
    rdap: selectedObjectValues(rdap, ['endpoint', 'httpStatus', 'fetchedAt']),
    network: selectedObjectValues(network, [
      'handle',
      'name',
      'holder',
      'cidrs',
      'startAddress',
      'endAddress',
      'country',
      'networkType',
      'databaseUpdatedAt',
    ]),
  };
}

function projectedLookup(response: LookupHttpResponse): Record<string, unknown> {
  const view = createLookupViewModel(response);
  const registrarRdap = view.registrarRdap;
  const rdap = view.rdap;
  const whois = view.whois;
  const firstWhoisHop = Array.isArray(whois.chain) && isJsonObject(whois.chain[0])
    ? selectedObjectValues(whois.chain[0], ['queriedAt'])
    : null;
  const projectedRegistrarRdap = Object.keys(registrarRdap).length
    ? {
        ...selectedObjectValues(registrarRdap, [
          'status',
          'endpoint',
          'transportSecurity',
          'upstreamStatus',
          'fetchedAt',
        ]),
        parsed: projectedRegistryPublication(view.registrarRdapParsed, {
          includeSourceHandle: false,
        }),
      }
    : null;

  return {
    query: response.query,
    type: response.type,
    inputHostname: response.inputHostname,
    registrableDomain: response.registrableDomain,
    isSubdomain: response.isSubdomain === true,
    availability: projectedAvailability(view.availability),
    diagnostics: projectedDiagnostics(view.diagnostics),
    rdap: {
      ...selectedObjectValues(rdap, [
        'error',
        'rdapServer',
        'transportSecurity',
        'upstreamStatus',
        'fetchedAt',
      ]),
      parsed: projectedRegistryPublication(view.rdapParsed),
      ...(projectedRegistrarRdap ? { registrarRdap: projectedRegistrarRdap } : {}),
    },
    whois: {
      ...selectedObjectValues(whois, ['error']),
      parsed: projectedRegistryPublication(view.whoisParsed),
      chain: firstWhoisHop ? [firstWhoisHop] : [],
    },
    ...(Object.keys(view.observedNetworkContext).length
      ? { networkContext: projectedNetworkContext(view.observedNetworkContext) }
      : {}),
  };
}

function generatedTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function buildLookupReadableReport(
  response: LookupHttpResponse,
  options: LookupReadableReportOptions = {},
): string {
  const generatedAt = generatedTimestamp(options.generatedAt);
  const projected = projectedLookup(response);
  const evidence = buildLookupEvidence(projected, {
    generatedAt,
    idnAnalysis: null,
  });
  const projectedRdap = isJsonObject(projected.rdap) ? projected.rdap : {};
  const registrarRdap = isJsonObject(projectedRdap.registrarRdap)
    ? projectedRdap.registrarRdap
    : null;
  const markdown = formatLookupEvidenceMarkdown(evidence, {
    risk: options.risk,
    registrarRdap,
  });
  if (new TextEncoder().encode(markdown).byteLength > MAX_LOOKUP_READABLE_REPORT_BYTES) {
    throw new RangeError('Readable Lookup report exceeded its byte limit.');
  }
  return markdown;
}

function lookupReadableReportFilename(
  response: Pick<LookupHttpResponse, 'inputHostname' | 'query' | 'registrableDomain'>,
  now = Date.now(),
): string {
  const rawTarget = response.registrableDomain || response.inputHostname || response.query || 'lookup';
  const target = String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'lookup';
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `whoisleuth-lookup-report-${target}-${timestamp}.md`;
}

export {
  buildLookupReadableReport,
  lookupReadableReportFilename,
  projectedLookup as projectLookupForReadableReport,
};
export type { LookupReadableReportOptions };
