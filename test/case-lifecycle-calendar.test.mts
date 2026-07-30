import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCaseLifecycleEvents,
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
        state: 'planned',
        reference: null,
        followUpAt: '2026-07-08T00:00:00.000Z',
        outcome: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    });
    assert.ok(record);
    const events = buildCaseLifecycleEvents(record ? [record] : []);
    assert.deepEqual(events.map((event) => event.kind), ['action_due', 'action_follow_up', 'domain_expiry_review']);
    const calendar = serializeCaseLifecycleCalendar(record ? [record] : [], '2026-06-01T00:00:00.000Z');
    assert.match(calendar, /BEGIN:VCALENDAR/);
    assert.match(calendar, /X-WHOISLEUTH-SCHEMA:whoisleuth\.case-review-calendar/);
    assert.doesNotMatch(calendar, /private-route/);
  });
});
