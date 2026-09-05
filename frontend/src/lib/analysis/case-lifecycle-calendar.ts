import type { CaseRecord } from './case-model.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { caseNumber, caseTypeSummary } from '../../../../packages/cases/case-workflow-metadata.mts';

export const CASE_LIFECYCLE_CALENDAR_SCHEMA = 'whoisleuth.case-review-calendar';
export const MAX_CASE_LIFECYCLE_EVENTS = 500;
export const MAX_CASE_LIFECYCLE_SOURCE_CASES = 500;

export type CaseLifecycleCalendarKind = 'action_due' | 'action_follow_up' | 'observed_effect_follow_up' | 'certificate_expiry_review' | 'disclosure_expiry_review' | 'domain_expiry_review';
export type CaseLifecycleCalendarSource = 'case_action' | 'observed_effect_review' | 'evidence_history' | 'evidence_pin';

export type CaseLifecycleCalendarEvent = Readonly<{
  uid: string;
  caseId: string;
  caseReference: string;
  domain: string;
  recipient: string | null;
  classification: string | null;
  kind: CaseLifecycleCalendarKind;
  source: CaseLifecycleCalendarSource;
  sourceLabel: string;
  startsAt: string;
  summary: string;
  description: string;
}>;

export type CaseLifecycleCalendarDisclosure = Readonly<{
  includeDomain?: boolean;
  includeRecipient?: boolean;
  includeContext?: boolean;
}>;

export type CaseLifecycleCalendarQuery = Readonly<{ kind?: unknown; window?: unknown }>;
export type CaseLifecycleCalendarProjection = Readonly<{
  events: readonly CaseLifecycleCalendarEvent[];
  matchingCount: number;
  omittedCount: number;
  sourceCasesOmitted: number;
}>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

function escapeCalendarText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function calendarDate(value: string): string {
  return value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldLine(value: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let byteLimit = 75;
  for (const character of value) {
    if (current && encoder.encode(`${current}${character}`).byteLength > byteLimit) {
      parts.push(current);
      current = character;
      byteLimit = 74;
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part, index) => index === 0 ? part : ` ${part}`).join('\r\n');
}

const EVENT_LABELS: Readonly<Record<CaseLifecycleCalendarKind, string>> = Object.freeze({
  action_due: 'Case action due',
  action_follow_up: 'Case action follow-up',
  observed_effect_follow_up: 'Independent effect review',
  certificate_expiry_review: 'Certificate evidence review',
  disclosure_expiry_review: 'Disclosure evidence review',
  domain_expiry_review: 'Domain expiry evidence review',
});

function collectCaseLifecycleEvents(records: readonly CaseRecord[]): CaseLifecycleCalendarEvent[] {
  const events: CaseLifecycleCalendarEvent[] = [];
  for (const record of records.slice(0, MAX_CASE_LIFECYCLE_SOURCE_CASES)) {
    const caseContext = {
      caseReference: caseNumber(record.id),
      domain: record.domain,
      classification: caseTypeSummary(record.tags) || null,
    };
    for (const action of record.actions.slice(-50)) {
      const dueAt = timestamp(action.dueAt);
      const followUpAt = timestamp(action.followUpAt);
      if (dueAt) {
        events.push({
          uid: `${record.id}-${action.id}-due`,
          caseId: record.id,
          ...caseContext,
          recipient: action.recipient,
          kind: 'action_due',
          source: 'case_action',
          sourceLabel: 'Saved case action',
          startsAt: dueAt,
          summary: `Review ${action.type.replaceAll('_', ' ')} for ${record.domain}`,
          description: `Case action state: ${action.state}. Open the browser-local case to review the recorded recipient and evidence.`,
        });
      }
      if (followUpAt && followUpAt !== dueAt) {
        events.push({
          uid: `${record.id}-${action.id}-follow-up`,
          caseId: record.id,
          ...caseContext,
          recipient: action.recipient,
          kind: 'action_follow_up',
          source: 'case_action',
          sourceLabel: 'Saved case action',
          startsAt: followUpAt,
          summary: `Follow up ${action.type.replaceAll('_', ' ')} for ${record.domain}`,
          description: `Case action state: ${action.state}. Open the browser-local case before contacting any recipient.`,
        });
      }
    }
    for (const review of (record.observedEffects?.reviews ?? []).slice(-40)) {
      const followUpAt = timestamp(review.followUpAt);
      if (!followUpAt) continue;
      events.push({
        uid: `${record.id}-${review.id}-effect-follow-up`,
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'observed_effect_follow_up',
        source: 'observed_effect_review',
        sourceLabel: 'Independent observed-effect review',
        startsAt: followUpAt,
        summary: `Review independently observed effect for ${record.domain}`,
        description: `The prior independent review state was ${review.state}. Open the browser-local case and deliberately decide whether to collect or attach new evidence; this calendar event performs no request.`,
      });
    }
    const expiry = timestamp(record.evidenceHistory.at(-1)?.expiryDate);
    if (expiry) {
      events.push({
        uid: `${record.id}-${expiry.slice(0, 10)}-expiry-review`,
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'domain_expiry_review',
        source: 'evidence_history',
        sourceLabel: 'Latest retained domain evidence',
        startsAt: addDays(expiry, -30),
        summary: `Review observed expiry evidence for ${record.domain}`,
        description: 'The retained expiry date is point-in-time evidence, not a guarantee of deletion, availability, release, or acquisition eligibility.',
      });
    }
    const latestPins = new Map<string, typeof record.evidencePins[number]>();
    for (const pin of record.evidencePins) {
      if (pin.field === 'tls.valid_to' || pin.field === 'disclosure.security_txt_expires') {
        latestPins.set(pin.field, pin);
      }
    }
    const certificateExpiry = timestamp(latestPins.get('tls.valid_to')?.value);
    if (certificateExpiry) {
      events.push({
        uid: `${record.id}-${certificateExpiry.slice(0, 10)}-certificate-review`,
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'certificate_expiry_review',
        source: 'evidence_pin',
        sourceLabel: 'Analyst-selected TLS evidence pin',
        startsAt: addDays(certificateExpiry, -30),
        summary: `Review retained certificate expiry for ${record.domain}`,
        description: 'This date came from an analyst-selected TLS evidence pin. Recollect before interpreting current certificate state.',
      });
    }
    const disclosureExpiry = timestamp(latestPins.get('disclosure.security_txt_expires')?.value);
    if (disclosureExpiry) {
      events.push({
        uid: `${record.id}-${disclosureExpiry.slice(0, 10)}-disclosure-review`,
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'disclosure_expiry_review',
        source: 'evidence_pin',
        sourceLabel: 'Analyst-selected disclosure evidence pin',
        startsAt: addDays(disclosureExpiry, -14),
        summary: `Review retained security.txt expiry for ${record.domain}`,
        description: 'This date came from an analyst-selected disclosure evidence pin. Publication and contact reachability must be reviewed again.',
      });
    }
  }
  return events
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || compareCodeUnits(left.uid, right.uid));
}

function lifecycleEventPredicate(
  options: CaseLifecycleCalendarQuery,
  now: unknown = new Date().toISOString(),
): (event: CaseLifecycleCalendarEvent) => boolean {
  const kinds = new Set<CaseLifecycleCalendarKind>([
    'action_due',
    'action_follow_up',
    'observed_effect_follow_up',
    'certificate_expiry_review',
    'disclosure_expiry_review',
    'domain_expiry_review',
  ]);
  const kind = typeof options.kind === 'string' && kinds.has(options.kind as CaseLifecycleCalendarKind)
    ? options.kind as CaseLifecycleCalendarKind
    : 'all';
  const window = typeof options.window === 'string' && ['all', 'overdue', '30d', '90d', 'future'].includes(options.window)
    ? options.window
    : 'future';
  const nowAt = timestamp(now) || new Date(0).toISOString();
  const nowMs = Date.parse(nowAt);
  const maximum = window === '30d'
    ? nowMs + 30 * 86_400_000
    : window === '90d'
      ? nowMs + 90 * 86_400_000
      : Number.POSITIVE_INFINITY;
  return (event) => {
    if (kind !== 'all' && event.kind !== kind) return false;
    const startsAt = Date.parse(event.startsAt);
    if (window === 'overdue') return startsAt < nowMs;
    if (window === 'future') return startsAt >= nowMs;
    if (window === '30d' || window === '90d') return startsAt >= nowMs && startsAt <= maximum;
    return true;
  };
}

export function projectCaseLifecycleEvents(
  records: readonly CaseRecord[],
  options: CaseLifecycleCalendarQuery = {},
  now: unknown = new Date().toISOString(),
): CaseLifecycleCalendarProjection {
  const matching = collectCaseLifecycleEvents(records).filter(lifecycleEventPredicate(options, now));
  const events = matching.slice(0, MAX_CASE_LIFECYCLE_EVENTS);
  return Object.freeze({
    events: Object.freeze(events),
    matchingCount: matching.length,
    omittedCount: matching.length - events.length,
    sourceCasesOmitted: Math.max(0, records.length - MAX_CASE_LIFECYCLE_SOURCE_CASES),
  });
}

export function buildCaseLifecycleEvents(records: readonly CaseRecord[]): CaseLifecycleCalendarEvent[] {
  return [...projectCaseLifecycleEvents(records, { window: 'all' }, new Date(0).toISOString()).events];
}

export function filterCaseLifecycleEvents(
  events: readonly CaseLifecycleCalendarEvent[],
  options: CaseLifecycleCalendarQuery = {},
  now: unknown = new Date().toISOString(),
): CaseLifecycleCalendarEvent[] {
  return events.filter(lifecycleEventPredicate(options, now)).slice(0, MAX_CASE_LIFECYCLE_EVENTS);
}

export function serializeCaseLifecycleCalendarEvents(
  events: readonly CaseLifecycleCalendarEvent[],
  disclosure: CaseLifecycleCalendarDisclosure = {},
  generatedAt: unknown = new Date().toISOString(),
): string {
  const createdAt = timestamp(generatedAt) || new Date(0).toISOString();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WHOISleuth//Browser-local case review//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText('WHOISleuth case follow-ups')}`,
  ];
  const seen = new Set<string>();
  for (const event of events.slice(0, MAX_CASE_LIFECYCLE_EVENTS)) {
    if (seen.has(event.uid)) continue;
    seen.add(event.uid);
    const summaryParts = [EVENT_LABELS[event.kind], event.caseReference];
    if (disclosure.includeDomain) summaryParts.push(event.domain);
    const descriptions = ['Open the browser-local Case before acting. This calendar event makes no request.'];
    if (disclosure.includeRecipient && event.recipient) descriptions.push(`Recipient or internal owner: ${event.recipient}.`);
    if (disclosure.includeContext) {
      if (event.classification) descriptions.push(`Case types: ${event.classification}.`);
      descriptions.push(event.description);
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeCalendarText(`${event.uid}@whoisleuth.local`)}`,
      `DTSTAMP:${calendarDate(createdAt)}`,
      `DTSTART:${calendarDate(event.startsAt)}`,
      `SUMMARY:${escapeCalendarText(summaryParts.join(' · '))}`,
      `DESCRIPTION:${escapeCalendarText(descriptions.join(' '))}`,
      `X-WHOISLEUTH-SCHEMA:${CASE_LIFECYCLE_CALENDAR_SCHEMA}`,
      `X-WHOISLEUTH-CASE-REFERENCE:${escapeCalendarText(event.caseReference)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n').concat('\r\n');
}

export function serializeCaseLifecycleCalendar(
  records: readonly CaseRecord[],
  generatedAt: unknown = new Date().toISOString(),
  disclosure: CaseLifecycleCalendarDisclosure = {},
): string {
  return serializeCaseLifecycleCalendarEvents(buildCaseLifecycleEvents(records), disclosure, generatedAt);
}
