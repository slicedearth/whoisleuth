import { registryAccessProfileLabel } from '../registry-access.mts';

const MAX_REPORT_VALUE_LENGTH = 300;
const MAX_REPORT_LIST_ITEMS = 50;
const MAX_REPORT_COMPARISON_FIELDS = 20;

type UnknownRecord = Record<string, unknown>;
type ReportField = { label: string; value: string };
type ReportGroup = { title: string; fields: ReportField[] };
type ComparisonField = { label: string; status: string; rdap: string; whois: string };
type PublicationComparisonField = { label: string; status: string; registry: string; registrar: string };
type LookupEvidenceReport = {
  title: string;
  notice: string;
  metadata: ReportField[];
  query: ReportField[];
  assessment: ReportField[];
  registryGroups: ReportGroup[];
  comparison: { health: ReportField[]; fields: ComparisonField[]; omitted: number };
  registrarComparison: { health: ReportField[]; fields: PublicationComparisonField[]; omitted: number };
  networkGroups: ReportGroup[];
  diagnostics: ReportField[];
  limitations: string[];
};

function objectOrEmpty(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function cleanReportText(value: unknown, fallback = 'Not reported'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REPORT_VALUE_LENGTH);
  return text || fallback;
}

function displayLabel(value: unknown): string {
  return cleanReportText(value, 'Unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function yesNoUnknown(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

function listText(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return 'Not reported';
  const candidates = value
    .slice(0, MAX_REPORT_LIST_ITEMS)
    .map((item) => cleanReportText(item).slice(0, 120));
  const retained: string[] = [];
  for (const candidate of candidates) {
    const next = [...retained, candidate].join(', ');
    // Reserve enough room for the omission suffix so it is never hidden by
    // the per-value display boundary.
    if (next.length > MAX_REPORT_VALUE_LENGTH - 40) break;
    retained.push(candidate);
  }
  const omitted = value.length - retained.length;
  return `${retained.join(', ')}${omitted > 0 ? ` (and ${omitted} more)` : ''}`;
}

function entityName(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entity = value as UnknownRecord;
  return entity.name || entity.org || entity.handle || null;
}

function lifecycleValue(parsed: unknown, field: string): unknown {
  const source = objectOrEmpty(parsed);
  const lifecycle = objectOrEmpty(source.lifecycle);
  return lifecycle[`${field}Iso`] || lifecycle[field] || source[`${field}Iso`] || source[field] || null;
}

function reportField(label: string, value: unknown, fallback = 'Not reported'): ReportField {
  return { label, value: cleanReportText(value, fallback) };
}

function buildLookupEvidenceReport(document: unknown): LookupEvidenceReport {
  const report = objectOrEmpty(document);
  const query = objectOrEmpty(report.query);
  const diagnostics = objectOrEmpty(report.diagnostics);
  const rdapDiagnostics = objectOrEmpty(diagnostics.rdap);
  const whoisDiagnostics = objectOrEmpty(diagnostics.whois);
  const availabilityDiagnostics = objectOrEmpty(diagnostics.availability);
  const registrarRdapDiagnostics = objectOrEmpty(rdapDiagnostics.registrar);
  const registryAccess = objectOrEmpty(diagnostics.registryAccess);
  const sources = objectOrEmpty(report.sources);
  const rdap = objectOrEmpty(sources.rdap);
  const whois = objectOrEmpty(sources.whois);
  const networkContext = objectOrEmpty(sources.network);
  const networkEndpoint = objectOrEmpty(networkContext.endpoint);
  const networkRdap = objectOrEmpty(networkContext.rdap);
  const networkRegistration = objectOrEmpty(networkContext.network);
  const rdapParsed = objectOrEmpty(rdap.parsed);
  const whoisParsed = objectOrEmpty(whois.parsed);
  const analysis = objectOrEmpty(report.analysis);
  const availability = objectOrEmpty(analysis.availability);
  const comparison = objectOrEmpty(analysis.registryComparison);
  const comparisonHealth = objectOrEmpty(comparison.sourceHealth);
  const rdapComparisonHealth = objectOrEmpty(comparisonHealth.rdap);
  const whoisComparisonHealth = objectOrEmpty(comparisonHealth.whois);
  const registrarComparison = objectOrEmpty(analysis.registrarPublicationComparison);
  const registrarComparisonHealth = objectOrEmpty(registrarComparison.sourceHealth);
  const registryPublicationHealth = objectOrEmpty(registrarComparisonHealth.registry);
  const registrarPublicationHealth = objectOrEmpty(registrarComparisonHealth.registrar);
  const dns = objectOrEmpty(availability.dns);
  const http = objectOrEmpty(availability.http);
  const httpResponse = objectOrEmpty(http.response);
  const tls = objectOrEmpty(availability.tls);
  const tlsAuthorization = objectOrEmpty(tls.authorization);
  const tlsHostname = objectOrEmpty(tls.hostname);
  const tlsValidity = objectOrEmpty(tls.validity);
  const tlsCertificate = objectOrEmpty(tls.certificate);
  const titleTarget = query.registrableDomain || query.submitted || 'Unknown domain';
  const registryAccessSuffix = [5, 6].includes(Number(diagnostics.version)) && registryAccess.authority === 'context_only'
    && typeof registryAccess.suffix === 'string'
    ? cleanReportText(registryAccess.suffix, '')
    : '';
  const registryAccessFields: ReportField[] = registryAccessSuffix ? [
    reportField('Registry access suffix', `.${registryAccessSuffix}`),
    reportField('WHOIS access', registryAccessProfileLabel(registryAccess.whoisAccessProfile)),
    reportField('RDAP access', registryAccessProfileLabel(registryAccess.rdapAccessProfile)),
    reportField('Registry access note', registryAccess.limitation),
  ] : [];

  const groups = {
    registryRdap: {
      title: 'Registry RDAP',
      fields: [
        reportField('Source status', displayLabel(rdapDiagnostics.status || rdap.status)),
        reportField('Endpoint', rdap.endpoint),
        reportField('HTTP status', rdap.httpStatus),
        reportField('Fetched', rdap.fetchedAt),
        reportField('Domain', rdapParsed.domain),
        reportField('Registry object ID', rdapParsed.handle),
        reportField('Registrar', entityName(rdapParsed.registrar)),
        reportField('Registrar IANA ID', rdapParsed.registrarIanaId),
        reportField('Created', lifecycleValue(rdapParsed, 'createdDate')),
        reportField('Expires', lifecycleValue(rdapParsed, 'expiryDate')),
        reportField('Last updated', lifecycleValue(rdapParsed, 'updatedDate')),
        reportField('DNSSEC', rdapParsed.dnssec),
        reportField('Statuses', listText(rdapParsed.statuses)),
        reportField('Name servers', listText(rdapParsed.nameservers)),
      ],
    },
    whois: {
      title: 'WHOIS',
      fields: [
        reportField('Source status', displayLabel(whoisDiagnostics.status || whois.status)),
        reportField('Queried', whois.queriedAt),
        reportField('Authoritative hop', whois.authoritativeHop),
        reportField('Failed hop', whois.failedHop),
        reportField('Domain', whoisParsed.domainName),
        reportField('Registry object ID', whoisParsed.registryDomainId),
        reportField('Registrar', entityName(whoisParsed.registrar)),
        reportField('Registrar IANA ID', whoisParsed.registrarIanaId),
        reportField('Created', lifecycleValue(whoisParsed, 'createdDate')),
        reportField('Expires', lifecycleValue(whoisParsed, 'expiryDate')),
        reportField('Last updated', lifecycleValue(whoisParsed, 'updatedDate')),
        reportField('DNSSEC', whoisParsed.dnssec),
        reportField('Statuses', listText(whoisParsed.statuses)),
        reportField('Name servers', listText(whoisParsed.nameservers)),
      ],
    },
    dns: {
      title: 'DNS and mail',
      fields: [
        reportField('DNS status', displayLabel(dns.status)),
        reportField('Observed', dns.observedAt),
        reportField('Name servers', listText(availability.nameservers)),
        reportField('MX hosts', listText(availability.mxHosts)),
      ],
    },
    website: {
      title: 'Website',
      fields: [
        reportField('Probe status', displayLabel(http.status || availability.websiteProbeStatus)),
        reportField('Observed', http.observedAt),
        reportField('Final URL', http.finalUrl),
        reportField('HTTP response', httpResponse.status),
        reportField('Content type', httpResponse.contentType),
        reportField('Redirects', http.redirectCount),
        reportField('Page title', availability.pageTitle),
        reportField('Password field observed', yesNoUnknown(availability.hasPasswordField)),
      ],
    },
    tls: {
      title: 'TLS',
      fields: [
        reportField('TLS status', displayLabel(tls.status)),
        reportField('Observed', tls.observedAt),
        reportField('Protocol', tls.protocol),
        reportField('Runtime trust', yesNoUnknown(tlsAuthorization.authorized)),
        reportField('Hostname match', yesNoUnknown(tlsHostname.matches)),
        reportField('Certificate validity', displayLabel(tlsValidity.status)),
        reportField('Certificate fingerprint', tlsCertificate.fingerprintSha256),
      ],
    },
    networkRegistration: {
      title: 'Observed network registration',
      fields: [
        reportField('Source status', displayLabel(networkContext.status)),
        reportField('Selected address', networkEndpoint.address),
        reportField('Selected from', displayLabel(networkEndpoint.selectedFrom)),
        reportField('IP RDAP endpoint', networkRdap.endpoint),
        reportField('IP RDAP fetched', networkRdap.fetchedAt),
        reportField('Registered network', networkRegistration.name),
        reportField('Network holder', networkRegistration.holder),
        reportField('Network handle', networkRegistration.handle),
        reportField('CIDR ranges', listText(networkRegistration.cidrs)),
        reportField('Address range', networkRegistration.startAddress && networkRegistration.endAddress
          ? `${networkRegistration.startAddress} to ${networkRegistration.endAddress}` : null),
        reportField('Country', networkRegistration.country),
        reportField('Network type', networkRegistration.networkType),
        reportField('RDAP database updated', networkRegistration.databaseUpdatedAt),
      ],
    },
  } satisfies Record<string, ReportGroup>;

  const comparisonFields: ComparisonField[] = Array.isArray(comparison.fields)
    ? comparison.fields.slice(0, MAX_REPORT_COMPARISON_FIELDS).map((value) => {
      const item = objectOrEmpty(value);
      return {
        label: cleanReportText(item.label),
        status: displayLabel(item.status),
        rdap: cleanReportText(item.rdapDisplay),
        whois: cleanReportText(item.whoisDisplay),
      };
    })
    : [];
  const registrarComparisonFields: PublicationComparisonField[] = Array.isArray(registrarComparison.fields)
    ? registrarComparison.fields.slice(0, MAX_REPORT_COMPARISON_FIELDS).map((value) => {
      const item = objectOrEmpty(value);
      return {
        label: cleanReportText(item.label),
        status: displayLabel(item.status),
        registry: cleanReportText(item.registryDisplay),
        registrar: cleanReportText(item.registrarDisplay),
      };
    })
    : [];

  return {
    title: cleanReportText(titleTarget),
    notice: 'Human-readable summary. The versioned JSON export remains the full-fidelity evidence package; raw RDAP JSON and WHOIS response bodies are deliberately omitted here.',
    metadata: [
      reportField('Generated', report.generatedAt),
      reportField('Report contract', `${cleanReportText(report.schema)} v${cleanReportText(report.schemaVersion)}`),
    ],
    query: [
      reportField('Submitted', query.submitted),
      reportField('Type', displayLabel(query.type)),
      reportField('Input hostname', query.inputHostname),
      reportField('Registrable domain', query.registrableDomain),
      reportField('Subdomain input', yesNoUnknown(query.isSubdomain)),
    ],
    assessment: [
      reportField('Availability', displayLabel(availability.state)),
      reportField('Confidence', displayLabel(availability.confidence)),
      reportField('Detail', availability.detail),
      reportField('Website activity', displayLabel(availability.activityStatus)),
      reportField('Website observation', availability.websiteProbeDetail),
      reportField('Deep scan complete', yesNoUnknown(availability.deepScanComplete)),
      reportField('MX observed', yesNoUnknown(availability.hasMx)),
      reportField('SPF observed', yesNoUnknown(availability.hasSpf)),
      reportField('DMARC observed', yesNoUnknown(availability.hasDmarc)),
    ],
    registryGroups: [groups.registryRdap, groups.whois],
    comparison: {
      health: [
        reportField('RDAP health', displayLabel(rdapComparisonHealth.status)),
        reportField('WHOIS health', displayLabel(whoisComparisonHealth.status)),
      ],
      fields: comparisonFields,
      omitted: Math.max(0, (Array.isArray(comparison.fields) ? comparison.fields.length : 0) - comparisonFields.length),
    },
    registrarComparison: {
      health: [
        reportField('Registry RDAP health', displayLabel(registryPublicationHealth.status)),
        reportField('Registrar RDAP health', displayLabel(registrarPublicationHealth.status)),
      ],
      fields: registrarComparisonFields,
      omitted: Math.max(0, (Array.isArray(registrarComparison.fields) ? registrarComparison.fields.length : 0) - registrarComparisonFields.length),
    },
    networkGroups: [
      groups.dns,
      groups.website,
      groups.tls,
      ...(networkContext.contextVersion === 1 ? [groups.networkRegistration] : []),
    ],
    diagnostics: [
      reportField('Diagnostics version', diagnostics.version),
      reportField('RDAP', displayLabel(rdapDiagnostics.status)),
      reportField('Registrar RDAP', displayLabel(registrarRdapDiagnostics.status)),
      reportField('WHOIS', displayLabel(whoisDiagnostics.status)),
      reportField('Availability', displayLabel(availabilityDiagnostics.status)),
      ...(networkContext.contextVersion === 1 ? [reportField('Observed network context', displayLabel(networkContext.status))] : []),
      ...registryAccessFields,
    ],
    limitations: [
      'This report summarizes point-in-time observations and registry publications. It does not prove ownership, activity, availability, or maliciousness.',
      'Missing, skipped, partial, unsupported, or failed sources are inconclusive rather than negative evidence.',
      'Raw registry payloads and full WHOIS referral responses are available only in the JSON evidence package and may contain public contact data.',
      ...(networkContext.contextVersion === 1 ? [
        'Observed network registration describes one point-in-time public endpoint. It may identify an edge or shared network rather than the origin host and does not prove control, ownership, intent, or maliciousness.',
      ] : []),
      ...(registryAccessFields.length ? [
        'Registry access constraints describe collection reachability only. They do not decide registration, availability, ownership, safety, or maliciousness.',
      ] : []),
    ],
  };
}

export {
  MAX_REPORT_COMPARISON_FIELDS,
  MAX_REPORT_LIST_ITEMS,
  MAX_REPORT_VALUE_LENGTH,
  buildLookupEvidenceReport,
  cleanReportText,
};
export type { ComparisonField, LookupEvidenceReport, PublicationComparisonField, ReportField, ReportGroup, UnknownRecord };
