import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DECISION_FACT_CONSISTENCY_STATES,
  DECISION_FACT_EVIDENCE_STATES,
  DECISION_FACT_FRESHNESS_STATES,
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  DECISION_FACT_PRESENTATION_LABELS,
  DECISION_FACT_PROVENANCE_STATES,
  DECISION_FACT_VERSION,
  MAX_DECISION_FACT_PROJECTION_FACTS,
  MAX_DECISION_FACT_PROJECTION_BYTES,
  MAX_DECISION_FACT_PROJECTION_SOURCES,
  MAX_DECISION_FACT_CONTRIBUTORS,
  MAX_DECISION_FACT_CONTRADICTIONS,
  MAX_DECISION_FACT_LIMITATIONS,
  MAX_DECISION_FACT_NEXT_ACTIONS,
  MAX_DECISION_FACT_REFERENCES,
  MAX_DECISION_FACTS,
  buildDecisionFacts,
  createDecisionFact,
  projectDecisionFacts,
  type DecisionFactContributorInput,
  type DecisionFactInput,
  type DecisionFactNextActionInput,
} from '../packages/evidence/decision-fact.mts';
import { buildLookupDecisionFacts } from '../frontend/src/lib/analysis/lookup-decision-facts.ts';
import type {
  EvidenceCoverageEntry,
  EvidenceCoverageLedger,
  EvidenceCoverageState,
} from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type {
  LookupDecisionSupport,
  LookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';

function contributor(
  id: string,
  overrides: Partial<DecisionFactContributorInput> = {},
): DecisionFactContributorInput {
  return {
    id,
    label: `Source ${id}`,
    provenance: 'direct_observation',
    evidenceState: 'observed',
    references: [`reference:${id}`],
    observedAt: '2026-08-20T01:02:03+10:00',
    limitations: [],
    ...overrides,
  };
}

function action(id: string): DecisionFactNextActionInput {
  return {
    id,
    label: `Review ${id}`,
    reason: 'The attributed evidence requires deliberate review.',
    expectedOutcome: 'Record whether the bounded observation supports a reviewed conclusion.',
    href: '#evidence-quality',
    importance: 'medium',
  };
}

function fact(id: string, overrides: Partial<DecisionFactInput> = {}): DecisionFactInput {
  return {
    id,
    question: 'What does the retained evidence establish?',
    conclusion: 'The bounded evidence supports only the stated observation.',
    importance: 'medium',
    evidenceState: 'observed',
    freshness: 'current',
    consistency: 'consistent',
    contributors: [],
    references: [],
    contradictions: [],
    limitations: [],
    nextActions: [],
    ...overrides,
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

describe('Decision Fact v1 canonical model', () => {
  test('publishes separate bounded vocabularies and stable presentation semantics', () => {
    assert.equal(DECISION_FACT_VERSION, 1);
    assert.deepEqual(DECISION_FACT_EVIDENCE_STATES, [
      'observed',
      'not_observed_in_bounded_evidence',
      'not_collected',
      'partial',
      'unsupported',
      'unavailable',
      'unknown',
    ]);
    assert.deepEqual(DECISION_FACT_FRESHNESS_STATES, ['current', 'stale', 'unknown', 'not_applicable']);
    assert.deepEqual(DECISION_FACT_CONSISTENCY_STATES, ['consistent', 'contradictory', 'unknown', 'not_applicable']);
    assert.deepEqual(DECISION_FACT_PROVENANCE_STATES, [
      'direct_observation',
      'provider_reported',
      'analyst_supplied',
      'derived',
    ]);
    assert.equal(DECISION_FACT_PRESENTATION_LABELS.evidenceState.not_observed_in_bounded_evidence, 'Not observed in bounded evidence');
    assert.equal(DECISION_FACT_PRESENTATION_LABELS.freshness.unknown, 'Freshness unknown');
    assert.equal(DECISION_FACT_PRESENTATION_LABELS.consistency.contradictory, 'Contradictory');
    assert.equal(DECISION_FACT_PRESENTATION_LABELS.provenance.provider_reported, 'Provider reported');
    assert.equal(DECISION_FACT_PRESENTATION_LABELS.completeness.complete, 'Complete bounded collection');
    assert.deepEqual(Object.keys(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState), DECISION_FACT_EVIDENCE_STATES);
    assert.deepEqual(Object.keys(DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness), DECISION_FACT_FRESHNESS_STATES);
    assert.deepEqual(Object.keys(DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency), DECISION_FACT_CONSISTENCY_STATES);
    assert.deepEqual(Object.keys(DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance), DECISION_FACT_PROVENANCE_STATES);
    for (const descriptor of [
      ...Object.values(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState),
      ...Object.values(DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness),
      ...Object.values(DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency),
      ...Object.values(DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance),
    ]) {
      assert.ok(descriptor.label.length > 0);
      assert.ok(descriptor.explanation.length > 0);
      assert.ok(['neutral', 'caution', 'conflict'].includes(descriptor.tone));
      assert.match(descriptor.icon, /^[a-z]+(?:-[a-z]+)*$/u);
      assert.ok(descriptor.assistiveText.length > 0);
      assert.doesNotMatch(descriptor.assistiveText, /\b(?:is safe|is legitimate|is owned|evidence is absent|nothing was found)\b/iu);
    }
    assert.equal(DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed.tone, 'neutral');
    assert.equal(DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.current.tone, 'neutral');
    assertRecursivelyFrozen(DECISION_FACT_PRESENTATION_DESCRIPTORS);
    assertRecursivelyFrozen(DECISION_FACT_PRESENTATION_LABELS);
  });

  test('detaches, canonically orders, deduplicates, counts, and recursively freezes retained values', () => {
    const sourceA = contributor('source:a', {
      references: ['reference:z', 'reference:a', 'reference:a'],
      limitations: ['Second limitation.', 'First limitation.', 'First limitation.'],
    });
    const sourceB = contributor('source:b', { observedAt: 'not-a-timestamp' });
    const mutable = fact('fact:z', {
      contributors: [sourceB, sourceA, sourceA],
      references: ['reference:z', 'reference:a', 'reference:z'],
      contradictions: ['Second contradiction.', 'First contradiction.', 'First contradiction.'],
      limitations: ['Second limitation.', 'First limitation.', 'First limitation.'],
      nextActions: [action('action:b'), action('action:a'), action('action:a')],
    });
    const earlier = fact('fact:a');
    const result = buildDecisionFacts([mutable, earlier, earlier]);

    assert.deepEqual(result.map((item) => item.id), ['fact:a', 'fact:z']);
    const retained = result[1]!;
    assert.deepEqual(retained.contributors.map((item) => item.id), ['source:a', 'source:b']);
    assert.equal(retained.contributorCount, 2);
    assert.deepEqual(retained.contributors[0]?.references, ['reference:a', 'reference:z']);
    assert.deepEqual(retained.contributors[0]?.limitations, ['First limitation.', 'Second limitation.']);
    assert.equal(retained.contributors[0]?.observedAt, '2026-08-19T15:02:03.000Z');
    assert.equal(retained.contributors[1]?.observedAt, null);
    assert.deepEqual(retained.references, ['reference:a', 'reference:z']);
    assert.deepEqual(retained.contradictions, ['First contradiction.', 'Second contradiction.']);
    assert.deepEqual(retained.nextActions.map((item) => item.id), ['action:a', 'action:b']);
    assertRecursivelyFrozen(result);
    assert.deepEqual(Object.getOwnPropertyDescriptor(retained, 'id'), {
      value: 'fact:z',
      writable: false,
      enumerable: true,
      configurable: false,
    });

    (mutable.contributors as DecisionFactContributorInput[])[0] = contributor('source:changed');
    (mutable.references as string[]).push('reference:changed');
    (sourceA.references as string[]).push('reference:changed');
    assert.deepEqual(retained.contributors.map((item) => item.id), ['source:a', 'source:b']);
    assert.deepEqual(retained.references, ['reference:a', 'reference:z']);
    assert.deepEqual(retained.contributors[0]?.references, ['reference:a', 'reference:z']);
  });

  test('uses deterministic code-unit ordering for canonical text lists', () => {
    const retained = createDecisionFact(fact('fact:code-unit-order', {
      references: ['z-reference', 'ä-reference', 'a-reference', 'Z-reference'],
    }));
    assert.deepEqual(retained.references, [
      'Z-reference',
      'a-reference',
      'z-reference',
      'ä-reference',
    ]);
  });

  test('applies exact caps before reading or copying excess values', () => {
    let excessReads = 0;
    const contributors = Array.from(
      { length: MAX_DECISION_FACT_CONTRIBUTORS },
      (_, index) => contributor(`source:${String(index).padStart(2, '0')}`),
    );
    Object.defineProperty(contributors, String(MAX_DECISION_FACT_CONTRIBUTORS), {
      configurable: true,
      enumerable: true,
      get() {
        excessReads += 1;
        return contributor('source:excess');
      },
    });
    contributors.length = 1_000_000;

    const references = Array.from(
      { length: MAX_DECISION_FACT_REFERENCES },
      (_, index) => `reference:${String(index).padStart(2, '0')}`,
    );
    Object.defineProperty(references, String(MAX_DECISION_FACT_REFERENCES), {
      configurable: true,
      enumerable: true,
      get() {
        excessReads += 1;
        return 'reference:excess';
      },
    });
    references.length = 1_000_000;

    const nextActions = Array.from(
      { length: MAX_DECISION_FACT_NEXT_ACTIONS },
      (_, index) => action(`action:${index}`),
    );
    Object.defineProperty(nextActions, String(MAX_DECISION_FACT_NEXT_ACTIONS), {
      configurable: true,
      enumerable: true,
      get() {
        excessReads += 1;
        return action('action:excess');
      },
    });
    nextActions.length = 1_000_000;

    const contradictions = Array.from(
      { length: MAX_DECISION_FACT_CONTRADICTIONS },
      (_, index) => `Contradiction ${index}.`,
    );
    contradictions.push('Excess contradiction.');
    const limitations = Array.from(
      { length: MAX_DECISION_FACT_LIMITATIONS },
      (_, index) => `Limitation ${index}.`,
    );
    limitations.push('Excess limitation.');

    const retained = createDecisionFact(fact('fact:bounded', {
      contributors,
      references,
      contradictions,
      limitations,
      nextActions,
    }));
    assert.equal(retained.contributors.length, MAX_DECISION_FACT_CONTRIBUTORS);
    assert.equal(retained.references.length, MAX_DECISION_FACT_REFERENCES);
    assert.equal(retained.contradictions.length, MAX_DECISION_FACT_CONTRADICTIONS);
    assert.equal(retained.limitations.length, MAX_DECISION_FACT_LIMITATIONS);
    assert.equal(retained.nextActions.length, MAX_DECISION_FACT_NEXT_ACTIONS);
    assert.equal(excessReads, 0);

    const facts = Array.from({ length: MAX_DECISION_FACTS }, (_, index) => fact(`fact:${String(index).padStart(2, '0')}`));
    Object.defineProperty(facts, String(MAX_DECISION_FACTS), {
      configurable: true,
      enumerable: true,
      get() {
        excessReads += 1;
        return fact('fact:excess');
      },
    });
    facts.length = 1_000_000;
    assert.equal(buildDecisionFacts(facts).length, MAX_DECISION_FACTS);
    assert.equal(excessReads, 0);
  });

  test('fails closed on accessors, unstable descriptors, sparse arrays, custom iteration, and invalid values', () => {
    let accessorReads = 0;
    const accessor = { ...fact('fact:accessor') } as Record<string, unknown>;
    Object.defineProperty(accessor, 'question', {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return 'Must not be read';
      },
    });
    assert.throws(() => createDecisionFact(accessor), /ordinary data/iu);
    assert.equal(accessorReads, 0);

    let descriptorReads = 0;
    const unstable = new Proxy({ ...fact('fact:unstable') }, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'conclusion' || !descriptor || !('value' in descriptor)) return descriptor;
        descriptorReads += 1;
        return { ...descriptor, value: descriptorReads % 2 ? 'First conclusion.' : 'Second conclusion.' };
      },
    });
    assert.throws(() => createDecisionFact(unstable), /stable ordinary data descriptors/iu);

    const sparseContributors = [contributor('source:a')];
    sparseContributors.length = 2;
    assert.throws(
      () => createDecisionFact(fact('fact:sparse', { contributors: sparseContributors })),
      /dense ordinary indexed data/iu,
    );

    let iteratorCalls = 0;
    const customContributors = [contributor('source:a')];
    Object.defineProperty(customContributors, Symbol.iterator, {
      configurable: true,
      value() {
        iteratorCalls += 1;
        return [][Symbol.iterator]();
      },
    });
    assert.throws(
      () => createDecisionFact(fact('fact:iterator', { contributors: customContributors })),
      /custom iteration/iu,
    );
    assert.equal(iteratorCalls, 0);

    let coercions = 0;
    const coercible = { toString() { coercions += 1; return 'Coerced conclusion.'; } };
    assert.throws(
      () => createDecisionFact({ ...fact('fact:coercion'), conclusion: coercible }),
      /bounded text/iu,
    );
    assert.equal(coercions, 0);

    assert.throws(() => createDecisionFact(null), /plain object/iu);
    assert.throws(
      () => createDecisionFact({ ...fact('fact:state'), evidenceState: 'absent' }),
      /unsupported state/iu,
    );
    assert.throws(
      () => createDecisionFact(fact('fact:href', {
        nextActions: [{ ...action('action:external'), href: 'https://external.example/' as `#${string}` }],
      })),
      /internal review fragment/iu,
    );
    assert.throws(
      () => buildDecisionFacts([
        fact('fact:duplicate'),
        fact('fact:duplicate', { conclusion: 'A conflicting duplicate value.' }),
      ]),
      /identifier is ambiguous/iu,
    );
    assert.throws(
      () => createDecisionFact(fact('fact:contributor-duplicate', {
        contributors: [
          contributor('source:duplicate'),
          contributor('source:duplicate', { label: 'Different source identity' }),
        ],
      })),
      /contributor identifier is ambiguous/iu,
    );
  });
});

const COVERAGE_FIXTURES: ReadonlyArray<Readonly<{
  id: string;
  label: string;
  state: EvidenceCoverageState;
  category: EvidenceCoverageEntry['category'];
  expected: string;
}>> = [
  { id: 'rdap', label: 'Registry RDAP', state: 'complete', category: 'registry', expected: 'observed' },
  { id: 'dns', label: 'DNS', state: 'not_found', category: 'network', expected: 'not_observed_in_bounded_evidence' },
  { id: 'tls', label: 'TLS', state: 'skipped', category: 'web', expected: 'not_collected' },
  { id: 'whois', label: 'WHOIS', state: 'partial', category: 'registry', expected: 'partial' },
  { id: 'page-identity', label: 'Page identity', state: 'unsupported', category: 'web', expected: 'unsupported' },
  { id: 'http', label: 'HTTP', state: 'unavailable', category: 'web', expected: 'unavailable' },
  { id: 'analysis', label: 'Derived analysis', state: 'unknown', category: 'analysis', expected: 'unknown' },
  { id: 'sslbl-certificate', label: 'Certificate warning data', state: 'complete', category: 'external', expected: 'observed' },
];

function coverageLedger(): EvidenceCoverageLedger {
  const entries: EvidenceCoverageEntry[] = COVERAGE_FIXTURES.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    state: item.state,
    statusLabel: item.state.replaceAll('_', ' '),
    truncated: false,
    limitations: item.state === 'partial' ? ['The source returned a bounded partial observation.'] : [],
    manualReviewSuggested: ['partial', 'unavailable', 'unknown'].includes(item.state),
  }));
  const counts: Record<EvidenceCoverageState, number> = {
    complete: 0,
    not_found: 0,
    partial: 0,
    skipped: 0,
    unavailable: 0,
    unknown: 0,
    unsupported: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return {
    version: 1,
    entries,
    counts,
    completeCount: counts.complete,
    limitedCount: counts.partial + counts.unavailable + counts.unknown,
  };
}

function qualityMatrix(coverage: EvidenceCoverageLedger): LookupEvidenceQualityMatrix {
  return {
    version: 1,
    observedAt: '2026-08-20T00:00:00.000Z',
    totalMs: 1,
    entries: coverage.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      category: entry.category,
      endpointClass: 'Fixture source',
      description: 'Fixture evidence.',
      state: entry.state,
      statusLabel: entry.statusLabel,
      truncated: entry.truncated,
      observedAt: entry.id === 'analysis'
        ? 'not-a-timestamp'
        : ['tls', 'page-identity', 'http'].includes(entry.id)
          ? null
          : '2026-08-20T00:00:00.000Z',
      ageDays: entry.id === 'whois' ? 31 : ['tls', 'page-identity', 'http', 'analysis'].includes(entry.id) ? null : 1,
      durationMs: null,
      timingOutcome: null,
      refreshAvailable: entry.id === 'whois',
      requestDisclosure: entry.id === 'whois' ? 'Starts one bounded WHOIS review request.' : null,
      limitations: entry.limitations,
      supports: [],
    })),
    completeCount: coverage.completeCount,
    limitedCount: coverage.limitedCount,
    stale: true,
    ageDays: 1,
    freshnessPolicy: {
      version: 1,
      id: 'task-default',
      task: 'general',
      thresholdsDays: { registration: 30, network: 7, web: 3 },
    },
  };
}

function decisionSupport(): LookupDecisionSupport {
  return {
    version: 1,
    guidance: {
      task: 'general',
      label: 'General investigation',
      summary: 'Keep evidence states and source identities separate.',
      questions: ['Which attributed observations support the conclusion?'],
      prioritySections: ['overview', 'registry'],
    },
    entries: [{
      id: 'registry-conflict',
      state: 'conflict',
      importance: 'high',
      title: 'Registration sources disagree',
      detail: 'The separately published values differ.',
      sources: ['Registry RDAP', 'WHOIS'],
      href: '#registry',
    }, {
      id: 'registration-uncertain',
      state: 'uncertain',
      importance: 'low',
      title: 'Registration comparison is incomplete',
      detail: 'One attributed source is partial.',
      sources: ['WHOIS'],
      href: '#registry',
    }, {
      id: 'unattributed-uncertain',
      state: 'uncertain',
      importance: 'low',
      title: 'A derived comparison remains uncertain',
      detail: 'No retained source state resolves the comparison.',
      sources: ['Unmapped source'],
      href: '#evidence-quality',
    }],
    actions: [{
      id: 'review-priority-conflict',
      label: 'Review the disagreement',
      reason: 'Separately published registration values differ.',
      expectedOutcome: 'Record which source is current, authoritative, or unresolved.',
      href: '#registry',
      priority: 'high',
    }, {
      id: 'inspect-limited-source',
      label: 'Inspect the limited source',
      reason: 'Partial evidence limits the comparison.',
      expectedOutcome: 'Clarify what the source can and cannot support.',
      href: '#evidence-quality',
      priority: 'medium',
    }],
    counts: { conflicts: 1, uncertainties: 2 },
  };
}

describe('Lookup Decision Fact projection', () => {
  test('maps every evidence state without turning bounded non-observation into absence', () => {
    const coverage = coverageLedger();
    const quality = qualityMatrix(coverage);
    const facts = buildLookupDecisionFacts({
      decisionSupport: decisionSupport(),
      coverage,
      quality,
    });

    for (const fixture of COVERAGE_FIXTURES) {
      const projected = facts.find((item) => item.id === `lookup-evidence:${fixture.id}`);
      assert.equal(projected?.evidenceState, fixture.expected, fixture.id);
    }
    const boundedNonObservation = facts.find((item) => item.id === 'lookup-evidence:dns');
    assert.equal(boundedNonObservation?.evidenceState, 'not_observed_in_bounded_evidence');
    assert.match(boundedNonObservation?.conclusion ?? '', /bounded evidence/iu);
    assert.match(boundedNonObservation?.conclusion ?? '', /does not establish generic absence/iu);
    assert.equal(facts.find((item) => item.id === 'lookup-evidence:tls')?.freshness, 'not_applicable');
    assert.equal(facts.find((item) => item.id === 'lookup-evidence:whois')?.freshness, 'stale');
    assert.equal(facts.find((item) => item.id === 'lookup-evidence:analysis')?.freshness, 'unknown');
    assert.equal(
      facts.find((item) => item.id === 'lookup-evidence:analysis')?.contributors[0]?.observedAt,
      null,
    );
    assert.ok(
      facts.find((item) => item.id === 'lookup-evidence:sslbl-certificate')
        ?.references.includes('#external-intelligence'),
    );
  });

  test('keeps conflicts, uncertainty, source identities, timestamps, counts, and review actions separately attributed', () => {
    const coverage = coverageLedger();
    const support = decisionSupport();
    const quality = qualityMatrix(coverage);
    const before = structuredClone({ coverage, support, quality });
    const facts = buildLookupDecisionFacts({ decisionSupport: support, coverage, quality });

    const conflict = facts.find((item) => item.id === 'lookup-decision:registry-conflict');
    assert.equal(conflict?.consistency, 'contradictory');
    assert.equal(conflict?.evidenceState, 'partial');
    assert.equal(conflict?.freshness, 'stale');
    assert.deepEqual(conflict?.contributors.map((item) => item.id), ['evidence:rdap', 'evidence:whois']);
    assert.deepEqual(conflict?.contributors.map((item) => item.label), ['Registry RDAP', 'WHOIS']);
    assert.equal(conflict?.contributorCount, 2);
    assert.deepEqual(conflict?.contributors.map((item) => item.provenance), ['provider_reported', 'provider_reported']);
    assert.deepEqual(conflict?.contributors.map((item) => item.observedAt), [
      '2026-08-20T00:00:00.000Z',
      '2026-08-20T00:00:00.000Z',
    ]);
    assert.equal(conflict?.contradictions.length, 1);
    assert.ok(conflict?.nextActions.some((item) => item.id === 'review-priority-conflict'));
    assert.ok(conflict?.references.includes('inspection-destination:#registry'));

    const partialUncertainty = facts.find((item) => item.id === 'lookup-decision:registration-uncertain');
    assert.equal(partialUncertainty?.evidenceState, 'partial');
    assert.equal(partialUncertainty?.consistency, 'unknown');
    const unknownUncertainty = facts.find((item) => item.id === 'lookup-decision:unattributed-uncertain');
    assert.equal(unknownUncertainty?.evidenceState, 'unknown');
    assert.equal(unknownUncertainty?.contributors[0]?.provenance, 'derived');
    assert.equal(unknownUncertainty?.contributors[0]?.observedAt, null);
    assertRecursivelyFrozen(facts);
    assert.deepEqual({ coverage, support, quality }, before);
  });

  test('keeps every uncertain decision unknown or partial while retaining specific contributor states', () => {
    const coverage = coverageLedger();
    const cases = [
      { id: 'complete', source: 'Registry RDAP', contributor: 'observed', fact: 'unknown' },
      { id: 'not-found', source: 'DNS', contributor: 'not_observed_in_bounded_evidence', fact: 'unknown' },
      { id: 'skipped', source: 'TLS', contributor: 'not_collected', fact: 'unknown' },
      { id: 'partial', source: 'WHOIS', contributor: 'partial', fact: 'partial' },
      { id: 'unsupported', source: 'Page identity', contributor: 'unsupported', fact: 'unknown' },
      { id: 'unavailable', source: 'HTTP', contributor: 'unavailable', fact: 'unknown' },
      { id: 'unknown', source: 'Derived analysis', contributor: 'unknown', fact: 'unknown' },
    ] as const;
    const support: LookupDecisionSupport = {
      ...decisionSupport(),
      entries: cases.map((item) => ({
        id: `uncertain-${item.id}`,
        state: 'uncertain' as const,
        importance: 'low' as const,
        title: `${item.source} remains uncertain`,
        detail: 'The decision cannot be strengthened beyond its attributed evidence.',
        sources: [item.source],
        href: '#evidence-quality' as const,
      })),
      actions: [],
      counts: { conflicts: 0, uncertainties: cases.length },
    };
    const facts = buildLookupDecisionFacts({
      decisionSupport: support,
      coverage,
      quality: qualityMatrix(coverage),
    });
    for (const item of cases) {
      const projected = facts.find((factValue) => factValue.id === `lookup-decision:uncertain-${item.id}`);
      assert.equal(projected?.evidenceState, item.fact, item.id);
      assert.equal(projected?.contributors[0]?.evidenceState, item.contributor, item.id);
      assert.equal(projected?.consistency, 'unknown', item.id);
    }
  });

  test('bounds source expansion without custom iteration and gives colliding labels distinct stable IDs', () => {
    let iteratorCalls = 0;
    let excessReads = 0;
    const sources = [
      'A/B',
      'A B',
      ...Array.from({ length: MAX_DECISION_FACT_CONTRIBUTORS - 2 }, (_, index) => `Source ${String(index).padStart(2, '0')}`),
    ];
    Object.defineProperty(sources, String(MAX_DECISION_FACT_CONTRIBUTORS), {
      configurable: true,
      enumerable: true,
      get() {
        excessReads += 1;
        return 'Excess source';
      },
    });
    sources.length = 1_000_000;
    Object.defineProperty(sources, Symbol.iterator, {
      configurable: true,
      value() {
        iteratorCalls += 1;
        return [][Symbol.iterator]();
      },
    });
    const support: LookupDecisionSupport = {
      ...decisionSupport(),
      entries: [{
        id: 'bounded-sources',
        state: 'uncertain',
        importance: 'low',
        title: 'Bounded sources remain uncertain',
        detail: 'Only the retained ordinary source entries contribute.',
        sources,
        href: '#evidence-quality',
      }],
      actions: [],
      counts: { conflicts: 0, uncertainties: 1 },
    };
    const coverage = coverageLedger();
    const projected = buildLookupDecisionFacts({
      decisionSupport: support,
      coverage,
      quality: qualityMatrix(coverage),
    }).find((item) => item.id === 'lookup-decision:bounded-sources');

    assert.equal(projected?.contributorCount, MAX_DECISION_FACT_CONTRIBUTORS);
    assert.equal(iteratorCalls, 0);
    assert.equal(excessReads, 0);
    const colliding = new Map(projected?.contributors
      .filter((item) => item.label === 'A/B' || item.label === 'A B')
      .map((item) => [item.label, item.id]));
    assert.equal(colliding.size, 2);
    assert.notEqual(colliding.get('A/B'), colliding.get('A B'));
    assert.equal(colliding.get('A B'), 'source:a-b:0');
    assert.equal(colliding.get('A/B'), 'source:a-b:1');
  });
});

describe('bounded Decision Fact consumer projection', () => {
  test('preserves canonical fields and reconciles every displayed and omitted count', () => {
    const inputs = Array.from({ length: MAX_DECISION_FACT_PROJECTION_FACTS + 2 }, (_, index) => fact(
      `fact-${String(index).padStart(2, '0')}`,
      index === 0
        ? {
            consistency: 'contradictory',
            contributors: Array.from({ length: MAX_DECISION_FACT_PROJECTION_SOURCES + 2 }, (_, sourceIndex) => contributor(`source-${sourceIndex}`, {
              references: Array.from({ length: 7 }, (__, referenceIndex) => `reference:${sourceIndex}:${referenceIndex}`),
              limitations: Array.from({ length: 6 }, (__, limitationIndex) => `Source limitation ${sourceIndex}:${limitationIndex}`),
            })),
            references: Array.from({ length: 14 }, (__, referenceIndex) => `fact-reference:${referenceIndex}`),
            contradictions: Array.from({ length: 10 }, (__, contradictionIndex) => `Contradiction ${contradictionIndex}`),
            limitations: Array.from({ length: MAX_DECISION_FACT_LIMITATIONS }, (__, limitationIndex) => `Fact limitation ${limitationIndex}`),
            nextActions: Array.from({ length: MAX_DECISION_FACT_NEXT_ACTIONS }, (__, actionIndex) => action(`action-${actionIndex}`)),
          }
        : index === 1
          ? { consistency: 'unknown', evidenceState: 'unknown', freshness: 'unknown' }
          : {},
    ));
    const canonical = buildDecisionFacts(inputs);
    const projected = projectDecisionFacts(canonical);

    assert.equal(projected.total, MAX_DECISION_FACT_PROJECTION_FACTS + 2);
    assert.equal(projected.displayed, MAX_DECISION_FACT_PROJECTION_FACTS);
    assert.equal(projected.omitted, 2);
    assert.equal(projected.total, projected.displayed + projected.omitted);
    assert.equal(projected.contradictory, 1);
    assert.equal(projected.unresolved, 1);
    const first = projected.facts[0];
    assert.equal(first?.id, 'fact-00');
    assert.equal(first?.dependencies.total, MAX_DECISION_FACT_PROJECTION_SOURCES + 2);
    assert.equal(first?.dependencies.displayed, MAX_DECISION_FACT_PROJECTION_SOURCES);
    assert.equal(first?.dependencies.omitted, 2);
    assert.deepEqual(first?.dependencies.items, first?.sources.items.map((source) => source.id));
    assert.equal(first?.sourceReferences.total, 14);
    assert.equal(first?.sourceReferences.displayed, 12);
    assert.equal(first?.sourceReferences.omitted, 2);
    assert.equal(first?.sources.items[0]?.references.total, 7);
    assert.equal(first?.sources.items[0]?.references.displayed, 6);
    assert.equal(first?.sources.items[0]?.references.omitted, 1);
    assert.equal(first?.sources.items[0]?.limitations.total, 6);
    assert.equal(first?.sources.items[0]?.limitations.displayed, 4);
    assert.equal(first?.sources.items[0]?.limitations.omitted, 2);
    assert.equal(first?.contradictions.total, 10);
    assert.equal(first?.contradictions.displayed, 8);
    assert.equal(first?.contradictions.omitted, 2);
    assert.equal(first?.safeNextActions.total, MAX_DECISION_FACT_NEXT_ACTIONS);
    assert.equal(first?.safeNextActions.displayed, 4);
    assert.equal(first?.safeNextActions.omitted, 2);
    assertRecursivelyFrozen(projected);
  });

  test('rejects fact-version and contributor-count drift instead of normalising it silently', () => {
    const canonical = structuredClone(buildDecisionFacts([fact('fact-one')]));
    (canonical as unknown as Array<{ version: number }>)[0]!.version = 2;
    assert.throws(
      () => projectDecisionFacts(canonical),
      /canonical Decision Fact/iu,
    );

    const wrongCount = structuredClone(buildDecisionFacts([fact('fact-two')]));
    (wrongCount as unknown as Array<{ contributorCount: number }>)[0]!.contributorCount = 99;
    assert.throws(
      () => projectDecisionFacts(wrongCount),
      /canonical Decision Fact/iu,
    );
  });

  test('applies the aggregate UTF-8 byte ceiling while keeping omission counts exact', () => {
    const bounded = (prefix: string, length: number, fill: string): string => (
      `${prefix}${fill.repeat(length)}`.slice(0, length)
    );
    const canonical = buildDecisionFacts(Array.from({ length: 3 }, (_, factIndex) => fact(
      `large-fact-${factIndex}`,
      {
        question: 'q'.repeat(320),
        conclusion: 'c'.repeat(640),
        consistency: 'contradictory',
        contributors: Array.from({ length: MAX_DECISION_FACT_PROJECTION_SOURCES }, (_, sourceIndex) => contributor(
          `source-${factIndex}-${sourceIndex}`,
          {
            label: 's'.repeat(160),
            references: Array.from({ length: 6 }, (__, index) => bounded(`r${index}`, 200, 'r')),
            limitations: Array.from({ length: 4 }, (__, index) => bounded(`l${index}`, 280, 'l')),
          },
        )),
        references: Array.from({ length: 12 }, (__, index) => bounded(`f${index}`, 200, 'r')),
        contradictions: Array.from({ length: 8 }, (__, index) => bounded(`c${index}`, 640, 'c')),
        limitations: Array.from({ length: 8 }, (__, index) => bounded(`l${index}`, 280, 'l')),
        nextActions: Array.from({ length: 4 }, (__, index) => ({
          ...action(`large-action-${index}`),
          label: 'a'.repeat(160),
          reason: 'r'.repeat(320),
          expectedOutcome: 'e'.repeat(320),
        })),
      },
    )));
    const projected = projectDecisionFacts(canonical);
    assert.ok(projected.displayed > 0);
    assert.ok(projected.displayed < projected.total);
    assert.equal(projected.omitted, projected.total - projected.displayed);
    assert.ok(new TextEncoder().encode(JSON.stringify(projected)).byteLength <= MAX_DECISION_FACT_PROJECTION_BYTES);
    assert.deepEqual(projected.facts.map((item) => item.id), [...projected.facts.map((item) => item.id)].sort());
  });
});
