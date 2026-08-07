import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import {
  exactKeys,
  requireBoundedString,
  requireIsoTimestamp,
  requireRecord,
} from '../lib/bounded-contract-normalizers.mts';

export const CT_EVENT_BATCH_SCHEMA = 'whoisleuth.ct-event-batch';
export const CT_EVENT_BATCH_VERSION = 1;
export const MAX_CT_EVENT_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CT_EVENTS = 500;
export const MAX_CT_EVENT_NAMES = 100;
export const MAX_CT_EXTERNAL_FINDINGS = 100;
export const MAX_CT_EXTERNAL_DOMAINS = 25;
export const MAX_CT_EXTERNAL_FINDINGS_PER_DOMAIN = 20;

const ROOT_KEYS = new Set(['schema', 'version', 'source', 'events']);
const SOURCE_KEYS = new Set(['name', 'reference', 'collectedAt']);
const EVENT_KEYS = new Set([
  'logId',
  'observedAt',
  'certificateSha256',
  'dnsNames',
  'issuer',
  'notAfter',
  'completeness',
  'limitations',
]);
const SHA256_RE = /^[a-f0-9]{64}$/u;

function eventId(logId: string, certificateSha256: string, observedAt: string): string {
  return createHash('sha256')
    .update(logId)
    .update('\u0000')
    .update(certificateSha256)
    .update('\u0000')
    .update(observedAt)
    .digest('hex');
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireBoundedString(value, label, maximum);
}

function domain(value: unknown, label: string): string {
  const supplied = requireBoundedString(value, label, 255).toLowerCase().replace(/^\*\./u, '').replace(/\.$/u, '');
  const ascii = domainToASCII(supplied).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.includes('.') || ascii.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part))) {
    throw new TypeError(`${label} must be a valid DNS name.`);
  }
  return ascii;
}

function boundedLimitations(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 8) throw new TypeError(`${label} must contain no more than 8 entries.`);
  return Object.freeze([...new Set(value.map((item, index) => requireBoundedString(item, `${label}[${index}]`, 240)))]);
}

export function buildCtEventFindings(inputRaw: unknown) {
  const input = requireRecord(inputRaw, 'Certificate event batch');
  if (input.schema !== CT_EVENT_BATCH_SCHEMA || input.version !== CT_EVENT_BATCH_VERSION) {
    throw new TypeError(`Certificate event input must use ${CT_EVENT_BATCH_SCHEMA} version ${CT_EVENT_BATCH_VERSION}.`);
  }
  exactKeys(input, ROOT_KEYS, 'Certificate event batch');
  const sourceInput = requireRecord(input.source, 'source');
  exactKeys(sourceInput, SOURCE_KEYS, 'source');
  const source = Object.freeze({
    name: requireBoundedString(sourceInput.name, 'source.name', 80),
    reference: optionalText(sourceInput.reference, 'source.reference', 500),
    collectedAt: sourceInput.collectedAt === null || sourceInput.collectedAt === undefined
      ? null
      : requireIsoTimestamp(sourceInput.collectedAt, 'source.collectedAt'),
  });
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_CT_EVENTS) {
    throw new TypeError(`events must contain between 1 and ${MAX_CT_EVENTS} entries.`);
  }
  const candidates = input.events.flatMap((raw, eventIndex) => {
    const event = requireRecord(raw, `events[${eventIndex}]`);
    exactKeys(event, EVENT_KEYS, `events[${eventIndex}]`);
    const logId = requireBoundedString(event.logId, `events[${eventIndex}].logId`, 200);
    const observedAt = requireIsoTimestamp(event.observedAt, `events[${eventIndex}].observedAt`);
    const certificateSha256 = requireBoundedString(event.certificateSha256, `events[${eventIndex}].certificateSha256`, 64).toLowerCase();
    if (!SHA256_RE.test(certificateSha256)) throw new TypeError(`events[${eventIndex}].certificateSha256 must be a SHA-256 hexadecimal digest.`);
    if (!Array.isArray(event.dnsNames) || event.dnsNames.length < 1 || event.dnsNames.length > MAX_CT_EVENT_NAMES) {
      throw new TypeError(`events[${eventIndex}].dnsNames must contain between 1 and ${MAX_CT_EVENT_NAMES} entries.`);
    }
    const names = [...new Set(event.dnsNames.map((name, nameIndex) => domain(name, `events[${eventIndex}].dnsNames[${nameIndex}]`)))].sort();
    const issuer = optionalText(event.issuer, `events[${eventIndex}].issuer`, 160);
    const notAfter = event.notAfter === null || event.notAfter === undefined
      ? null
      : requireIsoTimestamp(event.notAfter, `events[${eventIndex}].notAfter`);
    const completeness = event.completeness;
    if (completeness !== 'complete' && completeness !== 'partial') {
      throw new TypeError(`events[${eventIndex}].completeness must be complete or partial.`);
    }
    const limitations = boundedLimitations(event.limitations, `events[${eventIndex}].limitations`);
    const retainedEventId = eventId(logId, certificateSha256, observedAt);
    return names.map((name) => ({
      domain: name,
      category: 'certificate' as const,
      evidenceClass: 'deployment_observation' as const,
      summary: `Supplied certificate …${certificateSha256.slice(-12)} included ${name} among ${names.length} bounded DNS name${names.length === 1 ? '' : 's'}.`,
      observedAt,
      completeness,
      limitations,
      reference: `Certificate event ${logId}`,
      structuredObservation: {
        sourceSchema: 'whoisleuth.certificate-observation-rows' as const,
        sourceVersion: 1 as const,
        field: 'certificateSha256',
        value: certificateSha256,
        issuer,
        notAfter,
        eventId: retainedEventId,
        logId,
        certificateSha256,
        dnsNameCount: names.length,
        namesComplete: completeness === 'complete',
      },
    }));
  });
  const seen = new Set<string>();
  const unique = candidates
    .sort((left, right) => left.domain.localeCompare(right.domain)
      || left.observedAt.localeCompare(right.observedAt)
      || left.structuredObservation.value.localeCompare(right.structuredObservation.value))
    .filter((item) => {
      const key = `${item.domain}\u0000${item.observedAt}\u0000${item.structuredObservation.value}\u0000${item.structuredObservation.eventId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const domainCounts = new Map<string, number>();
  const acceptedDomains = new Set<string>();
  const selected = [] as typeof unique;
  for (const finding of unique) {
    if (!acceptedDomains.has(finding.domain) && acceptedDomains.size >= MAX_CT_EXTERNAL_DOMAINS) continue;
    const domainCount = domainCounts.get(finding.domain) ?? 0;
    if (domainCount >= MAX_CT_EXTERNAL_FINDINGS_PER_DOMAIN) continue;
    acceptedDomains.add(finding.domain);
    domainCounts.set(finding.domain, domainCount + 1);
    selected.push(finding);
    if (selected.length >= MAX_CT_EXTERNAL_FINDINGS) break;
  }
  const truncated = selected.length < unique.length;
  const selectedNamesByEvent = new Map<string, number>();
  for (const finding of selected) {
    const retainedEventId = finding.structuredObservation.eventId;
    selectedNamesByEvent.set(retainedEventId, (selectedNamesByEvent.get(retainedEventId) ?? 0) + 1);
  }
  const findings = selected.map((finding) => Object.freeze({
    ...finding,
    structuredObservation: Object.freeze({
      ...finding.structuredObservation,
      namesComplete: finding.structuredObservation.namesComplete
        && selectedNamesByEvent.get(finding.structuredObservation.eventId) === finding.structuredObservation.dnsNameCount,
    }),
    limitations: Object.freeze([
      ...finding.limitations,
      'The supplied event is an observation, not proof that the certificate was served by the named domain or that the domain operator requested it.',
      ...(finding.structuredObservation.namesComplete
        && selectedNamesByEvent.get(finding.structuredObservation.eventId) !== finding.structuredObservation.dnsNameCount
        ? ['The bounded import did not retain every DNS name from this certificate event.']
        : []),
      ...(truncated ? [`The batch contained ${unique.length} unique domain observations; this import preserves the first ${MAX_CT_EXTERNAL_FINDINGS} in deterministic order.`] : []),
    ].slice(0, 8)),
  }));
  return Object.freeze({
    schema: 'whoisleuth.external-findings' as const,
    schemaVersion: 4 as const,
    source,
    findings: Object.freeze(findings),
  });
}

export function formatCtEventFindings(document: ReturnType<typeof buildCtEventFindings>): string {
  const domains = new Set(document.findings.map((finding) => finding.domain));
  const certificates = new Set(document.findings.map((finding) => finding.structuredObservation.value));
  return [
    'Certificate event intake',
    `Source        ${document.source.name}`,
    `Findings      ${document.findings.length}`,
    `Domains       ${domains.size}`,
    `Certificates  ${certificates.size}`,
    '',
    'The JSON form can be imported through the Console external-findings workflow.',
    'A certificate event is a review lead, not proof that the certificate was served or requested by the domain operator.',
    '',
  ].join('\n');
}
