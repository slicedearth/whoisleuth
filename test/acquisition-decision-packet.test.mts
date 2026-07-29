import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  buildAcquisitionDecisionPacket,
} from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import { buildAcquisitionDueDiligence } from '../frontend/src/lib/analysis/acquisition-due-diligence.ts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';

const NOW = '2026-07-29T00:00:00.000Z';

function review() {
  return buildAcquisitionDueDiligence({
    availability: {
      domain: 'candidate.example',
      state: 'registered',
      source: 'rdap',
      confidence: 'high',
    },
    registryInsights: {
      publications: [{ state: 'complete' }],
      lifecycle: { rawStatuses: [], locks: {} },
    },
  });
}

describe('acquisition decision packet', () => {
  test('exports a bounded reviewed packet with deterministic integrity', async () => {
    const exported = await buildAcquisitionDecisionPacket({
      target: 'Candidate.Example.',
      evidenceObservedAt: '2026-07-28T00:00:00Z',
      generatedAt: NOW,
      decision: 'continue_manual_review',
      rationale: `  Verify seller\u0000 authority. ${'x'.repeat(3_000)}`,
      reviewedChecks: ['continuity', 'eligibility', 'eligibility', 'counterparty', 'transfer', 'legal', 'unknown'],
      synthetic: true,
      review: review(),
    });

    assert.equal(exported.document.schema, ACQUISITION_DECISION_PACKET_SCHEMA);
    assert.equal(exported.document.target, 'candidate.example');
    assert.equal(exported.document.synthetic, true);
    assert.equal(exported.document.analystReview.state, 'reviewed');
    assert.deepEqual(exported.document.analystReview.reviewedChecks, [
      'eligibility',
      'counterparty',
      'transfer',
      'continuity',
      'legal',
    ]);
    assert.equal(exported.document.analystReview.rationale.length, 2_000);
    assert.match(exported.document.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.doesNotMatch(exported.content, /\u0000/u);
    assert.match(exported.content, /synthetic demonstration data/u);
    const verification = await verifyOfflineArtifact(exported.content);
    assert.equal(verification.artifact.schema, ACQUISITION_DECISION_PACKET_SCHEMA);
    assert.equal(verification.state, 'verified');
  });

  test('keeps incomplete analyst work explicitly draft', async () => {
    const exported = await buildAcquisitionDecisionPacket({
      target: 'candidate.example',
      generatedAt: NOW,
      decision: 'unsupported',
      reviewedChecks: ['eligibility'],
      review: review(),
    });

    assert.equal(exported.document.analystReview.decision, 'unresolved');
    assert.equal(exported.document.analystReview.state, 'draft');
    assert.deepEqual(exported.document.analystReview.outstandingChecks, [
      'counterparty',
      'transfer',
      'continuity',
      'legal',
    ]);
  });

  test('rejects an empty or path-like target', async () => {
    await assert.rejects(
      buildAcquisitionDecisionPacket({ target: '/candidate.example', review: review() }),
      /canonical domain/u,
    );
  });
});
