import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DECISION_FACT_CONSISTENCY_STATES,
  DECISION_FACT_EVIDENCE_STATES,
  DECISION_FACT_FRESHNESS_STATES,
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  DECISION_FACT_PROVENANCE_STATES,
  createDecisionFact,
  type DecisionFact,
  type DecisionFactContributorInput,
  type DecisionFactInput,
} from '../packages/evidence/decision-fact.mts';
import { buildEvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import {
  buildLookupDecisionSupport,
  buildLookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import { buildLookupDecisionFacts } from '../frontend/src/lib/analysis/lookup-decision-facts.ts';
import {
  MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS,
  buildLookupAtAGlanceModel,
  type LookupAtAGlanceAggregate,
} from '../frontend/src/lib/analysis/lookup-at-a-glance-model.ts';
import type { LookupSourceRefreshPlan } from '../frontend/src/lib/analysis/lookup-source-refresh.ts';

function contributor(
  id: string,
  overrides: Partial<DecisionFactContributorInput> = {},
): DecisionFactContributorInput {
  return {
    id,
    label: `Source ${id}`,
    provenance: 'direct_observation',
    evidenceState: 'observed',
    references: [],
    observedAt: '2026-08-20T00:00:00.000Z',
    limitations: [],
    ...overrides,
  };
}

function factInput(
  id: string,
  overrides: Partial<DecisionFactInput> = {},
): DecisionFactInput {
  return {
    id,
    question: 'What does the retained evidence establish?',
    conclusion: 'The bounded evidence supports only the stated observation.',
    importance: 'medium',
    evidenceState: 'observed',
    freshness: 'current',
    consistency: 'not_applicable',
    contributors: [],
    references: [],
    contradictions: [],
    limitations: [],
    nextActions: [],
    ...overrides,
  };
}

function group(
  groups: readonly LookupAtAGlanceAggregate[],
  id: LookupAtAGlanceAggregate['id'],
): LookupAtAGlanceAggregate {
  const retained = groups.find((candidate) => candidate.id === id);
  assert.ok(retained);
  return retained;
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

const refreshPlan: LookupSourceRefreshPlan = {
  version: 1,
  stale: false,
  ageDays: 1,
  freshnessPolicy: {
    version: 1,
    id: 'task-default',
    task: 'general',
    thresholdsDays: { registration: 30, network: 7, web: 3 },
  },
  items: [],
  limitations: [],
};

describe('Lookup At-a-glance Decision Fact projection', () => {
  test('uses exact canonical membership while preserving prior counts, destinations, and source attribution', () => {
    const coverage = buildEvidenceCoverageLedger([
      { id: 'external-intelligence', label: 'External context', category: 'external', status: 'unsupported' },
      { id: 'security-txt', label: 'Security contact', category: 'web', status: 'skipped' },
      { id: 'tls', label: 'TLS', category: 'web', status: 'not_found' },
      { id: 'http', label: 'HTTP', category: 'web', status: 'indeterminate' },
      { id: 'dns', label: 'DNS', category: 'network', status: 'unavailable' },
      {
        id: 'whois',
        label: 'WHOIS',
        category: 'registry',
        status: 'partial',
        limitations: ['The referral chain ended before a complete response was retained.'],
      },
      { id: 'rdap', label: 'Registry RDAP', category: 'registry', status: 'complete' },
    ]);
    const quality = buildLookupEvidenceQualityMatrix({
      coverage,
      refreshPlan,
      timing: null,
      observedAt: '2026-08-20T00:00:00.000Z',
      now: '2026-08-21T00:00:00.000Z',
    });
    const support = buildLookupDecisionSupport({
      task: 'general',
      coverage,
      refreshPlan,
      registryComparison: {
        fields: [{
          label: 'Registrar',
          status: 'conflict',
          rdapDisplay: 'Example Registry Registrar',
          whoisDisplay: 'Example WHOIS Registrar',
        }, {
          label: 'Statuses',
          status: 'whois_incomplete',
          rdapDisplay: 'transfer prohibited',
          whoisDisplay: 'Not observed in partial evidence',
        }],
      },
      registrarPublicationComparison: { fields: [] },
      targetType: 'domain',
      availableEvidence: [],
    });
    const facts = buildLookupDecisionFacts({ decisionSupport: support, coverage, quality });
    const model = buildLookupAtAGlanceModel(facts);
    const complete = group(model.groups, 'complete');
    const limited = group(model.groups, 'limited');
    const disagreements = group(model.groups, 'disagreements');
    const unresolved = group(model.groups, 'unresolved');

    assert.deepEqual(model.groups.map((aggregate) => aggregate.id), [
      'complete',
      'limited',
      'disagreements',
      'unresolved',
    ]);
    assert.deepEqual(complete.contributingFactIds, ['lookup-evidence:rdap']);
    assert.deepEqual(limited.contributingFactIds, [
      'lookup-evidence:dns',
      'lookup-evidence:http',
      'lookup-evidence:whois',
    ]);
    assert.deepEqual(disagreements.contributingFactIds, [
      'lookup-decision:registry-whois-registrar',
    ]);
    assert.deepEqual(unresolved.contributingFactIds, [
      'lookup-decision:registry-whois-statuses-whois_incomplete',
    ]);
    assert.equal(complete.count, quality.completeCount);
    assert.equal(limited.count, quality.limitedCount);
    assert.equal(disagreements.count, support.counts.conflicts);
    assert.equal(unresolved.count, support.counts.uncertainties);
    assert.deepEqual(
      [...complete.contributingFactIds, ...limited.contributingFactIds],
      [
        'lookup-evidence:rdap',
        'lookup-evidence:dns',
        'lookup-evidence:http',
        'lookup-evidence:whois',
      ],
    );
    for (const excludedId of [
      'lookup-evidence:external-intelligence',
      'lookup-evidence:security-txt',
      'lookup-evidence:tls',
    ]) {
      assert.equal(model.groups.some((aggregate) => aggregate.contributingFactIds.includes(excludedId)), false);
    }
    for (const aggregate of model.groups) {
      assert.equal(aggregate.count, aggregate.displayedItems.length + aggregate.omittedCount);
      assert.equal(aggregate.contributingFactIds.length, aggregate.count);
      assert.match(aggregate.destination, /^#[a-z0-9]/u);
    }
    assert.equal(complete.destination, '#source-quality');
    assert.equal(limited.destination, '#source-quality');
    assert.ok(complete.displayedItems.every((item) => item.destination === '#source-quality'));
    assert.ok(limited.displayedItems.every((item) => item.destination === '#source-quality'));
    assert.equal(disagreements.destination, '#registry');
    assert.equal(unresolved.destination, '#registry');
    assert.equal(disagreements.displayedItems[0]?.destination, '#registry');
    assert.equal(unresolved.displayedItems[0]?.destination, '#registry');

    const decisionItem = disagreements.displayedItems[0]!;
    assert.deepEqual(decisionItem.contributors.map((source) => source.label), ['Registry RDAP', 'WHOIS']);
    assert.deepEqual(decisionItem.contributors.map((source) => source.id), ['evidence:rdap', 'evidence:whois']);
    assert.deepEqual(decisionItem.contributors[0]?.limitations, []);
    assert.deepEqual(
      decisionItem.contributors[1]?.limitations,
      ['The referral chain ended before a complete response was retained.'],
    );
    assert.deepEqual(decisionItem.limitations, []);
    assert.equal(decisionItem.statePresentation.label, 'Contradictory');
    assert.equal(limited.displayedItems.find((item) => item.factId === 'lookup-evidence:whois')
      ?.contributors[0]?.evidencePresentation.label, 'Partial');
    assertRecursivelyFrozen(model);
  });

  test('publishes descriptors for every canonical state without favourable observed or current semantics', () => {
    const vocabularies = [
      [DECISION_FACT_EVIDENCE_STATES, DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState],
      [DECISION_FACT_FRESHNESS_STATES, DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness],
      [DECISION_FACT_CONSISTENCY_STATES, DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency],
      [DECISION_FACT_PROVENANCE_STATES, DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance],
    ] as const;
    for (const [states, descriptors] of vocabularies) {
      assert.deepEqual(Object.keys(descriptors), states);
      for (const descriptor of Object.values(descriptors)) {
        assert.ok(descriptor.label.length > 0);
        assert.ok(descriptor.explanation.length > 0);
        assert.ok(descriptor.icon.length > 0);
        assert.ok(descriptor.assistiveText.length > 0);
        assert.doesNotMatch(descriptor.assistiveText, /\b(?:is safe|is legitimate|is owned|evidence is absent|nothing was found)\b/iu);
      }
    }
    assert.equal(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed.tone, 'neutral');
    assert.equal(DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.current.tone, 'neutral');
    assert.match(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed.assistiveText,
      /does not establish safety, legitimacy, ownership, or a favourable result/iu,
    );
    assert.match(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.not_observed_in_bounded_evidence.explanation,
      /not a generic absence claim/iu,
    );
  });

  test('deduplicates exact IDs, rejects ambiguous IDs, and uses deterministic bounded ordering', () => {
    const duplicate = factInput('lookup-evidence:duplicate');
    const deduplicated = buildLookupAtAGlanceModel(
      [duplicate, duplicate] as unknown as readonly DecisionFact[],
    );
    assert.equal(group(deduplicated.groups, 'complete').count, 1);

    assert.throws(
      () => buildLookupAtAGlanceModel([
        duplicate,
        { ...duplicate, conclusion: 'A conflicting value for the same identifier.' },
      ] as unknown as readonly DecisionFact[]),
      /identifier is ambiguous/iu,
    );

    const facts = Array.from({ length: MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS + 6 }, (_, index) => (
      createDecisionFact(factInput(`lookup-evidence:${String(index).padStart(2, '0')}`))
    )).reverse();
    const complete = group(buildLookupAtAGlanceModel(facts).groups, 'complete');
    assert.equal(complete.count, MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS + 6);
    assert.equal(complete.displayedItems.length, MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS);
    assert.equal(complete.omittedCount, 6);
    assert.equal(complete.count, complete.displayedItems.length + complete.omittedCount);
    assert.deepEqual(
      complete.contributingFactIds,
      [...complete.contributingFactIds].sort(),
    );
    assert.deepEqual(
      complete.displayedItems.map((item) => item.factId),
      complete.contributingFactIds.slice(0, MAX_LOOKUP_AT_A_GLANCE_DISPLAYED_ITEMS),
    );
  });

  test('detaches caller-owned values, freezes output, and never exposes an external destination', () => {
    const mutable = JSON.parse(JSON.stringify(factInput('lookup-decision:mutable', {
      evidenceState: 'partial',
      freshness: 'unknown',
      consistency: 'unknown',
      contributors: [contributor('source:a', {
        label: 'First attributed source',
        limitations: ['The first source is incomplete.'],
      }), contributor('source:b', {
        label: 'Second attributed source',
        provenance: 'provider_reported',
        limitations: ['The second source is time-limited.'],
      })],
      references: [
        'https://outside.invalid/review',
        'javascript:alert(1)',
        '#evidence-http',
        'inspection-destination:#evidence-page',
      ],
      limitations: ['The first source is incomplete.', 'The second source is time-limited.'],
    }))) as Record<string, unknown>;
    const fallback = createDecisionFact(factInput('lookup-decision:external-only', {
      consistency: 'unknown',
      references: ['https://outside.invalid/review'],
    }));
    const model = buildLookupAtAGlanceModel(
      [mutable, fallback] as unknown as readonly DecisionFact[],
    );
    const unresolved = group(model.groups, 'unresolved');
    const mutableItem = unresolved.displayedItems.find((item) => item.factId === 'lookup-decision:mutable')!;
    const fallbackItem = unresolved.displayedItems.find((item) => item.factId === 'lookup-decision:external-only')!;

    assert.equal(mutableItem.destination, '#evidence-page');
    assert.equal(fallbackItem.destination, '#source-quality');
    assert.deepEqual(mutableItem.contributors.map((source) => source.label), [
      'First attributed source',
      'Second attributed source',
    ]);
    assert.deepEqual(mutableItem.contributors.map((source) => source.limitations), [
      ['The first source is incomplete.'],
      ['The second source is time-limited.'],
    ]);
    assert.deepEqual(mutableItem.limitations, []);

    mutable.conclusion = 'Changed after projection.';
    const mutableContributors = mutable.contributors as Array<Record<string, unknown>>;
    mutableContributors[0]!.label = 'Changed source label';
    (mutable.references as string[]).push('#changed');
    assert.equal(mutableItem.detail, 'The bounded evidence supports only the stated observation.');
    assert.equal(mutableItem.contributors[0]?.label, 'First attributed source');
    assert.equal(mutableItem.destination, '#evidence-page');

    for (const aggregate of model.groups) {
      assert.doesNotMatch(aggregate.destination, /^(?:https?:|javascript:)/iu);
      for (const item of aggregate.displayedItems) {
        assert.doesNotMatch(item.destination, /^(?:https?:|javascript:)/iu);
      }
    }
    assertRecursivelyFrozen(model);
  });
});
