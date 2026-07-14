'use strict';

const MAX_MARKDOWN_VALUE_LENGTH = 300;
const MAX_MARKDOWN_LIST_ITEMS = 50;

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = 'Not reported') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MARKDOWN_VALUE_LENGTH);
  return text || fallback;
}

// Every registry-provided value is untrusted. Escaping block/inline markers,
// HTML delimiters, bare-URL separators, and email separators prevents a
// readable local report from acquiring active links or injected structure.
function escapeMarkdownValue(value, fallback = 'Not reported') {
  return cleanText(value, fallback)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+\-.!|=~])/g, '\\$1')
    .replace(/:/g, '\\:')
    .replace(/@/g, '\\@');
}

function label(value) {
  return cleanText(value, 'Unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function yesNoUnknown(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Unknown';
}

function listValue(value) {
  if (!Array.isArray(value) || !value.length) return 'Not reported';
  const retained = value.slice(0, MAX_MARKDOWN_LIST_ITEMS);
  const rendered = retained.map((item) => escapeMarkdownValue(item)).join(', ');
  const omitted = value.length - retained.length;
  return omitted > 0 ? `${rendered} \(and ${omitted} more\)` : rendered;
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

function field(lines, name, value, fallback) {
  lines.push(`- **${name}:** ${escapeMarkdownValue(value, fallback)}`);
}

function comparisonStatus(value) {
  return label(value || 'unknown');
}

function formatLookupEvidenceMarkdown(document) {
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
  const lines = [
    `# Lookup evidence report — ${escapeMarkdownValue(query.registrableDomain || query.submitted || 'Unknown domain')}`,
    '',
    '> Human-readable summary. The versioned JSON export remains the full-fidelity evidence package; raw RDAP JSON and WHOIS response bodies are deliberately omitted here.',
    '',
    `- **Generated:** ${escapeMarkdownValue(report.generatedAt)}`,
    `- **Report contract:** ${escapeMarkdownValue(report.schema)} v${escapeMarkdownValue(report.schemaVersion)}`,
    '',
    '## Query',
  ];
  field(lines, 'Submitted', query.submitted);
  field(lines, 'Type', label(query.type));
  field(lines, 'Input hostname', query.inputHostname);
  field(lines, 'Registrable domain', query.registrableDomain);
  field(lines, 'Subdomain input', yesNoUnknown(query.isSubdomain));

  lines.push('', '## Assessment');
  field(lines, 'Availability', label(availability.state));
  field(lines, 'Confidence', label(availability.confidence));
  field(lines, 'Detail', availability.detail);
  field(lines, 'Website activity', label(availability.activityStatus));
  field(lines, 'Website observation', availability.websiteProbeDetail);
  field(lines, 'Deep scan complete', yesNoUnknown(availability.deepScanComplete));
  field(lines, 'MX observed', yesNoUnknown(availability.hasMx));
  field(lines, 'SPF observed', yesNoUnknown(availability.hasSpf));
  field(lines, 'DMARC observed', yesNoUnknown(availability.hasDmarc));

  lines.push('', '## Registry sources', '', '### Registry RDAP');
  field(lines, 'Source status', comparisonStatus(diagnostics.rdap?.status || rdap.status));
  field(lines, 'Endpoint', rdap.endpoint);
  field(lines, 'HTTP status', rdap.httpStatus);
  field(lines, 'Fetched', rdap.fetchedAt);
  field(lines, 'Domain', rdapParsed.domain);
  field(lines, 'Registry object ID', rdapParsed.handle);
  field(lines, 'Registrar', entityName(rdapParsed.registrar));
  field(lines, 'Registrar IANA ID', rdapParsed.registrarIanaId);
  field(lines, 'Created', lifecycleValue(rdapParsed, 'createdDate'));
  field(lines, 'Expires', lifecycleValue(rdapParsed, 'expiryDate'));
  field(lines, 'Last updated', lifecycleValue(rdapParsed, 'updatedDate'));
  field(lines, 'DNSSEC', rdapParsed.dnssec);
  lines.push(`- **Statuses:** ${listValue(rdapParsed.statuses)}`);
  lines.push(`- **Name servers:** ${listValue(rdapParsed.nameservers)}`);

  lines.push('', '### WHOIS');
  field(lines, 'Source status', comparisonStatus(diagnostics.whois?.status || whois.status));
  field(lines, 'Queried', whois.queriedAt);
  field(lines, 'Authoritative hop', whois.authoritativeHop);
  field(lines, 'Failed hop', whois.failedHop);
  field(lines, 'Domain', whoisParsed.domainName);
  field(lines, 'Registry object ID', whoisParsed.registryDomainId);
  field(lines, 'Registrar', entityName(whoisParsed.registrar));
  field(lines, 'Registrar IANA ID', whoisParsed.registrarIanaId);
  field(lines, 'Created', lifecycleValue(whoisParsed, 'createdDate'));
  field(lines, 'Expires', lifecycleValue(whoisParsed, 'expiryDate'));
  field(lines, 'Last updated', lifecycleValue(whoisParsed, 'updatedDate'));
  field(lines, 'DNSSEC', whoisParsed.dnssec);
  lines.push(`- **Statuses:** ${listValue(whoisParsed.statuses)}`);
  lines.push(`- **Name servers:** ${listValue(whoisParsed.nameservers)}`);

  lines.push('', '## Registry-source comparison');
  field(lines, 'RDAP health', comparisonStatus(comparisonHealth.rdap?.status));
  field(lines, 'WHOIS health', comparisonStatus(comparisonHealth.whois?.status));
  const comparisonFields = Array.isArray(comparison.fields) ? comparison.fields.slice(0, 20) : [];
  if (!comparisonFields.length) {
    lines.push('- No comparable normalized fields were published.');
  } else {
    for (const item of comparisonFields) {
      const compared = objectOrEmpty(item);
      lines.push(`- **${escapeMarkdownValue(compared.label)} — ${escapeMarkdownValue(comparisonStatus(compared.status))}:** RDAP ${escapeMarkdownValue(compared.rdapDisplay)}; WHOIS ${escapeMarkdownValue(compared.whoisDisplay)}`);
    }
  }

  lines.push('', '## Network evidence', '', '### DNS and mail');
  field(lines, 'DNS status', comparisonStatus(dns.status));
  field(lines, 'Observed', dns.observedAt);
  lines.push(`- **Name servers:** ${listValue(availability.nameservers)}`);
  lines.push(`- **MX hosts:** ${listValue(availability.mxHosts)}`);

  lines.push('', '### Website');
  field(lines, 'Probe status', comparisonStatus(http.status || availability.websiteProbeStatus));
  field(lines, 'Observed', http.observedAt);
  field(lines, 'Final URL', http.finalUrl);
  field(lines, 'HTTP response', httpResponse.status);
  field(lines, 'Content type', httpResponse.contentType);
  field(lines, 'Redirects', http.redirectCount);
  field(lines, 'Page title', availability.pageTitle);
  field(lines, 'Password field observed', yesNoUnknown(availability.hasPasswordField));

  lines.push('', '### TLS');
  field(lines, 'TLS status', comparisonStatus(tls.status));
  field(lines, 'Observed', tls.observedAt);
  field(lines, 'Protocol', tls.protocol);
  field(lines, 'Runtime trust', yesNoUnknown(tls.authorization?.authorized));
  field(lines, 'Hostname match', yesNoUnknown(tls.hostname?.matches));
  field(lines, 'Certificate validity', comparisonStatus(tls.validity?.status));
  field(lines, 'Certificate fingerprint', tlsCertificate.fingerprintSha256);

  lines.push('', '## Collection diagnostics');
  field(lines, 'Diagnostics version', diagnostics.version);
  field(lines, 'RDAP', comparisonStatus(diagnostics.rdap?.status));
  field(lines, 'Registrar RDAP', comparisonStatus(diagnostics.rdap?.registrar?.status));
  field(lines, 'WHOIS', comparisonStatus(diagnostics.whois?.status));
  field(lines, 'Availability', comparisonStatus(diagnostics.availability?.status));

  lines.push(
    '',
    '## Limitations',
    '',
    '- This report summarizes point-in-time observations and registry publications. It does not prove ownership, activity, availability, or maliciousness.',
    '- Missing, skipped, partial, unsupported, or failed sources are inconclusive rather than negative evidence.',
    '- Raw registry payloads and full WHOIS referral responses are available only in the JSON evidence package and may contain public contact data.',
    ''
  );
  return lines.join('\n');
}

module.exports = {
  MAX_MARKDOWN_LIST_ITEMS,
  MAX_MARKDOWN_VALUE_LENGTH,
  escapeMarkdownValue,
  formatLookupEvidenceMarkdown,
};
