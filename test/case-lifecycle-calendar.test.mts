import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  buildCaseLifecycleEvents,
  collectCaseLifecycleEvents,
  filterCaseLifecycleEvents,
  projectCaseLifecycleEvents,
  serializeCaseLifecycleCalendar,
  serializeCaseLifecycleCalendarEvents,
  MAX_CASE_LIFECYCLE_EVENTS,
  MAX_CASE_LIFECYCLE_CALENDAR_BYTES,
} from '../frontend/src/lib/analysis/case-lifecycle-calendar.ts';
import { normalizeCase } from '../frontend/src/lib/analysis/case-model.ts';
import {
  CASE_SCHEMA_VERSION, MAX_CASE_STORE_BYTES, MAX_CASES, MAX_CASE_ACTIONS,
  MAX_CASE_OBSERVED_EFFECT_REVIEWS, MAX_CASE_EVIDENCE_PINS, MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
} from '../packages/contracts/case-portability.mts';
import { enforceStoreBudget, serializeCaseStore } from '../packages/cases/case-storage-model.mts';

describe('case lifecycle calendar', () => {
  test('exports bounded due, follow-up, and observed-expiry review events without recipients', () => {
    const record = normalizeCase({
      id: 'case-1',
      domain: 'example.test',
      tags: ['case-type:phishing'],
      source: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      evidenceHistory: [{
        id: 'evidence-1',
        capturedAt: '2026-01-01T00:00:00.000Z',
        source: 'lookup',
        scanDepth: 'deep',
        expiryDate: '2026-10-01T00:00:00.000Z',
      }],
      actions: [{
        id: 'action-1',
        type: 'security_contact_report',
        recipient: 'private-route@example.test',
        contactSource: 'Published route',
        contactLimitations: ['Not verified.'],
        dueAt: '2026-07-01T00:00:00.000Z',
        state: 'drafting',
        reference: null,
        followUpAt: '2026-07-08T00:00:00.000Z',
        providerOutcome: null,
        outcome: null,
        originActionId: null,
        history: [{
          id: 'action-event-1', previousState: null, nextState: 'drafting',
          occurredAt: '2026-01-01T00:00:00.000Z', sourceClass: 'analyst', provenance: 'fixture_creation',
          reference: null, evidencePinId: null, limitations: [], providerOutcome: null,
          outcomeDetail: null, originActionId: null, applied: true,
        }],
        historyOmitted: 0,
        historyLimitations: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        metadataUpdatedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      observedEffects: {
        reviews: [{
          id: 'effect-review-1', state: 'not_checked', observedAt: '2026-06-01T00:00:00.000Z',
          sourceClass: 'analyst', source: 'Manual local review', completeness: 'unknown',
          limitations: ['No request was made.'], evidencePinId: null, sightingId: null,
          followUpAt: '2026-07-15T00:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z',
        }],
        omitted: 0,
        preV13HistoryUnavailable: false,
        limitations: [],
      },
      closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
      evidencePins: [{
        id: 'pin-tls-expiry',
        checkpointId: 'checkpoint-1',
        field: 'tls.valid_to',
        category: 'tls',
        label: 'TLS certificate expiry',
        value: '2026-09-01T00:00:00.000Z',
        source: 'TLS certificate',
        sourceState: 'success',
        sourceSchema: null,
        observedAt: '2026-06-01T00:00:00.000Z',
        collectionDepth: 'deep',
        completeness: 'complete',
        truncated: null,
        transitionExpectation: null,
        limitations: [],
        createdAt: '2026-06-01T00:00:00.000Z',
      }, {
        id: 'pin-disclosure-expiry',
        checkpointId: 'checkpoint-1',
        field: 'disclosure.security_txt_expires',
        category: 'disclosure',
        label: 'security.txt expiry',
        value: '2026-08-01T00:00:00.000Z',
        source: 'security.txt',
        sourceState: 'present',
        sourceSchema: null,
        observedAt: '2026-06-01T00:00:00.000Z',
        collectionDepth: 'deep',
        completeness: 'complete',
        truncated: null,
        transitionExpectation: null,
        limitations: [],
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    });
    assert.ok(record);
    const events = buildCaseLifecycleEvents(record ? [record] : []);
    assert.deepEqual(events.map((event) => event.kind), [
      'action_due',
      'action_follow_up',
      'observed_effect_follow_up',
      'disclosure_expiry_review',
      'certificate_expiry_review',
      'domain_expiry_review',
    ]);
    assert.deepEqual(events.map((event) => event.source), [
      'case_action',
      'case_action',
      'observed_effect_review',
      'evidence_pin',
      'evidence_pin',
      'evidence_history',
    ]);
    assert.deepEqual(
      filterCaseLifecycleEvents(events, { window: '30d' }, '2026-06-15T00:00:00.000Z').map((event) => event.kind),
      ['action_due', 'action_follow_up', 'observed_effect_follow_up'],
    );
    assert.deepEqual(
      filterCaseLifecycleEvents(events, { kind: 'certificate_expiry_review', window: 'all' }).map((event) => event.kind),
      ['certificate_expiry_review'],
    );
    const calendar = serializeCaseLifecycleCalendar(record ? [record] : [], '2026-06-01T00:00:00.000Z');
    const unfoldedCalendar = calendar.replaceAll(/\r\n[ \t]/gu, '');
    assert.match(calendar, /BEGIN:VCALENDAR/);
    assert.match(calendar, /X-WHOISLEUTH-SCHEMA:whoisleuth\.case-review-calendar/);
    assert.match(calendar, /X-WHOISLEUTH-CASE-REFERENCE:WS-/u);
    assert.doesNotMatch(calendar, /X-WHOISLEUTH-(?:APP-)?VERSION/iu);
    assert.doesNotMatch(calendar, /private-route/);
    assert.doesNotMatch(calendar, /example\.test|phishing|action state/iu);
    assert.match(unfoldedCalendar, /calendar event makes no request/iu);
    assert.doesNotMatch(
      serializeCaseLifecycleCalendar([], '2026-06-01T00:00:00.000Z'),
      /X-WHOISLEUTH-SCHEMA/iu,
    );

    const selected = events.filter((event) => event.kind === 'action_follow_up');
    const disclosed = serializeCaseLifecycleCalendarEvents(selected, {
      includeDomain: true,
      includeRecipient: true,
      includeContext: true,
    }, '2026-06-01T00:00:00.000Z');
    const unfoldedDisclosed = disclosed.replaceAll(/\r\n[ \t]/gu, '');
    assert.equal(disclosed.match(/BEGIN:VEVENT/gu)?.length, 1);
    assert.match(unfoldedDisclosed, /example\.test/u);
    assert.match(unfoldedDisclosed, /private-route@example\.test/u);
    assert.match(unfoldedDisclosed, /Case types: Phishing/u);
    assert.match(unfoldedDisclosed, /Case action state: drafting/u);
    for (const line of disclosed.split('\r\n').filter(Boolean)) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `Calendar line exceeds 75 octets: ${line}`);
    }

    const hostileCalendar = serializeCaseLifecycleCalendar(record ? [{
      ...record,
      id: 'case-1\rX-INJECTED:yes',
    }] : [], '2026-06-01T00:00:00.000Z');
    assert.doesNotMatch(hostileCalendar, /\r(?!\n)/u);
    assert.doesNotMatch(hostileCalendar, /\rX-INJECTED/iu);
  });
});

test('time filters preserve all matching admitted events beyond the former display limit', () => {
  const action = (id: string, dueAt: string, followUpAt: string | null) => ({
    id,
    type: 'internal_review',
    recipient: 'Internal review',
    contactSource: 'Analyst supplied',
    contactLimitations: [],
    dueAt,
    state: 'drafting',
    reference: null,
    followUpAt,
    providerOutcome: null,
    outcome: null,
    originActionId: null,
    history: [],
    historyOmitted: 0,
    historyLimitations: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    metadataUpdatedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const past = Array.from({ length: 250 }, (_, index) => normalizeCase({
    id: `past-${index}`,
    domain: `past-${index}.example`,
    actions: [action(`past-action-${index}`, '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z')],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })).filter((record): record is NonNullable<typeof record> => Boolean(record));
  const future = normalizeCase({
    id: 'future-case',
    domain: 'future.example',
    actions: [action('future-action', '2026-12-01T00:00:00.000Z', null)],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(future);
  const records = [...past, future];
  const upcoming = projectCaseLifecycleEvents(records, { window: 'future' }, '2026-06-01T00:00:00.000Z');
  assert.deepEqual(upcoming.events.map((event) => event.caseId), ['future-case']);
  const all = projectCaseLifecycleEvents(records, { window: 'all' }, '2026-06-01T00:00:00.000Z');
  assert.equal(all.events.length, 501);
  assert.equal(all.matchingCount, 501);
  assert.equal(all.sourceCasesOmitted, 0);
});

const CLOCK = '2026-09-10T10:00:00.000Z';
function calendarCase(id: string, actionCount = 1) {
  const record = normalizeCase({ id, domain: `${id}.test`, source: 'manual', createdAt: CLOCK, updatedAt: CLOCK,
    actions: Array.from({ length: actionCount }, (_, index) => ({ id: `action-${index}`, type: 'internal_review', recipient: `Private recipient ${index}`,
      contactSource: 'Analyst', dueAt: '2026-10-01T00:00:00.000Z', followUpAt: '2026-11-01T00:00:00.000Z' })),
  }, undefined, CLOCK, CASE_SCHEMA_VERSION);
  assert.ok(record);
  return record;
}

test('an admitted multi-Case calendar retains and exports every one of five thousand events', () => {
  const records = Array.from({ length: 50 }, (_, index) => calendarCase(`calendar-${index}`, 50));
  assert.ok(Buffer.byteLength(serializeCaseStore(records)) <= MAX_CASE_STORE_BYTES);
  const admitted = enforceStoreBudget(records);
  assert.equal(admitted.pruned, 0);
  const collection = collectCaseLifecycleEvents(admitted.cases, false, CLOCK);
  assert.equal(collection.events.length, 5_000);
  assert.equal(new Set(collection.events.map((event) => event.uid)).size, 5_000);
  const all = filterCaseLifecycleEvents(collection.events, { window: 'all' }, CLOCK);
  assert.equal(all.length, 5_000);
  const followUps = filterCaseLifecycleEvents(collection.events, { kind: 'action_follow_up', window: 'all' }, CLOCK);
  assert.equal(followUps.length, 2_500);
  assert.ok(followUps.every((event) => all.includes(event)));
  const calendar = serializeCaseLifecycleCalendarEvents(all, {}, CLOCK);
  assert.equal(calendar.match(/BEGIN:VEVENT/gu)?.length, 5_000);
  assert.doesNotMatch(calendar, /calendar-\d+\.test|Private recipient|Case action state/iu);
  assert.equal(collectCaseLifecycleEvents(records, false, CLOCK).events.length, 5_000);
});

test('unknown evaluation clocks never become an epoch-based future or overdue classification', () => {
  const records = [calendarCase('clock')];
  for (const now of ['', 'invalid', '2026-09-10', '2026-02-29T00:00:00Z']) {
    for (const window of ['future', 'overdue', '30d', '90d']) {
      const result = projectCaseLifecycleEvents(records, { window }, now);
      assert.equal(result.evaluatedAt, null);
      assert.equal(result.events.length, 0);
    }
    const all = projectCaseLifecycleEvents(records, { window: 'all' }, now);
    assert.equal(all.events.length, 2);
    assert.equal(all.evaluatedAt, null);
    assert.throws(() => serializeCaseLifecycleCalendarEvents(all.events, {}, now), /valid generation time/iu);
  }
});

test('derived reminder dates outside the supported calendar range remain explicit limitations', () => {
  const record = calendarCase('early-expiry', 0);
  const dated = normalizeCase({ ...record, evidenceHistory: [{ id: 'old-expiry', capturedAt: CLOCK, source: 'lookup', scanDepth: 'deep', expiryDate: '0001-01-01T00:00:00.000Z' }] }, undefined, CLOCK, CASE_SCHEMA_VERSION);
  assert.ok(dated);
  assert.equal(dated.evidenceHistory.length, 1);
  const result = projectCaseLifecycleEvents([dated], { window: 'all' }, CLOCK);
  assert.equal(result.events.length, 0);
  assert.equal(result.dateLimitations.length, 1);
  assert.match(result.dateLimitations[0]?.detail ?? '', /reminder falls outside the supported calendar range/iu);
});

test('source bounds count each stage and do not select a latest date from incomplete source arrays', () => {
  const record = normalizeCase({ ...calendarCase('source-bounds'),
    observedEffects: { reviews: [{ id: 'review', observedAt: CLOCK, state: 'not_checked', source: 'Review source', sourceClass: 'analyst',
      completeness: 'unknown', followUpAt: '2026-12-01T00:00:00.000Z', createdAt: CLOCK }], omitted: 0, limitations: [], preV13HistoryUnavailable: false },
    evidencePins: [{ id: 'pin', field: 'tls.valid_to', label: 'Certificate expiry', source: 'Retained source', value: '2027-01-01T00:00:00.000Z', observedAt: CLOCK, createdAt: CLOCK }],
    evidenceHistory: [{ id: 'snapshot', capturedAt: CLOCK, source: 'lookup', scanDepth: 'deep', expiryDate: '2027-01-01T00:00:00.000Z' }],
  }, undefined, CLOCK, CASE_SCHEMA_VERSION);
  assert.ok(record);
  assert.equal(record.observedEffects.reviews.length, 1);
  assert.equal(record.evidencePins.length, 1);
  assert.equal(record.evidenceHistory.length, 1);
  record.actions = Array.from({ length: MAX_CASE_ACTIONS + 1 }, (_, index) => ({ ...record.actions[0]!, id: `action-${index}` }));
  record.observedEffects.reviews = Array.from({ length: MAX_CASE_OBSERVED_EFFECT_REVIEWS + 2 }, (_, index) => ({ ...record.observedEffects.reviews[0]!, id: `review-${index}` }));
  record.evidenceHistory = Array.from({ length: MAX_EVIDENCE_SNAPSHOTS_PER_CASE + 3 }, (_, index) => ({ ...record.evidenceHistory[0]!, id: `snapshot-${index}` }));
  record.evidencePins = Array.from({ length: MAX_CASE_EVIDENCE_PINS + 4 }, (_, index) => ({ ...record.evidencePins[0]!, id: `pin-${index}` }));
  const result = collectCaseLifecycleEvents([record], false, CLOCK);
  assert.deepEqual([result.sourceActionsOmitted, result.sourceReviewsOmitted, result.sourceSnapshotsOmitted, result.sourcePinsOmitted], [1, 2, 3, 4]);
  assert.equal(result.dateLimitations.length, 3);
  assert.equal(result.events.length, 100);
  assert.ok(result.events.every((event) => event.kind === 'action_due' || event.kind === 'action_follow_up'));
  assert.equal(collectCaseLifecycleEvents([record], true, CLOCK).events.length, 140);
  const empty = calendarCase('empty', 0);
  const many = collectCaseLifecycleEvents(Array.from({ length: MAX_CASES + 2 }, (_, index) => ({ ...empty, id: `case-${index}` })), false, CLOCK);
  assert.equal(many.sourceCasesOmitted, 2);
});

test('calendar export rejects oversized, invalid or duplicate selections without publishing a partial result', () => {
  const [event] = collectCaseLifecycleEvents([calendarCase('export')], false, CLOCK).events;
  assert.ok(event);
  assert.throws(() => serializeCaseLifecycleCalendarEvents(Array(MAX_CASE_LIFECYCLE_EVENTS + 1).fill(event), {}, CLOCK), /bounded Case source population/iu);
  assert.throws(() => serializeCaseLifecycleCalendarEvents([event, event], {}, CLOCK), /duplicate identities/iu);
  assert.throws(() => serializeCaseLifecycleCalendarEvents([{ ...event, startsAt: '2026-02-29T00:00:00Z' }], {}, CLOCK), /invalid date/iu);
  assert.throws(() => serializeCaseLifecycleCalendarEvents([{ ...event, description: 'x'.repeat(1_001) }], { includeContext: true }, CLOCK), /bounded Case text/iu);
  const large = { ...event, description: '界'.repeat(1_000), classification: '界'.repeat(1_000) };
  const disclosure = { includeContext: true };
  const headerBytes = Buffer.byteLength(serializeCaseLifecycleCalendarEvents([], disclosure, CLOCK));
  const eventBytes = Buffer.byteLength(serializeCaseLifecycleCalendarEvents([large], disclosure, CLOCK)) - headerBytes;
  const count = Math.floor((MAX_CASE_LIFECYCLE_CALENDAR_BYTES - headerBytes) / eventBytes);
  assert.ok(count < MAX_CASE_LIFECYCLE_EVENTS);
  const events = Array.from({ length: count }, (_, index) => ({ ...large, uid: `event-${index}` }));
  const accepted = serializeCaseLifecycleCalendarEvents(events, disclosure, CLOCK);
  assert.equal(accepted.match(/BEGIN:VEVENT/gu)?.length, count);
  assert.equal(Buffer.byteLength(accepted), headerBytes + count * eventBytes);
  assert.ok(Buffer.byteLength(accepted) <= MAX_CASE_LIFECYCLE_CALENDAR_BYTES);
  assert.throws(() => serializeCaseLifecycleCalendarEvents([...events, { ...large, uid: 'one-over' }], disclosure, CLOCK), /byte bound/iu);
});

test('calendar folding retains Unicode scalars, escaped text and stable digest event identity', () => {
  const [event] = collectCaseLifecycleEvents([calendarCase('unicode')], false, CLOCK).events;
  assert.ok(event);
  const text = 'é界🧭;\\,\n'.repeat(60);
  const calendar = serializeCaseLifecycleCalendarEvents([{ ...event, recipient: text }], { includeRecipient: true }, CLOCK);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = calendar.replaceAll(/\r\n /gu, '');
  assert.ok(unfolded.includes(text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;')));
  assert.equal(unfolded.includes('\uFFFD'), false);
  assert.ok(unfolded.includes(`UID:${createHash('sha256').update(event.uid).digest('hex')}@whoisleuth.local`));
});

test('independent Case and source identities cannot collide at delimiter boundaries', () => {
  const first = calendarCase('one-two');
  first.actions[0]!.id = 'three';
  const second = calendarCase('one');
  second.actions[0]!.id = 'two-three';
  const forward = collectCaseLifecycleEvents([first, second], false, CLOCK).events;
  const reversed = collectCaseLifecycleEvents([second, first], false, CLOCK).events;
  assert.equal(forward.length, 4);
  assert.equal(new Set(forward.map((event) => event.uid)).size, 4);
  assert.deepEqual(reversed, forward);
  const calendar = serializeCaseLifecycleCalendarEvents(forward, {}, CLOCK).replaceAll(/\r\n /gu, '');
  assert.equal(calendar.match(/BEGIN:VEVENT/gu)?.length, 4);
  assert.equal(new Set(calendar.match(/^UID:.+$/gmu)).size, 4);
  assert.doesNotMatch(calendar, /one-two|two-three/iu);
});
