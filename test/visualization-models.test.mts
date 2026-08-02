import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_LIFECYCLE_EVENTS,
  MAX_REDIRECT_NODES,
  MAX_TRIAGE_PLOT_POINTS,
  MAX_COLLECTION_TIMING_SOURCES,
  MAX_SCORE_FACTORS,
  MAX_VISUAL_MATRIX_ROWS,
  MAX_FORCE_GRAPH_NODES,
  MAX_FORCE_GRAPH_LINKS,
  MAX_COVERAGE_BAR_GROUPS,
  MAX_TREND_POINTS,
  MAX_MONITOR_TIMELINE_EVENTS,
  MAX_MONITOR_TIMELINE_LANES,
  WATCHLIST_ACTIVITY_DAYS,
  projectBoundedForceGraph,
  projectCertificateValidity,
  projectCollectionTiming,
  projectCoverageBars,
  projectEvidenceMatrix,
  projectLifecycleEvents,
  projectMonitorTimeline,
  projectRedirectPath,
  projectScoreFactors,
  projectTrendPoints,
  projectTriagePoints,
  projectWatchlistActivity,
} from '../frontend/src/lib/analysis/visualization-models.ts';
import type {
  ForceGraphLinkInput,
  ForceGraphNodeInput,
  LifecycleEventInput,
} from '../frontend/src/lib/analysis/visualization-models.ts';

describe('bounded visualization models', () => {
  test('orders and caps valid lifecycle events without treating spacing as duration', () => {
    const events: LifecycleEventInput[] = [
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
    assert.equal(requiredValue(projected.events[0]).id, 'event-0');
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
    assert.equal(requiredValue(projected.nodes[0]).label, 'source-0.example/path');
    assert.equal(requiredValue(projected.nodes[1]).queryOmitted, true);
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
    assert.equal(Object.values(first.quadrants).reduce((total, count) => total + count, 0), first.eligibleCount);
    assert.equal(first.quadrants.priorityReview > 0, true);
    assert.equal(first.quadrants.riskLedReview > 0, true);
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

  test('projects bounded source timings against the final completion time', () => {
    const projected = projectCollectionTiming([
      { source: 'registry', durationMs: 180, completedAfterMs: 220, outcome: 'fulfilled' },
      { source: 'whois', durationMs: 0, completedAfterMs: 1_300, outcome: 'rejected' },
      ...Array.from({ length: 20 }, (_, index) => ({
        source: `source-${index}`,
        durationMs: index * 50,
        completedAfterMs: 1_500 + index * 50,
        outcome: 'fulfilled',
      })),
    ], 2_500);

    assert.equal(projected.sources.length, MAX_COLLECTION_TIMING_SOURCES);
    assert.equal(projected.truncated, true);
    assert.ok(projected.sources.every((source) => source.width >= 3));
    assert.ok(projected.ticks.every((tick) => Number.isFinite(tick.x)));
  });

  test('bounds signed score factors around a shared zero axis', () => {
    const projected = projectScoreFactors([
      { label: 'Positive', delta: 18 },
      { label: 'Negative', delta: -7 },
      { label: 'Ignored', delta: 0 },
      ...Array.from({ length: 20 }, (_, index) => ({ label: `Factor ${index}`, delta: index + 1 })),
    ]);

    assert.equal(projected.factors.length, MAX_SCORE_FACTORS);
    assert.equal(projected.truncated, true);
    assert.ok(projected.factors.every((factor) => factor.width >= 2));
    const negative = projected.factors.find((factor) => factor.delta < 0);
    assert.ok(negative);
    assert.ok((negative?.x ?? 0) < projected.zeroX);
  });

  test('normalizes source-agreement states and caps matrix rows and columns', () => {
    const projected = projectEvidenceMatrix(
      ['Registry', 'Registrar', 'WHOIS', 'Page', 'DNS', 'TLS', 'Ignored'],
      Array.from({ length: 30 }, (_, index) => ({
        id: `field-${index}`,
        label: `Field ${index}`,
        cells: [
          { column: 'Registry', state: index === 0 ? 'equivalent' : 'missing', detail: 'value' },
          { column: 'WHOIS', state: index === 0 ? 'failed' : 'not_recorded' },
        ],
      })),
    );

    assert.equal(projected.columns.length, 6);
    assert.equal(projected.rows.length, MAX_VISUAL_MATRIX_ROWS);
    assert.equal(projected.truncated, true);
    assert.equal(requiredValue(projected.rows[0]).cells[0]?.state, 'equal');
    assert.equal(requiredValue(projected.rows[0]).cells[2]?.state, 'unavailable');
    assert.equal(requiredValue(projected.rows[1]).cells[0]?.state, 'partial');
  });

  test('creates a deterministic bounded force layout without mutating caller inputs', () => {
    const nodes: ForceGraphNodeInput[] = Array.from({ length: MAX_FORCE_GRAPH_NODES + 4 }, (_, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
      kind: index === 0 ? 'target' : 'domain',
    }));
    const links: ForceGraphLinkInput[] = Array.from({ length: MAX_FORCE_GRAPH_LINKS + 8 }, (_, index) => ({
      id: `link-${index}`,
      source: 'node-0',
      target: `node-${(index % (MAX_FORCE_GRAPH_NODES - 1)) + 1}`,
      kind: index % 2 ? 'observed' : 'derived',
    }));
    const original = structuredClone({ nodes, links });
    const first = projectBoundedForceGraph(nodes, links);
    const second = projectBoundedForceGraph([...nodes].reverse(), [...links].reverse());

    assert.equal(first.nodes.length, MAX_FORCE_GRAPH_NODES);
    assert.equal(first.links.length, MAX_FORCE_GRAPH_LINKS);
    assert.equal(first.omittedNodeInputs, 4);
    assert.equal(first.omittedLinkInputs, 8);
    assert.equal(first.truncated, true);
    assert.deepEqual(first, second);
    assert.deepEqual({ nodes, links }, original);
    assert.ok(first.nodes.every((node) =>
      node.x >= 38 && node.x <= first.width - 38
      && node.y >= 28 && node.y <= first.height - 52));
    assert.ok(first.clusters.some((cluster) => cluster.label === 'Domains and hosts'));
    assert.ok(first.nodes.every((node) =>
      node.labelLines.join('').replaceAll(' ', '') === node.label.replaceAll(' ', '')));
  });

  test('normalizes relationship kinds and rejects duplicate link keys', () => {
    const projected = projectBoundedForceGraph([
      { id: 'target', label: 'Target', kind: 'Target Node' },
      { id: 'source', label: 'Source', kind: 'External Source' },
    ], [
      { id: 'shared-link', source: 'target', target: 'source', kind: 'Derived Finding' },
      { id: 'shared-link', source: 'source', target: 'target', kind: 'Observed' },
    ]);

    assert.deepEqual(projected.nodes.map((node) => node.kind), ['external-source', 'target-node']);
    assert.equal(projected.links.length, 1);
    assert.equal(projected.links[0]?.kind, 'derived-finding');
    assert.equal(projected.omittedNodeInputs, 0);
    assert.equal(projected.omittedLinkInputs, 1);
    assert.equal(projected.truncated, true);
  });

  test('clusters a busy target map without boundary coordinate piles or shortened labels', () => {
    const nodes: ForceGraphNodeInput[] = [
      { id: 'target', label: 'reviewed-example.test', kind: 'target' },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `address-${index}`,
        label: `2001:db8:abcd:${index}::1234`,
        kind: 'address',
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `identity-${index}`,
        label: `Reviewed publisher identity ${index + 1}`,
        kind: 'identity',
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `certificate-${index}`,
        label: `Certificate observation ${index + 1}`,
        kind: 'certificate',
      })),
    ];
    const links: ForceGraphLinkInput[] = nodes.slice(1).map((node, index) => ({
      id: `target-link-${index}`,
      source: 'target',
      target: node.id,
      kind: index % 4 === 0 ? 'derived' : 'observed',
    }));
    const projected = projectBoundedForceGraph(nodes, links, { focusNodeId: 'target' });

    assert.equal(projected.nodes.length, nodes.length);
    assert.equal(projected.clusters.length, 3);
    assert.deepEqual(projected.nodes.find((node) => node.id === 'target')?.labelLines, ['reviewed-example.', 'test']);
    assert.equal(new Set(projected.nodes.map((node) => `${Math.round(node.x)}:${Math.round(node.y)}`)).size, nodes.length);
    assert.ok(projected.height > 480);
    for (const [leftIndex, left] of projected.nodes.entries()) {
      const leftBounds = left.kind === 'target'
        ? {
            left: left.x - (left.labelWidth + 20) / 2,
            right: left.x + (left.labelWidth + 20) / 2,
            top: left.y - (left.labelLines.length * 13 + 17) / 2,
            bottom: left.y + (left.labelLines.length * 13 + 17) / 2,
          }
        : {
            left: left.x - Math.max(20, left.labelWidth / 2),
            right: left.x + Math.max(20, left.labelWidth / 2),
            top: left.y + 25,
            bottom: left.y + 33 + left.labelLines.length * 13,
          };
      for (const right of projected.nodes.slice(leftIndex + 1)) {
        const rightBounds = right.kind === 'target'
          ? {
              left: right.x - (right.labelWidth + 20) / 2,
              right: right.x + (right.labelWidth + 20) / 2,
              top: right.y - (right.labelLines.length * 13 + 17) / 2,
              bottom: right.y + (right.labelLines.length * 13 + 17) / 2,
            }
          : {
              left: right.x - Math.max(20, right.labelWidth / 2),
              right: right.x + Math.max(20, right.labelWidth / 2),
              top: right.y + 25,
              bottom: right.y + 33 + right.labelLines.length * 13,
            };
        assert.equal(
          leftBounds.left < rightBounds.right
            && leftBounds.right > rightBounds.left
            && leftBounds.top < rightBounds.bottom
            && leftBounds.bottom > rightBounds.top,
          false,
          `${left.id} should not overlap ${right.id}`,
        );
      }
    }
  });

  test('keeps evidence-family colour slots stable across different graph subsets', () => {
    const target = { id: 'target', label: 'reviewed-example.test', kind: 'target' };
    const network = { id: 'address', label: '192.0.2.40', kind: 'address' };
    const certificate = { id: 'certificate', label: 'Certificate observation', kind: 'certificate' };
    const complete = projectBoundedForceGraph([target, network, certificate], [
      { id: 'network-link', source: 'target', target: 'address' },
      { id: 'certificate-link', source: 'target', target: 'certificate' },
    ], { focusNodeId: 'target' });
    const networkOnly = projectBoundedForceGraph([target, network], [
      { id: 'network-link', source: 'target', target: 'address' },
    ], { focusNodeId: 'target' });

    assert.equal(
      complete.clusters.find((cluster) => cluster.id === 'network')?.index,
      networkOnly.clusters.find((cluster) => cluster.id === 'network')?.index,
    );
    assert.equal(
      complete.nodes.find((node) => node.id === 'address')?.clusterIndex,
      networkOnly.nodes.find((node) => node.id === 'address')?.clusterIndex,
    );
    assert.notEqual(
      complete.clusters.find((cluster) => cluster.id === 'network')?.index,
      complete.clusters.find((cluster) => cluster.id === 'certificate')?.index,
    );
  });

  test('projects capped defensive-coverage bars while preserving exact counts', () => {
    const projected = projectCoverageBars(Array.from({ length: 22 }, (_, index) => ({
      id: `group-${index}`,
      label: `Group ${index}`,
      protected: index,
      registered: 2,
      available: 3,
      unknown: 1,
    })));

    assert.equal(projected.groups.length, MAX_COVERAGE_BAR_GROUPS);
    assert.equal(projected.truncated, true);
    assert.ok(projected.groups.every((group) =>
      group.segments.reduce((total, segment) => total + segment.value, 0) === group.total));
  });

  test('orders and caps certificate-search trend points', () => {
    const projected = projectTrendPoints([
      ...Array.from({ length: 28 }, (_, index) => ({
        id: `check-${index}`,
        date: `2026-06-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        total: index + 1,
        added: index % 3,
        partial: index === 20,
      })),
      { id: 'invalid', date: 'invalid', total: 999, added: 999 },
    ]);

    assert.equal(projected.points.length, MAX_TREND_POINTS);
    assert.equal(projected.truncated, true);
    assert.equal(requiredValue(projected.points.at(-1)).total, 28);
  });

  test('caps retained-monitor events and evidence lanes without erasing zero-change cells', () => {
    const projected = projectMonitorTimeline(Array.from({ length: 16 }, (_, eventIndex) => ({
      id: `event-${eventIndex}`,
      checkedAt: `2026-07-${String(eventIndex + 1).padStart(2, '0')}T00:00:00Z`,
      mode: 'deep',
      groups: Array.from({ length: 8 }, (_, groupIndex) => ({
        key: `group-${groupIndex}`,
        label: `Group ${groupIndex}`,
        changeCount: eventIndex === groupIndex ? 1 : 0,
      })),
    })));

    assert.equal(projected.events.length, MAX_MONITOR_TIMELINE_EVENTS);
    assert.equal(projected.lanes.length, MAX_MONITOR_TIMELINE_LANES);
    assert.equal(projected.truncated, true);
    assert.ok(projected.events.every((event) => event.cells.length === projected.lanes.length));
  });

  test('places a fixed observation within the certificate validity interval', () => {
    const projected = projectCertificateValidity({
      validFrom: '2026-07-01T00:00:00Z',
      validTo: '2026-10-01T00:00:00Z',
      observedAt: '2026-08-15T00:00:00Z',
    });
    assert.equal(projected.available, true);
    if (!projected.available) return;
    assert.equal(projected.hasObservation, true);
    assert.equal(projected.observedWithinValidity, true);
    assert.ok(projected.observedX > projected.fromX);
    assert.ok(projected.observedX < projected.toX);
    assert.deepEqual(
      projectCertificateValidity({ validFrom: 'invalid', validTo: '2026-10-01T00:00:00Z' }),
      { available: false, width: 900, height: 110 },
    );
  });
});
