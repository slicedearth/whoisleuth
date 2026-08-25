import { buildLookupEvidence } from './evidence-export.mts';
import { formatLookupEvidenceMarkdown } from './evidence-report-markdown.mts';
import { buildRegistryInsights } from './registry-insights.mts';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from './project-metadata.mts';
import {
  buildPortableGeneratorMetadata,
  portableGeneratorAttribution,
} from './portable-generator.mts';
import {
  createLookupViewModel,
  isJsonObject,
  type JsonObject,
  type LookupHttpResponse,
} from './lookup-response-contract.mts';
import {
  DECISION_FACT_PRESENTATION_LABELS,
  projectDecisionFacts,
  type DecisionFact,
  type DecisionFactProjection,
  type DecisionFactProjectionCollection,
  type DecisionFactProjectionSet,
} from '../packages/evidence/decision-fact.mts';

export const LOOKUP_READABLE_REPORT_SCHEMA = 'whoisleuth.lookup-readable-report';
export const LOOKUP_READABLE_REPORT_VERSION = 3;
export const SUPPORTED_LOOKUP_READABLE_REPORT_VERSIONS = Object.freeze([
  LOOKUP_READABLE_REPORT_VERSION,
] as const);
export const MAX_LOOKUP_READABLE_REPORT_BYTES = 64 * 1024;

type LookupReadableReportOptions = {
  applicationVersion?: unknown;
  generatedAt?: string;
  includeAttribution?: boolean;
  risk?: unknown;
  decisionFacts?: readonly DecisionFact[];
};

function selectedObjectValues(value: JsonObject, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys
    .filter((key) => Object.hasOwn(value, key) && value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

function projectedRegistrar(value: unknown): Record<string, unknown> | null {
  if (!isJsonObject(value)) return null;
  return selectedObjectValues(value, ['name', 'org', 'handle']);
}

function projectedEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const endpoint = new URL(value);
    if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password) {
      return null;
    }
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint.toString().slice(0, 2_048);
  } catch {
    return null;
  }
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

function projectedNetworkRegistration(value: JsonObject): Record<string, unknown> {
  const lifecycle = isJsonObject(value.lifecycle)
    ? selectedObjectValues(value.lifecycle, [
        'createdDate',
        'createdDateIso',
        'updatedDate',
        'updatedDateIso',
      ])
    : {};
  return {
    ...selectedObjectValues(value, [
      'handle',
      'name',
      'startAddress',
      'endAddress',
      'cidrs',
      'cidrsTruncated',
      'country',
      'networkType',
      'statuses',
    ]),
    lifecycle,
  };
}

function projectedAutnumRegistration(value: JsonObject): Record<string, unknown> {
  const lifecycle = isJsonObject(value.lifecycle)
    ? selectedObjectValues(value.lifecycle, [
        'createdDate',
        'createdDateIso',
        'updatedDate',
        'updatedDateIso',
      ])
    : {};
  return {
    ...selectedObjectValues(value, [
      'handle',
      'name',
      'startAutnum',
      'endAutnum',
      'country',
      'autnumType',
      'statuses',
    ]),
    lifecycle,
  };
}

function projectedReverseDns(value: JsonObject): Record<string, unknown> {
  const records = isJsonObject(value.records) ? value.records : {};
  return {
    ...selectedObjectValues(value, [
      'version',
      'status',
      'observedAt',
      'scanMode',
      'complete',
      'truncated',
      'limitations',
    ]),
    records: selectedObjectValues(records, ['ptr']),
  };
}

function projectedSoaRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isJsonObject)
    .slice(0, 1)
    .map((record) => selectedObjectValues(record, [
      'nsname',
      'hostmaster',
      'serial',
      'refresh',
      'retry',
      'expire',
      'minttl',
    ]));
}

function projectedAvailability(value: JsonObject): Record<string, unknown> {
  const dnsSource = isJsonObject(value.dns) ? value.dns : {};
  const dnsRecords = isJsonObject(dnsSource.records) ? dnsSource.records : {};
  const dns = {
    ...selectedObjectValues(dnsSource, ['status', 'observedAt']),
    records: {
      soa: projectedSoaRecords(dnsRecords.soa),
    },
  };
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
  const firstWhoisHopObservedAt = firstWhoisHop?.queriedAt ?? null;
  const rdapDiagnostics = isJsonObject(view.diagnostics.rdap) ? view.diagnostics.rdap : {};
  const whoisDiagnostics = isJsonObject(view.diagnostics.whois) ? view.diagnostics.whois : {};
  const registrarDiagnostics = isJsonObject(rdapDiagnostics.registrar) ? rdapDiagnostics.registrar : {};
  // The readable report deliberately derives current interpretation from the
  // already-collected bounded fields. It performs no collection and preserves
  // the limitations and source-health states of incomplete or fast results.
  const registryInsights = buildRegistryInsights({
    rdapParsed: view.rdapParsed,
    rdapStatus: rdapDiagnostics.status,
    rdapFetchedAt: rdap.fetchedAt,
    whoisParsed: view.whoisParsed,
    whoisStatus: whoisDiagnostics.status,
    whoisQueriedAt: firstWhoisHopObservedAt,
    registrarRdapParsed: view.registrarRdapParsed,
    registrarRdapStatus: registrarRdap.status ?? registrarDiagnostics.status,
    registrarRdapFetchedAt: registrarRdap.fetchedAt,
  });

  const queryType = response.type;
  const projectedParsed = queryType === 'domain'
    ? projectedRegistryPublication(view.rdapParsed)
    : queryType === 'asn'
      ? projectedAutnumRegistration(view.rdapParsed)
      : projectedNetworkRegistration(view.rdapParsed);
  return {
    ...selectedObjectValues(response, [
      'query',
      'type',
      'inputHostname',
      'registrableDomain',
    ]),
    isSubdomain: response.isSubdomain === true,
    availability: projectedAvailability(view.availability),
    registryInsights,
    diagnostics: projectedDiagnostics(view.diagnostics),
    rdap: {
      ...selectedObjectValues(rdap, [
        'error',
        'rdapServer',
        'transportSecurity',
        'upstreamStatus',
        'fetchedAt',
      ]),
      rdapServer: projectedEndpoint(rdap.rdapServer),
      parsed: projectedParsed,
      ...(projectedRegistrarRdap ? { registrarRdap: projectedRegistrarRdap } : {}),
    },
    ...(queryType === 'ipv4' || queryType === 'ipv6'
      ? { reverseDns: projectedReverseDns(view.reverseDns) }
      : {}),
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
  if (response.type !== 'domain') {
    const markdown = formatNetworkIdentifierReadableReport(
      projected,
      generatedAt,
      options.applicationVersion,
      options.includeAttribution !== false,
    );
    if (new TextEncoder().encode(markdown).byteLength > MAX_LOOKUP_READABLE_REPORT_BYTES) {
      throw new RangeError('Readable Lookup report exceeded its byte limit.');
    }
    return markdown;
  }
  const evidence = buildLookupEvidence(projected, {
    generatedAt,
    idnAnalysis: null,
    applicationVersion: options.applicationVersion,
  });
  const projectedRdap = isJsonObject(projected.rdap) ? projected.rdap : {};
  const registrarRdap = isJsonObject(projectedRdap.registrarRdap)
    ? projectedRdap.registrarRdap
    : null;
  if (!Array.isArray(options.decisionFacts)) {
    throw new TypeError('Domain readable Lookup reports require canonical Decision Facts.');
  }
  const decisionFacts = projectDecisionFacts(options.decisionFacts);
  const evidenceMarkdown = formatLookupEvidenceMarkdown(evidence, {
    includeAttribution: false,
    risk: options.risk,
    registrarRdap,
  });
  const markdown = formatDomainReadableReport(
    evidenceMarkdown,
    decisionFacts,
    options.applicationVersion,
    options.includeAttribution !== false,
  );
  if (new TextEncoder().encode(markdown).byteLength > MAX_LOOKUP_READABLE_REPORT_BYTES) {
    throw new RangeError('Readable Lookup report exceeded its byte limit.');
  }
  return markdown;
}

function markdownValue(value: unknown, fallback = 'Not reported'): string {
  const raw = value === null || value === undefined || value === ''
    ? fallback
    : Array.isArray(value)
      ? value.length ? value.join(', ') : fallback
      : String(value);
  return raw
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}\[\]()#+\-.!|=~])/gu, '\\$1')
    .replace(/:/gu, '\\:')
    .replace(/@/gu, '\\@');
}

function lifecycleValue(value: JsonObject, field: 'createdDate' | 'updatedDate'): unknown {
  const lifecycle = isJsonObject(value.lifecycle) ? value.lifecycle : {};
  return lifecycle[`${field}Iso`] ?? lifecycle[field] ?? null;
}

function appendReadableField(lines: string[], label: string, value: unknown): void {
  lines.push(`- **${label}:** ${markdownValue(value)}`);
}

function projectionList(
  collection: DecisionFactProjectionCollection<string>,
): string {
  const values = collection.items.length
    ? collection.items.map((item) => markdownValue(item)).join(', ')
    : 'none';
  return `${collection.displayed} of ${collection.total} displayed; ${collection.omitted} omitted. ${values}`;
}

function appendDecisionFact(lines: string[], fact: DecisionFactProjection): void {
  lines.push(
    '',
    `### ${markdownValue(fact.question)}`,
    `- **Fact ID:** ${markdownValue(fact.id)}`,
    `- **Conclusion:** ${markdownValue(fact.conclusion)}`,
    `- **Importance:** ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.importance[fact.importance])}`,
    `- **Evidence state:** ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.evidenceState[fact.evidenceState])} (${markdownValue(fact.evidenceState)})`,
    `- **Completeness:** ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.completeness[fact.completeness])} (${markdownValue(fact.completeness)})`,
    `- **Freshness:** ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.freshness[fact.freshness])} (${markdownValue(fact.freshness)})`,
    `- **Consistency:** ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.consistency[fact.consistency])} (${markdownValue(fact.consistency)})`,
    `- **Dependencies:** ${projectionList(fact.dependencies)}`,
    `- **Source references:** ${projectionList(fact.sourceReferences)}`,
    `- **Attributed sources:** ${fact.sources.displayed} of ${fact.sources.total} displayed; ${fact.sources.omitted} omitted.`,
  );
  if (fact.sources.items.length) {
    for (const source of fact.sources.items) {
      lines.push(
        `  - **${markdownValue(source.label)}** (${markdownValue(source.id)}): ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.provenance[source.provenance])}; ${markdownValue(DECISION_FACT_PRESENTATION_LABELS.evidenceState[source.evidenceState])}; observed ${markdownValue(source.observedAt, 'Not reported')}.`,
        `    - References: ${projectionList(source.references)}`,
        `    - Limitations: ${projectionList(source.limitations)}`,
      );
    }
  } else {
    lines.push('  - No attributed source was retained for this fact.');
  }
  lines.push(
    `- **Contradictions:** ${projectionList(fact.contradictions)}`,
    `- **Limitations:** ${projectionList(fact.limitations)}`,
    `- **Safe next actions:** ${fact.safeNextActions.displayed} of ${fact.safeNextActions.total} displayed; ${fact.safeNextActions.omitted} omitted.`,
  );
  if (fact.safeNextActions.items.length) {
    for (const action of fact.safeNextActions.items) {
      lines.push(`  - **${markdownValue(action.label)}** (${markdownValue(action.id)}; ${markdownValue(action.importance)}): ${markdownValue(action.reason)} Expected outcome: ${markdownValue(action.expectedOutcome)} Review destination: ${markdownValue(action.href)}.`);
    }
  } else {
    lines.push('  - No fact-specific action was retained. Review the attributed evidence and limitations.');
  }
}

function formatDomainReadableReport(
  evidenceMarkdown: string,
  decisionFacts: DecisionFactProjectionSet,
  applicationVersion: unknown,
  includeAttribution: boolean,
): string {
  const lines = [
    evidenceMarkdown.trimEnd(),
    '',
    '## Canonical Decision Facts',
    '',
    `- **Readable report contract:** ${markdownValue(`${LOOKUP_READABLE_REPORT_SCHEMA} v${LOOKUP_READABLE_REPORT_VERSION}`)}`,
    `- **Decision Fact projection:** v${decisionFacts.version}`,
    `- **Fact counts:** ${decisionFacts.displayed} of ${decisionFacts.total} included; ${decisionFacts.omitted} omitted.`,
    `- **Decision states:** ${decisionFacts.contradictory} contradictory; ${decisionFacts.unresolved} unresolved across the complete canonical set.`,
    '- Decision Facts are bounded projections of the same canonical transient model used by the Lookup review surfaces. They add no request, persistence, authority, availability, or scoring conclusion.',
  ];
  if (decisionFacts.facts.length) {
    for (const fact of decisionFacts.facts) appendDecisionFact(lines, fact);
  } else {
    lines.push('', 'No canonical Decision Fact was available. Review source quality before drawing a conclusion.');
  }
  if (includeAttribution) {
    lines.push(
      '',
      '---',
      '',
      portableGeneratorAttribution(buildPortableGeneratorMetadata(applicationVersion)),
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatNetworkIdentifierReadableReport(
  projectedRaw: Record<string, unknown>,
  generatedAt: string,
  applicationVersion: unknown,
  includeAttribution: boolean,
): string {
  const projected = projectedRaw as JsonObject;
  const type = typeof projected.type === 'string' ? projected.type : 'network';
  const title = type === 'asn' ? 'ASN evidence report' : 'IP evidence report';
  const submitted = projected.query ?? 'Unknown target';
  const diagnostics = isJsonObject(projected.diagnostics) ? projected.diagnostics : {};
  const rdapDiagnostic = isJsonObject(diagnostics.rdap) ? diagnostics.rdap : {};
  const whoisDiagnostic = isJsonObject(diagnostics.whois) ? diagnostics.whois : {};
  const rdap = isJsonObject(projected.rdap) ? projected.rdap : {};
  const parsed = isJsonObject(rdap.parsed) ? rdap.parsed : {};
  const reverseDns = isJsonObject(projected.reverseDns) ? projected.reverseDns : {};
  const reverseRecords = isJsonObject(reverseDns.records) ? reverseDns.records : {};
  const lines = [
    `# ${title}: ${markdownValue(submitted)}`,
    '',
    '> Human-readable point-in-time summary. Raw RDAP and WHOIS responses, expanded contacts, secrets, and remote assets are deliberately excluded.',
    '',
  ];
  appendReadableField(lines, 'Generated', generatedAt);
  appendReadableField(lines, 'Generator', typeof applicationVersion === 'string' ? `WHOISleuth ${applicationVersion}` : 'WHOISleuth');
  appendReadableField(lines, 'Project', WHOISLEUTH_SOURCE_REPOSITORY_URL);
  appendReadableField(lines, 'Report contract', `${LOOKUP_READABLE_REPORT_SCHEMA} v${LOOKUP_READABLE_REPORT_VERSION}`);
  lines.push('', '## Query');
  appendReadableField(lines, 'Submitted', submitted);
  appendReadableField(lines, 'Type', type === 'asn' ? 'ASN' : type.toUpperCase());
  lines.push('', '## Source health');
  appendReadableField(lines, 'RDAP', rdapDiagnostic.status ?? (rdap.error ? 'error' : 'unknown'));
  appendReadableField(lines, 'WHOIS', whoisDiagnostic.status ?? 'unknown');
  appendReadableField(lines, 'RDAP endpoint', rdap.rdapServer);
  appendReadableField(lines, 'RDAP transport', rdap.transportSecurity);
  appendReadableField(lines, 'RDAP HTTP status', rdap.upstreamStatus);
  appendReadableField(lines, 'RDAP fetched', rdap.fetchedAt);
  if (type !== 'asn') appendReadableField(lines, 'Reverse DNS', reverseDns.status ?? 'not recorded');
  lines.push('', type === 'asn' ? '## Autonomous-system registration' : '## Network registration');
  appendReadableField(lines, 'Handle', parsed.handle);
  appendReadableField(lines, 'Name', parsed.name);
  if (type === 'asn') {
    appendReadableField(lines, 'ASN range', parsed.startAutnum === parsed.endAutnum
      ? parsed.startAutnum
      : parsed.startAutnum !== undefined && parsed.endAutnum !== undefined
        ? `${parsed.startAutnum} to ${parsed.endAutnum}`
        : null);
    appendReadableField(lines, 'Allocation type', parsed.autnumType);
  } else {
    appendReadableField(lines, 'Address range', parsed.startAddress && parsed.endAddress
      ? `${parsed.startAddress} to ${parsed.endAddress}`
      : null);
    appendReadableField(lines, 'CIDR prefixes', parsed.cidrs);
    appendReadableField(lines, 'CIDR list truncated', typeof parsed.cidrsTruncated === 'boolean'
      ? parsed.cidrsTruncated ? 'Yes' : 'No'
      : null);
    appendReadableField(lines, 'Network type', parsed.networkType);
  }
  appendReadableField(lines, 'Country', parsed.country);
  appendReadableField(lines, 'Statuses', parsed.statuses);
  appendReadableField(lines, 'Created', lifecycleValue(parsed, 'createdDate'));
  appendReadableField(lines, 'Updated', lifecycleValue(parsed, 'updatedDate'));
  if (type !== 'asn') {
    lines.push('', '## Reverse DNS context');
    appendReadableField(lines, 'Observed', reverseDns.observedAt);
    appendReadableField(lines, 'Collection depth', reverseDns.scanMode);
    appendReadableField(lines, 'Complete', typeof reverseDns.complete === 'boolean'
      ? reverseDns.complete ? 'Yes' : 'No'
      : null);
    appendReadableField(lines, 'Truncated', typeof reverseDns.truncated === 'boolean'
      ? reverseDns.truncated ? 'Yes' : 'No'
      : null);
    appendReadableField(lines, 'PTR names', reverseRecords.ptr);
    appendReadableField(lines, 'Source limitations', reverseDns.limitations);
  }
  lines.push(
    '',
    '## Limitations',
    '',
    '- This report preserves the observed source states. Unavailable, partial, unsupported, stale, conflicting, or missing evidence is inconclusive rather than a negative finding.',
    '- Public registration and routing identifiers describe published allocation context. They do not prove ownership, current control, hosting responsibility, intent, safety, or maliciousness.',
    '- Reverse DNS names are operator-published context. They do not prove identity, hosting control, or a forward-confirmed relationship.',
    '- The report projects only bounded normalised fields already collected by Lookup and makes no additional request.',
  );
  if (includeAttribution) {
    lines.push(
      '',
      '---',
      '',
      portableGeneratorAttribution(buildPortableGeneratorMetadata(applicationVersion)),
    );
  }
  lines.push('');
  return lines.join('\n');
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
