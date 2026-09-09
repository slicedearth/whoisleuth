import type { CaseRecord } from './case-model.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { latestObservationCohort } from '../../../../packages/evidence/latest-observations.mts';
import { caseFollowUpSources } from '../../../../packages/cases/case-follow-ups.mts';
import { sha256IdentityHex } from '../../../../packages/evidence/record-identity.mts';
import { caseNumber, caseTypeSummary } from '../../../../packages/cases/case-workflow-metadata.mts';
import {
  MAX_CASES, MAX_CASE_ACTIONS, MAX_CASE_OBSERVED_EFFECT_REVIEWS,
  MAX_CASE_EVIDENCE_PINS, MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  MAX_CASE_STORE_BYTES, MAX_RESPONSE_VALUE_LENGTH,
} from '../../../../packages/contracts/case-portability.mts';

export const CASE_LIFECYCLE_CALENDAR_SCHEMA = 'whoisleuth.case-review-calendar';
export const MAX_CASE_LIFECYCLE_EVENTS = MAX_CASES * (MAX_CASE_ACTIONS * 2 + MAX_CASE_OBSERVED_EFFECT_REVIEWS + 3);
// Calendar fields repeat bounded Case context within each standard event.
export const MAX_CASE_LIFECYCLE_CALENDAR_BYTES = MAX_CASE_STORE_BYTES * 8;

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

export type CaseLifecycleCalendarQuery = Readonly<{ kind?: unknown; window?: unknown; includeHistorical?: boolean }>;
export type CaseLifecycleCalendarCollection = Readonly<{
  events: readonly CaseLifecycleCalendarEvent[];
  evaluatedAt: string | null;
  sourceCasesOmitted: number;
  sourceActionsOmitted: number;
  sourceReviewsOmitted: number;
  sourceSnapshotsOmitted: number;
  sourcePinsOmitted: number;
  dateLimitations: readonly Readonly<{ caseId: string; domain: string; detail: string }>[];
}>;
export type CaseLifecycleCalendarProjection = CaseLifecycleCalendarCollection & Readonly<{ matchingCount: number }>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function addDays(value: string, days: number): string | null {
  return timestamp(new Date(Date.parse(value) + days * 86_400_000).toISOString());
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
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let byteLimit = 75;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (current && currentBytes + bytes > byteLimit) {
      parts.push(current);
      current = character;
      currentBytes = bytes;
      byteLimit = 74;
    } else {
      current += character;
      currentBytes += bytes;
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

export function collectCaseLifecycleEvents(
  records: readonly CaseRecord[],
  includeHistorical = false,
  now: unknown = new Date().toISOString(),
): CaseLifecycleCalendarCollection {
  const events: CaseLifecycleCalendarEvent[] = [];
  function appendEvent(sourceId: string, event: Omit<CaseLifecycleCalendarEvent, 'uid'>) {
    events.push({ ...event, uid: JSON.stringify([event.caseId, event.source, sourceId, event.kind]) });
  }
  const dateLimitations: Array<{ caseId: string; domain: string; detail: string }> = [];
  const asOf = timestamp(now);
  let sourceActionsOmitted = 0;
  let sourceReviewsOmitted = 0;
  let sourceSnapshotsOmitted = 0;
  let sourcePinsOmitted = 0;
  for (const record of records.slice(0, MAX_CASES)) {
    const actionsOmitted = Math.max(0, record.actions.length - MAX_CASE_ACTIONS);
    const reviewsOmitted = Math.max(0, record.observedEffects.reviews.length - MAX_CASE_OBSERVED_EFFECT_REVIEWS);
    const snapshotsOmitted = Math.max(0, record.evidenceHistory.length - MAX_EVIDENCE_SNAPSHOTS_PER_CASE);
    const pinsOmitted = Math.max(0, record.evidencePins.length - MAX_CASE_EVIDENCE_PINS);
    sourceActionsOmitted += actionsOmitted;
    sourceReviewsOmitted += reviewsOmitted;
    sourceSnapshotsOmitted += snapshotsOmitted;
    sourcePinsOmitted += pinsOmitted;
    const caseContext = {
      caseReference: caseNumber(record.id),
      domain: record.domain,
      classification: caseTypeSummary(record.tags) || null,
    };
    const followUpSources = caseFollowUpSources({
      ...record,
      actions: record.actions.slice(-MAX_CASE_ACTIONS),
      observedEffects: { ...record.observedEffects, reviews: record.observedEffects.reviews.slice(-MAX_CASE_OBSERVED_EFFECT_REVIEWS) },
    }, includeHistorical);
    if (reviewsOmitted && !includeHistorical) {
      followUpSources.reviews = [];
      dateLimitations.push({ caseId: record.id, domain: record.domain, detail: 'Independent effect review: source reviews exceed the Case bound; no latest follow-up was selected.' });
    }
    function latestDate<T>(values: readonly T[], clock: (item: T) => unknown, value: (item: T) => unknown, label: string): string | null {
      if (!values.length || values.every((item) => value(item) == null || value(item) === '')) return null;
      const cohort = latestObservationCohort(values, clock);
      const dates = cohort.latest.map((item) => timestamp(value(item)));
      const future = !asOf || (cohort.observedAt !== null && Date.parse(cohort.observedAt) > Date.parse(asOf));
      const reason = cohort.undated.length ? 'capture time is unknown'
        : future ? 'capture time is later than this review or the review clock is unavailable'
          : !dates.length || dates.some((date) => date === null) ? 'the latest observation has no valid date'
            : new Set(dates).size !== 1 ? 'the latest observations disagree' : null;
      if (reason) {
        dateLimitations.push({ caseId: record.id, domain: record.domain, detail: `${label}: ${reason}; no calendar date was selected.` });
        return null;
      }
      return dates[0] ?? null;
    }
    function reminderDate(expiry: string | null, days: number, label: string): string | null {
      if (!expiry) return null;
      const startsAt = addDays(expiry, days);
      if (!startsAt) dateLimitations.push({ caseId: record.id, domain: record.domain, detail: `${label}: the reminder falls outside the supported calendar range; no calendar date was selected.` });
      return startsAt;
    }
    for (const action of followUpSources.actions) {
      const dueAt = timestamp(action.dueAt);
      const followUpAt = timestamp(action.followUpAt);
      if (dueAt) {
        appendEvent(action.id, {
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
        appendEvent(action.id, {
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
    for (const review of followUpSources.reviews) {
      const followUpAt = timestamp(review.followUpAt);
      if (!followUpAt) continue;
      appendEvent(review.id, {
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
    if (snapshotsOmitted) dateLimitations.push({ caseId: record.id, domain: record.domain, detail: 'Domain expiry: source snapshots exceed the Case bound; no latest expiry was selected.' });
    if (pinsOmitted) dateLimitations.push({ caseId: record.id, domain: record.domain, detail: 'Certificate and disclosure expiry: source pins exceed the Case bound; no latest expiry was selected.' });
    const expiry = snapshotsOmitted ? null : latestDate(record.evidenceHistory, (snapshot) => snapshot.capturedAt, (snapshot) => snapshot.expiryDate, 'Domain expiry');
    const expiryReminder = reminderDate(expiry, -30, 'Domain expiry');
    if (expiry && expiryReminder) {
      appendEvent(expiry, {
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'domain_expiry_review',
        source: 'evidence_history',
        sourceLabel: 'Latest retained domain evidence',
        startsAt: expiryReminder,
        summary: `Review observed expiry evidence for ${record.domain}`,
        description: 'The retained expiry date is point-in-time evidence, not a guarantee of deletion, availability, release, or acquisition eligibility.',
      });
    }
    const certificateExpiry = pinsOmitted ? null : latestDate(record.evidencePins.filter((pin) => pin.field === 'tls.valid_to'), (pin) => pin.observedAt, (pin) => pin.value, 'Certificate expiry');
    const certificateReminder = reminderDate(certificateExpiry, -30, 'Certificate expiry');
    if (certificateExpiry && certificateReminder) {
      appendEvent(certificateExpiry, {
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'certificate_expiry_review',
        source: 'evidence_pin',
        sourceLabel: 'Analyst-selected TLS evidence pin',
        startsAt: certificateReminder,
        summary: `Review retained certificate expiry for ${record.domain}`,
        description: 'This date came from an analyst-selected TLS evidence pin. Recollect before interpreting current certificate state.',
      });
    }
    const disclosureExpiry = pinsOmitted ? null : latestDate(record.evidencePins.filter((pin) => pin.field === 'disclosure.security_txt_expires'), (pin) => pin.observedAt, (pin) => pin.value, 'Disclosure expiry');
    const disclosureReminder = reminderDate(disclosureExpiry, -14, 'Disclosure expiry');
    if (disclosureExpiry && disclosureReminder) {
      appendEvent(disclosureExpiry, {
        caseId: record.id,
        ...caseContext,
        recipient: null,
        kind: 'disclosure_expiry_review',
        source: 'evidence_pin',
        sourceLabel: 'Analyst-selected disclosure evidence pin',
        startsAt: disclosureReminder,
        summary: `Review retained security.txt expiry for ${record.domain}`,
        description: 'This date came from an analyst-selected disclosure evidence pin. Publication and contact reachability must be reviewed again.',
      });
    }
  }
  events.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || compareCodeUnits(left.uid, right.uid));
  return Object.freeze({
    events: Object.freeze(events),
    evaluatedAt: asOf,
    sourceCasesOmitted: Math.max(0, records.length - MAX_CASES),
    sourceActionsOmitted, sourceReviewsOmitted, sourceSnapshotsOmitted, sourcePinsOmitted,
    dateLimitations: Object.freeze(dateLimitations),
  });
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
  const nowAt = timestamp(now);
  const nowMs = nowAt === null ? NaN : Date.parse(nowAt);
  const maximum = window === '30d'
    ? nowMs + 30 * 86_400_000
    : window === '90d'
      ? nowMs + 90 * 86_400_000
      : Number.POSITIVE_INFINITY;
  return (event) => {
    if (kind !== 'all' && event.kind !== kind) return false;
    const validDate = timestamp(event.startsAt);
    if (!validDate || (window !== 'all' && nowAt === null)) return false;
    const startsAt = Date.parse(validDate);
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
  const collected = collectCaseLifecycleEvents(records, options.includeHistorical === true, now);
  const events = filterCaseLifecycleEvents(collected.events, options, now);
  return Object.freeze({
    ...collected,
    events: Object.freeze(events),
    matchingCount: events.length,
  });
}

export function buildCaseLifecycleEvents(records: readonly CaseRecord[], now: unknown = new Date().toISOString()): CaseLifecycleCalendarEvent[] {
  return [...projectCaseLifecycleEvents(records, { window: 'all' }, now).events];
}

export function filterCaseLifecycleEvents(
  events: readonly CaseLifecycleCalendarEvent[],
  options: CaseLifecycleCalendarQuery = {},
  now: unknown = new Date().toISOString(),
): CaseLifecycleCalendarEvent[] {
  if (events.length > MAX_CASE_LIFECYCLE_EVENTS) throw new RangeError('Calendar events exceed the bounded Case source population.');
  return events.filter(lifecycleEventPredicate(options, now));
}

export function serializeCaseLifecycleCalendarEvents(
  events: readonly CaseLifecycleCalendarEvent[],
  disclosure: CaseLifecycleCalendarDisclosure = {},
  generatedAt: unknown = new Date().toISOString(),
): string {
  if (events.length > MAX_CASE_LIFECYCLE_EVENTS) throw new RangeError('Calendar events exceed the bounded Case source population.');
  const createdAt = timestamp(generatedAt);
  if (!createdAt) throw new TypeError('Calendar export requires an explicit valid generation time.');
  const lines: string[] = [];
  const encoder = new TextEncoder();
  let byteLength = 0;
  function append(...values: string[]) {
    for (const value of values) {
      const line = `${foldLine(value)}\r\n`;
      byteLength += encoder.encode(line).byteLength;
      if (byteLength > MAX_CASE_LIFECYCLE_CALENDAR_BYTES) throw new RangeError('Calendar export exceeds its byte bound. Select fewer events.');
      lines.push(line);
    }
  }
  append(
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WHOISleuth//Browser-local case review//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText('WHOISleuth case follow-ups')}`,
  );
  const seen = new Set<string>();
  for (const event of events) {
    if (!event.uid || seen.has(event.uid)) throw new TypeError('Selected calendar events have missing or duplicate identities. Review the selection before exporting.');
    if ([event.uid, event.caseId, event.caseReference, event.domain, event.recipient, event.classification, event.description].some((value) => value !== null && (typeof value !== 'string' || value.length > MAX_RESPONSE_VALUE_LENGTH))) {
      throw new RangeError('A calendar event exceeds the bounded Case text fields.');
    }
    const startsAt = timestamp(event.startsAt);
    if (!startsAt || !Object.hasOwn(EVENT_LABELS, event.kind)) throw new TypeError('A selected calendar event has an invalid date or kind.');
    seen.add(event.uid);
    const summaryParts = [EVENT_LABELS[event.kind], event.caseReference];
    if (disclosure.includeDomain) summaryParts.push(event.domain);
    const descriptions = ['Open the browser-local Case before acting. This calendar event makes no request.'];
    if (disclosure.includeRecipient && event.recipient) descriptions.push(`Recipient or internal owner: ${event.recipient}.`);
    if (disclosure.includeContext) {
      if (event.classification) descriptions.push(`Case types: ${event.classification}.`);
      descriptions.push(event.description);
    }
    append(
      'BEGIN:VEVENT',
      `UID:${sha256IdentityHex(encoder.encode(event.uid))}@whoisleuth.local`,
      `DTSTAMP:${calendarDate(createdAt)}`,
      `DTSTART:${calendarDate(startsAt)}`,
      `SUMMARY:${escapeCalendarText(summaryParts.join(' · '))}`,
      `DESCRIPTION:${escapeCalendarText(descriptions.join(' '))}`,
      `X-WHOISLEUTH-SCHEMA:${CASE_LIFECYCLE_CALENDAR_SCHEMA}`,
      `X-WHOISLEUTH-CASE-REFERENCE:${escapeCalendarText(event.caseReference)}`,
      'END:VEVENT',
    );
  }
  append('END:VCALENDAR');
  return lines.join('');
}

export function serializeCaseLifecycleCalendar(
  records: readonly CaseRecord[],
  generatedAt: unknown = new Date().toISOString(),
  disclosure: CaseLifecycleCalendarDisclosure = {},
): string {
  return serializeCaseLifecycleCalendarEvents(buildCaseLifecycleEvents(records, generatedAt), disclosure, generatedAt);
}
