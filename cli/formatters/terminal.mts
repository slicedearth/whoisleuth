const MAX_TERMINAL_VALUE_LENGTH = 240;
const MAX_CT_TERMINAL_MATCHES = 100;
const MAX_CT_TERMINAL_HOSTNAMES = 5;
const MAX_DISCOVER_TERMINAL_CANDIDATES = 200;
const MAX_POSTURE_TERMINAL_RECORDS = 5;
const MAX_TLS_TERMINAL_ALT_NAMES = 10;

// Terminal documents have different versioned shapes. Every scalar crosses
// safeTerminalValue before display, while the runner supplies bounded arrays.
type TerminalRecord = Record<string, any>;
type MutationLabels = Record<string, string>;
type TerminalBulkItem = {
  ok: boolean;
  query: unknown;
  error?: unknown;
  result?: unknown;
};
type TerminalBulkMetadata = { duplicates?: number };

function safeTerminalValue(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERMINAL_VALUE_LENGTH);
  return normalized || fallback;
}

function titleCase(value: unknown): string {
  const text = safeTerminalValue(value, 'unknown').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTerminalLookup(document: TerminalRecord): string {
  const lines = [
    `Query          ${safeTerminalValue(document.query)}`,
    `Type           ${safeTerminalValue(document.type)}`,
    `Mode           ${titleCase(document.mode)}`,
  ];
  if (document.inputHostname && document.inputHostname !== document.registrableDomain) {
    lines.push(`Input host     ${safeTerminalValue(document.inputHostname)}`);
    lines.push(`Registry query ${safeTerminalValue(document.registrableDomain)}`);
  }
  if (document.availability?.applicable) {
    lines.push(`Availability   ${titleCase(document.availability.state)}`);
    lines.push(`Confidence     ${titleCase(document.availability.confidence)}`);
  }
  lines.push(`RDAP           ${titleCase(document.diagnostics?.rdap?.status)}`);
  if (document.diagnostics?.rdap?.endpoint) lines.push(`RDAP source    ${safeTerminalValue(document.diagnostics.rdap.endpoint)}`);
  const registrarRdap = document.diagnostics?.rdap?.registrar;
  if (registrarRdap) {
    lines.push(`Registrar RDAP ${titleCase(registrarRdap.status)}`);
    if (registrarRdap.endpoint) lines.push(`Registrar source ${safeTerminalValue(registrarRdap.endpoint)}`);
  }
  lines.push(`WHOIS          ${titleCase(document.diagnostics?.whois?.status)}`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalBulk(items: TerminalBulkItem[], metadata: TerminalBulkMetadata): string {
  const lines = items.map((item) => {
    if (!item.ok) return `! ${safeTerminalValue(item.query)} — ${safeTerminalValue(item.error, 'Lookup failed')}`;
    const result = item.result as TerminalRecord | undefined;
    const state = titleCase(result?.availability?.state);
    const confidence = titleCase(result?.availability?.confidence);
    return `✓ ${safeTerminalValue(item.query)} — ${state} (${confidence} confidence)`;
  });
  const succeeded = items.filter((item) => item.ok).length;
  lines.push('');
  lines.push(`${items.length} queries · ${succeeded} succeeded · ${items.length - succeeded} failed · ${metadata.duplicates || 0} duplicates removed`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalCtSearch(document: TerminalRecord): string {
  const matches = Array.isArray(document.matches) ? document.matches : [];
  const visible = matches.slice(0, MAX_CT_TERMINAL_MATCHES);
  const lines = [
    `Keyword        ${safeTerminalValue(document.keyword)}`,
    `CT status      ${titleCase(document.observation?.status || (document.truncated ? 'partial' : 'success'))}`,
    `Certificates   ${safeTerminalValue(document.certCount, '0')}`,
    `Observed hosts ${safeTerminalValue(Array.isArray(document.domains) ? document.domains.length : 0, '0')}`,
    `Matches        ${safeTerminalValue(matches.length, '0')}`,
    `Truncated      ${document.truncated ? 'Yes' : 'No'}`,
    '',
  ];
  if (!visible.length) {
    lines.push('No structured registrable-domain matches.');
  } else {
    for (const match of visible) {
      const hostnames = Array.isArray(match.hostnames) ? match.hostnames : [];
      const shownHosts = hostnames.slice(0, MAX_CT_TERMINAL_HOSTNAMES).map((value: unknown) => safeTerminalValue(value));
      const omitted = hostnames.length - shownHosts.length;
      lines.push(safeTerminalValue(match.domain));
      lines.push(`  Certificates ${safeTerminalValue(match.certificateCount, '0')}`);
      lines.push(`  Hostnames     ${shownHosts.join(', ')}${omitted > 0 ? ` (+${omitted} more)` : ''}`);
      lines.push(`  Observed      ${safeTerminalValue(match.firstObservedAt)} → ${safeTerminalValue(match.lastObservedAt)}`);
    }
  }
  if (matches.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${matches.length} structured matches in terminal output; use --json for the complete bounded result.`);
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalDiscover(document: TerminalRecord, mutationLabels: MutationLabels = {}): string {
  const candidates = Array.isArray(document.candidates) ? document.candidates : [];
  const visible = candidates.slice(0, MAX_DISCOVER_TERMINAL_CANDIDATES);
  const lines = [
    `Seed           ${safeTerminalValue(document.seed)}`,
    `Preset         ${safeTerminalValue(document.preset)}`,
    `Keyboard       ${safeTerminalValue(document.keyboardLayout)}`,
    `TLDs           ${(Array.isArray(document.tlds) ? document.tlds : []).map((value: unknown) => safeTerminalValue(value)).join(', ')}`,
    `Candidates     ${safeTerminalValue(candidates.length, '0')}`,
    `Truncated      ${document.truncated ? 'Yes' : 'No'}`,
    '',
  ];
  for (const candidate of visible) {
    const labels = (Array.isArray(candidate.mutationTypes) ? candidate.mutationTypes : [])
      .map((value: string) => safeTerminalValue(mutationLabels[value] || value));
    lines.push(`${safeTerminalValue(candidate.domain)} — ${labels.join(', ') || 'Generated variant'}`);
  }
  if (!visible.length) lines.push('No candidates were generated.');
  if (candidates.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${candidates.length} candidates in terminal output; use --json or --jsonl for the complete bounded result.`);
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalPosture(document: TerminalRecord): string {
  const summary = document.summary && typeof document.summary === 'object' ? document.summary : {};
  const selectors = Array.isArray(document.dkimSelectors) ? document.dkimSelectors : [];
  const checks = Array.isArray(document.checks) ? document.checks : [];
  const lines = [
    `Domain         ${safeTerminalValue(document.domain)}`,
    `Checked        ${safeTerminalValue(document.checkedAt)}`,
    `DKIM selectors ${selectors.length ? selectors.map((value: unknown) => safeTerminalValue(value)).join(', ') : 'None supplied'}`,
    `Summary        ${safeTerminalValue(summary.danger, '0')} action · ${safeTerminalValue(summary.warning, '0')} review · ${safeTerminalValue(summary.pass, '0')} pass · ${safeTerminalValue(summary.info, '0')} info`,
    '',
  ];
  for (const item of checks) {
    lines.push(`[${safeTerminalValue(item.status, 'info').toUpperCase()}] ${safeTerminalValue(item.label)} — ${safeTerminalValue(item.summary)}`);
    if (item.detail) lines.push(`  Detail  ${safeTerminalValue(item.detail)}`);
    if (item.remediation) lines.push(`  Next    ${safeTerminalValue(item.remediation)}`);
    const records = Array.isArray(item.records) ? item.records : [];
    for (const record of records.slice(0, MAX_POSTURE_TERMINAL_RECORDS)) {
      lines.push(`  Record  ${safeTerminalValue(record)}`);
    }
    if (records.length > MAX_POSTURE_TERMINAL_RECORDS) {
      lines.push(`  Records ${records.length - MAX_POSTURE_TERMINAL_RECORDS} more omitted from terminal output; use --json for the complete bounded report.`);
    }
  }
  if (!checks.length) lines.push('No posture checks were returned.');
  return `${lines.join('\n')}\n`;
}

function formatTerminalHttp(document: TerminalRecord): string {
  const http = document.http && typeof document.http === 'object' ? document.http : {};
  const response = http.response && typeof http.response === 'object' ? http.response : {};
  const attempts = Array.isArray(http.attempts) ? http.attempts : [];
  const limitations = Array.isArray(http.limitations) ? http.limitations : [];
  const securityHeaders = response.securityHeaders && typeof response.securityHeaders === 'object'
    ? Object.entries(response.securityHeaders).filter(([, value]) => Boolean(value)).map(([name]) => name)
    : [];
  const lines = [
    `Domain         ${safeTerminalValue(document.domain)}`,
    `Probe          ${titleCase(document.probeStatus)}`,
    `Activity       ${titleCase(document.activityStatus)}`,
    `Evidence       ${titleCase(http.status)}`,
    `Final URL      ${safeTerminalValue(http.finalUrl)}`,
    `HTTP status    ${safeTerminalValue(response.status)}`,
    `Transport      ${safeTerminalValue(http.transportSecurity)}`,
    `Redirects      ${safeTerminalValue(http.redirectCount, '0')}`,
    `Content type   ${safeTerminalValue(response.contentType)}`,
    `Body inspected ${response.bodyInspected === true ? 'Yes' : response.bodyInspected === false ? 'No' : '—'}`,
    `Security       ${securityHeaders.length ? securityHeaders.join(', ') : 'No selected headers observed'}`,
  ];
  if (document.detail) lines.push(`Detail         ${safeTerminalValue(document.detail)}`);
  if (response.bodyHash?.value) {
    lines.push(`Body hash      ${safeTerminalValue(`${response.bodyHash.algorithm}:${response.bodyHash.value} (${response.bodyHash.scope})`)}`);
  }
  for (const attempt of attempts) {
    const outcome = attempt.httpStatus ? `HTTP ${attempt.httpStatus}` : attempt.error || attempt.outcome;
    lines.push(`Attempt        ${safeTerminalValue(attempt.url)} — ${safeTerminalValue(outcome)}`);
  }
  for (const limitation of limitations) lines.push(`Limitation     ${safeTerminalValue(limitation)}`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalTls(document: TerminalRecord): string {
  const certificate = document.certificate && typeof document.certificate === 'object' ? document.certificate : {};
  const subject = certificate.subject && typeof certificate.subject === 'object' ? certificate.subject : {};
  const issuer = certificate.issuer && typeof certificate.issuer === 'object' ? certificate.issuer : {};
  const altNames = certificate.subjectAltNames && typeof certificate.subjectAltNames === 'object' ? certificate.subjectAltNames : {};
  const dnsNames = Array.isArray(altNames.dnsNames) ? altNames.dnsNames : [];
  const ipAddresses = Array.isArray(altNames.ipAddresses) ? altNames.ipAddresses : [];
  const visibleAltNames = [...dnsNames, ...ipAddresses].slice(0, MAX_TLS_TERMINAL_ALT_NAMES);
  const omittedAltNames = dnsNames.length + ipAddresses.length - visibleAltNames.length;
  const cipher = document.cipher && typeof document.cipher === 'object' ? document.cipher : {};
  const publicKey = certificate.publicKey && typeof certificate.publicKey === 'object' ? certificate.publicKey : {};
  const findings = Array.isArray(document.findings) ? document.findings : [];
  const limitations = Array.isArray(document.limitations) ? document.limitations : [];
  const lines = [
    `Hostname       ${safeTerminalValue(document.sniHost)}`,
    `Evidence       ${titleCase(document.status)}`,
    `Observed       ${safeTerminalValue(document.observedAt)}`,
    `Address        ${safeTerminalValue(document.connectedAddress)}`,
    `Protocol       ${safeTerminalValue(document.protocol)}`,
    `ALPN           ${safeTerminalValue(document.alpnProtocol)}`,
    `Cipher         ${safeTerminalValue(cipher.standardName || cipher.name)}`,
    `Authorized     ${document.authorization?.authorized === true ? 'Yes' : document.authorization?.authorized === false ? 'No' : 'Unknown'}`,
    `Hostname match ${document.hostname?.matches === true ? 'Yes' : document.hostname?.matches === false ? 'No' : 'Unknown'}`,
    `Validity       ${titleCase(document.validity?.status)}`,
    `Subject        ${safeTerminalValue(Array.isArray(subject.commonNames) ? subject.commonNames.join(', ') : null)}`,
    `Issuer         ${safeTerminalValue(Array.isArray(issuer.commonNames) ? issuer.commonNames.join(', ') : null)}`,
    `Valid from     ${safeTerminalValue(certificate.validFrom)}`,
    `Valid to       ${safeTerminalValue(certificate.validTo)}`,
    `Fingerprint    ${safeTerminalValue(certificate.fingerprintSha256)}`,
    `Public key     ${safeTerminalValue([publicKey.type, publicKey.bits ? `${publicKey.bits} bits` : null, publicKey.curve].filter(Boolean).join(' '))}`,
    `Alt names      ${visibleAltNames.length ? visibleAltNames.map((value) => safeTerminalValue(value)).join(', ') : '—'}${omittedAltNames > 0 ? ` (+${omittedAltNames} more)` : ''}`,
    `Chain          ${safeTerminalValue(Array.isArray(document.chain) ? document.chain.length : 0, '0')} certificate${Array.isArray(document.chain) && document.chain.length === 1 ? '' : 's'}${document.chainTruncated ? ' (truncated)' : ''}`,
  ];
  if (document.authorization?.error) lines.push(`Trust detail   ${safeTerminalValue(document.authorization.error)}`);
  if (document.hostname?.error) lines.push(`Name detail    ${safeTerminalValue(document.hostname.error)}`);
  if (document.diagnostics?.error) lines.push(`Error          ${safeTerminalValue(document.diagnostics.error)}`);
  for (const finding of findings) lines.push(`Finding        ${safeTerminalValue(finding.label)} — ${safeTerminalValue(finding.detail)}`);
  for (const limitation of limitations) lines.push(`Limitation     ${safeTerminalValue(limitation)}`);
  return `${lines.join('\n')}\n`;
}

function comparisonStatusLabel(status: unknown): string {
  const labels: Record<string, string> = {
    equivalent: 'Equivalent',
    conflict: 'Conflict',
    rdap_only: 'RDAP only',
    whois_only: 'WHOIS only',
    rdap_redacted: 'RDAP redacted',
    whois_redacted: 'WHOIS redacted',
    rdap_unavailable: 'RDAP unavailable',
    whois_unavailable: 'WHOIS unavailable',
    rdap_incomplete: 'RDAP incomplete',
    whois_incomplete: 'WHOIS incomplete',
    registry_only: 'Registry only',
    registrar_only: 'Registrar only',
    registry_redacted: 'Registry redacted',
    registrar_redacted: 'Registrar redacted',
    registry_unavailable: 'Registry unavailable',
    registrar_unavailable: 'Registrar unavailable',
    registry_incomplete: 'Registry incomplete',
    registrar_incomplete: 'Registrar incomplete',
  };
  return labels[String(status)] || titleCase(status);
}

function formatTerminalCompare(document: TerminalRecord): string {
  const fields = Array.isArray(document.fields) ? document.fields : [];
  const counts = document.counts && typeof document.counts === 'object' ? document.counts : {};
  const sourceHealth = document.sourceHealth && typeof document.sourceHealth === 'object' ? document.sourceHealth : {};
  const differenceCount = fields.length - (Number(counts.equivalent) || 0);
  const lines = [
    `Query          ${safeTerminalValue(document.query || document.registrableDomain)}`,
    `Lookup mode    ${titleCase(document.lookupMode)}`,
    `Lookup saved   ${safeTerminalValue(document.lookupGeneratedAt)}`,
    `RDAP source    ${comparisonStatusLabel(sourceHealth.rdap?.status)}`,
    `WHOIS source   ${comparisonStatusLabel(sourceHealth.whois?.status)}`,
    `Compared       ${safeTerminalValue(fields.length, '0')} field${fields.length === 1 ? '' : 's'}`,
    `Equivalent     ${safeTerminalValue(counts.equivalent, '0')}`,
    `Differences    ${safeTerminalValue(differenceCount, '0')}`,
    '',
  ];
  if (!fields.length) {
    lines.push('Neither source published a comparable normalized field.');
  } else {
    for (const field of fields) {
      lines.push(`[${comparisonStatusLabel(field.status).toUpperCase()}] ${safeTerminalValue(field.label)}`);
      lines.push(`  RDAP   ${safeTerminalValue(field.rdapDisplay)}`);
      lines.push(`  WHOIS  ${safeTerminalValue(field.whoisDisplay)}`);
    }
  }
  const registrarComparison = document.registrarPublicationComparison
    && typeof document.registrarPublicationComparison === 'object'
    ? document.registrarPublicationComparison
    : null;
  if (registrarComparison) {
    const publicationFields = Array.isArray(registrarComparison.fields) ? registrarComparison.fields : [];
    const publicationCounts = registrarComparison.counts && typeof registrarComparison.counts === 'object'
      ? registrarComparison.counts
      : {};
    const publicationHealth = registrarComparison.sourceHealth && typeof registrarComparison.sourceHealth === 'object'
      ? registrarComparison.sourceHealth
      : {};
    const publicationDifferences = publicationFields.length - (Number(publicationCounts.equivalent) || 0);
    lines.push(
      '',
      'Registry / registrar RDAP publication',
      `Registry RDAP  ${comparisonStatusLabel(publicationHealth.registry?.status)}`,
      `Registrar RDAP ${comparisonStatusLabel(publicationHealth.registrar?.status)}`,
      `Compared       ${safeTerminalValue(publicationFields.length, '0')} field${publicationFields.length === 1 ? '' : 's'}`,
      `Equivalent     ${safeTerminalValue(publicationCounts.equivalent, '0')}`,
      `Differences    ${safeTerminalValue(publicationDifferences, '0')}`,
      '',
    );
    if (!publicationFields.length) {
      lines.push('Neither RDAP publication exposed a comparable normalized field.');
    } else {
      for (const field of publicationFields) {
        lines.push(`[${comparisonStatusLabel(field.status).toUpperCase()}] ${safeTerminalValue(field.label)}`);
        lines.push(`  Registry   ${safeTerminalValue(field.registryDisplay)}`);
        lines.push(`  Registrar  ${safeTerminalValue(field.registrarDisplay)}`);
      }
    }
  }
  lines.push('', 'Comparison is source reconciliation, not an availability or ownership decision.');
  return `${lines.join('\n')}\n`;
}

export {
  MAX_CT_TERMINAL_HOSTNAMES,
  MAX_CT_TERMINAL_MATCHES,
  MAX_DISCOVER_TERMINAL_CANDIDATES,
  MAX_POSTURE_TERMINAL_RECORDS,
  MAX_TLS_TERMINAL_ALT_NAMES,
  MAX_TERMINAL_VALUE_LENGTH,
  formatTerminalBulk,
  formatTerminalCompare,
  formatTerminalCtSearch,
  formatTerminalDiscover,
  formatTerminalHttp,
  formatTerminalLookup,
  formatTerminalPosture,
  formatTerminalTls,
  safeTerminalValue,
};
export type { MutationLabels, TerminalBulkItem, TerminalBulkMetadata, TerminalRecord };
