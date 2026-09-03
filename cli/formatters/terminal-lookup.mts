import { registryAccessProfileLabel } from '../registry-access.mts';
import {
  technologyEvidenceRoles,
  type TechnologyEvidenceRole,
} from '../../lib/technology-evidence-role.mts';
import { appendDeliveryMetadataLines, appendPublicationMetadataLines } from './terminal-metadata.mts';
import {
  appendSection,
  boundedTerminalComponent,
  boundedTerminalList,
  boundedTerminalWithSuffix,
  MAX_TLS_TERMINAL_ALT_NAMES,
  MAX_TLS_TERMINAL_PURPOSES,
  safeTerminalValue,
  terminalCount,
  terminalCountSummary,
  terminalDisplayCount,
  terminalRecord,
  titleCase,
} from './terminal-shared.mts';
import type { TerminalRecord } from './terminal-shared.mts';

const MAX_LOOKUP_TERMINAL_RECORDS = 5;
const MAX_LOOKUP_TERMINAL_NAMES = 5;
const MAX_LOOKUP_TERMINAL_ALPN_IDS = 4;
const MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH = 32;
const MAX_LOOKUP_TERMINAL_LIMITATIONS = 3;
const MAX_LOOKUP_TERMINAL_CIDRS = 5;
const MAX_LOOKUP_TERMINAL_FINDINGS = 5;
const MAX_LOOKUP_TERMINAL_ABUSE_ROUTES = 6;

type LookupTerminalDetail = 'summary' | 'standard' | 'verbose';

function terminalTechnologyRoleNames(findings: unknown[], role: TechnologyEvidenceRole): string {
  const names = findings
    .filter((finding) => technologyEvidenceRoles(finding).includes(role))
    .slice(0, 6)
    .map((finding) => safeTerminalValue(terminalRecord(finding).name, 'Unnamed indicator'));
  return names.length ? boundedTerminalList(names, Math.max(0, findings.filter((finding) => technologyEvidenceRoles(finding).includes(role)).length - names.length)) : 'None retained';
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

function registrarComplianceSummary(compliance: TerminalRecord, actionCount: number): string {
  const health = titleCase(compliance.sourceHealth);
  const year = safeTerminalValue(compliance.catalogueYear || 'current-year');
  if (compliance.state === 'matching_actions') {
    return `${actionCount} matching ${year} action${actionCount === 1 ? '' : 's'} · source ${health}`;
  }
  if (compliance.state === 'reviewed_no_match') return `No matching ${year} action · source ${health}`;
  if (compliance.state === 'not_applicable') return `Not assessed without one registrar IANA ID · source ${health}`;
  if (compliance.state === 'stale') return `No matching action retained · source ${health}`;
  return `${titleCase(compliance.state)} · source ${health}`;
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

function certificateWarningVerdict(value: TerminalRecord): string {
  if (value.verdict === 'listed') return 'Listed certificate review lead';
  if (value.verdict === 'not_listed' && value.status === 'success' && value.complete === true) {
    return 'No match in retained snapshot';
  }
  return 'Inconclusive';
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
  const registrarStanding = terminalRecord(document.registrarStanding);
  if (registrarStanding.version === 1) {
    const accreditation = terminalRecord(registrarStanding.accreditation);
    const compliance = terminalRecord(registrarStanding.compliance);
    const assessment = terminalRecord(registrarStanding.assessment);
    const actions = Array.isArray(compliance.actions)
      ? compliance.actions.map(terminalRecord).slice(0, 5)
      : [];
    registrationLines.push(`Registrar standing ${safeTerminalValue(assessment.label || assessment.state || 'Unavailable')}`);
    if (detail !== 'summary') {
      registrationLines.push(`Registrar ID   ${safeTerminalValue(registrarStanding.ianaId || 'Unavailable')}`);
      registrationLines.push(`Accreditation  ${titleCase(accreditation.state)} · source ${titleCase(accreditation.sourceHealth)}`);
      registrationLines.push(`Compliance     ${registrarComplianceSummary(compliance, actions.length)}`);
      for (const action of actions) {
        registrationLines.push(`Official notice ${titleCase(action.type)} · ${safeTerminalValue(action.issuedOn)}`);
        if (action.sourceUrl) registrationLines.push(`Notice source  ${safeTerminalValue(action.sourceUrl)}`);
      }
      if (assessment.detail) registrationLines.push(`Standing detail ${safeTerminalValue(assessment.detail)}`);
      registrationLines.push('Standing scope Provider standing is context, not a classification of this domain.');
    }
  }

  const dnsLines: string[] = [];
  const mailLines: string[] = [];
  const tlsLines: string[] = [];
  const certificateWarningLines: string[] = [];
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

    const sslbl = terminalRecord(document.sslbl);
    if (Object.keys(sslbl).length) {
      certificateWarningLines.push('Source         Local SSLBL certificate snapshot');
      certificateWarningLines.push(`Evidence       ${titleCase(sslbl.status)}`);
      certificateWarningLines.push(`Result         ${certificateWarningVerdict(sslbl)}`);
      const completeness = sourceCompleteness(sslbl);
      if (completeness) certificateWarningLines.push(`Completeness   ${completeness}`);
      certificateWarningLines.push('Interpretation Review lead only; not a maliciousness verdict');
      if (detail !== 'summary' && sslbl.observedAt) certificateWarningLines.push(`Observed       ${safeTerminalValue(sslbl.observedAt)}`);
      if (detail === 'verbose') {
        const snapshot = terminalRecord(sslbl.snapshot);
        if (snapshot.sourceUpdatedAt) certificateWarningLines.push(`Snapshot date  ${safeTerminalValue(snapshot.sourceUpdatedAt)}`);
        if (sslbl.fingerprintSha1) certificateWarningLines.push(`SHA-1          ${safeTerminalValue(sslbl.fingerprintSha1)}`);
        if (sslbl.detail) certificateWarningLines.push(`Detail         ${safeTerminalValue(sslbl.detail)}`);
        if (Array.isArray(sslbl.limitations)) {
          for (const limitation of sslbl.limitations.slice(0, MAX_LOOKUP_TERMINAL_LIMITATIONS)) {
            certificateWarningLines.push(`Limitation     ${safeTerminalValue(limitation)}`);
          }
          const omitted = Math.max(0, sslbl.limitations.length - MAX_LOOKUP_TERMINAL_LIMITATIONS);
          if (omitted) certificateWarningLines.push(`Limitation     +${omitted} more retained limitation${omitted === 1 ? '' : 's'}`);
        }
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
        websiteLines.push(`Nameservers   ${nameservers.length ? boundedTerminalList(nameservers, Math.max(0, (availability.nameservers as unknown[]).length - nameservers.length)) : 'Unavailable'} · identity does not establish operator or web-host ownership`);
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
        websiteLines.push(`Primary role   ${safeTerminalValue(primary.label, 'Unclassified')} · ${titleCase(primary.confidence)} indicator strength`);
      }
      if (positiveSourceStatus(pageRole.status) && detail === 'verbose') {
        const findings = boundedFindingLabels(roleFindings, (finding) => `${safeTerminalValue(finding.label, 'Unclassified')} (${titleCase(finding.confidence)} indicator strength)`);
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
  appendSection(lines, 'Certificate warning data', certificateWarningLines);
  appendSection(lines, 'Network', networkLines);
  appendSection(lines, 'Source health', sourceHealthLines);
  appendSection(lines, 'Collection', collectionLines);
  return `${lines.join('\n')}\n`;
}

export {
  MAX_LOOKUP_TERMINAL_ALPN_IDS,
  MAX_LOOKUP_TERMINAL_ALPN_ID_LENGTH,
  MAX_LOOKUP_TERMINAL_LIMITATIONS,
  MAX_LOOKUP_TERMINAL_NAMES,
  MAX_LOOKUP_TERMINAL_RECORDS,
  formatTerminalLookup,
};
