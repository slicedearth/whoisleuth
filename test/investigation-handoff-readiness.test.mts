import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildInvestigationHandoffReadiness } from '../frontend/src/lib/analysis/investigation-handoff-readiness.ts';

describe('investigation handoff readiness', () => {
  test('keeps an absent case as a workflow gap rather than a target finding', () => {
    const result = buildInvestigationHandoffReadiness({
      evidenceProjection: { observations: 2, relationships: 1 },
    });

    assert.equal(result.status, 'not_retained');
    assert.equal(result.checks[0]?.state, 'block');
    assert.match(result.limitations[0] ?? '', /workflow structure only/u);
  });

  test('requires a reviewed disposition and typed decision for structured handoff', () => {
    const result = buildInvestigationHandoffReadiness({
      caseRecord: {
        id: 'case-1',
        domain: 'candidate.example',
        disposition: 'unreviewed',
        evidencePins: [],
        decisions: [],
        assertions: [],
        actions: [],
      },
      evidenceProjection: { observations: 1, relationships: 0 },
    });

    assert.equal(result.status, 'needs_decision');
    assert.equal(result.checks.find((item) => item.id === 'disposition')?.state, 'caution');
    assert.equal(result.checks.find((item) => item.id === 'analyst_decision')?.state, 'caution');
  });

  test('reports a fully structured handoff without evaluating the underlying conclusion', () => {
    const result = buildInvestigationHandoffReadiness({
      caseRecord: {
        id: 'case-1',
        domain: 'candidate.example',
        disposition: 'suspicious',
        evidencePins: [{ id: 'pin-1' }],
        decisions: [{ id: 'decision-1', evidencePinIds: ['pin-1'] }],
        assertions: [{ kind: 'hypothesis', state: 'open' }],
        actions: [{ state: 'planned' }],
      },
      evidenceProjection: { observations: 3, relationships: 2 },
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.counts.openHypotheses, 1);
    assert.equal(result.counts.activeActions, 1);
    assert.ok(result.checks.every((item) => item.state === 'pass'));
    assert.equal('verdict' in result, false);
  });

  test('keeps unknowns and contradictions as cautions and bounds hostile arrays', () => {
    const result = buildInvestigationHandoffReadiness({
      caseRecord: {
        id: 'case-1',
        domain: 'candidate.example',
        disposition: 'confirmed_abuse',
        evidencePins: Array.from({ length: 80 }, (_, index) => ({ id: `pin-${index}` })),
        decisions: [{ id: 'decision-1', evidencePinIds: ['pin-0'] }],
        assertions: [
          { kind: 'unknown', state: 'open' },
          { kind: 'contradiction', state: 'open' },
          ...Array.from({ length: 80 }, () => ({ kind: 'unknown', state: 'open' })),
        ],
        actions: [],
      },
    });

    assert.equal(result.status, 'review_cautions');
    assert.equal(result.counts.evidencePins, 40);
    assert.equal(result.counts.openUnknowns, 49);
    assert.equal(result.counts.openContradictions, 1);
    assert.equal(result.checks.find((item) => item.id === 'open_questions')?.state, 'caution');
  });
});
