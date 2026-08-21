import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  createDecisionFact,
  type DecisionFact,
  type DecisionFactNextActionInput,
} from '../packages/evidence/decision-fact.mts';
import type { EvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupClaimReadiness } from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import { buildLookupDecisionFacts } from '../frontend/src/lib/analysis/lookup-decision-facts.ts';
import {
  buildLookupDecisionSupport,
  buildLookupEvidenceQualityMatrix,
  type LookupDecisionSupport,
  type LookupNextAction,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import {
  buildLookupEvidenceImpactPlan,
  type LookupEvidenceImpactPlan,
} from '../frontend/src/lib/analysis/lookup-evidence-impact.ts';
import { buildLookupReviewActionModel } from '../frontend/src/lib/analysis/lookup-review-action-model.ts';
import type { LookupTaskView } from '../frontend/src/lib/analysis/lookup-presentation.ts';
import type { LookupSourceRefreshPlan } from '../frontend/src/lib/analysis/lookup-source-refresh.ts';

const EMPTY_IMPACT: LookupEvidenceImpactPlan = Object.freeze({
  version: 2,
  items: Object.freeze([]),
  total: 0,
  displayedCount: 0,
  omittedCount: 0,
  claimCount: 0,
  networkCollectionCount: 0,
  localReviewCount: 0,
  limitation: 'Additional observations do not guarantee a conclusion.',
});

function action(id: string, overrides: Partial<LookupNextAction> = {}): LookupNextAction {
  return {
    id,
    label: `Review ${id}`,
    reason: `The bounded ${id} evidence needs review.`,
    expectedOutcome: 'Clarify what the separately attributed evidence can and cannot support.',
    href: '#evidence-quality',
    priority: 'medium',
    ...overrides,
  };
}

function support(
  actions: readonly LookupNextAction[],
  task: LookupTaskView = 'general',
): LookupDecisionSupport {
  return {
    version: 1,
    guidance: {
      task,
      label: 'Bounded review',
      summary: 'Review separately attributed evidence.',
      questions: [],
      prioritySections: [],
    },
    entries: [],
    actions,
    counts: { conflicts: 0, uncertainties: 0 },
  };
}

function fact(
  id: string,
  nextActions: readonly DecisionFactNextActionInput[] = [],
): DecisionFact {
  return createDecisionFact({
    id,
    question: 'What does this bounded evidence establish?',
    conclusion: 'The retained observation supports no broader conclusion.',
    importance: 'medium',
    evidenceState: 'partial',
    freshness: 'unknown',
    consistency: 'not_applicable',
    contributors: [],
    references: ['#evidence-quality'],
    contradictions: [],
    limitations: [],
    nextActions,
  });
}

function actionInput(value: LookupNextAction): DecisionFactNextActionInput {
  return {
    id: value.id,
    label: value.label,
    reason: value.reason,
    expectedOutcome: value.expectedOutcome,
    href: value.href,
    importance: value.priority,
  };
}

function assertRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertRecursivelyFrozen(descriptor.value, seen);
  }
}

function integratedFixture() {
  const coverage: EvidenceCoverageLedger = {
    version: 1,
    entries: [{
      id: 'rdap', label: 'Registry RDAP', category: 'registry', state: 'complete',
      statusLabel: 'Complete', truncated: false, limitations: [], manualReviewSuggested: false,
    }, {
      id: 'whois', label: 'WHOIS', category: 'registry', state: 'partial',
      statusLabel: 'Partial', truncated: false,
      limitations: ['The referral chain ended before a complete result.'], manualReviewSuggested: true,
    }],
    counts: { complete: 1, not_found: 0, partial: 1, skipped: 0, unavailable: 0, unknown: 0, unsupported: 0 },
    completeCount: 1,
    limitedCount: 1,
  };
  const refreshPlan: LookupSourceRefreshPlan = {
    version: 1,
    stale: false,
    ageDays: 1,
    freshnessPolicy: {
      version: 1,
      id: 'task-default',
      task: 'acquisition',
      thresholdsDays: { registration: 30, network: 7, web: 3 },
    },
    items: [{
      id: 'whois',
      label: 'WHOIS',
      endpoint: '/api/whois',
      evidenceIds: ['whois'],
      reason: 'limited',
      requestDisclosure: 'Starts one bounded referral-aware WHOIS operation for this target.',
      supersedesObservedAt: '2026-08-20T00:00:00.000Z',
    }],
    limitations: [],
  };
  const decisionSupport = buildLookupDecisionSupport({
    task: 'acquisition',
    coverage,
    refreshPlan,
    registryComparison: { fields: [{
      label: 'Registrar',
      status: 'conflict',
      rdapDisplay: 'Registry publication',
      whoisDisplay: 'WHOIS publication',
    }] },
    registrarPublicationComparison: { fields: [] },
    targetType: 'domain',
    availableEvidence: ['dns'],
    hasCaseSection: true,
  });
  const quality = buildLookupEvidenceQualityMatrix({
    coverage,
    refreshPlan,
    timing: null,
    observedAt: '2026-08-20T00:00:00.000Z',
    now: '2026-08-21T00:00:00.000Z',
  });
  const decisionFacts = buildLookupDecisionFacts({
    decisionSupport,
    coverage,
    quality,
  });
  const readiness: LookupClaimReadiness = {
    version: 2,
    entries: [{
      id: 'controlled-change',
      label: 'Controlled-change planning',
      state: 'limited',
      conclusion: 'Whether a reviewed change can be prepared.',
      requiredEvidence: ['Registry WHOIS evidence'],
      missingEvidence: ['Registry WHOIS evidence'],
      requiredEvidenceIds: ['registry-whois'],
      missingEvidenceIds: ['registry-whois'],
      requirements: [{
        id: 'registry-whois',
        label: 'Registry WHOIS evidence',
        evidenceId: 'whois',
        mode: 'network_collection',
        href: '#registry',
        coverageState: 'partial',
        state: 'partial',
        limitations: ['The referral chain ended before a complete result.'],
      }],
      limitations: ['Registry WHOIS evidence is partial.'],
      href: '#registry',
    }],
    disagreements: [],
    counts: { ready: 0, limited: 1, not_ready: 0 },
    limitation: 'Readiness is not truth.',
  };
  const evidenceImpact = buildLookupEvidenceImpactPlan({
    readiness,
    quality,
    facts: decisionFacts,
  });
  return { decisionSupport, decisionFacts, evidenceImpact };
}

test('review-action model ranks all source actions once and exposes exact fact or contextual basis', () => {
  const fixture = integratedFixture();
  const model = buildLookupReviewActionModel({
    support: fixture.decisionSupport,
    facts: fixture.decisionFacts,
    evidenceImpact: fixture.evidenceImpact,
  });
  const queue = model.recommendedNextReviews;

  assert.deepEqual(queue.rankedItems.map((item) => item.id), [
    'review-priority-conflict',
    'review-acquisition-dependencies',
    'review-refresh-options',
    'review-case-handoff',
  ]);
  assert.deepEqual(queue.displayedItems.map((item) => item.id), queue.rankedItems.slice(0, 3).map((item) => item.id));
  assert.equal(queue.total, 4);
  assert.equal(queue.displayedCount, 3);
  assert.equal(queue.omittedCount, 1);
  assert.equal(queue.total, queue.displayedCount + queue.omittedCount);

  const conflict = queue.rankedItems[0]!;
  const acquisition = queue.rankedItems[1]!;
  const refresh = queue.rankedItems[2]!;
  const handoff = queue.rankedItems[3]!;
  assert.equal(conflict.basis, 'decision_fact');
  assert.deepEqual(conflict.contributingFactIds, ['lookup-decision:registry-whois-registrar']);
  assert.equal(refresh.basis, 'decision_fact');
  assert.deepEqual(refresh.contributingFactIds, ['lookup-evidence:whois']);
  assert.equal(acquisition.basis, 'task_context');
  assert.deepEqual(acquisition.contributingFactIds, []);
  assert.equal(handoff.basis, 'case_context');
  assert.deepEqual(handoff.contributingFactIds, []);
  assert.deepEqual(queue.contributingFactIds, [
    'lookup-decision:registry-whois-registrar',
    'lookup-evidence:whois',
  ]);

  assert.equal(model.evidenceImprovements.total, 1);
  assert.equal(model.evidenceImprovements.displayedItems[0]?.factId, 'lookup-evidence:whois');
  assert.equal(model.evidenceImprovements.displayedItems[0]?.basis, 'decision_fact');
  assertRecursivelyFrozen(model);
});

test('identical fact action copies deduplicate safely while conflicting copies fail closed', () => {
  const review = action('review-priority-conflict', { priority: 'high' });
  const identicalFacts = [
    fact('lookup-decision:first', [actionInput(review)]),
    fact('lookup-decision:second', [actionInput(review)]),
  ];
  const model = buildLookupReviewActionModel({
    support: support([review]),
    facts: identicalFacts,
    evidenceImpact: EMPTY_IMPACT,
  });
  assert.equal(model.recommendedNextReviews.total, 1);
  assert.deepEqual(model.recommendedNextReviews.rankedItems[0]?.contributingFactIds, [
    'lookup-decision:first',
    'lookup-decision:second',
  ]);

  const conflicting = createDecisionFact({
    ...JSON.parse(JSON.stringify(identicalFacts[1])),
    nextActions: [{ ...actionInput(review), reason: 'A conflicting canonical reason.' }],
  });
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([review]),
      facts: [identicalFacts[0]!, conflicting],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /ambiguous across Decision Facts/iu,
  );
});

test('review-action model rejects missing evidence facts, drifted copies, and unknown contextual actions', () => {
  const evidenceAction = action('review-priority-conflict', { priority: 'high' });
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([evidenceAction]),
      facts: [],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /missing its required canonical Decision Fact/iu,
  );

  const driftedFact = fact('lookup-decision:drift', [{
    ...actionInput(evidenceAction),
    expectedOutcome: 'A different canonical expected outcome is retained.',
  }]);
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([evidenceAction]),
      facts: [driftedFact],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /differs from its canonical Decision Fact copy/iu,
  );

  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([action('unknown-context-action')]),
      facts: [],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /no canonical fact or approved contextual rule/iu,
  );
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([action('review-page-identity')], 'acquisition'),
      facts: [],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /no canonical fact or approved contextual rule/iu,
  );
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([action('review-page-identity', { href: '#registry' })], 'brand'),
      facts: [],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /no canonical fact or approved contextual rule/iu,
  );
});

test('review-action model rejects duplicate or non-canonical facts, unsafe destinations, and count drift', () => {
  const evidenceAction = action('review-priority-conflict', { priority: 'high' });
  const canonicalFact = fact('lookup-decision:canonical', [actionInput(evidenceAction)]);
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([evidenceAction]),
      facts: [canonicalFact, canonicalFact],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /duplicate or over-limit identifiers/iu,
  );

  const nonCanonical = structuredClone(canonicalFact) as DecisionFact & { question: string };
  nonCanonical.question = ` ${nonCanonical.question} `;
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([evidenceAction]),
      facts: [nonCanonical],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /canonical Decision Fact values/iu,
  );

  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([{ ...evidenceAction, href: 'https://outside.invalid/' as `#${string}` }]),
      facts: [canonicalFact],
      evidenceImpact: EMPTY_IMPACT,
    }),
    /ambiguous or non-canonical/iu,
  );

  const driftedImpact = { ...EMPTY_IMPACT, total: 1 } as LookupEvidenceImpactPlan;
  assert.throws(
    () => buildLookupReviewActionModel({
      support: support([]),
      facts: [],
      evidenceImpact: driftedImpact,
    }),
    /counts did not reconcile/iu,
  );

  const fixture = integratedFixture();
  const modeCountDrift = {
    ...fixture.evidenceImpact,
    networkCollectionCount: 0,
    localReviewCount: fixture.evidenceImpact.total,
  } as LookupEvidenceImpactPlan;
  assert.throws(
    () => buildLookupReviewActionModel({
      support: fixture.decisionSupport,
      facts: fixture.decisionFacts,
      evidenceImpact: modeCountDrift,
    }),
    /displayed and omitted counts did not reconcile/iu,
  );

  const descriptorDrift = structuredClone(fixture.evidenceImpact) as unknown as {
    items: Array<{
      contributors: Array<{ provenancePresentation: typeof DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.derived }>;
      unattributedLimitations: string[];
    }>;
  };
  descriptorDrift.items[0]!.contributors[0]!.provenancePresentation =
    DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.derived;
  assert.throws(
    () => buildLookupReviewActionModel({
      support: fixture.decisionSupport,
      facts: fixture.decisionFacts,
      evidenceImpact: descriptorDrift as unknown as LookupEvidenceImpactPlan,
    }),
    /mismatched contributor provenance/iu,
  );
  descriptorDrift.items[0]!.contributors[0]!.provenancePresentation =
    DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.provider_reported;
  descriptorDrift.items[0]!.unattributedLimitations.push('Fabricated adjacent limitation.');
  assert.throws(
    () => buildLookupReviewActionModel({
      support: fixture.decisionSupport,
      facts: fixture.decisionFacts,
      evidenceImpact: descriptorDrift as unknown as LookupEvidenceImpactPlan,
    }),
    /mismatched adjacent limitations/iu,
  );
});

test('review-action model detaches later support, fact, impact, contributor, limitation, and descriptor mutations', () => {
  const fixture = integratedFixture();
  const mutableSupport = structuredClone(fixture.decisionSupport);
  const mutableFacts = structuredClone(fixture.decisionFacts);
  const mutableImpact = structuredClone(fixture.evidenceImpact);
  const model = buildLookupReviewActionModel({
    support: mutableSupport,
    facts: mutableFacts,
    evidenceImpact: mutableImpact,
  });

  const supportMutation = mutableSupport as unknown as { actions: Array<{ label: string }> };
  const factMutation = mutableFacts as unknown as Array<{
    id: string;
    contributors: Array<{ label: string }>;
  }>;
  const impactMutation = mutableImpact as unknown as {
    items: Array<{
      contributors: Array<{ limitations: string[] }>;
      evidencePresentation: typeof DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed;
    }>;
  };
  supportMutation.actions[0]!.label = 'Changed support action';
  factMutation.find((item) => item.id === 'lookup-evidence:whois')!.contributors[0]!.label = 'Changed contributor';
  impactMutation.items[0]!.contributors[0]!.limitations[0] = 'Changed limitation';
  impactMutation.items[0]!.evidencePresentation = DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed;

  assert.equal(model.recommendedNextReviews.rankedItems[0]?.label, 'Review the highest-priority disagreement');
  assert.equal(model.evidenceImprovements.displayedItems[0]?.contributors[0]?.label, 'WHOIS');
  assert.deepEqual(model.evidenceImprovements.displayedItems[0]?.contributors[0]?.limitations,
    ['The referral chain ended before a complete result.']);
  assert.equal(model.evidenceImprovements.displayedItems[0]?.evidenceState, 'partial');
  assertRecursivelyFrozen(model);
});
