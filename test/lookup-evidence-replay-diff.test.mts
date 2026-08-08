import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildLookupEvidenceReplayDiff } from '../frontend/src/lib/analysis/lookup-evidence-replay-diff.ts';
import type { LookupEvidenceReplay } from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';

const OBSERVED_AT = '2026-08-01T00:00:00.000Z';

function replay(overrides: Partial<LookupEvidenceReplay> = {}): LookupEvidenceReplay {
  return {
    version: 1, schemaVersion: 6, digestSha256: 'a'.repeat(64), digestVerified: false,
    exportedAt: '2026-08-01T00:00:00.000Z', generatorVersion: '1.40.0', target: 'example.test', targetType: 'domain',
    availability: 'registered', confidence: 'high',
    sources: [{ id: 'dns', label: 'DNS', state: 'success', complete: true, observedAt: '2026-08-01T00:00:00.000Z', limitations: [] }],
    facts: [{ id: 'registration.nameservers', label: 'Nameservers', value: 'ns1.example.test', sourceId: 'dns', source: 'DNS', sourceState: 'success', sourceComplete: true }],
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
      facts: [{ id: 'registration.nameservers', label: 'Nameservers', value: 'ns2.example.test', sourceId: 'dns', source: 'DNS', sourceState: 'partial', sourceComplete: false }],
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

  test('recognises the displayed not-found source token as incomplete for a missing fact', () => {
    const report = buildLookupEvidenceReplayDiff(replay(), replay({
      sources: [{ id: 'dns', label: 'DNS', state: 'not found', complete: null, observedAt: null, limitations: [] }],
      facts: [],
    }));
    assert.equal(report.rows.find((item) => item.label === 'Nameservers')?.kind, 'collection_quality_difference');
  });

  const nonPositiveSourceStates = [
    ['skipped', 'skipped', null],
    ['disabled', 'disabled', null],
    ['rate-limited', 'rate-limited', null],
    ['inconclusive', 'inconclusive', null],
    ['blocked', 'blocked', null],
    ['not-reported', 'not-reported', null],
    ['stale', 'stale', null],
    ['error', 'error', false],
    ['partial', 'partial', false],
    ['unavailable', 'unavailable', false],
    ['unsupported', 'unsupported', null],
    ['not-found', 'not-found', null],
    ['success without explicit completeness', 'success', null],
    ['complete marked incomplete', 'complete', false],
  ] as const;
  for (const [label, state, complete] of nonPositiveSourceStates) {
    test(`fails closed for a one-sided fact when its source is ${label}`, () => {
      const report = buildLookupEvidenceReplayDiff(replay(), replay({
        sources: [{ id: 'dns', label: 'DNS', state, complete, observedAt: null, limitations: [] }],
        facts: [],
      }));
      assert.equal(report.rows.find((item) => item.id === 'fact:registration.nameservers')?.kind, 'collection_quality_difference');
      assert.equal(report.counts.observedChanges, 0);
    });
  }

  test('allows a one-sided fact only with explicitly complete positive source states', () => {
    for (const state of ['complete', 'success', 'provided']) {
      const report = buildLookupEvidenceReplayDiff(replay(), replay({
        sources: [{ id: 'dns', label: 'DNS', state, complete: true, observedAt: OBSERVED_AT, limitations: [] }],
        facts: [],
      }));
      assert.equal(report.rows.find((item) => item.id === 'fact:registration.nameservers')?.kind, 'observed_change');
    }
  });

  test('uses the fact source only instead of unrelated incomplete sources', () => {
    const report = buildLookupEvidenceReplayDiff(replay({
      sources: [
        { id: 'dns', label: 'DNS', state: 'success', complete: true, observedAt: '2026-08-01T00:00:00.000Z', limitations: [] },
        { id: 'http', label: 'HTTP', state: 'partial', complete: false, observedAt: null, limitations: [] },
      ],
    }), replay({
      sources: [
        { id: 'dns', label: 'DNS', state: 'success', complete: true, observedAt: '2026-08-02T00:00:00.000Z', limitations: [] },
        { id: 'http', label: 'HTTP', state: 'unavailable', complete: false, observedAt: null, limitations: [] },
      ],
      facts: [],
    }));
    assert.equal(report.rows.find((item) => item.id === 'fact:registration.nameservers')?.kind, 'observed_change');
  });

  test('treats a retained fact source switch as collection provenance rather than target change', () => {
    const registrarFact = {
      id: 'registration.nameservers',
      label: 'Nameservers',
      value: 'ns1.example.test',
      sourceId: 'registrar',
      source: 'Registrar publication',
      sourceState: 'success',
      sourceComplete: true,
    } as const;
    const sources = [
      { id: 'dns', label: 'DNS', state: 'success', complete: true, observedAt: OBSERVED_AT, limitations: [] },
      { id: 'registrar', label: 'Registrar publication', state: 'success', complete: true, observedAt: OBSERVED_AT, limitations: [] },
    ];
    const sameValue = buildLookupEvidenceReplayDiff(replay({ sources }), replay({ sources, facts: [registrarFact] }));
    assert.equal(sameValue.rows.find((item) => item.id === 'fact:registration.nameservers')?.kind, 'collection_quality_difference');

    const changedValue = buildLookupEvidenceReplayDiff(replay({ sources }), replay({
      sources,
      facts: [{ ...registrarFact, value: 'ns2.example.test' }],
    }));
    const fact = changedValue.rows.find((item) => item.id === 'fact:registration.nameservers');
    assert.equal(fact?.kind, 'collection_quality_difference');
    assert.match(fact?.explanation ?? '', /source attribution changed/iu);
    assert.equal(changedValue.counts.observedChanges, 0);
  });

  test('requires the same target', () => {
    assert.throws(() => buildLookupEvidenceReplayDiff(replay(), replay({ target: 'other.test' })), /same target/iu);
  });
});
