import { registryAccessProfileLabel } from '../registry-access.mts';
import { unicodeDomainFromAscii } from '../../lib/idn-confusables.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../../lib/homepage-metadata-contract.mts';
import {
  technologyEvidenceRoles,
  type TechnologyEvidenceRole,
} from '../../lib/technology-evidence-role.mts';

const MAX_TERMINAL_VALUE_LENGTH = 240;
const MAX_LOOKUP_TERMINAL_RECORDS = 5;
const MAX_LOOKUP_TERMINAL_NAMES = 5;
const MAX_LOOKUP_TERMINAL_ALPN_IDS = 4;
const MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH = 32;
const MAX_LOOKUP_TERMINAL_LIMITATIONS = 3;
const MAX_LOOKUP_TERMINAL_CIDRS = 5;
const MAX_LOOKUP_TERMINAL_FINDINGS = 5;
const MAX_LOOKUP_TERMINAL_ABUSE_ROUTES = 6;
const MAX_CT_TERMINAL_MATCHES = 100;
const MAX_CT_TERMINAL_HOSTNAMES = 5;
const MAX_DISCOVER_TERMINAL_CANDIDATES = 200;
const MAX_POSTURE_TERMINAL_RECORDS = 5;
const MAX_TLS_TERMINAL_ALT_NAMES = 10;
const MAX_TLS_TERMINAL_PURPOSES = 8;
const MAX_RISK_CALIBRATION_TERMINAL_RECORDS = 100;
// Archive values are attacker-controlled evidence. Remove the complete Unicode
// default-ignorable class so visually identical identifiers cannot differ only
// through soft hyphens, combining grapheme joiners, variation selectors, tag
// characters, bidi controls, or other zero-width formatting code points.
const TERMINAL_DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;

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
type TerminalBulkMetadata = {
  collectedTotal?: number;
  duplicates?: number;
  filter?: 'all' | 'errors' | 'inconclusive' | 'registered';
};
type LookupTerminalDetail = 'summary' | 'standard' | 'verbose';

function safeTerminalValue(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value)
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(TERMINAL_DEFAULT_IGNORABLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  return normalized.length > MAX_TERMINAL_VALUE_LENGTH
    ? `${normalized.slice(0, MAX_TERMINAL_VALUE_LENGTH - 1)}…`
    : normalized;
}

function boundedTerminalList(values: readonly string[], omitted: number): string {
  const suffix = omitted > 0 ? ` · +${omitted} more` : '';
  const maximumBodyLength = Math.max(1, MAX_TERMINAL_VALUE_LENGTH - suffix.length);
  const joined = values.join(', ');
  const body = joined.length > maximumBodyLength
    ? `${joined.slice(0, Math.max(0, maximumBodyLength - 1))}…`
    : joined;
  return `${body}${suffix}`;
}

function boundedTerminalComponent(value: unknown, maximum: number): string {
  const normalized = safeTerminalValue(value);
  return normalized.length > maximum ? `${normalized.slice(0, Math.max(0, maximum - 1))}…` : normalized;
}

function boundedTerminalWithSuffix(value: string, suffix: string): string {
  if (!suffix) return safeTerminalValue(value);
  const retainedSuffix = suffix.length >= MAX_TERMINAL_VALUE_LENGTH
    ? `${suffix.slice(0, MAX_TERMINAL_VALUE_LENGTH - 1)}…`
    : suffix;
  const maximumValueLength = Math.max(1, MAX_TERMINAL_VALUE_LENGTH - retainedSuffix.length);
  const retainedValue = value.length > maximumValueLength
    ? `${value.slice(0, Math.max(0, maximumValueLength - 1))}…`
    : value;
  return `${retainedValue}${retainedSuffix}`;
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

function terminalTechnologyRoleNames(findings: unknown[], role: TechnologyEvidenceRole): string {
  const names = findings
    .filter((finding) => technologyEvidenceRoles(finding).includes(role))
    .slice(0, 6)
    .map((finding) => safeTerminalValue(terminalRecord(finding).name, 'Unnamed indicator'));
  return names.length ? boundedTerminalList(names, Math.max(0, findings.filter((finding) => technologyEvidenceRoles(finding).includes(role)).length - names.length)) : 'None retained';
}

function terminalCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

function terminalDisplayCount(value: unknown): string {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? String(count) : '0';
}

function terminalCountSummary(
  value: unknown,
  labels: ReadonlyArray<readonly [string, string]>,
): string {
  const source = terminalRecord(value);
  return labels
    .map(([key, label]) => {
      const count = Number(source[key]);
      return [label, Number.isSafeInteger(count) && count >= 0 ? count : 0] as const;
    })
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${terminalDisplayCount(count)}`)
    .join(', ');
}

function appendPublicationMetadataLines(
  lines: string[],
  value: unknown,
  detail: LookupTerminalDetail,
): void {
  if (detail === 'summary' || !validPagePublicationMetadata(value)) return;
  const metadata = terminalRecord(value);
  const robots = terminalRecord(metadata.robots);
  const twitter = terminalRecord(metadata.twitterCard);
  const headings = terminalRecord(metadata.headings);
  const images = terminalRecord(metadata.images);
  const blocking = terminalRecord(metadata.renderBlockingCandidates);
  lines.push(`Publication    ${metadata.complete === true ? 'Complete' : 'Partial'} · robots ${titleCase(robots.status)} · card ${titleCase(twitter.status)}`);
  const directives = Array.isArray(robots.directives) ? robots.directives.map((item) => safeTerminalValue(item)) : [];
  if (directives.length) lines.push(`Robots         ${safeTerminalValue(directives.join(', '))}${robots.conflicting === true ? ' · conflicting' : ''}`);
  else if (robots.status === 'not_observed') lines.push('Robots         No declaration observed in captured static HTML');
  if (twitter.cardType) lines.push(`Card type      ${safeTerminalValue(twitter.cardType)}`);
  lines.push(
    `Static page    headings ${terminalDisplayCount(headings.total)} · images ${terminalDisplayCount(images.total)} · blocking candidates ${terminalDisplayCount(blocking.total)}`,
  );
  if (detail === 'verbose') {
    lines.push(
      `Image alt      missing ${terminalDisplayCount(images.altMissing)} · empty ${terminalDisplayCount(images.altEmpty)} · non-empty ${terminalDisplayCount(images.altNonEmpty)} · unclassified ${terminalDisplayCount(images.altUnclassified)}`,
    );
    lines.push(
      `Blocking       scripts ${terminalDisplayCount(blocking.script)} · stylesheets ${terminalDisplayCount(blocking.stylesheet)} · static candidates only`,
    );
  }
}

function appendDeliveryMetadataLines(lines: string[], value: unknown, verbose = false): void {
  if (!validHttpDeliveryMetadata(value)) return;
  const metadata = terminalRecord(value);
  const encoding = terminalRecord(metadata.contentEncoding);
  const cache = terminalRecord(metadata.cachePolicy);
  const codings = Array.isArray(encoding.codings) ? encoding.codings.map((item) => safeTerminalValue(item)) : [];
  lines.push(`Delivery       ${metadata.complete === true ? 'Complete' : 'Partial'} · encoding ${titleCase(encoding.status)} · cache ${titleCase(cache.status)}`);
  if (codings.length) lines.push(`Content coding ${safeTerminalValue(codings.join(', '))}`);
  const cacheDirectives = [
    ['no-store', cache.noStore], ['no-cache', cache.noCache], ['must-revalidate', cache.mustRevalidate],
    ['public', cache.public], ['private', cache.private], ['immutable', cache.immutable],
  ].filter(([, present]) => present === true).map(([label]) => label);
  if (cacheDirectives.length) lines.push(`Cache policy   ${safeTerminalValue(cacheDirectives.join(', '))}`);
  if (verbose) {
    const seconds = [
      cache.maxAgeSeconds === null ? null : `max-age ${terminalDisplayCount(cache.maxAgeSeconds)}s`,
      cache.sMaxAgeSeconds === null ? null : `s-maxage ${terminalDisplayCount(cache.sMaxAgeSeconds)}s`,
      cache.ageSeconds === null ? null : `Age ${terminalDisplayCount(cache.ageSeconds)}s`,
    ].filter(Boolean);
    if (seconds.length) lines.push(`Cache timing   ${safeTerminalValue(seconds.join(' · '))}`);
    const declared = [
      terminalRecord(cache.etag).present === true ? 'ETag' : null,
      terminalRecord(cache.lastModified).present === true ? 'Last-Modified' : null,
      terminalRecord(cache.expires).present === true ? 'Expires' : null,
    ].filter(Boolean);
    lines.push(`Validators     ${declared.length ? safeTerminalValue(declared.join(', ')) : 'No validator declaration observed'}`);
  }
}

function appendSection(lines: string[], label: string, values: string[]): void {
  if (!values.length) return;
  if (lines.length) lines.push('');
  lines.push(`${label}:`, ...values);
}

function formatLookupDnsRecord(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return safeTerminalValue(value);
  const record = terminalRecord(value);
  if (!Object.keys(record).length) return null;
  if ('exchange' in record) {
    return safeTerminalValue(`${safeTerminalValue(record.priority, '0')} ${record.exchange ? safeTerminalValue(record.exchange) : '.'}`);
  }
  if ('tag' in record && 'value' in record) {
    return safeTerminalValue(`${record.critical ? 'critical ' : ''}${safeTerminalValue(record.tag)} ${safeTerminalValue(record.value)}`);
  }
  if ('nsname' in record) {
    return safeTerminalValue(`${safeTerminalValue(record.nsname)} · serial ${safeTerminalValue(record.serial, 'unknown')}`);
  }
  if (record.type === 'HTTPS') {
    const parameters = terminalRecord(record.parameters);
    const alpnValues = Array.isArray(parameters.alpn) ? parameters.alpn : [];
    const alpnVisible = alpnValues
      .slice(0, MAX_LOOKUP_TERMINAL_ALPN_IDS)
      .map((item) => boundedTerminalComponent(item, MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH));
    const alpn = alpnVisible.length
      ? boundedTerminalList(alpnVisible, Math.max(0, alpnValues.length - alpnVisible.length))
      : '';
    const suffix = [parameters.port ? `port ${safeTerminalValue(parameters.port)}` : '', alpn ? `ALPN ${alpn}` : ''].filter(Boolean).join(' · ');
    const target = `${safeTerminalValue(record.priority, '0')} ${safeTerminalValue(record.target, '.')}`;
    return boundedTerminalWithSuffix(target, suffix ? ` · ${suffix}` : '');
  }
  return null;
}

function appendLookupRecordLine(lines: string[], label: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  const visible = value
    .slice(0, MAX_LOOKUP_TERMINAL_RECORDS)
    .map(formatLookupDnsRecord)
    .filter((item): item is string => item !== null);
  if (!visible.length) return;
  const omitted = Math.max(0, value.length - visible.length);
  lines.push(`${label.padEnd(14)}${boundedTerminalList(visible, omitted)}`);
}

function lookupObservationLabel(value: unknown, observed: string, notObserved: string): string {
  return value === true ? observed : value === false ? notObserved : 'Unavailable';
}

function boundedTerminalNames(value: unknown): string | null {
  if (typeof value === 'string') return safeTerminalValue(value);
  if (!Array.isArray(value)) return null;
  const names = value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .slice(0, MAX_LOOKUP_TERMINAL_NAMES)
    .map((item) => safeTerminalValue(item));
  if (!names.length) return null;
  return boundedTerminalList(names, Math.max(0, value.length - names.length));
}

function boundedTerminalStrings(value: unknown, maximum = MAX_LOOKUP_TERMINAL_NAMES): string | null {
  if (!Array.isArray(value)) return null;
  const inspected = Math.min(value.length, maximum);
  const retained: string[] = [];
  let invalid = 0;
  for (let index = 0; index < inspected; index += 1) {
    const item = value[index];
    if (typeof item === 'string' || typeof item === 'number') retained.push(safeTerminalValue(item));
    else invalid += 1;
  }
  const uninspected = Math.max(0, value.length - inspected);
  const disclosures = [
    invalid > 0 ? `${invalid} malformed retained entr${invalid === 1 ? 'y' : 'ies'} omitted` : null,
    uninspected > 0 ? `+${uninspected} more retained entr${uninspected === 1 ? 'y' : 'ies'}` : null,
  ].filter(Boolean).join(' · ');
  if (!retained.length) return disclosures || null;
  return boundedTerminalWithSuffix(retained.join(', '), disclosures ? ` · ${disclosures}` : '');
}

function sourceCompleteness(value: TerminalRecord): string | null {
  if (value.complete === true && value.truncated !== true) return 'Complete';
  if (value.complete === false || value.truncated === true) return value.truncated === true ? 'Incomplete · truncated' : 'Incomplete';
  return null;
}

function positiveSourceStatus(value: unknown): boolean {
  return value === 'success' || value === 'partial';
}

function lifecycleDate(value: TerminalRecord, field: 'createdDate' | 'updatedDate'): unknown {
  const lifecycle = terminalRecord(value.lifecycle);
  return lifecycle[`${field}Iso`] ?? lifecycle[field];
}

function addressSelectionLabel(value: unknown): string {
  const labels: Record<string, string> = {
    tls_connection: 'TLS connection',
    dns_a: 'DNS A',
    dns_aaaa: 'DNS AAAA',
  };
  return labels[String(value)] || titleCase(value);
}

function retainedUrlRelationship(value: unknown, target: unknown): string | null {
  const urlValue = terminalRecord(value);
  if (typeof urlValue.url !== 'string') return null;
  try {
    const declared = new URL(urlValue.url);
    const targetValue = String(target || '').trim().replace(/\.$/u, '');
    const targetHost = new URL(`http://${targetValue}`).hostname.toLowerCase();
    const relationship = declared.hostname.toLowerCase() === targetHost
      ? 'Same target host'
      : 'Different host declared';
    return [
      relationship,
      urlValue.queryOmitted === true ? 'query omitted' : null,
      urlValue.pathTruncated === true ? 'path shortened' : null,
    ].filter(Boolean).join(' · ');
  } catch {
    return null;
  }
}

function boundedFindingLabels(
  value: unknown,
  formatter: (finding: TerminalRecord) => string,
): string | null {
  if (!Array.isArray(value)) return null;
  const inspected = Math.min(value.length, MAX_LOOKUP_TERMINAL_FINDINGS);
  const retained = value
    .slice(0, inspected)
    .map(terminalRecord)
    .map(formatter)
    .filter(Boolean);
  if (!retained.length) return null;
  return boundedTerminalList(retained, Math.max(0, value.length - inspected));
}

function appendNetworkRegistrationLines(
  lines: string[],
  parsed: TerminalRecord,
  type: unknown,
  detail: LookupTerminalDetail,
): void {
  if (!Object.keys(parsed).length || detail === 'summary') return;
  if (parsed.handle) lines.push(`RDAP handle    ${safeTerminalValue(parsed.handle)}`);
  if (parsed.name) lines.push(`RDAP name      ${safeTerminalValue(parsed.name)}`);
  if (type === 'asn') {
    if (parsed.startAutnum !== undefined && parsed.endAutnum !== undefined) {
      const range = parsed.startAutnum === parsed.endAutnum
        ? safeTerminalValue(parsed.startAutnum)
        : `${safeTerminalValue(parsed.startAutnum)} to ${safeTerminalValue(parsed.endAutnum)}`;
      lines.push(`ASN range      ${range}`);
    } else if (parsed.startAutnum !== undefined) {
      lines.push(`ASN start      ${safeTerminalValue(parsed.startAutnum)}`);
    } else if (parsed.endAutnum !== undefined) {
      lines.push(`ASN end        ${safeTerminalValue(parsed.endAutnum)}`);
    }
    if (parsed.autnumType) lines.push(`Allocation     ${safeTerminalValue(parsed.autnumType)}`);
  } else {
    if (parsed.startAddress && parsed.endAddress) {
      lines.push(`Address range  ${safeTerminalValue(parsed.startAddress)} to ${safeTerminalValue(parsed.endAddress)}`);
    } else if (parsed.startAddress) {
      lines.push(`Address start  ${safeTerminalValue(parsed.startAddress)}`);
    } else if (parsed.endAddress) {
      lines.push(`Address end    ${safeTerminalValue(parsed.endAddress)}`);
    }
    const cidrs = boundedTerminalStrings(parsed.cidrs, MAX_LOOKUP_TERMINAL_CIDRS);
    if (cidrs) lines.push(`CIDR prefixes  ${cidrs}`);
    if (parsed.networkType) lines.push(`Allocation     ${safeTerminalValue(parsed.networkType)}`);
  }
  if (parsed.country) lines.push(`Country        ${safeTerminalValue(parsed.country)}`);
  const statuses = boundedTerminalStrings(parsed.statuses);
  if (statuses) lines.push(`Statuses       ${statuses}`);
  if (detail === 'verbose') {
    const created = lifecycleDate(parsed, 'createdDate');
    const updated = lifecycleDate(parsed, 'updatedDate');
    if (created) lines.push(`Created        ${safeTerminalValue(created)}`);
    if (updated) lines.push(`Updated        ${safeTerminalValue(updated)}`);
    if (parsed.serverTruncated === true || parsed.cidrsTruncated === true) lines.push('RDAP detail    Source declared or local list truncation');
  }
}

function formatTerminalLookup(
  document: TerminalRecord,
  { detail = 'standard' }: { detail?: LookupTerminalDetail } = {},
): string {
  const availability = terminalRecord(document.availability);
  const diagnostics = terminalRecord(document.diagnostics);
  const rdapDiagnostics = terminalRecord(diagnostics.rdap);
  const whoisDiagnostics = terminalRecord(diagnostics.whois);
  const targetLines = [
    `Query          ${safeTerminalValue(document.query)}`,
    `Type           ${safeTerminalValue(document.type)}`,
    `Mode           ${titleCase(document.mode)}`,
  ];
  if (document.inputHostname && document.inputHostname !== document.registrableDomain) {
    targetLines.push(`Input host     ${safeTerminalValue(document.inputHostname)}`);
    targetLines.push(`Registry query ${safeTerminalValue(document.registrableDomain)}`);
  }
  if (availability.applicable) {
    targetLines.push(`Availability   ${titleCase(availability.state)}`);
    targetLines.push(`Confidence     ${titleCase(availability.confidence)}`);
  }

  const registrationLines = [
    `RDAP           ${titleCase(rdapDiagnostics.status)}`,
    `WHOIS          ${titleCase(whoisDiagnostics.status)}`,
  ];
  if (detail !== 'summary' && rdapDiagnostics.endpoint) {
    registrationLines.splice(1, 0, `RDAP source    ${safeTerminalValue(rdapDiagnostics.endpoint)}`);
  }
  const registrarRdap = terminalRecord(rdapDiagnostics.registrar);
  if (Object.keys(registrarRdap).length) {
    registrationLines.push(`Registrar RDAP ${titleCase(registrarRdap.status)}`);
    if (detail !== 'summary' && registrarRdap.endpoint) {
      registrationLines.push(`Registrar source ${safeTerminalValue(registrarRdap.endpoint)}`);
    }
  }
  if (['ipv4', 'ipv6', 'asn'].includes(String(document.type)) && positiveSourceStatus(rdapDiagnostics.status)) {
    const rdap = terminalRecord(document.rdap);
    appendNetworkRegistrationLines(registrationLines, terminalRecord(rdap.parsed), document.type, detail);
  }
  const registryInsights = terminalRecord(document.registryInsights);
  if (detail !== 'summary' && registryInsights.version === 1) {
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
    registrationLines.push(`Lifecycle      ${titleCase(lifecycle.label)}`);
    registrationLines.push(`Disclosure     RDAP ${titleCase(registryDisclosure.state)} · WHOIS ${titleCase(whoisDisclosure.state)}`);
    registrationLines.push(`Reconciliation ${titleCase(reconciliation.state)}`);
    registrationLines.push(`Publications   ${publicationCounts.complete} complete · ${publicationCounts.partial} partial · ${publicationCounts.unavailable} unavailable`);
  }

  const dnsLines: string[] = [];
  const mailLines: string[] = [];
  const tlsLines: string[] = [];
  if (document.mode === 'deep' && document.type === 'domain') {
    const dns = terminalRecord(availability.dns);
    const dnsRecords = terminalRecord(dns.records);
    const dnsDiagnostics = terminalRecord(dns.diagnostics);
    if (Object.keys(dns).length) {
      dnsLines.push(`Evidence       ${titleCase(dns.status)}`);
      dnsLines.push(`Completeness   ${dns.complete === true ? 'Complete' : 'Incomplete'}`);
      const recordTypes = [
        ['a', 'A'], ['aaaa', 'AAAA'], ['cname', 'CNAME'], ['ns', 'NS'],
        ['mx', 'MX'], ['spf', 'SPF'], ['dmarc', 'DMARC'], ['caa', 'CAA'],
        ['soa', 'SOA'], ['https', 'HTTPS'],
      ] as const;
      const retainedCounts = recordTypes
        .map(([key, label]) => [label, Array.isArray(dnsRecords[key]) ? dnsRecords[key].length : 0] as const)
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `${label} ${count}`);
      dnsLines.push(`Retained       ${retainedCounts.length ? safeTerminalValue(retainedCounts.join(' · ')) : 'No records retained'}`);
      if (detail === 'verbose') {
        const unsettled = recordTypes.flatMap(([key, label]) => {
          const diagnostic = terminalRecord(dnsDiagnostics[key]);
          return diagnostic.status && !['success', 'not_found'].includes(String(diagnostic.status))
            ? [`${label} ${titleCase(diagnostic.status)}`]
            : [];
        });
        if (unsettled.length) dnsLines.push(`Query states   ${safeTerminalValue(unsettled.join(' · '))}`);
      }
      if (detail !== 'summary') {
        for (const [key, label] of recordTypes) appendLookupRecordLine(dnsLines, label, dnsRecords[key]);
      }

      mailLines.push(`Evidence       ${titleCase(dns.status)}`);
      mailLines.push(`Mail exchange  ${lookupObservationLabel(dns.hasNullMx === true ? true : dns.hasMx, dns.hasNullMx === true ? 'Null MX observed' : 'MX observed', 'No MX observed')}`);
      mailLines.push(`SPF            ${lookupObservationLabel(dns.hasSpf, 'Record observed', 'No record observed')}`);
      mailLines.push(`DMARC          ${lookupObservationLabel(dns.hasDmarc, 'Record observed', 'No record observed')}`);
      if (detail !== 'summary') {
        appendLookupRecordLine(mailLines, 'MX hosts', Array.isArray(dns.mxHosts) ? dns.mxHosts : []);
        appendLookupRecordLine(mailLines, 'SPF policy', dnsRecords.spf);
        appendLookupRecordLine(mailLines, 'DMARC policy', dnsRecords.dmarc);
      }
    }

    const tls = terminalRecord(availability.tls);
    if (Object.keys(tls).length) {
      const usableTls = positiveSourceStatus(tls.status);
      const certificate = usableTls ? terminalRecord(tls.certificate) : {};
      const subject = terminalRecord(certificate.subject);
      const issuer = terminalRecord(certificate.issuer);
      const authorization = usableTls ? terminalRecord(tls.authorization) : {};
      const hostname = usableTls ? terminalRecord(tls.hostname) : {};
      const validity = usableTls ? terminalRecord(tls.validity) : {};
      const cipher = usableTls ? terminalRecord(tls.cipher) : {};
      tlsLines.push(`Evidence       ${titleCase(tls.status)}`);
      const completeness = sourceCompleteness(tls);
      if (completeness) tlsLines.push(`Completeness   ${completeness}`);
      if (usableTls && tls.connectedAddress && detail !== 'summary') tlsLines.push(`Address        ${safeTerminalValue(tls.connectedAddress)}`);
      if (usableTls && tls.protocol) tlsLines.push(`Protocol       ${safeTerminalValue(tls.protocol)}`);
      if (usableTls && tls.alpnProtocol && detail !== 'summary') tlsLines.push(`ALPN           ${safeTerminalValue(tls.alpnProtocol)}`);
      if (cipher.standardName || cipher.name) tlsLines.push(`Cipher         ${safeTerminalValue(cipher.standardName || cipher.name)}`);
      tlsLines.push(`Chain trust    ${authorization.authorized === true ? 'Authorised' : authorization.authorized === false ? 'Not authorised' : 'Unavailable'}`);
      tlsLines.push(`Hostname       ${hostname.matches === true ? 'Matched' : hostname.matches === false ? 'Not matched' : 'Unavailable'}`);
      tlsLines.push(`Validity       ${validity.status ? titleCase(validity.status) : 'Unavailable'}`);
      const subjectName = boundedTerminalNames(subject.commonNames ?? subject.CN);
      const issuerName = boundedTerminalNames(issuer.commonNames ?? issuer.CN);
      if (detail !== 'summary' && subjectName) tlsLines.push(`Subject        ${subjectName}`);
      if (detail !== 'summary' && issuerName) tlsLines.push(`Issuer         ${issuerName}`);
      if (detail !== 'summary' && certificate.validFrom) tlsLines.push(`Valid from     ${safeTerminalValue(certificate.validFrom)}`);
      if (detail !== 'summary' && certificate.validTo) tlsLines.push(`Valid until    ${safeTerminalValue(certificate.validTo)}`);
      const publicKey = terminalRecord(certificate.publicKey);
      if (detail !== 'summary' && (publicKey.type || publicKey.bits || publicKey.curve)) {
        tlsLines.push(`Public key     ${safeTerminalValue([publicKey.type, publicKey.bits ? `${publicKey.bits} bits` : null, publicKey.curve].filter(Boolean).join(' '))}`);
      }
      const signature = terminalRecord(certificate.signature);
      if (detail !== 'summary' && (signature.algorithm || signature.oid)) {
        tlsLines.push(`Signature      ${safeTerminalValue(signature.algorithm || signature.oid)}`);
      }
      const altNames = terminalRecord(certificate.subjectAltNames);
      const dnsAltNames = Array.isArray(altNames.dnsNames) ? altNames.dnsNames : [];
      const ipAltNames = Array.isArray(altNames.ipAddresses) ? altNames.ipAddresses : [];
      const sanClasses = terminalCountSummary(altNames.classes, [
        ['dns', 'DNS'], ['ip', 'IP'], ['email', 'email'], ['uri', 'URI'],
        ['directoryName', 'directory name'], ['registeredId', 'registered ID'],
        ['otherName', 'other name'], ['unclassified', 'other'],
      ]);
      if (detail !== 'summary' && (dnsAltNames.length || ipAltNames.length || sanClasses)) {
        tlsLines.push(`SAN summary    ${sanClasses || `DNS ${dnsAltNames.length} · IP ${ipAltNames.length}`}${altNames.truncated ? ' · truncated' : ''}`);
      }
      const chainCount = Array.isArray(tls.chain) ? tls.chain.length : 0;
      if (detail !== 'summary' && (chainCount || tls.chainTruncated === true)) {
        tlsLines.push(`Chain          ${chainCount} retained certificate${chainCount === 1 ? '' : 's'}${tls.chainTruncated ? ' · truncated' : ''}`);
      }
      const aia = terminalRecord(certificate.authorityInformationAccess);
      if (detail !== 'summary' && Object.keys(aia).length) {
        const ocsp = terminalRecord(aia.ocsp);
        const caIssuers = terminalRecord(aia.caIssuers);
        tlsLines.push(
          `AIA presence   OCSP ${terminalCount(ocsp.total)} · CA issuers ${terminalCount(caIssuers.total)} · `
          + `unknown methods ${terminalCount(aia.unknownMethods)}${aia.truncated ? ' · truncated' : ''}`,
        );
      }
      if (detail === 'verbose') {
        const visibleAltNames = [...dnsAltNames, ...ipAltNames]
          .slice(0, MAX_TLS_TERMINAL_ALT_NAMES)
          .map((value) => safeTerminalValue(value));
        if (visibleAltNames.length) tlsLines.push(`Alt names      ${boundedTerminalList(visibleAltNames, Math.max(0, dnsAltNames.length + ipAltNames.length - visibleAltNames.length))}`);
        const purposes = terminalRecord(certificate.extendedKeyUsage);
        const purposeValues = Array.isArray(purposes.values) ? purposes.values : [];
        const visiblePurposes = purposeValues.slice(0, MAX_TLS_TERMINAL_PURPOSES).map((value) => {
          const purpose = terminalRecord(value);
          return safeTerminalValue(purpose.name || purpose.oid || 'Unrecognized purpose');
        });
        if (visiblePurposes.length) tlsLines.push(`Purposes       ${boundedTerminalList(visiblePurposes, Math.max(0, purposeValues.length - visiblePurposes.length))}${purposes.truncated ? ' · truncated' : ''}`);
        const findings = boundedFindingLabels(tls.findings, (finding) => safeTerminalValue(finding.label, 'Unlabelled finding'));
        if (findings) tlsLines.push(`Findings       ${findings}`);
      }
      if (detail === 'verbose' && certificate.fingerprintSha256) tlsLines.push(`SHA-256        ${safeTerminalValue(certificate.fingerprintSha256)}`);
      if (detail === 'verbose' && Array.isArray(tls.limitations)) {
        for (const limitation of tls.limitations.slice(0, MAX_LOOKUP_TERMINAL_LIMITATIONS)) tlsLines.push(`Limitation     ${safeTerminalValue(limitation)}`);
        const omittedLimitations = Math.max(0, tls.limitations.length - MAX_LOOKUP_TERMINAL_LIMITATIONS);
        if (omittedLimitations) tlsLines.push(`Limitation     +${omittedLimitations} more retained limitation${omittedLimitations === 1 ? '' : 's'}`);
      }
    }
  }

  const websiteLines: string[] = [];
  if (document.mode === 'deep' && document.type === 'domain') {
    const http = terminalRecord(availability.http);
    const httpResponse = terminalRecord(http.response);
    const credentialSurface = terminalRecord(availability.credentialSurfaceProfile);
    const structuredIdentity = terminalRecord(availability.structuredDataIdentity);
    const technology = terminalRecord(availability.technologyProfile);
    const browserLibraries = terminalRecord(technology.browserLibraryProfile);
    const posture = terminalRecord(availability.securityPosture);
    const postureSummary = terminalRecord(posture.summary);
    const pageIdentity = terminalRecord(availability.pageIdentity);
    const pageRole = terminalRecord(availability.pageRoleProfile);
    const clientBehavior = terminalRecord(availability.clientBehaviorProfile);

    if (availability.activityStatus) websiteLines.push(`Web activity   ${titleCase(availability.activityStatus)}`);
    if (detail !== 'summary' && availability.pageTitle) websiteLines.push(`Page title     ${safeTerminalValue(availability.pageTitle)}`);
    if (http.status) {
      websiteLines.push(`HTTP evidence  ${titleCase(http.status)}`);
      const responseDetail = [
        httpResponse.status ? `HTTP ${safeTerminalValue(httpResponse.status)}` : null,
        http.transportSecurity ? safeTerminalValue(http.transportSecurity).toUpperCase() : null,
      ].filter(Boolean).join(' · ');
      if (detail !== 'summary' && responseDetail) websiteLines.push(`HTTP response  ${responseDetail}`);
      if (detail !== 'summary') appendDeliveryMetadataLines(websiteLines, httpResponse.deliveryMetadata, detail === 'verbose');
    }
    if (pageIdentity.status || pageIdentity.source === 'html') {
      websiteLines.push(`Page identity  ${titleCase(pageIdentity.status)}`);
      const completeness = sourceCompleteness(pageIdentity);
      if (completeness) websiteLines.push(`Page coverage  ${completeness}`);
      if (positiveSourceStatus(pageIdentity.status) && detail !== 'summary') {
        if (pageIdentity.documentLanguage) websiteLines.push(`Language       ${safeTerminalValue(pageIdentity.documentLanguage)}`);
        const canonical = retainedUrlRelationship(
          pageIdentity.canonical,
          document.registrableDomain || availability.domain || document.query,
        );
        if (canonical) websiteLines.push(`Canonical      ${canonical}`);
        const openGraph = terminalRecord(pageIdentity.openGraph);
        if (openGraph.title || openGraph.siteName) {
          websiteLines.push(`Open Graph     ${safeTerminalValue([openGraph.siteName, openGraph.title].filter(Boolean).join(' · '))}`);
        }
        if (pageIdentity.generator) websiteLines.push(`Generator      ${safeTerminalValue(pageIdentity.generator)}`);
        const forms = terminalRecord(pageIdentity.forms);
        if (Object.keys(forms).length) websiteLines.push(
          `Page forms     ${terminalDisplayCount(forms.count)} total · ${terminalDisplayCount(forms.postCount)} POST · ${terminalDisplayCount(forms.insecureActionCount)} insecure action`,
        );
        const resources = terminalRecord(pageIdentity.resources);
        const resourceTypes = terminalCountSummary(resources.byType, [
          ['image', 'image'], ['script', 'script'], ['stylesheet', 'stylesheet'], ['link', 'link'],
          ['frame', 'frame'], ['media', 'media'], ['object', 'object'],
        ]);
        if (Object.keys(resources).length) websiteLines.push(`Resources      ${terminalDisplayCount(resources.count)} retained${resourceTypes ? ` · ${resourceTypes}` : ''}${resources.truncated ? ' · truncated' : ''}`);
        const downloads = terminalRecord(pageIdentity.downloads);
        if (Object.keys(downloads).length) websiteLines.push(
          `Downloads      ${terminalDisplayCount(downloads.count)} retained · ${terminalDisplayCount(downloads.riskyCount)} review file${Number(downloads.riskyCount) === 1 ? '' : 's'}${downloads.truncated ? ' · truncated' : ''}`,
        );
        if ([pageIdentity.embeddedOrigins, pageIdentity.contactDomains, pageIdentity.trackingIdentifiers].some(Array.isArray)) {
          websiteLines.push(
            `Relationships  ${Array.isArray(pageIdentity.embeddedOrigins) ? pageIdentity.embeddedOrigins.length : 0} embedded retained · `
            + `${Array.isArray(pageIdentity.contactDomains) ? pageIdentity.contactDomains.length : 0} contact domain${Array.isArray(pageIdentity.contactDomains) && pageIdentity.contactDomains.length === 1 ? '' : 's'} retained · `
            + `${Array.isArray(pageIdentity.trackingIdentifiers) ? pageIdentity.trackingIdentifiers.length : 0} tracking identifier${Array.isArray(pageIdentity.trackingIdentifiers) && pageIdentity.trackingIdentifiers.length === 1 ? '' : 's'} retained`,
          );
        }
        appendPublicationMetadataLines(websiteLines, pageIdentity.publicationMetadata, detail);
      }
    }
    if (availability.phishingLanguageMatch && detail !== 'summary') {
      websiteLines.push(`Content cue    ${safeTerminalValue(availability.phishingLanguageMatch)} · static review label`);
    }
    if (credentialSurface.status || credentialSurface.source === 'html') {
      const forms = terminalRecord(credentialSurface.forms);
      const inputs = terminalRecord(credentialSurface.inputs);
      const categories = terminalRecord(inputs.categories);
      const actions = terminalRecord(forms.actions);
      const formCount = terminalCount(forms.count);
      const inputCount = terminalCount(inputs.count);
      const externalActionCount = terminalCount(actions.external);
      websiteLines.push(`Credential UI  ${titleCase(credentialSurface.status)} · ${safeTerminalValue(inputs.classifiedCount, '0')} classified input${Number(inputs.classifiedCount) === 1 ? '' : 's'}`);
      if (detail !== 'summary') websiteLines.push(`Form surface   ${safeTerminalValue(formCount)} form${formCount === 1 ? '' : 's'} · ${safeTerminalValue(inputCount)} input${inputCount === 1 ? '' : 's'} · ${safeTerminalValue(externalActionCount)} external action${externalActionCount === 1 ? '' : 's'}`);
      const visible = [
        ['password', categories.password],
        ['email', categories.email],
        ['username', categories.username],
        ['one-time code', categories.one_time_code],
        ['payment related', categories.payment],
      ].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${safeTerminalValue(label)} ${safeTerminalValue(count)}`);
      if (detail !== 'summary' && visible.length) websiteLines.push(`Input purposes ${safeTerminalValue(visible.join(' · '))}`);
    }
    if (structuredIdentity.status || structuredIdentity.source === 'html') {
      const entities = Array.isArray(structuredIdentity.entities) ? structuredIdentity.entities : [];
      websiteLines.push(`Structured ID  ${titleCase(structuredIdentity.status)} · ${entities.length} declared entit${entities.length === 1 ? 'y' : 'ies'}`);
      const visible = entities.slice(0, 4).map((entity: unknown) => {
        const item = terminalRecord(entity);
        const types = Array.isArray(item.types) ? item.types.slice(0, 3).map((value: unknown) => safeTerminalValue(value)).join('/') : '';
        return `${safeTerminalValue(item.name, 'Unnamed declaration')}${types ? ` (${types})` : ''}`;
      });
      if (detail !== 'summary' && visible.length) websiteLines.push(`Declarations   ${safeTerminalValue(visible.join('; '))}`);
    }
    if (technology.status || technology.source === 'derived') {
      const findings = Array.isArray(technology.findings) ? technology.findings : [];
      websiteLines.push(`Technology     ${titleCase(technology.status)} · ${findings.length} indicator${findings.length === 1 ? '' : 's'}`);
      const visible = findings.slice(0, 6).map((finding: unknown) => {
        const item = terminalRecord(finding);
        const qualifiers = [item.category, item.confidence ? `${item.confidence} signature strength` : null].filter(Boolean).map((value) => safeTerminalValue(value));
        return `${safeTerminalValue(item.name, 'Unnamed indicator')}${qualifiers.length ? ` (${qualifiers.join(', ')})` : ''}`;
      });
      if (detail !== 'summary' && visible.length) {
        const omitted = findings.length - visible.length;
        websiteLines.push(`Indicators     ${safeTerminalValue(`${visible.join('; ')}${omitted > 0 ? `; +${omitted} more` : ''}`)}`);
      }
      if (detail !== 'summary') {
        const nameservers = Array.isArray(availability.nameservers)
          ? availability.nameservers.slice(0, MAX_LOOKUP_TERMINAL_NAMES).map((value) => safeTerminalValue(value))
          : [];
        websiteLines.push(`DNS operator   ${nameservers.length ? boundedTerminalList(nameservers, Math.max(0, (availability.nameservers as unknown[]).length - nameservers.length)) : 'Unavailable'} · nameserver evidence only`);
        websiteLines.push(`Observed edge  ${terminalTechnologyRoleNames(findings, 'observed_edge')}`);
        websiteLines.push(`App platform   ${terminalTechnologyRoleNames(findings, 'application_platform')}`);
        websiteLines.push(`Framework/run  ${terminalTechnologyRoleNames(findings, 'framework_runtime')}`);
        websiteLines.push(`Embedded deps  ${terminalTechnologyRoleNames(findings, 'embedded_dependency')}`);
        websiteLines.push('Origin host    Not established from retained evidence');
      }
      if (detail !== 'summary' && (browserLibraries.profileVersion === 1 || browserLibraries.source === 'derived')) {
        const libraries = Array.isArray(browserLibraries.findings) ? browserLibraries.findings : [];
        const advisoryMatches = libraries.filter((finding: unknown) => terminalCount(terminalRecord(finding).advisoryCount) > 0).length;
        websiteLines.push(
          `JS libraries   ${titleCase(browserLibraries.status)} · ${libraries.length} apparent · `
          + `${advisoryMatches} with catalogue advisory match${advisoryMatches === 1 ? '' : 'es'}`,
        );
      }
    }
    if (posture.status || posture.source === 'derived') {
      websiteLines.push(`Posture        ${titleCase(posture.status)}`);
      if (detail !== 'summary' && Object.keys(postureSummary).length) websiteLines.push(
        `Posture counts ${terminalCount(postureSummary.observed)} observed · `
        + `${terminalCount(postureSummary.potentialExposure)} potential exposure · `
        + `${terminalCount(postureSummary.observedAbsence)} observed absence · `
        + `${terminalCount(postureSummary.unavailable)} unavailable`,
      );
      if (detail === 'verbose' && positiveSourceStatus(posture.status)) {
        const findings = boundedFindingLabels(posture.findings, (finding) => {
          const state = finding.state ? ` (${titleCase(finding.state)})` : '';
          return `${safeTerminalValue(finding.label, 'Unlabelled finding')}${state}`;
        });
        if (findings) websiteLines.push(`Posture labels ${findings}`);
      }
    }
    if (pageRole.status || pageRole.source === 'derived') {
      websiteLines.push(`Page role      ${titleCase(pageRole.status)}`);
      const roleFindings = Array.isArray(pageRole.findings) ? pageRole.findings : [];
      const primary = roleFindings.map(terminalRecord).find((finding) => finding.role === pageRole.primaryRole)
        || terminalRecord(roleFindings[0]);
      if (positiveSourceStatus(pageRole.status) && detail !== 'summary' && Object.keys(primary).length) {
        websiteLines.push(`Primary role   ${safeTerminalValue(primary.label, 'Unclassified')} · ${titleCase(primary.confidence)}`);
      }
      if (positiveSourceStatus(pageRole.status) && detail === 'verbose') {
        const findings = boundedFindingLabels(roleFindings, (finding) => `${safeTerminalValue(finding.label, 'Unclassified')} (${titleCase(finding.confidence)})`);
        if (findings) websiteLines.push(`Role labels    ${findings}`);
      }
    }
    if (clientBehavior.status || clientBehavior.source === 'derived') {
      websiteLines.push(`Client signals ${titleCase(clientBehavior.status)}`);
      const scriptSummary = terminalRecord(clientBehavior.scriptSummary);
      if (positiveSourceStatus(clientBehavior.status) && detail !== 'summary' && Object.keys(scriptSummary).length) websiteLines.push(
        `Scripts        ${terminalCount(scriptSummary.elementsObserved)} elements · ${terminalCount(scriptSummary.referencedScripts)} referenced · `
        + `${terminalCount(scriptSummary.inlineScripts)} inline · ${terminalCount(scriptSummary.moduleScripts)} modules`,
      );
      if (positiveSourceStatus(clientBehavior.status) && detail === 'verbose') {
        const indicators = boundedFindingLabels(clientBehavior.indicators, (indicator) => {
          const occurrences = terminalCount(indicator.occurrences);
          return `${safeTerminalValue(indicator.label, 'Static indicator')} (${titleCase(indicator.evidenceClass)}, ${occurrences})`;
        });
        if (indicators) websiteLines.push(`Client labels  ${indicators}`);
      }
    }
  }

  const networkLines: string[] = [];
  if (document.mode === 'deep' && (document.type === 'ipv4' || document.type === 'ipv6')) {
    const reverseDns = terminalRecord(document.reverseDns);
    const reverseDnsRecords = terminalRecord(reverseDns.records);
    const ptrNames = boundedTerminalStrings(reverseDnsRecords.ptr);
    if (reverseDns.status) networkLines.push(`Reverse DNS    ${titleCase(reverseDns.status)}`);
    const completeness = sourceCompleteness(reverseDns);
    if (completeness) networkLines.push(`PTR coverage   ${completeness}`);
    if (detail !== 'summary' && ptrNames) networkLines.push(`PTR names      ${ptrNames}`);
    if (detail !== 'summary' && !ptrNames && reverseDns.status) networkLines.push('PTR names      No names retained; source state remains inconclusive');
  }
  const network = terminalRecord(document.networkContext);
  if (network.contextVersion === 1) {
    const endpoint = terminalRecord(network.endpoint);
    const networkRecord = terminalRecord(network.network);
    networkLines.push(`Network RDAP   ${titleCase(network.status)}`);
    const completeness = sourceCompleteness(network);
    if (completeness) networkLines.push(`Completeness   ${completeness}`);
    if (detail !== 'summary' && endpoint.address) networkLines.push(`Selected IP    ${safeTerminalValue(endpoint.address)}`);
    if (detail !== 'summary' && endpoint.selectedFrom) networkLines.push(`Selected from  ${addressSelectionLabel(endpoint.selectedFrom)}`);
    if (positiveSourceStatus(network.status) && (networkRecord.name || networkRecord.holder)) {
      networkLines.push(`Network        ${safeTerminalValue(networkRecord.name || networkRecord.holder)}`);
    }
    if (positiveSourceStatus(network.status) && detail !== 'summary') {
      if (networkRecord.handle) networkLines.push(`Network handle ${safeTerminalValue(networkRecord.handle)}`);
      if (networkRecord.holder && networkRecord.holder !== networkRecord.name) networkLines.push(`Holder         ${safeTerminalValue(networkRecord.holder)}`);
      const cidrs = boundedTerminalStrings(networkRecord.cidrs, MAX_LOOKUP_TERMINAL_CIDRS);
      if (cidrs) networkLines.push(`CIDR prefixes  ${cidrs}`);
      if (networkRecord.startAddress || networkRecord.endAddress) networkLines.push(`Address range  ${safeTerminalValue(networkRecord.startAddress)} to ${safeTerminalValue(networkRecord.endAddress)}`);
      if (networkRecord.country) networkLines.push(`Country        ${safeTerminalValue(networkRecord.country)}`);
      if (networkRecord.networkType) networkLines.push(`Allocation     ${safeTerminalValue(networkRecord.networkType)}`);
      const allAbuseRoutes = Array.isArray(network.abuseRouting) ? network.abuseRouting : [];
      const inspectedRoutes = Math.min(allAbuseRoutes.length, MAX_LOOKUP_TERMINAL_ABUSE_ROUTES);
      const abuseRoutes = allAbuseRoutes.slice(0, inspectedRoutes).map(terminalRecord);
      if (abuseRoutes.length) {
        const channelCounts = new Map<string, number>();
        for (const route of abuseRoutes) {
          const channel = ['email', 'phone'].includes(String(route.channel)) ? String(route.channel) : 'other';
          channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);
        }
        const summary = [...channelCounts].map(([channel, count]) => `${channel} ${count}`).join(' · ');
        const omittedRoutes = Math.max(0, allAbuseRoutes.length - inspectedRoutes);
        networkLines.push(
          `Published routes ${abuseRoutes.length} retained${omittedRoutes ? ` · +${omittedRoutes} more entries` : ''} (${summary}); values omitted`,
        );
      }
      if (detail === 'verbose' && networkRecord.databaseUpdatedAt) networkLines.push(`Registry date  ${safeTerminalValue(networkRecord.databaseUpdatedAt)}`);
      if (detail === 'verbose' && Array.isArray(network.limitations)) {
        for (const limitation of network.limitations.slice(0, MAX_LOOKUP_TERMINAL_LIMITATIONS)) networkLines.push(`Limitation     ${safeTerminalValue(limitation)}`);
        const omitted = Math.max(0, network.limitations.length - MAX_LOOKUP_TERMINAL_LIMITATIONS);
        if (omitted) networkLines.push(`Limitation     +${omitted} more retained limitation${omitted === 1 ? '' : 's'}`);
      }
    }
  }

  const sourceHealthLines: string[] = [];
  const registryAccess = terminalRecord(diagnostics.registryAccess);
  if (Object.keys(registryAccess).length) {
    sourceHealthLines.push(`Registry access .${safeTerminalValue(registryAccess.suffix)}`);
    sourceHealthLines.push(`WHOIS access   ${registryAccessProfileLabel(registryAccess.whoisAccessProfile)}`);
    sourceHealthLines.push(`RDAP access    ${registryAccessProfileLabel(registryAccess.rdapAccessProfile)}`);
    if (detail !== 'summary' && registryAccess.limitation) sourceHealthLines.push(`Access note    ${safeTerminalValue(registryAccess.limitation)}`);
  }

  const collectionLines: string[] = [];
  if (detail === 'verbose') {
    collectionLines.push(`Generated      ${safeTerminalValue(document.generatedAt, 'unknown')}`);
    const timing = terminalRecord(document.timing);
    if (Number(timing.totalMs) >= 0) collectionLines.push(`Total time     ${safeTerminalValue(timing.totalMs)} ms`);
    const sources = Array.isArray(timing.sources) ? timing.sources.map(terminalRecord) : [];
    for (const source of sources.slice(0, 16)) {
      collectionLines.push(
        `${safeTerminalValue(source.source, 'source')} ${titleCase(source.outcome)} · ${safeTerminalValue(source.durationMs, '0')} ms`,
      );
    }
  }

  const lines: string[] = [];
  appendSection(lines, 'Target', targetLines);
  appendSection(lines, 'Registration', registrationLines);
  appendSection(lines, 'DNS', dnsLines);
  appendSection(lines, 'Mail', mailLines);
  appendSection(lines, 'Website and security', websiteLines);
  appendSection(lines, 'TLS and certificate', tlsLines);
  appendSection(lines, 'Network', networkLines);
  appendSection(lines, 'Source health', sourceHealthLines);
  appendSection(lines, 'Collection', collectionLines);
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
    ...(typeof profile.officialLookupUrl === 'string' && profile.officialLookupUrl
      ? [`Official lookup ${safeTerminalValue(profile.officialLookupUrl)}`]
      : []),
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
    if (!item.ok) return `! ${safeTerminalValue(item.query)}: ${safeTerminalValue(item.error, 'Lookup failed')}`;
    const result = terminalRecord(item.result);
    const availability = terminalRecord(result.availability);
    const state = titleCase(availability.state);
    const confidence = titleCase(availability.confidence);
    return `✓ ${safeTerminalValue(item.query)}: ${state} (${confidence} confidence)`;
  });
  const succeeded = items.filter((item) => item.ok).length;
  lines.push('');
  const collected = metadata.collectedTotal ?? items.length;
  const filter = metadata.filter && metadata.filter !== 'all'
    ? ` · ${items.length} matched ${metadata.filter}`
    : '';
  lines.push(`${collected} collected${filter} · ${succeeded} succeeded · ${items.length - succeeded} failed in output · ${metadata.duplicates || 0} duplicates removed`);
  return `${lines.join('\n')}\n`;
}

function formatTerminalCtSearch(document: TerminalRecord): string {
  const matches = Array.isArray(document.matches) ? document.matches : [];
  const certificateGroups = Array.isArray(document.certificateGroups) ? document.certificateGroups : [];
  const crossDomainGroups = certificateGroups.filter((value: unknown) => {
    const group = terminalRecord(value);
    return Array.isArray(group.domains) && group.domains.length > 1;
  });
  const visible = matches.slice(0, MAX_CT_TERMINAL_MATCHES);
  const observation = terminalRecord(document.observation);
  const lines = [
    `Keyword        ${safeTerminalValue(document.keyword)}`,
    `CT status      ${titleCase(observation.status || (document.truncated ? 'partial' : 'success'))}`,
    `Certificates   ${safeTerminalValue(document.certCount, '0')}`,
    `Observed hosts ${safeTerminalValue(Array.isArray(document.domains) ? document.domains.length : 0, '0')}`,
    `Matches        ${safeTerminalValue(matches.length, '0')}`,
    `Issuance groups ${safeTerminalValue(certificateGroups.length, '0')} (${safeTerminalValue(crossDomainGroups.length, '0')} cross-domain)`,
    `Truncated      ${document.truncated ? 'Yes' : 'No'}`,
    `Group cap      ${document.certificateGroupsTruncated ? 'Reached' : 'Not reached'}`,
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
  const snapshot = terminalRecord(document.snapshot);
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
  if (Object.keys(snapshot).length) {
    lines.push(
      `Snapshot       ${snapshot.baselineCreated ? 'Baseline created' : `${safeTerminalValue(Array.isArray(snapshot.added) ? snapshot.added.length : 0, '0')} added · ${safeTerminalValue(Array.isArray(snapshot.removed) ? snapshot.removed.length : 0, '0')} removed`}`,
    );
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
    lines.push(`${safeTerminalValue(candidateDomain)}${unicodeDetail}: ${labels.join(', ') || 'Generated variant'}`);
  }
  if (!visible.length) lines.push('No candidates were generated.');
  if (candidates.length > visible.length) {
    lines.push('', `Showing ${visible.length} of ${candidates.length} candidates in terminal output; use --json or --jsonl for the complete bounded result.`);
  }
  return `${lines.join('\n')}\n`;
}

function formatTerminalPosture(document: TerminalRecord): string {
  const summary = terminalRecord(document.summary);
  const spfExpansion = terminalRecord(document.spfExpansion);
  const selectors = Array.isArray(document.dkimSelectors) ? document.dkimSelectors : [];
  const checks = Array.isArray(document.checks) ? document.checks : [];
  const dependencies = Array.isArray(document.externalDependencies) ? document.externalDependencies : [];
  const dmarcAuthorizations = Array.isArray(document.dmarcAuthorizations) ? document.dmarcAuthorizations : [];
  const lines = [
    `Domain         ${safeTerminalValue(document.domain)}`,
    `Checked        ${safeTerminalValue(document.checkedAt)}`,
    `DKIM selectors ${selectors.length ? selectors.map((value: unknown) => safeTerminalValue(value)).join(', ') : 'None supplied'}`,
    `Summary        ${safeTerminalValue(summary.danger, '0')} action · ${safeTerminalValue(summary.warning, '0')} review · ${safeTerminalValue(summary.pass, '0')} pass · ${safeTerminalValue(summary.info, '0')} info`,
    ...(Object.keys(spfExpansion).length ? [
      `SPF expansion  ${safeTerminalValue(spfExpansion.state)} · ${safeTerminalValue(spfExpansion.lookupsUsed, '0')}/${safeTerminalValue(spfExpansion.lookupLimit, '0')} policy queries · ${safeTerminalValue(spfExpansion.dnsLookupTerms, '0')} DNS terms`,
    ] : []),
    `Dependencies   ${dependencies.length} observed · ${dmarcAuthorizations.length} DMARC reporting destination${dmarcAuthorizations.length === 1 ? '' : 's'} checked`,
    '',
  ];
  for (const value of checks) {
    const item = terminalRecord(value);
    lines.push(`[${safeTerminalValue(item.status, 'info').toUpperCase()}] ${safeTerminalValue(item.label)}: ${safeTerminalValue(item.summary)}`);
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
    `Assessment     ${titleCase(document.assessment ?? document.activityStatus)}`,
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
  appendDeliveryMetadataLines(lines, response.deliveryMetadata, true);
  const bodyHash = terminalRecord(response.bodyHash);
  if (bodyHash.value) {
    lines.push(`Body hash      ${safeTerminalValue(`${bodyHash.algorithm}:${bodyHash.value} (${bodyHash.scope})`)}`);
  }
  for (const value of attempts) {
    const attempt = terminalRecord(value);
    const outcome = attempt.httpStatus ? `HTTP ${attempt.httpStatus}` : attempt.error || attempt.outcome;
    lines.push(`Attempt        ${safeTerminalValue(attempt.url)}: ${safeTerminalValue(outcome)}`);
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
    lines.push(`Finding        ${safeTerminalValue(finding.label)}: ${safeTerminalValue(finding.detail)}`);
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
    lines.push('Neither source published a comparable normalised field.');
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
      lines.push('Neither RDAP publication exposed a comparable normalised field.');
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
  const comparison = terminalRecord(document.modelComparison);
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
      `${String(safeTerminalValue(threshold.threshold)).padStart(3)}+  TP ${safeTerminalValue(threshold.truePositive, '0')}  FP ${safeTerminalValue(threshold.falsePositive, '0')}  TN ${safeTerminalValue(threshold.trueNegative, '0')}  FN ${safeTerminalValue(threshold.falseNegative, '0')}  precision ${safeTerminalValue(threshold.precision)}  recall ${safeTerminalValue(threshold.recall)}  F1 ${safeTerminalValue(threshold.f1)}`,
    );
  }
  if (comparison.available === true) {
    lines.push('', `Model comparison  v${safeTerminalValue(comparison.previousModelVersion)} → v${safeTerminalValue(comparison.currentModelVersion)} · ${safeTerminalValue(comparison.scoresChanged, '0')} score changes · ${safeTerminalValue(comparison.thresholdClassificationsChanged, '0')} review-band changes`);
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
  MAX_LOOKUP_TERMINAL_ALPN_IDS,
  MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH,
  MAX_LOOKUP_TERMINAL_LIMITATIONS,
  MAX_LOOKUP_TERMINAL_NAMES,
  MAX_LOOKUP_TERMINAL_RECORDS,
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
