import { registryAccessProfileLabel } from '../registry-access.mts';
import { unicodeDomainFromAscii } from '../../lib/idn-confusables.mts';

const MAX_TERMINAL_VALUE_LENGTH = 240;
const MAX_CT_TERMINAL_MATCHES = 100;
const MAX_CT_TERMINAL_HOSTNAMES = 5;
const MAX_DISCOVER_TERMINAL_CANDIDATES = 200;
const MAX_POSTURE_TERMINAL_RECORDS = 5;
const MAX_TLS_TERMINAL_ALT_NAMES = 10;
const MAX_TLS_TERMINAL_PURPOSES = 8;
const MAX_RISK_CALIBRATION_TERMINAL_RECORDS = 100;

// Terminal documents have different versioned shapes. Every scalar crosses
// safeTerminalValue before display, while the runner supplies bounded arrays.
type TerminalRecord = Record<string, unknown>;
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

function terminalRecord(value: unknown): TerminalRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as TerminalRecord
    : {};
}

function terminalCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

function terminalCountSummary(
  value: unknown,
  labels: ReadonlyArray<readonly [string, string]>,
): string {
  const source = terminalRecord(value);
  return labels
    .map(([key, label]) => [label, terminalCount(source[key])] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(', ');
}

function formatTerminalLookup(document: TerminalRecord): string {
  const availability = terminalRecord(document.availability);
  const diagnostics = terminalRecord(document.diagnostics);
  const rdapDiagnostics = terminalRecord(diagnostics.rdap);
  const whoisDiagnostics = terminalRecord(diagnostics.whois);
  const lines = [
    `Query          ${safeTerminalValue(document.query)}`,
    `Type           ${safeTerminalValue(document.type)}`,
    `Mode           ${titleCase(document.mode)}`,
  ];
  if (document.inputHostname && document.inputHostname !== document.registrableDomain) {
    lines.push(`Input host     ${safeTerminalValue(document.inputHostname)}`);
    lines.push(`Registry query ${safeTerminalValue(document.registrableDomain)}`);
  }
  if (availability.applicable) {
    lines.push(`Availability   ${titleCase(availability.state)}`);
    lines.push(`Confidence     ${titleCase(availability.confidence)}`);
  }
  lines.push(`RDAP           ${titleCase(rdapDiagnostics.status)}`);
  if (rdapDiagnostics.endpoint) lines.push(`RDAP source    ${safeTerminalValue(rdapDiagnostics.endpoint)}`);
  const registrarRdap = terminalRecord(rdapDiagnostics.registrar);
  if (Object.keys(registrarRdap).length) {
    lines.push(`Registrar RDAP ${titleCase(registrarRdap.status)}`);
    if (registrarRdap.endpoint) lines.push(`Registrar source ${safeTerminalValue(registrarRdap.endpoint)}`);
  }
  lines.push(`WHOIS          ${titleCase(whoisDiagnostics.status)}`);
  const registryInsights = terminalRecord(document.registryInsights);
  if (registryInsights.version === 1) {
    const lifecycle = terminalRecord(registryInsights.lifecycle);
    const disclosure = terminalRecord(registryInsights.contactDisclosure);
    const registryDisclosure = terminalRecord(disclosure.registryRdap);
    const whoisDisclosure = terminalRecord(disclosure.whois);
    const reconciliation = terminalRecord(registryInsights.reconciliation);
    const publications = Array.isArray(registryInsights.publications)
      ? registryInsights.publications.map(terminalRecord)
      : [];
    const publicationCounts = {
      complete: publications.filter((item) => item.state === 'complete').length,
      partial: publications.filter((item) => item.state === 'partial').length,
      unavailable: publications.filter((item) => item.state === 'unavailable').length,
    };
    lines.push(`Lifecycle      ${titleCase(lifecycle.label)}`);
    lines.push(`Disclosure     RDAP ${titleCase(registryDisclosure.state)} · WHOIS ${titleCase(whoisDisclosure.state)}`);
    lines.push(`Reconciliation ${titleCase(reconciliation.state)}`);
    lines.push(`Publications   ${publicationCounts.complete} complete · ${publicationCounts.partial} partial · ${publicationCounts.unavailable} unavailable`);
  }
  if (document.mode === 'deep' && document.type === 'domain') {
    const dns = terminalRecord(availability.dns);
    const http = terminalRecord(availability.http);
    const httpResponse = terminalRecord(http.response);
    const tls = terminalRecord(availability.tls);
    const credentialSurface = terminalRecord(availability.credentialSurfaceProfile);
    const structuredIdentity = terminalRecord(availability.structuredDataIdentity);
    const technology = terminalRecord(availability.technologyProfile);
    const browserLibraries = terminalRecord(technology.browserLibraryProfile);
    const posture = terminalRecord(availability.securityPosture);
    const postureSummary = terminalRecord(posture.summary);

    if (availability.activityStatus) lines.push(`Web activity   ${titleCase(availability.activityStatus)}`);
    if (availability.pageTitle) lines.push(`Page title     ${safeTerminalValue(availability.pageTitle)}`);
    if (dns.status) lines.push(`DNS evidence   ${titleCase(dns.status)}`);
    if (http.status) {
      lines.push(`HTTP evidence  ${titleCase(http.status)}`);
      const responseDetail = [
        httpResponse.status ? `HTTP ${safeTerminalValue(httpResponse.status)}` : null,
        http.transportSecurity ? safeTerminalValue(http.transportSecurity).toUpperCase() : null,
      ].filter(Boolean).join(' · ');
      if (responseDetail) lines.push(`HTTP response  ${responseDetail}`);
    }
    if (tls.status) {
      lines.push(`TLS evidence   ${titleCase(tls.status)}`);
      if (tls.protocol) lines.push(`TLS protocol   ${safeTerminalValue(tls.protocol)}`);
    }
    if (credentialSurface.status || credentialSurface.source === 'html') {
      const forms = terminalRecord(credentialSurface.forms);
      const inputs = terminalRecord(credentialSurface.inputs);
      const categories = terminalRecord(inputs.categories);
      const actions = terminalRecord(forms.actions);
      const formCount = terminalCount(forms.count);
      const inputCount = terminalCount(inputs.count);
      const externalActionCount = terminalCount(actions.external);
      lines.push(`Credential UI  ${titleCase(credentialSurface.status)} · ${safeTerminalValue(inputs.classifiedCount, '0')} classified input${Number(inputs.classifiedCount) === 1 ? '' : 's'}`);
      lines.push(`Form surface   ${safeTerminalValue(formCount)} form${formCount === 1 ? '' : 's'} · ${safeTerminalValue(inputCount)} input${inputCount === 1 ? '' : 's'} · ${safeTerminalValue(externalActionCount)} external action${externalActionCount === 1 ? '' : 's'}`);
      const visible = [
        ['password', categories.password],
        ['email', categories.email],
        ['username', categories.username],
        ['one-time code', categories.one_time_code],
        ['payment related', categories.payment],
      ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${safeTerminalValue(label)} ${safeTerminalValue(count)}`);
      if (visible.length) lines.push(`Input purposes ${safeTerminalValue(visible.join(' · '))}`);
    }
    if (structuredIdentity.status || structuredIdentity.source === 'html') {
      const entities = Array.isArray(structuredIdentity.entities) ? structuredIdentity.entities : [];
      lines.push(`Structured ID  ${titleCase(structuredIdentity.status)} · ${entities.length} declared entit${entities.length === 1 ? 'y' : 'ies'}`);
      const visible = entities.slice(0, 4).map((entity: unknown) => {
        const item = terminalRecord(entity);
        const types = Array.isArray(item.types) ? item.types.slice(0, 3).map((value: unknown) => safeTerminalValue(value)).join('/') : '';
        return `${safeTerminalValue(item.name, 'Unnamed declaration')}${types ? ` (${types})` : ''}`;
      });
      if (visible.length) lines.push(`Declarations   ${safeTerminalValue(visible.join('; '))}`);
    }
    if (technology.status || technology.source === 'derived') {
      const findings = Array.isArray(technology.findings) ? technology.findings : [];
      lines.push(`Technology     ${titleCase(technology.status)} · ${findings.length} indicator${findings.length === 1 ? '' : 's'}`);
      const visible = findings.slice(0, 6).map((finding: unknown) => {
        const item = terminalRecord(finding);
        const qualifiers = [item.category, item.confidence].filter(Boolean).map((value) => safeTerminalValue(value));
        return `${safeTerminalValue(item.name, 'Unnamed indicator')}${qualifiers.length ? ` (${qualifiers.join(', ')})` : ''}`;
      });
      if (visible.length) {
        const omitted = findings.length - visible.length;
        lines.push(`Indicators     ${safeTerminalValue(`${visible.join('; ')}${omitted > 0 ? `; +${omitted} more` : ''}`)}`);
      }
      if (browserLibraries.profileVersion === 1 || browserLibraries.source === 'derived') {
        const libraries = Array.isArray(browserLibraries.findings) ? browserLibraries.findings : [];
        const advisoryMatches = libraries.filter((finding: unknown) => terminalCount(terminalRecord(finding).advisoryCount) > 0).length;
        lines.push(
          `JS libraries   ${titleCase(browserLibraries.status)} · ${libraries.length} apparent · `
          + `${advisoryMatches} with catalogue advisory match${advisoryMatches === 1 ? '' : 'es'}`,
        );
      }
    }
    if (posture.status || posture.source === 'derived') {
      lines.push(`Posture        ${titleCase(posture.status)}`);
      lines.push(
        `Posture counts ${terminalCount(postureSummary.observed)} observed · `
        + `${terminalCount(postureSummary.potentialExposure)} potential exposure · `
        + `${terminalCount(postureSummary.observedAbsence)} observed absence · `
        + `${terminalCount(postureSummary.unavailable)} unavailable`,
      );
    }
  }
  if (document.mode === 'deep' && (document.type === 'ipv4' || document.type === 'ipv6')) {
    const reverseDns = terminalRecord(document.reverseDns);
    const reverseDnsRecords = terminalRecord(reverseDns.records);
    const ptrNames = Array.isArray(reverseDnsRecords.ptr)
      ? reverseDnsRecords.ptr.slice(0, 5).map((value: unknown) => safeTerminalValue(value))
      : [];
    if (reverseDns.status) lines.push(`Reverse DNS    ${titleCase(reverseDns.status)}`);
    if (ptrNames.length) lines.push(`PTR names      ${safeTerminalValue(ptrNames.join(', '))}`);
  }
  const network = terminalRecord(document.networkContext);
  if (network.contextVersion === 1) {
    const endpoint = terminalRecord(network.endpoint);
    const networkRecord = terminalRecord(network.network);
    lines.push(`Network RDAP   ${titleCase(network.status)}`);
    if (endpoint.address) lines.push(`Selected IP    ${safeTerminalValue(endpoint.address)}`);
    if (networkRecord.name || networkRecord.holder) {
      lines.push(`Network        ${safeTerminalValue(networkRecord.name || networkRecord.holder)}`);
    }
  }
  const registryAccess = terminalRecord(diagnostics.registryAccess);
  if (Object.keys(registryAccess).length) {
    lines.push(`Registry access .${safeTerminalValue(registryAccess.suffix)}`);
    lines.push(`WHOIS access   ${registryAccessProfileLabel(registryAccess.whoisAccessProfile)}`);
    lines.push(`RDAP access    ${registryAccessProfileLabel(registryAccess.rdapAccessProfile)}`);
    if (registryAccess.limitation) lines.push(`Access note    ${safeTerminalValue(registryAccess.limitation)}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalRegistrySupport(document: TerminalRecord): string {
  const profile = terminalRecord(document.profile);
  const rdap = terminalRecord(profile.rdap);
  const whois = terminalRecord(profile.whois);
  const verification = terminalRecord(document.verification);
  const fixtures = Array.isArray(verification.fixtureScenarios) ? verification.fixtureScenarios : [];
  const files = Array.isArray(verification.files) ? verification.files : [];
  const documentation = Array.isArray(verification.documentationUrls) ? verification.documentationUrls : [];
  const standards = terminalRecord(document.standardsCoverage);
  const genericCoverage = terminalRecord(standards.genericAndRestricted);
  const supportLabel = (value: unknown) => titleCase(safeTerminalValue(value, 'unknown').replaceAll('-', '_'));
  const lines = [
    `Input          ${safeTerminalValue(document.requestedInput)}`,
    `Suffix         .${safeTerminalValue(document.suffix)}`,
    `Catalogue      Version ${safeTerminalValue(document.catalogueVersion, '0')}`,
    `gTLD RDAP      ${safeTerminalValue(genericCoverage.rdapCovered, '0')} / ${safeTerminalValue(genericCoverage.total, '0')}`,
    `Coverage date  ${safeTerminalValue(standards.verifiedAt, 'unknown')}`,
    `Profile        ${profile.explicitSuffixProfile ? 'Explicit suffix profile' : 'Generic IANA discovery profile'}`,
    `Profile ID     ${safeTerminalValue(profile.id)}`,
    `Registry class ${supportLabel(profile.registryClass)}`,
    `Coverage       ${supportLabel(profile.coverageState)}`,
    `RDAP discovery ${registryAccessProfileLabel(rdap.discovery)}`,
    `RDAP access    ${registryAccessProfileLabel(rdap.accessProfile)}`,
    `WHOIS discovery ${registryAccessProfileLabel(whois.discovery)}`,
    `WHOIS access   ${registryAccessProfileLabel(whois.accessProfile)}`,
    `WHOIS query    ${supportLabel(whois.queryProfile)}`,
    `WHOIS scope    ${supportLabel(whois.queryScope)}`,
    `WHOIS encoding ${supportLabel(whois.encodingProfile)}`,
    `WHOIS parser   ${supportLabel(whois.parserProfile)}`,
    `Fallback       ${profile.fallbackProfile ? supportLabel(profile.fallbackProfile) : 'None'}`,
    `Fixture states ${fixtures.length ? fixtures.map((value: unknown) => supportLabel(value)).join(', ') : 'None documented'}`,
  ];
  for (const file of files) lines.push(`Verified by    ${safeTerminalValue(file)}`);
  for (const url of documentation) lines.push(`Documentation  ${safeTerminalValue(url)}`);
  lines.push(
    `Limitation     ${safeTerminalValue(document.limitation)}`,
    '',
    safeTerminalValue(terminalRecord(document.interpretation).statement),
  );
  return `${lines.join('\n')}\n`;
}

function formatTerminalBulk(items: TerminalBulkItem[], metadata: TerminalBulkMetadata): string {
  const lines = items.map((item) => {
    if (!item.ok) return `! ${safeTerminalValue(item.query)} — ${safeTerminalValue(item.error, 'Lookup failed')}`;
    const result = terminalRecord(item.result);
    const availability = terminalRecord(result.availability);
    const state = titleCase(availability.state);
    const confidence = titleCase(availability.confidence);
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
  const observation = terminalRecord(document.observation);
  const lines = [
    `Keyword        ${safeTerminalValue(document.keyword)}`,
    `CT status      ${titleCase(observation.status || (document.truncated ? 'partial' : 'success'))}`,
    `Certificates   ${safeTerminalValue(document.certCount, '0')}`,
    `Observed hosts ${safeTerminalValue(Array.isArray(document.domains) ? document.domains.length : 0, '0')}`,
    `Matches        ${safeTerminalValue(matches.length, '0')}`,
    `Truncated      ${document.truncated ? 'Yes' : 'No'}`,
    '',
  ];
  if (!visible.length) {
    lines.push('No structured registrable-domain matches.');
  } else {
    for (const value of visible) {
      const match = terminalRecord(value);
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
  const advanced = terminalRecord(document.advancedConfusable);
  const lines = [
    `Seed           ${safeTerminalValue(document.seed)}`,
    `Preset         ${safeTerminalValue(document.preset)}`,
    `Keyboard       ${safeTerminalValue(document.keyboardLayout)}`,
    `TLDs           ${(Array.isArray(document.tlds) ? document.tlds : []).map((value: unknown) => safeTerminalValue(value)).join(', ')}`,
    `Families       ${(Array.isArray(document.mutationFamilies) && document.mutationFamilies.length) ? document.mutationFamilies.map((value: unknown) => safeTerminalValue(value)).join(', ') : 'Preset defaults'}`,
    `Dictionary     ${safeTerminalValue(document.dictionaryTermCount, '0')} accepted custom terms${Number(document.rejectedDictionaryTermCount) > 0 ? `, ${safeTerminalValue(document.rejectedDictionaryTermCount)} rejected` : ''}`,
    `Candidates     ${safeTerminalValue(candidates.length, '0')}`,
    `Truncated      ${document.truncated ? 'Yes' : 'No'}`,
  ];
  if (Object.keys(advanced).length) {
    lines.push(`Advanced IDN   ${safeTerminalValue(advanced.generated, '0')} generated, ${safeTerminalValue(advanced.omittedByPolicy, '0')} policy-omitted, ${safeTerminalValue(advanced.omittedByBudget, '0')} budget-omitted`);
  }
  lines.push('');
  for (const value of visible) {
    const candidate = terminalRecord(value);
    const labels = (Array.isArray(candidate.mutationTypes) ? candidate.mutationTypes : [])
      .map((mutationType: unknown) => {
        const value = safeTerminalValue(mutationType);
        return safeTerminalValue(mutationLabels[value] || value);
      });
    const candidateDomain = safeTerminalValue(candidate.domain, '');
    const unicodeDomain = unicodeDomainFromAscii(candidateDomain);
    const unicodeDetail = unicodeDomain && unicodeDomain !== candidateDomain
      ? ` [Unicode: ${safeTerminalValue(unicodeDomain)}]`
      : '';
    lines.push(`${safeTerminalValue(candidateDomain)}${unicodeDetail} — ${labels.join(', ') || 'Generated variant'}`);
  }
  if (!visible.length) lines.push('No candidates were generated.');
  if (candidates.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${candidates.length} candidates in terminal output; use --json or --jsonl for the complete bounded result.`);
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalPosture(document: TerminalRecord): string {
  const summary = terminalRecord(document.summary);
  const selectors = Array.isArray(document.dkimSelectors) ? document.dkimSelectors : [];
  const checks = Array.isArray(document.checks) ? document.checks : [];
  const lines = [
    `Domain         ${safeTerminalValue(document.domain)}`,
    `Checked        ${safeTerminalValue(document.checkedAt)}`,
    `DKIM selectors ${selectors.length ? selectors.map((value: unknown) => safeTerminalValue(value)).join(', ') : 'None supplied'}`,
    `Summary        ${safeTerminalValue(summary.danger, '0')} action · ${safeTerminalValue(summary.warning, '0')} review · ${safeTerminalValue(summary.pass, '0')} pass · ${safeTerminalValue(summary.info, '0')} info`,
    '',
  ];
  for (const value of checks) {
    const item = terminalRecord(value);
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
  const http = terminalRecord(document.http);
  const response = terminalRecord(http.response);
  const attempts = Array.isArray(http.attempts) ? http.attempts : [];
  const limitations = Array.isArray(http.limitations) ? http.limitations : [];
  const securityHeadersRecord = terminalRecord(response.securityHeaders);
  const securityHeaders = Object.keys(securityHeadersRecord).length
    ? Object.entries(securityHeadersRecord).filter(([, value]) => Boolean(value)).map(([name]) => name)
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
  const bodyHash = terminalRecord(response.bodyHash);
  if (bodyHash.value) {
    lines.push(`Body hash      ${safeTerminalValue(`${bodyHash.algorithm}:${bodyHash.value} (${bodyHash.scope})`)}`);
  }
  for (const value of attempts) {
    const attempt = terminalRecord(value);
    const outcome = attempt.httpStatus ? `HTTP ${attempt.httpStatus}` : attempt.error || attempt.outcome;
    lines.push(`Attempt        ${safeTerminalValue(attempt.url)} — ${safeTerminalValue(outcome)}`);
  }
  for (const limitation of limitations) lines.push(`Limitation     ${safeTerminalValue(limitation)}`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalTls(document: TerminalRecord): string {
  const certificate = terminalRecord(document.certificate);
  const subject = terminalRecord(certificate.subject);
  const issuer = terminalRecord(certificate.issuer);
  const altNames = terminalRecord(certificate.subjectAltNames);
  const dnsNames = Array.isArray(altNames.dnsNames) ? altNames.dnsNames : [];
  const ipAddresses = Array.isArray(altNames.ipAddresses) ? altNames.ipAddresses : [];
  const visibleAltNames = [...dnsNames, ...ipAddresses].slice(0, MAX_TLS_TERMINAL_ALT_NAMES);
  const omittedAltNames = dnsNames.length + ipAddresses.length - visibleAltNames.length;
  const cipher = terminalRecord(document.cipher);
  const publicKey = terminalRecord(certificate.publicKey);
  const signature = terminalRecord(certificate.signature);
  const purposes = terminalRecord(certificate.extendedKeyUsage);
  const purposeValues = Array.isArray(purposes.values)
    ? purposes.values.slice(0, MAX_TLS_TERMINAL_PURPOSES).map(terminalRecord)
    : [];
  const sanClasses = terminalCountSummary(altNames.classes, [
    ['dns', 'DNS'],
    ['ip', 'IP'],
    ['email', 'email'],
    ['uri', 'URI'],
    ['directoryName', 'directory name'],
    ['registeredId', 'registered ID'],
    ['otherName', 'other name'],
    ['unclassified', 'other'],
  ]);
  const aia = terminalRecord(certificate.authorityInformationAccess);
  const ocsp = terminalRecord(aia.ocsp);
  const caIssuers = terminalRecord(aia.caIssuers);
  const authorization = terminalRecord(document.authorization);
  const hostname = terminalRecord(document.hostname);
  const validity = terminalRecord(document.validity);
  const diagnostics = terminalRecord(document.diagnostics);
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
    `Authorized     ${authorization.authorized === true ? 'Yes' : authorization.authorized === false ? 'No' : 'Unknown'}`,
    `Hostname match ${hostname.matches === true ? 'Yes' : hostname.matches === false ? 'No' : 'Unknown'}`,
    `Validity       ${titleCase(validity.status)}`,
    `Subject        ${safeTerminalValue(Array.isArray(subject.commonNames) ? subject.commonNames.join(', ') : null)}`,
    `Issuer         ${safeTerminalValue(Array.isArray(issuer.commonNames) ? issuer.commonNames.join(', ') : null)}`,
    `Valid from     ${safeTerminalValue(certificate.validFrom)}`,
    `Valid to       ${safeTerminalValue(certificate.validTo)}`,
    `Fingerprint    ${safeTerminalValue(certificate.fingerprintSha256)}`,
    `Public key     ${safeTerminalValue([publicKey.type, publicKey.bits ? `${publicKey.bits} bits` : null, publicKey.curve].filter(Boolean).join(' '))}`,
    ...(signature.algorithm || signature.oid
      ? [`Signature      ${safeTerminalValue([signature.algorithm, signature.oid ? `(${signature.oid})` : null].filter(Boolean).join(' '))}`]
      : []),
    ...(Object.keys(purposes).length
      ? [`Purposes       ${purposeValues.length
        ? purposeValues.map((purpose) => safeTerminalValue(`${purpose.name || 'Unrecognized purpose'} (${purpose.oid || 'unknown OID'})`)).join(', ')
        : 'None declared'}${Array.isArray(purposes.values) && purposes.values.length > purposeValues.length ? ` (+${purposes.values.length - purposeValues.length} more)` : ''}${purposes.truncated ? ' (source truncated)' : ''}`]
      : []),
    `Alt names      ${visibleAltNames.length ? visibleAltNames.map((value) => safeTerminalValue(value)).join(', ') : '—'}${omittedAltNames > 0 ? ` (+${omittedAltNames} more)` : ''}`,
    ...(Object.keys(terminalRecord(altNames.classes)).length
      ? [`SAN classes    ${sanClasses || 'None observed'}${altNames.truncated ? ' (truncated)' : ''}`]
      : []),
    ...(Object.keys(aia).length
      ? [`AIA presence   ${[
        terminalCount(ocsp.total) > 0
          ? `OCSP ${terminalCount(ocsp.total)} (${terminalCount(ocsp.https)} HTTPS, ${terminalCount(ocsp.http)} HTTP, ${terminalCount(ocsp.other)} other)`
          : null,
        terminalCount(caIssuers.total) > 0
          ? `CA issuers ${terminalCount(caIssuers.total)} (${terminalCount(caIssuers.https)} HTTPS, ${terminalCount(caIssuers.http)} HTTP, ${terminalCount(caIssuers.other)} other)`
          : null,
        terminalCount(aia.unknownMethods) > 0 ? `unknown methods ${terminalCount(aia.unknownMethods)}` : null,
      ].filter(Boolean).join(' · ') || 'None declared'}${aia.truncated ? ' (truncated)' : ''}`]
      : []),
    `Chain          ${safeTerminalValue(Array.isArray(document.chain) ? document.chain.length : 0, '0')} certificate${Array.isArray(document.chain) && document.chain.length === 1 ? '' : 's'}${document.chainTruncated ? ' (truncated)' : ''}`,
  ];
  if (authorization.error) lines.push(`Trust detail   ${safeTerminalValue(authorization.error)}`);
  if (hostname.error) lines.push(`Name detail    ${safeTerminalValue(hostname.error)}`);
  if (diagnostics.error) lines.push(`Error          ${safeTerminalValue(diagnostics.error)}`);
  for (const value of findings) {
    const finding = terminalRecord(value);
    lines.push(`Finding        ${safeTerminalValue(finding.label)} — ${safeTerminalValue(finding.detail)}`);
  }
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
  const counts = terminalRecord(document.counts);
  const sourceHealth = terminalRecord(document.sourceHealth);
  const rdapHealth = terminalRecord(sourceHealth.rdap);
  const whoisHealth = terminalRecord(sourceHealth.whois);
  const registryAccess = terminalRecord(document.registryAccess);
  const differenceCount = fields.length - (Number(counts.equivalent) || 0);
  const lines = [
    `Query          ${safeTerminalValue(document.query || document.registrableDomain)}`,
    `Lookup mode    ${titleCase(document.lookupMode)}`,
    `Lookup saved   ${safeTerminalValue(document.lookupGeneratedAt)}`,
    `RDAP source    ${comparisonStatusLabel(rdapHealth.status)}`,
    `WHOIS source   ${comparisonStatusLabel(whoisHealth.status)}`,
    `Compared       ${safeTerminalValue(fields.length, '0')} field${fields.length === 1 ? '' : 's'}`,
    `Equivalent     ${safeTerminalValue(counts.equivalent, '0')}`,
    `Differences    ${safeTerminalValue(differenceCount, '0')}`,
  ];
  if (Object.keys(registryAccess).length) {
    lines.push(
      `Registry access .${safeTerminalValue(registryAccess.suffix)}`,
      `WHOIS access   ${registryAccessProfileLabel(registryAccess.whoisAccessProfile)}`,
      `RDAP access    ${registryAccessProfileLabel(registryAccess.rdapAccessProfile)}`,
      `Access note    ${safeTerminalValue(registryAccess.limitation)}`,
    );
  }
  lines.push('');
  if (!fields.length) {
    lines.push('Neither source published a comparable normalized field.');
  } else {
    for (const value of fields) {
      const field = terminalRecord(value);
      lines.push(`[${comparisonStatusLabel(field.status).toUpperCase()}] ${safeTerminalValue(field.label)}`);
      lines.push(`  RDAP   ${safeTerminalValue(field.rdapDisplay)}`);
      lines.push(`  WHOIS  ${safeTerminalValue(field.whoisDisplay)}`);
    }
  }
  const registrarComparison = terminalRecord(document.registrarPublicationComparison);
  if (Object.keys(registrarComparison).length) {
    const publicationFields = Array.isArray(registrarComparison.fields) ? registrarComparison.fields : [];
    const publicationCounts = terminalRecord(registrarComparison.counts);
    const publicationHealth = terminalRecord(registrarComparison.sourceHealth);
    const registryHealth = terminalRecord(publicationHealth.registry);
    const registrarHealth = terminalRecord(publicationHealth.registrar);
    const publicationDifferences = publicationFields.length - (Number(publicationCounts.equivalent) || 0);
    lines.push(
      '',
      'Registry / registrar RDAP publication',
      `Registry RDAP  ${comparisonStatusLabel(registryHealth.status)}`,
      `Registrar RDAP ${comparisonStatusLabel(registrarHealth.status)}`,
      `Compared       ${safeTerminalValue(publicationFields.length, '0')} field${publicationFields.length === 1 ? '' : 's'}`,
      `Equivalent     ${safeTerminalValue(publicationCounts.equivalent, '0')}`,
      `Differences    ${safeTerminalValue(publicationDifferences, '0')}`,
      '',
    );
    if (!publicationFields.length) {
      lines.push('Neither RDAP publication exposed a comparable normalized field.');
    } else {
      for (const value of publicationFields) {
        const field = terminalRecord(value);
        lines.push(`[${comparisonStatusLabel(field.status).toUpperCase()}] ${safeTerminalValue(field.label)}`);
        lines.push(`  Registry   ${safeTerminalValue(field.registryDisplay)}`);
        lines.push(`  Registrar  ${safeTerminalValue(field.registrarDisplay)}`);
      }
    }
  }
  lines.push('', 'Comparison is source reconciliation, not an availability or ownership decision.');
  if (Object.keys(registryAccess).length) {
    lines.push('Registry access describes collection reachability only; it does not decide registration, availability, ownership, safety, or maliciousness.');
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalRiskCalibration(document: TerminalRecord): string {
  const summary = terminalRecord(document.summary);
  const bands = terminalRecord(summary.scoreBands);
  const thresholds = Array.isArray(document.thresholds) ? document.thresholds : [];
  const records = Array.isArray(document.records) ? document.records : [];
  const visible = records.slice(0, MAX_RISK_CALIBRATION_TERMINAL_RECORDS);
  const lines = [
    `Risk model     v${safeTerminalValue(document.riskModelVersion)}`,
    `Review band    ${safeTerminalValue(document.currentReviewThreshold)}+`,
    `Records        ${safeTerminalValue(summary.total, '0')}`,
    `Metric labels  ${safeTerminalValue((Number(summary.positive) || 0) + (Number(summary.negative) || 0), '0')}`,
    `Excluded       ${safeTerminalValue(summary.excluded, '0')}`,
    `Score bands    0-39 ${safeTerminalValue(bands['0_39'], '0')} · 40-69 ${safeTerminalValue(bands['40_69'], '0')} · 70-100 ${safeTerminalValue(bands['70_100'], '0')} · not scored ${safeTerminalValue(bands.not_scored, '0')}`,
    '',
    'Threshold replay',
  ];
  for (const value of thresholds) {
    const threshold = terminalRecord(value);
    lines.push(
      `${String(safeTerminalValue(threshold.threshold)).padStart(3)}+  TP ${safeTerminalValue(threshold.truePositive, '0')}  FP ${safeTerminalValue(threshold.falsePositive, '0')}  TN ${safeTerminalValue(threshold.trueNegative, '0')}  FN ${safeTerminalValue(threshold.falseNegative, '0')}  precision ${safeTerminalValue(threshold.precision)}  recall ${safeTerminalValue(threshold.recall)}`,
    );
  }
  lines.push('', 'Records');
  for (const value of visible) {
    const record = terminalRecord(value);
    const score = record.score === null ? 'not scored' : String(record.score);
    lines.push(`${safeTerminalValue(record.id)}  ${safeTerminalValue(record.domain)}  ${titleCase(record.analystDisposition)}  ${score}`);
  }
  if (records.length > visible.length) lines.push(`… ${records.length - visible.length} additional records omitted from terminal output; use --json for the complete bounded report.`);
  lines.push('', safeTerminalValue(terminalRecord(document.interpretation).statement));
  return `${lines.join('\n')}\n`;
}

export {
  MAX_CT_TERMINAL_HOSTNAMES,
  MAX_CT_TERMINAL_MATCHES,
  MAX_DISCOVER_TERMINAL_CANDIDATES,
  MAX_POSTURE_TERMINAL_RECORDS,
  MAX_TLS_TERMINAL_ALT_NAMES,
  MAX_TLS_TERMINAL_PURPOSES,
  MAX_RISK_CALIBRATION_TERMINAL_RECORDS,
  MAX_TERMINAL_VALUE_LENGTH,
  formatTerminalBulk,
  formatTerminalCompare,
  formatTerminalCtSearch,
  formatTerminalDiscover,
  formatTerminalHttp,
  formatTerminalLookup,
  formatTerminalPosture,
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
  formatTerminalTls,
  safeTerminalValue,
};
export type { MutationLabels, TerminalBulkItem, TerminalBulkMetadata, TerminalRecord };
