// Bounded interpretation of already-collected registry and WHOIS evidence.
//
// This module performs no network work. It keeps raw source statuses alongside
// conservative lifecycle, disclosure, reconciliation, publication-quality,
// and abuse-routing summaries so a missing field never becomes a claim that
// contact data or a registration condition is absent.

import { compareRegistrySources } from './registry-comparison.mts';
import { inspectRdapCapabilities } from './rdap-capabilities.mts';

type UnknownRecord = Record<string, unknown>;
type ContactDisclosureState =
  | 'public'
  | 'privacy_proxy'
  | 'redacted'
  | 'withheld'
  | 'absent'
  | 'unavailable';
type PublicationState = 'complete' | 'partial' | 'unavailable';

export const REGISTRY_INSIGHTS_VERSION = 1;
export const MAX_REGISTRY_INSIGHT_STATUSES = 40;
export const MAX_REGISTRY_INSIGHT_ISSUES = 12;
export const MAX_REGISTRY_ABUSE_ROUTES = 8;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const PRIVACY_PROXY_RE = /(?:privacy|proxy|whoisguard|data protected|identity protect|private registration)/iu;
const REDACTED_RE = /(?:redacted|masked|not published)/iu;
const WITHHELD_RE = /(?:withheld|not disclosed|restricted disclosure)/iu;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, maximum = 320): string {
  return typeof value === 'string' && !CONTROL_RE.test(value)
    ? value.trim().slice(0, maximum)
    : '';
}

function strings(value: unknown, maximum = MAX_REGISTRY_INSIGHT_STATUSES): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, 160);
    if (normalized) unique.add(normalized);
    if (unique.size >= maximum) break;
  }
  return [...unique];
}

function normalizedStatus(value: unknown): string {
  return text(value, 160).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function sourceState(status: unknown, partial: boolean): PublicationState {
  if (partial || status === 'partial') return 'partial';
  return typeof status === 'string'
    && ['success', 'complete'].includes(status)
    ? 'complete'
    : 'unavailable';
}

function redactionBlob(parsed: UnknownRecord): string {
  const redactions = Array.isArray(parsed.redactions) ? parsed.redactions.slice(0, 50) : [];
  return redactions.map((item) => {
    const value = record(item);
    return [
      value.name,
      value.reason,
      value.method,
      value.prePath,
      value.postPath,
      value.replacementPath,
    ].map((part) => text(part, 240)).join(' ');
  }).join(' ');
}

function contactBlob(contact: unknown): string {
  const value = record(contact);
  return [
    value.name,
    value.org,
    value.email,
    value.phone,
    value.address,
    ...(Array.isArray(value.names) ? value.names.slice(0, 10) : []),
    ...(Array.isArray(value.organizations) ? value.organizations.slice(0, 10) : []),
    ...(Array.isArray(value.emails) ? value.emails.slice(0, 10) : []),
  ].map((part) => text(part, 320)).filter(Boolean).join(' ');
}

function disclosure(
  source: 'registry_rdap' | 'whois',
  parsedValue: unknown,
  status: unknown,
): { source: string; state: ContactDisclosureState; detail: string } {
  if (!isRecord(parsedValue)) {
    return {
      source,
      state: 'unavailable',
      detail: 'The source did not provide a usable normalised publication.',
    };
  }
  const parsed = record(parsedValue);
  if (parsed.contactsExcluded === true) {
    return {
      source,
      state: 'unavailable',
      detail: 'Contact fields are deliberately excluded from this portable projection, so publication disclosure remains unavailable.',
    };
  }
  const partial = source === 'whois'
    ? parsed.chainStatus === 'partial' || strings(parsed.fieldsTruncated, 20).length > 0
    : parsed.serverTruncated === true
      || parsed.entitiesTruncated === true
      || parsed.statusesTruncated === true;
  const publicationState = sourceState(status, partial);
  if (publicationState === 'unavailable') {
    return {
      source,
      state: 'unavailable',
      detail: 'The source was unavailable, skipped, unsupported, or did not return a usable publication.',
    };
  }
  const registrant = source === 'registry_rdap'
    ? contactBlob(parsed.registrant)
    : [
        parsed.registrantName,
        parsed.registrantOrg,
        parsed.registrantEmail,
        parsed.registrantPhone,
        parsed.registrantAddress,
      ].map((part) => text(part, 320)).filter(Boolean).join(' ');
  const redactions = redactionBlob(parsed);
  const combined = `${registrant} ${redactions}`.trim();
  if (WITHHELD_RE.test(combined)) {
    return { source, state: 'withheld', detail: 'The publication indicates that registrant data was withheld or not disclosed.' };
  }
  if (REDACTED_RE.test(combined) || redactions) {
    return { source, state: 'redacted', detail: 'The publication explicitly marks registrant data as redacted or removed.' };
  }
  if (PRIVACY_PROXY_RE.test(registrant)) {
    return { source, state: 'privacy_proxy', detail: 'The published registrant fields appear to identify a privacy or proxy service.' };
  }
  if (registrant) {
    return { source, state: 'public', detail: 'The source published at least one usable registrant contact field.' };
  }
  if (publicationState === 'partial') {
    return {
      source,
      state: 'unavailable',
      detail: 'The publication was partial, so missing registrant fields are not treated as evidence of absence.',
    };
  }
  return {
    source,
    state: 'absent',
    detail: 'The source completed without a usable registrant contact or an explicit disclosure marker.',
  };
}

function lifecycle(statusesValue: unknown) {
  const rawStatuses = strings(statusesValue);
  const normalized = rawStatuses.map(normalizedStatus);
  const has = (value: string) => normalized.includes(value);
  const pendingDelete = has('pendingdelete');
  const redemption = has('redemptionperiod');
  const pendingTransfer = has('pendingtransfer');
  const serverHold = has('serverhold');
  const clientHold = has('clienthold');
  const serverLocks = normalized.filter((value) => /^server(?:delete|renew|transfer|update)prohibited$/u.test(value));
  const clientLocks = normalized.filter((value) => /^client(?:delete|renew|transfer|update)prohibited$/u.test(value));

  let stage = 'registered';
  let label = 'Registered';
  let acquisitionPath = ['Continue monitoring registry status and expiry.'];
  if (pendingDelete) {
    stage = 'pending_delete';
    label = 'Pending delete';
    acquisitionPath = [
      'Confirm the status from the authoritative registry publication.',
      'Monitor for deletion without assuming a release time or successful registration.',
      'Use a registrar or registry-supported acquisition path when policy permits.',
    ];
  } else if (redemption) {
    stage = 'redemption';
    label = 'Redemption period';
    acquisitionPath = [
      'The current registrant may still be able to restore the registration.',
      'Monitor for restoration or a later pending-delete transition.',
      'Do not treat the domain as available or guaranteed to drop.',
    ];
  } else if (pendingTransfer) {
    stage = 'pending_transfer';
    label = 'Pending transfer';
    acquisitionPath = ['A registrar transfer is pending; this is not an availability signal.'];
  } else if (serverHold || clientHold) {
    stage = 'hold';
    label = 'Registration hold';
    acquisitionPath = ['A hold affects delegation or publication; it does not mean the registration is available.'];
  }

  return {
    stage,
    label,
    rawStatuses,
    redemption,
    pendingDelete,
    pendingTransfer,
    hold: { client: clientHold, server: serverHold },
    locks: {
      client: clientLocks.length > 0,
      server: serverLocks.length > 0,
      clientStatuses: clientLocks,
      serverStatuses: serverLocks,
    },
    acquisitionPath,
    limitation: 'EPP statuses describe the current registry lifecycle. They do not guarantee deletion, release timing, transfer completion, eligibility, price, or acquisition success.',
  };
}

function publicationDiagnostic(
  source: 'registry_rdap' | 'whois' | 'registrar_rdap',
  parsedValue: unknown,
  status: unknown,
  observedAt: unknown,
) {
  const usablePublication = isRecord(parsedValue);
  const parsed = record(parsedValue);
  const partial = parsed.serverTruncated === true
    || parsed.chainStatus === 'partial'
    || parsed.entitiesTruncated === true
    || parsed.statusesTruncated === true
    || strings(parsed.fieldsTruncated, 20).length > 0;
  const state = usablePublication ? sourceState(status, partial) : 'unavailable';
  const issues: string[] = [];
  if (state === 'unavailable') issues.push('No usable publication was available from this source.');
  if (parsed.serverTruncated === true) issues.push('The RDAP server declared a truncated response.');
  if (parsed.entitiesTruncated === true) issues.push('The normalised entity inventory was capped.');
  if (parsed.statusesTruncated === true) issues.push('The normalised status inventory was capped.');
  if (strings(parsed.fieldsTruncated, 20).length) issues.push('One or more normalised WHOIS fields were capped.');
  if (parsed.chainStatus === 'partial') issues.push('The WHOIS referral chain was incomplete or conflicting.');
  const conformance = strings(parsed.conformance, 30);
  const redactions = Array.isArray(parsed.redactions) ? parsed.redactions.slice(0, 50) : [];
  return {
    source,
    state,
    observedAt: text(observedAt, 64) || null,
    conformance,
    redactionCount: redactions.length,
    issueCount: Math.min(issues.length, MAX_REGISTRY_INSIGHT_ISSUES),
    issues: issues.slice(0, MAX_REGISTRY_INSIGHT_ISSUES),
  };
}

function contactRoute(
  kind: 'registry' | 'registrar',
  contact: unknown,
  source: string,
): Array<{ kind: string; contact: string; channel: 'email' | 'phone'; source: string; limitations: string[] }> {
  const value = record(contact);
  return [
    { channel: 'email' as const, contact: text(value.email, 320) },
    { channel: 'phone' as const, contact: text(value.phone, 80) },
  ].filter((item) => item.contact).map((item) => ({
    kind,
    contact: item.contact,
    channel: item.channel,
    source,
    limitations: [
      'A published contact does not prove that the destination is monitored, appropriate for the incident, or responsible for the observed content.',
    ],
  }));
}

export function buildRegistryInsights(input: {
  rdapParsed?: unknown;
  rdapStatus?: unknown;
  rdapFetchedAt?: unknown;
  whoisParsed?: unknown;
  whoisStatus?: unknown;
  whoisQueriedAt?: unknown;
  registrarRdapParsed?: unknown;
  registrarRdapStatus?: unknown;
  registrarRdapFetchedAt?: unknown;
}) {
  const rdap = record(input.rdapParsed);
  const whois = record(input.whoisParsed);
  const registrarRdap = record(input.registrarRdapParsed);
  const comparison = compareRegistrySources(rdap, whois, {
    rdapStatus: input.rdapStatus,
    whoisStatus: input.whoisStatus,
  });
  const counts = comparison.counts;
  const conflictCount = counts.conflict;
  const sourceOnlyCount = counts.rdap_only + counts.whois_only;
  const redactedCount = counts.rdap_redacted + counts.whois_redacted;
  const unavailableCount = counts.rdap_unavailable
    + counts.whois_unavailable
    + counts.rdap_incomplete
    + counts.whois_incomplete;
  const reconciliationState = conflictCount
    ? 'conflict'
    : unavailableCount
      ? 'partial'
      : sourceOnlyCount || redactedCount
        ? 'source_specific'
        : counts.equivalent
          ? 'consistent'
          : 'unavailable';
  const statuses = strings(rdap.statuses).length ? rdap.statuses : whois.statuses;
  const routes = [
    ...contactRoute('registry', rdap.abuse, 'Registry RDAP abuse entity'),
    ...contactRoute('registrar', rdap.registrar, 'Registry RDAP registrar entity'),
    ...contactRoute('registrar', registrarRdap.abuse, 'Registrar RDAP abuse entity'),
    ...contactRoute('registrar', registrarRdap.registrar, 'Registrar RDAP registrar entity'),
    ...contactRoute('registrar', { email: whois.abuseEmail, phone: whois.abusePhone }, 'WHOIS registrar abuse fields'),
  ];
  const uniqueRoutes = new Map<string, typeof routes[number]>();
  for (const route of routes) {
    const key = `${route.kind}\u0000${route.channel}\u0000${route.contact.toLowerCase()}`;
    if (!uniqueRoutes.has(key)) uniqueRoutes.set(key, route);
    if (uniqueRoutes.size >= MAX_REGISTRY_ABUSE_ROUTES) break;
  }

  return {
    version: REGISTRY_INSIGHTS_VERSION,
    contactDisclosure: {
      registryRdap: disclosure('registry_rdap', input.rdapParsed, input.rdapStatus),
      whois: disclosure('whois', input.whoisParsed, input.whoisStatus),
      limitation: 'Disclosure state describes what each point-in-time source published. It does not infer the identity, intent, reachability, or legal status of a registrant.',
    },
    lifecycle: lifecycle(statuses),
    reconciliation: {
      state: reconciliationState,
      conflictCount,
      equivalentCount: counts.equivalent,
      sourceOnlyCount,
      redactedCount,
      unavailableCount,
      summary: conflictCount
        ? `${conflictCount} normalized registry conflict${conflictCount === 1 ? '' : 's'} require source review.`
        : unavailableCount
          ? 'The comparison is partial because at least one publication was unavailable or incomplete.'
          : sourceOnlyCount || redactedCount
            ? 'The sources differ in publication or disclosure without a normalised conflict.'
            : counts.equivalent
              ? 'The comparable fields are normalised as equivalent.'
              : 'No comparable fields were available.',
    },
    publications: [
      publicationDiagnostic('registry_rdap', input.rdapParsed, input.rdapStatus, input.rdapFetchedAt),
      publicationDiagnostic('whois', input.whoisParsed, input.whoisStatus, input.whoisQueriedAt),
      publicationDiagnostic('registrar_rdap', input.registrarRdapParsed, input.registrarRdapStatus, input.registrarRdapFetchedAt),
    ],
    rdapCapabilities: {
      registry: inspectRdapCapabilities(input.rdapParsed, input.rdapStatus),
      registrar: inspectRdapCapabilities(input.registrarRdapParsed, input.registrarRdapStatus),
    },
    abuseRouting: [...uniqueRoutes.values()],
  };
}
