import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionFactContributor, DecisionFactPresentationDescriptor } from '../packages/evidence/decision-fact.mts';
import { decisionFactPresentation, presentLookupContributor } from '../frontend/src/lib/analysis/lookup-fact-presentation.ts';

test('contributor presentation preserves independent state and provenance without exporting references', () => {
  const limitations = ['This check was not requested.'];
  const input: DecisionFactContributor = {
    id: 'source-1', label: 'Analyst context', evidenceState: 'not_collected',
    provenance: 'analyst_supplied', observedAt: null, limitations,
    references: ['private-reference-not-for-display'],
  };
  const presented = presentLookupContributor(input);
  assert.deepEqual(presented, {
    id: 'source-1', label: 'Analyst context', evidenceState: 'not_collected',
    evidencePresentation: {
      label: 'Not collected', explanation: 'The source or check was not run for this fact.',
      tone: 'caution', icon: 'collection-not-run',
      assistiveText: 'This evidence was not collected, so there is no collection result to interpret.',
    },
    provenance: 'analyst_supplied',
    provenancePresentation: {
      label: 'Analyst supplied', explanation: 'The contributor was supplied through analyst-controlled context.',
      tone: 'neutral', icon: 'evidence-analyst-supplied',
      assistiveText: 'This contributor came from analyst-supplied context and retains that attribution.',
    },
    observedAt: null, limitations: ['This check was not requested.'],
  });
  assert.equal('references' in presented, false);
  limitations.push('Later source mutation');
  assert.deepEqual(presented.limitations, ['This check was not requested.']);
  for (const value of [presented, presented.limitations, presented.evidencePresentation, presented.provenancePresentation]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(input), false);
});

test('descriptor presentation copies only its display fields and does not freeze the input', () => {
  const descriptor: DecisionFactPresentationDescriptor & { internal: string } = {
    label: 'Review', explanation: 'A bounded comparison.', tone: 'neutral',
    icon: 'state-unknown', assistiveText: 'Review remains incomplete.', internal: 'not displayed',
  };
  const result = decisionFactPresentation(descriptor);
  assert.deepEqual(result, {
    label: 'Review', explanation: 'A bounded comparison.', tone: 'neutral',
    icon: 'state-unknown', assistiveText: 'Review remains incomplete.',
  });
  assert.notEqual(result, descriptor);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(descriptor), false);
});
