import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseLifecycleEvents,
  filterCaseLifecycleEvents,
  serializeCaseLifecycleCalendar,
} from '../frontend/src/lib/analysis/case-lifecycle-calendar.ts';
import { normalizeCase } from '../frontend/src/lib/analysis/case-model.ts';

describe('case lifecycle calendar', () => {
  test('exports bounded due, follow-up, and observed-expiry review events without recipients', () => {
    const record = normalizeCase({
      id: 'case-1',
      domain: 'example.test',
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
    assert.match(calendar, /BEGIN:VCALENDAR/);
    assert.match(calendar, /X-WHOISLEUTH-SCHEMA:whoisleuth\.case-review-calendar/);
    assert.doesNotMatch(calendar, /X-WHOISLEUTH-(?:APP-)?VERSION/iu);
    assert.doesNotMatch(calendar, /private-route/);
    assert.match(calendar, /performs no request/iu);
    assert.doesNotMatch(
      serializeCaseLifecycleCalendar([], '2026-06-01T00:00:00.000Z'),
      /X-WHOISLEUTH-SCHEMA/iu,
    );

    const hostileCalendar = serializeCaseLifecycleCalendar(record ? [{
      ...record,
      id: 'case-1\rX-INJECTED:yes',
    }] : [], '2026-06-01T00:00:00.000Z');
    assert.doesNotMatch(hostileCalendar, /\r(?!\n)/u);
    assert.doesNotMatch(hostileCalendar, /\rX-INJECTED/iu);
  });
});
