import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildLookupEvidenceReplayDiff } from '../frontend/src/lib/analysis/lookup-evidence-replay-diff.ts';
import type { LookupEvidenceReplay } from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';

function replay(overrides: Partial<LookupEvidenceReplay> = {}): LookupEvidenceReplay {
  return {
    version: 1, schemaVersion: 6, digestSha256: 'a'.repeat(64), digestVerified: false,
    exportedAt: '2026-08-01T00:00:00.000Z', generatorVersion: '1.40.0', target: 'example.test', targetType: 'domain',
    availability: 'registered', confidence: 'high',
    sources: [{ id: 'dns', label: 'DNS', state: 'success', complete: true, observedAt: '2026-08-01T00:00:00.000Z', limitations: [] }],
    facts: [{ label: 'Nameservers', value: 'ns1.example.test', source: 'DNS' }],
    contradictions: [], unknowns: [], recommendedSteps: [],
    graph: { version: 2, targetId: 'target:example.test', nodes: [], edges: [], sources: [], truncated: false, limitations: [] },
    limitations: [],
    ...overrides,
  };
}

describe('offline Lookup evidence replay diff', () => {
  test('separates observed, collection-quality, and interpretation differences', () => {
    const report = buildLookupEvidenceReplayDiff(replay(), replay({
      generatorVersion: '1.41.0',
      sources: [{ id: 'dns', label: 'DNS', state: 'partial', complete: false, observedAt: null, limitations: [] }],
      facts: [{ label: 'Nameservers', value: 'ns2.example.test', source: 'DNS' }],
    }));

    assert.equal(report.counts.observedChanges, 1);
    assert.equal(report.counts.collectionDifferences, 1);
    assert.equal(report.counts.interpretationDifferences, 1);
  });

  test('keeps one-sided facts inconclusive when collection is incomplete', () => {
    const report = buildLookupEvidenceReplayDiff(replay(), replay({
      sources: [{ id: 'dns', label: 'DNS', state: 'unavailable', complete: false, observedAt: null, limitations: [] }],
      facts: [],
    }));
    assert.equal(report.rows.find((item) => item.label === 'Nameservers')?.kind, 'collection_quality_difference');
  });

  test('requires the same target', () => {
    assert.throws(() => buildLookupEvidenceReplayDiff(replay(), replay({ target: 'other.test' })), /same target/iu);
  });
});
