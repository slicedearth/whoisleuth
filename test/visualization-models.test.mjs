import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_LIFECYCLE_EVENTS,
  MAX_REDIRECT_NODES,
  MAX_TRIAGE_PLOT_POINTS,
  WATCHLIST_ACTIVITY_DAYS,
  projectLifecycleEvents,
  projectRedirectPath,
  projectTriagePoints,
  projectWatchlistActivity,
} from '../frontend/src/lib/analysis/visualization-models.ts';

describe('bounded visualization models', () => {
  test('orders and caps valid lifecycle events without treating spacing as duration', () => {
    const events = [
      { id: 'later', label: 'Later', date: '2030-01-01T00:00:00Z', kind: 'certificate' },
      { id: 'invalid', label: 'Invalid', date: 'not-a-date' },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `event-${index}`,
        label: `Event ${index}`,
        date: `202${index}-01-01T00:00:00Z`,
      })),
    ];
    const projected = projectLifecycleEvents(events);

    assert.equal(projected.events.length, MAX_LIFECYCLE_EVENTS);
    assert.equal(projected.truncated, true);
    assert.equal(projected.events[0].id, 'event-0');
    assert.ok(projected.events.every((event) => Number.isFinite(event.x)));
  });

  test('bounds redirect nodes and does not turn retained URLs into links', () => {
    const redirects = Array.from({ length: 12 }, (_, index) => ({
      status: index === 0 ? '301' : '302',
      from: `https://source-${index}.example/path?secret=value`,
      to: `https://target-${index}.example/landing`,
      queryOmitted: true,
    }));
    const projected = projectRedirectPath(redirects);

    assert.equal(projected.nodes.length, MAX_REDIRECT_NODES);
    assert.equal(projected.truncated, true);
    assert.equal(projected.nodes[0].label, 'source-0.example/path');
    assert.equal(projected.nodes[1].queryOmitted, true);
    assert.ok(projected.edges.every((edge) => edge.toX > edge.fromX));
  });

  test('uses a deterministic capped triage sample and keeps incomplete scores explicit', () => {
    const points = [
      { domain: 'incomplete.example', risk: 40, opportunity: null, availability: 'registered' },
      ...Array.from({ length: MAX_TRIAGE_PLOT_POINTS + 25 }, (_, index) => ({
        domain: `candidate-${String(index).padStart(3, '0')}.example`,
        risk: index % 101,
        opportunity: 100 - (index % 101),
        availability: index % 2 ? 'registered' : 'available',
        trusted: index === 8,
      })),
    ];
    const first = projectTriagePoints(points);
    const second = projectTriagePoints([...points].reverse());

    assert.equal(first.points.length, MAX_TRIAGE_PLOT_POINTS);
    assert.equal(first.sampled, true);
    assert.equal(first.omittedCount, 1);
    assert.deepEqual(first, second);
    assert.ok(first.points.every((point) => point.x >= 58 && point.x <= 842 && point.y >= 28 && point.y <= 308));
  });

  test('aggregates retained watchlist checks into a fixed 28-day activity window', () => {
    const projected = projectWatchlistActivity([
      { checkedAt: '2026-05-01T01:00:00Z', changeCount: 100, resultCount: 100, conclusiveCount: 100 },
      { checkedAt: '2026-07-01T01:00:00Z', changeCount: 2, resultCount: 4, conclusiveCount: 3 },
      { checkedAt: '2026-07-01T18:00:00Z', changeCount: 1, resultCount: 4, conclusiveCount: 4 },
      { checkedAt: '2026-07-04T08:00:00Z', changeCount: 5, resultCount: 5, conclusiveCount: 5 },
      { checkedAt: 'invalid', changeCount: 99 },
    ]);

    assert.equal(projected.days.length, WATCHLIST_ACTIVITY_DAYS);
    assert.equal(projected.totalChecks, 3);
    assert.equal(projected.totalChanges, 8);
    assert.equal(projected.maxChanges, 5);
    const firstDay = projected.days.find((day) => day.date === '2026-07-01');
    assert.ok(firstDay);
    assert.equal(firstDay?.checks, 2);
    assert.equal(firstDay?.changes, 3);
  });
});
