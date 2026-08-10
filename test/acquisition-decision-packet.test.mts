import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  buildAcquisitionDecisionPacket,
} from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import { buildAcquisitionDueDiligence } from '../frontend/src/lib/analysis/acquisition-due-diligence.ts';
import { sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';
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

async function redigest<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity, ...unsigned } = value;
  return {
    ...unsigned,
    integrity: { ...(integrity as Record<string, unknown>), digestSha256: await sha256ArtifactDigestV2(unsigned) },
  } as unknown as T;
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

  test('rejects re-digested omissions and non-canonical manual-check partitions', async () => {
    const exported = await buildAcquisitionDecisionPacket({
      target: 'candidate.example',
      generatedAt: NOW,
      decision: 'continue_manual_review',
      reviewedChecks: ['eligibility', 'counterparty', 'transfer', 'continuity', 'legal'],
      review: review(),
    });
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { ((value.evidenceReview as Record<string, unknown>).items as unknown[]) = []; },
      (value) => { ((value.evidenceReview as Record<string, unknown>).transitionDependencies as unknown[]) = []; },
      (value) => { ((value.evidenceReview as Record<string, unknown>).policyChecks as unknown[]) = []; },
      (value) => {
        const analystReview = value.analystReview as Record<string, unknown>;
        analystReview.reviewedChecks = [...(analystReview.reviewedChecks as string[])].reverse();
      },
      (value) => {
        const analystReview = value.analystReview as Record<string, unknown>;
        analystReview.outstandingChecks = ['eligibility'];
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(exported.document) as unknown as Record<string, unknown>;
      mutate(changed);
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(await redigest(changed))),
        /acquisition .*unsupported or malformed structure/iu,
      );
    }
  });

  test('rejects an empty or path-like target', async () => {
    await assert.rejects(
      buildAcquisitionDecisionPacket({ target: '/candidate.example', review: review() }),
      /canonical domain/u,
    );
  });
});
