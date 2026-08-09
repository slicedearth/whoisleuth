import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLookupEvidenceImpactPlan } from '../frontend/src/lib/analysis/lookup-evidence-impact.ts';
import type { LookupClaimReadiness } from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import type { LookupEvidenceQualityMatrix } from '../frontend/src/lib/analysis/lookup-decision-support.ts';

const readiness: LookupClaimReadiness = {
  version: 2,
  entries: [{
    id: 'controlled-change', label: 'Controlled-change planning', state: 'limited',
    conclusion: 'Whether a reviewed change can be prepared.',
    requiredEvidence: ['Authoritative registry evidence', 'DNS observation'],
    missingEvidence: ['DNS observation'],
    requiredEvidenceIds: ['authoritative-rdap', 'dns-observation'],
    missingEvidenceIds: ['dns-observation'],
    requirements: [
      { id: 'authoritative-rdap', label: 'Authoritative RDAP evidence', evidenceId: 'rdap', mode: 'network_collection', href: '#registry', state: 'complete', limitations: [] },
      { id: 'dns-observation', label: 'DNS observation', evidenceId: 'dns', mode: 'network_collection', href: '#evidence-dns', state: 'partial', limitations: ['One authority timed out.'] },
    ],
    limitations: ['DNS observation: partial'], href: '#evidence-dns',
  }, {
    id: 'incident-response', label: 'Incident response handoff', state: 'not_ready',
    conclusion: 'Whether a reviewed response can be prepared.',
    requiredEvidence: ['HTTP observation', 'Page identity observation'],
    missingEvidence: ['HTTP observation', 'Reviewed case and recipient route'],
    requiredEvidenceIds: ['http-observation', 'page-identity-observation', 'reviewed-case-recipient'],
    missingEvidenceIds: ['http-observation', 'reviewed-case-recipient'],
    requirements: [
      { id: 'http-observation', label: 'HTTP observation', evidenceId: 'http', mode: 'network_collection', href: '#evidence-http', state: 'unavailable', limitations: ['Connection failed.'] },
      { id: 'page-identity-observation', label: 'Page identity observation', evidenceId: 'page-identity', mode: 'network_collection', href: '#evidence-page', state: 'complete', limitations: [] },
      { id: 'reviewed-case-recipient', label: 'Reviewed case and recipient route', evidenceId: null, mode: 'local_review', href: '#case-response', state: 'unknown', limitations: ['Not supplied'] },
    ],
    limitations: [], href: '#case-response',
  }],
  disagreements: [], counts: { ready: 0, limited: 1, not_ready: 1 }, limitation: 'Readiness is not truth.',
};

const quality: LookupEvidenceQualityMatrix = {
  version: 1, observedAt: '2026-08-05T00:00:00.000Z', totalMs: 300,
  entries: [{
    id: 'dns', label: 'DNS', category: 'web', endpointClass: 'DNS resolver and authorities',
    description: 'DNS evidence.', state: 'partial', statusLabel: 'Partial', truncated: false,
    observedAt: '2026-08-05T00:00:00.000Z', ageDays: 0, durationMs: 100,
    timingOutcome: 'fulfilled', refreshAvailable: true, limitations: ['One authority timed out.'], supports: [],
  }, {
    id: 'http', label: 'HTTP', category: 'web', endpointClass: 'Bounded HTTP collection',
    description: 'HTTP evidence.', state: 'unavailable', statusLabel: 'Unavailable', truncated: false,
    observedAt: '2026-08-05T00:00:00.000Z', ageDays: 0, durationMs: 200,
    timingOutcome: 'rejected', refreshAvailable: true, limitations: ['Connection failed.'], supports: [],
  }],
  completeCount: 0, limitedCount: 2, stale: false, ageDays: 0,
  freshnessPolicy: { version: 1, id: 'task-default', task: 'incident', thresholdsDays: { registration: 30, network: 7, web: 3 } },
};

test('evidence impact plans the observation that could change a claim without promising the result', () => {
  const plan = buildLookupEvidenceImpactPlan({ readiness, quality });
  const dns = plan.items.find((item) => item.evidenceId === 'dns');
  assert.equal(dns?.outcomeIfSettled, 'ready');
  assert.equal(dns?.mode, 'network_collection');
  assert.match(dns?.disclosure ?? '', /disclose the target/u);
  assert.match(dns?.expectedEffect ?? '', /could make/u);
  assert.match(plan.limitation, /never guarantees/u);
});

test('evidence impact keeps local review separate from collection and exposes remaining limits', () => {
  const plan = buildLookupEvidenceImpactPlan({ readiness, quality });
  const local = plan.items.find((item) => item.evidenceLabel === 'Reviewed case and recipient route');
  const http = plan.items.find((item) => item.evidenceId === 'http');
  assert.equal(local?.mode, 'local_review');
  assert.match(local?.disclosure ?? '', /does not start/u);
  assert.equal(http?.outcomeIfSettled, 'limited');
  assert.equal(plan.networkCollectionCount, 2);
  assert.equal(plan.localReviewCount, 1);
});
