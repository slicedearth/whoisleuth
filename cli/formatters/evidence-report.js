'use strict';

const MAX_REPORT_VALUE_LENGTH = 300;
const MAX_REPORT_LIST_ITEMS = 50;
const MAX_REPORT_COMPARISON_FIELDS = 20;

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanReportText(value, fallback = 'Not reported') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REPORT_VALUE_LENGTH);
  return text || fallback;
}

function displayLabel(value) {
  return cleanReportText(value, 'Unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function yesNoUnknown(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

function listText(value) {
  if (!Array.isArray(value) || !value.length) return 'Not reported';
  const candidates = value
    .slice(0, MAX_REPORT_LIST_ITEMS)
    .map((item) => cleanReportText(item).slice(0, 120));
  const retained = [];
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

function entityName(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return value.name || value.org || value.handle || null;
}

function lifecycleValue(parsed, field) {
  const source = objectOrEmpty(parsed);
  const lifecycle = objectOrEmpty(source.lifecycle);
  return lifecycle[`${field}Iso`] || lifecycle[field] || source[`${field}Iso`] || source[field] || null;
}

function reportField(label, value, fallback = 'Not reported') {
  return { label, value: cleanReportText(value, fallback) };
}

function buildLookupEvidenceReport(document) {
  const report = objectOrEmpty(document);
  const query = objectOrEmpty(report.query);
  const diagnostics = objectOrEmpty(report.diagnostics);
  const sources = objectOrEmpty(report.sources);
  const rdap = objectOrEmpty(sources.rdap);
  const whois = objectOrEmpty(sources.whois);
  const rdapParsed = objectOrEmpty(rdap.parsed);
  const whoisParsed = objectOrEmpty(whois.parsed);
  const analysis = objectOrEmpty(report.analysis);
  const availability = objectOrEmpty(analysis.availability);
  const comparison = objectOrEmpty(analysis.registryComparison);
  const comparisonHealth = objectOrEmpty(comparison.sourceHealth);
  const dns = objectOrEmpty(availability.dns);
  const http = objectOrEmpty(availability.http);
  const httpResponse = objectOrEmpty(http.response);
  const tls = objectOrEmpty(availability.tls);
  const tlsCertificate = objectOrEmpty(tls.certificate);
  const titleTarget = query.registrableDomain || query.submitted || 'Unknown domain';

  const groups = {
    registryRdap: {
      title: 'Registry RDAP',
      fields: [
        reportField('Source status', displayLabel(diagnostics.rdap?.status || rdap.status)),
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
        reportField('Source status', displayLabel(diagnostics.whois?.status || whois.status)),
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
        reportField('Runtime trust', yesNoUnknown(tls.authorization?.authorized)),
        reportField('Hostname match', yesNoUnknown(tls.hostname?.matches)),
        reportField('Certificate validity', displayLabel(tls.validity?.status)),
        reportField('Certificate fingerprint', tlsCertificate.fingerprintSha256),
      ],
    },
  };

  const comparisonFields = Array.isArray(comparison.fields)
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
        reportField('RDAP health', displayLabel(comparisonHealth.rdap?.status)),
        reportField('WHOIS health', displayLabel(comparisonHealth.whois?.status)),
      ],
      fields: comparisonFields,
      omitted: Math.max(0, (Array.isArray(comparison.fields) ? comparison.fields.length : 0) - comparisonFields.length),
    },
    networkGroups: [groups.dns, groups.website, groups.tls],
    diagnostics: [
      reportField('Diagnostics version', diagnostics.version),
      reportField('RDAP', displayLabel(diagnostics.rdap?.status)),
      reportField('Registrar RDAP', displayLabel(diagnostics.rdap?.registrar?.status)),
      reportField('WHOIS', displayLabel(diagnostics.whois?.status)),
      reportField('Availability', displayLabel(diagnostics.availability?.status)),
    ],
    limitations: [
      'This report summarizes point-in-time observations and registry publications. It does not prove ownership, activity, availability, or maliciousness.',
      'Missing, skipped, partial, unsupported, or failed sources are inconclusive rather than negative evidence.',
      'Raw registry payloads and full WHOIS referral responses are available only in the JSON evidence package and may contain public contact data.',
    ],
  };
}

module.exports = {
  MAX_REPORT_COMPARISON_FIELDS,
  MAX_REPORT_LIST_ITEMS,
  MAX_REPORT_VALUE_LENGTH,
  buildLookupEvidenceReport,
  cleanReportText,
};
