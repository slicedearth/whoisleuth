import type { LookupHttpResponse } from './lookup-response.ts';
import {
  datedRow,
  formatDate,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  type JsonRecord,
  type PublicationComparison,
  type RegistryComparison,
  type SourceStatus,
} from './lookup-display-shared.ts';

function assessment(status: string): string {
  return (
    {
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
    } as Record<string, string>
  )[status] || status;
}

function publicationAssessment(status: string): string {
  return (
    {
      equivalent: 'Equivalent',
      conflict: 'Conflict',
      registry_only: 'Registry only',
      registrar_only: 'Registrar only',
      registry_redacted: 'Registry redacted',
      registrar_redacted: 'Registrar redacted',
      registry_unavailable: 'Registry unavailable',
      registrar_unavailable: 'Registrar unavailable',
      registry_incomplete: 'Registry incomplete',
      registrar_incomplete: 'Registrar incomplete',
    } as Record<string, string>
  )[status] || status;
}

function diagnosticLabel(source: SourceStatus): string {
  return source.status ? statusLabel(source.status) : 'unknown';
}

function attemptSummary(source: SourceStatus): string | null {
  return Array.isArray(source.attempts) && source.attempts.length
    ? `attempts: ${source.attempts
        .map((item) => statusLabel(String(item.outcome || 'unknown')))
        .join(' → ')}`
    : null;
}

function diagnosticDetail(source: SourceStatus): string {
  return (
    [
      source.endpoint,
      source.transportSecurity === 'http' ? 'transport: cleartext HTTP' : null,
      source.httpStatus ? `HTTP ${source.httpStatus}` : null,
      attemptSummary(source),
      source.resultState ? `result: ${source.resultState}` : null,
      source.errorCode,
      source.authoritativeHop ? `authoritative: ${show(source.authoritativeHop)}` : null,
      source.failedHop ? `failed: ${show(source.failedHop)}` : null,
      source.fetchedAt ? `fetched ${formatDate(source.fetchedAt)}` : null,
      source.queriedAt ? `queried ${formatDate(source.queriedAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'No additional source detail'
  );
}

function contactIdentity(contact: JsonRecord): string {
  return show(contact.name || contact.org || contact.handle);
}

function contactDetails(contact: JsonRecord): string[] {
  return [
    Array.isArray(contact.organizations) && contact.organizations.length
      ? `Organizations: ${contact.organizations.join(', ')}`
      : null,
    Array.isArray(contact.emails) && contact.emails.length
      ? `Email: ${contact.emails.join(', ')}`
      : null,
    Array.isArray(contact.phones) && contact.phones.length
      ? `Phone: ${contact.phones.join(', ')}`
      : null,
    Array.isArray(contact.addresses) && contact.addresses.length
      ? `Address: ${contact.addresses.join(' · ')}`
      : null,
    records(contact.publicIds).length
      ? `IDs: ${records(contact.publicIds)
          .map((item) => `${item.type}: ${item.identifier}`)
          .join(', ')}`
      : null,
    records(contact.links).length
      ? `Links: ${records(contact.links)
          .map((item) => item.href)
          .join(', ')}`
      : null,
  ].filter(Boolean) as string[];
}

export function buildLookupRegistryDisplay(input: {
  result: LookupHttpResponse | null;
  rdapParsed: JsonRecord;
  whoisParsed: JsonRecord;
  whoisContactsByRole: JsonRecord;
  populatedWhoisRoles: string[];
  comparison: RegistryComparison;
  registrarRdap: SourceStatus;
  registrarRdapParsed: JsonRecord;
  registrarPublicationComparison: PublicationComparison;
}) {
  const {
    result,
    rdapParsed,
    whoisParsed,
    whoisContactsByRole,
    populatedWhoisRoles,
    comparison,
    registrarRdap,
    registrarRdapParsed,
    registrarPublicationComparison,
  } = input;
  const matrixState = (sourceState: string | undefined, comparisonStatus: string): string => {
    if (sourceState === 'value') {
      if (comparisonStatus === 'equivalent') return 'equal';
      if (comparisonStatus === 'conflict') return 'conflict';
      return 'observed';
    }
    if (sourceState === 'redacted' || sourceState === 'incomplete') return 'partial';
    if (sourceState === 'unavailable') return 'unavailable';
    if (sourceState === 'absent') return 'not_collected';
    return comparisonStatus;
  };
  const comparisonRows = comparison.fields.map((field) => ({
    label: field.label,
    rdapValue: field.rdapDisplay,
    whoisValue: field.whoisDisplay,
    status: field.status,
    rdapMatrixState: matrixState(field.rdapState, field.status),
    whoisMatrixState: matrixState(field.whoisState, field.status),
    assessment: assessment(field.status),
    tone:
      field.status === 'conflict'
        ? 'danger'
        : field.status === 'equivalent'
          ? 'good'
          : ['rdap_unavailable', 'whois_unavailable', 'rdap_incomplete', 'whois_incomplete'].includes(
                field.status,
              )
            ? 'warn'
            : '',
  }));
  const publicationRows = registrarPublicationComparison.fields.map((field) => ({
    label: field.label,
    registryValue: field.registryDisplay,
    registrarValue: field.registrarDisplay,
    status: field.status,
    registryMatrixState: matrixState(field.registryState, field.status),
    registrarMatrixState: matrixState(field.registrarState, field.status),
    assessment: publicationAssessment(field.status),
    tone:
      field.status === 'conflict'
        ? 'danger'
        : field.status === 'equivalent'
          ? 'good'
          : [
                'registry_unavailable',
                'registrar_unavailable',
                'registry_incomplete',
                'registrar_incomplete',
              ].includes(field.status)
            ? 'warn'
            : '',
  }));
  const rows: Array<{ label: string; value: string; datetime?: string }> = [];
  if (result?.type === 'ipv4' || result?.type === 'ipv6') {
    rows.push(
      { label: 'Handle', value: show(rdapParsed.handle) },
      { label: 'Name', value: show(rdapParsed.name) },
      {
        label: 'Range',
        value: `${show(rdapParsed.startAddress)} – ${show(rdapParsed.endAddress)}`,
      },
      {
        label: 'CIDRs',
        value: `${show(rdapParsed.cidrs)}${rdapParsed.cidrsTruncated ? ' (capped)' : ''}`,
      },
      { label: 'Country', value: show(rdapParsed.country) },
      { label: 'Type', value: show(rdapParsed.networkType) },
      {
        label: 'Status',
        value: `${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated ? ' (capped)' : ''}`,
      },
      datedRow('Registered', rec(rdapParsed.lifecycle).createdDate),
      datedRow('Updated', rec(rdapParsed.lifecycle).updatedDate),
    );
  } else if (result?.type === 'asn') {
    rows.push(
      { label: 'Handle', value: show(rdapParsed.handle) },
      { label: 'Name', value: show(rdapParsed.name) },
      {
        label: 'AS range',
        value: `${show(rdapParsed.startAutnum)} – ${show(rdapParsed.endAutnum)}`,
      },
      { label: 'Country', value: show(rdapParsed.country) },
      { label: 'Type', value: show(rdapParsed.autnumType) },
      {
        label: 'Status',
        value: `${show(rdapParsed.statuses)}${rdapParsed.statusesTruncated ? ' (capped)' : ''}`,
      },
      datedRow('Registered', rec(rdapParsed.lifecycle).createdDate),
      datedRow('Updated', rec(rdapParsed.lifecycle).updatedDate),
    );
  }
  rows.push(
    { label: 'Object class', value: show(rdapParsed.objectClassName) },
    { label: 'Language', value: show(rdapParsed.language) },
    {
      label: 'Conformance',
      value: `${show(rdapParsed.conformance)}${rdapParsed.conformanceTruncated ? ' (capped)' : ''}`,
    },
    {
      label: 'Lifecycle events',
      value: `${Array.isArray(rdapParsed.events) ? rdapParsed.events.length : 0}${
        rdapParsed.eventsTruncated ? ' (capped)' : ''
      }`,
    },
    {
      label: 'RDAP database updated',
      value: formatDate(rec(rdapParsed.lifecycle).databaseUpdatedDate),
    },
    { label: 'Port 43', value: show(rdapParsed.port43) },
    { label: 'Parent handle', value: show(rdapParsed.parentHandle) },
  );

  return {
    comparisonRows,
    rdapPartialDetail: rdapParsed.serverTruncated
      ? `The registry reported that some RDAP data was omitted.${
          stringList(rdapParsed.serverTruncationReasons).length
            ? ` ${stringList(rdapParsed.serverTruncationReasons).join(' · ')}.`
            : ''
        }`
      : '',
    rdapRows: rows,
    whoisRows: [
      { label: 'Domain', value: show(whoisParsed.domainName) },
      { label: 'Registry ID', value: show(whoisParsed.registryDomainId) },
      { label: 'Registrar', value: show(whoisParsed.registrar) },
      { label: 'Registrar ID', value: show(whoisParsed.registrarIanaId) },
      { label: 'Registrar WHOIS', value: show(whoisParsed.registrarWhoisServer) },
      { label: 'Reseller', value: show(whoisParsed.reseller) },
      { label: 'Created', value: formatDate(rec(whoisParsed.lifecycle).createdDate) },
      { label: 'Expires', value: formatDate(rec(whoisParsed.lifecycle).expiryDate) },
      { label: 'Updated', value: formatDate(rec(whoisParsed.lifecycle).updatedDate) },
      { label: 'DNSSEC', value: show(whoisParsed.dnssec) },
      { label: 'Status', value: show(whoisParsed.statuses) },
      { label: 'Nameservers', value: show(whoisParsed.nameservers) },
      { label: 'Chain', value: show(whoisParsed.chainStatus) },
    ],
    whoisContactRoles: populatedWhoisRoles.map((role) => ({
      role,
      contacts: records(whoisContactsByRole[role]).map((contact) => ({
        identity: contactIdentity(contact),
        details: contactDetails(contact),
      })),
    })),
    registrarRdap: {
      visible: Boolean(registrarRdap.status),
      label: diagnosticLabel(registrarRdap),
      endpoint: registrarRdap.endpoint ? String(registrarRdap.endpoint) : '',
      detail: [
        registrarRdap.upstreamStatus ? `HTTP ${registrarRdap.upstreamStatus}` : null,
        registrarRdap.fetchedAt ? `Fetched ${formatDate(registrarRdap.fetchedAt)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      stateDetail: show(registrarRdap.detail),
      error: registrarRdap.status === 'error',
      success: registrarRdap.status === 'success',
      parsed: registrarRdapParsed,
      comparisonSummary: `Registry / registrar publication comparison · ${registrarPublicationComparison.counts.conflict} conflicts · ${
        registrarPublicationComparison.counts.registry_only +
        registrarPublicationComparison.counts.registrar_only
      } source-only · ${
        registrarPublicationComparison.counts.registry_redacted +
        registrarPublicationComparison.counts.registrar_redacted
      } redacted · ${
        registrarPublicationComparison.counts.registry_unavailable +
        registrarPublicationComparison.counts.registrar_unavailable +
        registrarPublicationComparison.counts.registry_incomplete +
        registrarPublicationComparison.counts.registrar_incomplete
      } unavailable/incomplete · ${registrarPublicationComparison.counts.equivalent} equivalent`,
      comparisonRows: publicationRows,
    },
    diagnosticLabel,
    diagnosticDetail,
  };
}
