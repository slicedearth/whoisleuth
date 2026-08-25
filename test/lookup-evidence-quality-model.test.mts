import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  createDecisionFact,
  type DecisionFact,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactInput,
  type DecisionFactProvenance,
} from '../packages/evidence/decision-fact.mts';
import type { EvidenceCoverageState } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import {
  buildLookupEvidenceQualityModel,
} from '../frontend/src/lib/analysis/lookup-evidence-quality-model.ts';
import type {
  LookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';

type Fixture = Readonly<{
  id: string;
  label: string;
  category: LookupEvidenceQualityMatrix['entries'][number]['category'];
  matrixState: EvidenceCoverageState;
  evidenceState: DecisionFactEvidenceState;
  freshness: DecisionFactFreshness;
  provenance: DecisionFactProvenance;
}>;

const FIXTURES: readonly Fixture[] = Object.freeze([
  Object.freeze({
    id: 'z-observed-provider',
    label: 'Provider observation',
    category: 'registry',
    matrixState: 'complete',
    evidenceState: 'observed',
    freshness: 'current',
    provenance: 'provider_reported',
  }),
  Object.freeze({
    id: 'a-bounded-non-observation',
    label: 'Bounded network check',
    category: 'network',
    matrixState: 'not_found',
    evidenceState: 'not_observed_in_bounded_evidence',
    freshness: 'current',
    provenance: 'direct_observation',
  }),
  Object.freeze({
    id: 'f-not-collected',
    label: 'Deferred web check',
    category: 'web',
    matrixState: 'skipped',
    evidenceState: 'not_collected',
    freshness: 'not_applicable',
    provenance: 'direct_observation',
  }),
  Object.freeze({
    id: 'b-partial-provider',
    label: 'Partial provider source',
    category: 'external',
    matrixState: 'partial',
    evidenceState: 'partial',
    freshness: 'stale',
    provenance: 'provider_reported',
  }),
  Object.freeze({
    id: 'e-unsupported-derived',
    label: 'Unsupported derived check',
    category: 'analysis',
    matrixState: 'unsupported',
    evidenceState: 'unsupported',
    freshness: 'not_applicable',
    provenance: 'derived',
  }),
  Object.freeze({
    id: 'c-unavailable-analyst',
    label: 'Analyst supplied context',
    category: 'analysis',
    matrixState: 'unavailable',
    evidenceState: 'unavailable',
    freshness: 'unknown',
    provenance: 'analyst_supplied',
  }),
  Object.freeze({
    id: 'd-unknown-derived',
    label: 'Derived uncertainty',
    category: 'analysis',
    matrixState: 'unknown',
    evidenceState: 'unknown',
    freshness: 'unknown',
    provenance: 'derived',
  }),
]);

function limitationFor(fixture: Fixture): string {
  return `${fixture.label} retains its own source limitation.`;
}

function factInput(fixture: Fixture): DecisionFactInput {
  const sourceLimitation = limitationFor(fixture);
  return {
    id: `lookup-evidence:${fixture.id}`,
    question: `What did ${fixture.label} establish?`,
    conclusion: `${fixture.label} supports only its bounded evidence state.`,
    importance: 'medium',
    evidenceState: fixture.evidenceState,
    freshness: fixture.freshness,
    consistency: 'not_applicable',
    contributors: [{
      id: `evidence:${fixture.id}`,
      label: fixture.label,
      provenance: fixture.provenance,
      evidenceState: fixture.evidenceState,
      references: [`lookup-evidence:${fixture.id}`],
      observedAt: fixture.freshness === 'current' || fixture.freshness === 'stale'
        ? '2026-08-20T00:00:00.000Z'
        : null,
      limitations: [sourceLimitation],
    }],
    references: [`lookup-evidence:${fixture.id}`, '#evidence-quality'],
    contradictions: [],
    limitations: fixture.id === 'b-partial-provider'
      ? [sourceLimitation, 'The aggregate fact retains a separate bounded limitation.']
      : [sourceLimitation],
    nextActions: [],
  };
}

function buildFixture(): Readonly<{
  matrix: LookupEvidenceQualityMatrix;
  facts: readonly DecisionFact[];
}> {
  const entries = FIXTURES.map((fixture, index) => ({
    id: fixture.id,
    label: fixture.label,
    category: fixture.category,
    endpointClass: `Endpoint class ${index}`,
    description: `Bounded matrix description ${index}.`,
    state: fixture.matrixState,
    statusLabel: `Legacy matrix label ${index}`,
    truncated: fixture.id === 'b-partial-provider',
    observedAt: fixture.freshness === 'current' || fixture.freshness === 'stale'
      ? '2026-08-20T00:00:00.000Z'
      : null,
    ageDays: fixture.freshness === 'current' ? 1 : fixture.freshness === 'stale' ? 45 : null,
    durationMs: 20 + index,
    timingOutcome: fixture.id === 'b-partial-provider' ? 'rejected' as const : 'fulfilled' as const,
    refreshAvailable: fixture.id === 'b-partial-provider',
    requestDisclosure: fixture.id === 'b-partial-provider'
      ? 'Starts one bounded provider review request.'
      : null,
    limitations: [`Matrix-only limitation ${index}.`],
    supports: [`Evidence use ${index}`, `Secondary use ${index}`],
  }));
  return {
    matrix: {
      version: 1,
      observedAt: '2026-08-20T00:00:00.000Z',
      totalMs: 427,
      entries,
      completeCount: 1,
      limitedCount: 3,
      stale: true,
      ageDays: 45,
      freshnessPolicy: {
        version: 1,
        id: 'analyst-custom',
        task: 'general',
        thresholdsDays: { registration: 31, network: 8, web: 4 },
      },
    },
    facts: FIXTURES.map((fixture) => createDecisionFact(factInput(fixture))),
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

function mutableClone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

describe('Lookup evidence quality presentation model', () => {
  test('joins all canonical states, freshness states, and provenance classes in matrix order', () => {
    const fixture = buildFixture();
    const unrelatedDecision = createDecisionFact({
      ...factInput(FIXTURES[0]!),
      id: 'lookup-decision:unrelated',
      consistency: 'unknown',
      contributors: [],
      limitations: [],
    });
    const model = buildLookupEvidenceQualityModel({
      matrix: fixture.matrix,
      facts: [...fixture.facts].reverse().concat(unrelatedDecision),
    });

    assert.deepEqual(model.entries.map((entry) => entry.id), FIXTURES.map((fixture) => fixture.id));
    assert.deepEqual(model.entries.map((entry) => entry.factId), FIXTURES.map((fixture) => `lookup-evidence:${fixture.id}`));
    assert.deepEqual(model.entries.map((entry) => entry.evidenceState), FIXTURES.map((fixture) => fixture.evidenceState));
    assert.deepEqual(new Set(model.entries.map((entry) => entry.freshness)), new Set([
      'current',
      'stale',
      'unknown',
      'not_applicable',
    ]));
    assert.deepEqual(new Set(model.entries.map((entry) => entry.contributors[0]?.provenance)), new Set([
      'direct_observation',
      'provider_reported',
      'analyst_supplied',
      'derived',
    ]));
    assert.deepEqual(model.entries.map((entry) => entry.statePresentation.label), [
      'Observed',
      'Not observed in bounded evidence',
      'Not collected',
      'Partial',
      'Unsupported',
      'Unavailable',
      'Unknown',
    ]);
    assert.deepEqual(model.entries.map((entry) => entry.freshnessPresentation.label), [
      'Current',
      'Current',
      'Freshness not applicable',
      'Stale',
      'Freshness not applicable',
      'Freshness unknown',
      'Freshness unknown',
    ]);
    assert.equal(model.displayedRowCount, FIXTURES.length);
    assert.equal(model.canonicalCoverageFactCount, FIXTURES.length);
  });

  test('reconciles complete and limited counts without counting bounded non-observation, skipped, or unsupported states', () => {
    const fixture = buildFixture();
    const model = buildLookupEvidenceQualityModel(fixture);

    assert.equal(model.completeCount, 1);
    assert.equal(model.limitedCount, 3);
    assert.deepEqual(
      model.entries.filter((entry) => entry.countsAsComplete).map((entry) => entry.evidenceState),
      ['observed'],
    );
    assert.deepEqual(
      model.entries.filter((entry) => entry.countsAsLimited).map((entry) => entry.evidenceState),
      ['partial', 'unavailable', 'unknown'],
    );
    for (const state of [
      'not_observed_in_bounded_evidence',
      'not_collected',
      'unsupported',
    ] as const) {
      const entry = model.entries.find((candidate) => candidate.evidenceState === state)!;
      assert.equal(entry.countsAsComplete, false);
      assert.equal(entry.countsAsLimited, false);
    }

    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: { ...fixture.matrix, completeCount: 2 },
        facts: fixture.facts,
      }),
      /summary counts did not reconcile/iu,
    );
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: { ...fixture.matrix, limitedCount: 4 },
        facts: fixture.facts,
      }),
      /summary counts did not reconcile/iu,
    );
  });

  test('preserves matrix details and canonical limitations without merging source identities', () => {
    const fixture = buildFixture();
    const model = buildLookupEvidenceQualityModel(fixture);
    const partial = model.entries.find((entry) => entry.id === 'b-partial-provider')!;
    const analyst = model.entries.find((entry) => entry.id === 'c-unavailable-analyst')!;

    assert.equal(partial.endpointClass, 'Endpoint class 3');
    assert.equal(partial.description, 'Bounded matrix description 3.');
    assert.equal(partial.durationMs, 23);
    assert.equal(partial.timingOutcome, 'rejected');
    assert.equal(partial.truncated, true);
    assert.equal(partial.refreshAvailable, true);
    assert.deepEqual(partial.supports, ['Evidence use 3', 'Secondary use 3']);
    assert.equal(partial.observedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(partial.ageDays, 45);
    assert.deepEqual(partial.contributors.map((contributor) => contributor.id), [
      'evidence:b-partial-provider',
    ]);
    assert.deepEqual(partial.contributors[0]?.limitations, [
      'Partial provider source retains its own source limitation.',
    ]);
    assert.deepEqual(partial.limitations, [
      'Partial provider source retains its own source limitation.',
      'The aggregate fact retains a separate bounded limitation.',
    ]);
    assert.deepEqual(partial.unattributedLimitations, [
      'The aggregate fact retains a separate bounded limitation.',
    ]);
    assert.equal(partial.limitationCount, 2);
    assert.deepEqual(analyst.contributors.map((contributor) => ({
      id: contributor.id,
      label: contributor.label,
      provenance: contributor.provenancePresentation.label,
      limitations: contributor.limitations,
    })), [{
      id: 'evidence:c-unavailable-analyst',
      label: 'Analyst supplied context',
      provenance: 'Analyst supplied',
      limitations: ['Analyst supplied context retains its own source limitation.'],
    }]);
    assert.equal(partial.limitations.includes('Matrix-only limitation 3.'), false);
    assert.deepEqual(model.freshnessPolicy, fixture.matrix.freshnessPolicy);
  });

  test('fails closed for missing, duplicate, mismatched, and incorrectly typed facts', () => {
    const fixture = buildFixture();
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: fixture.facts.slice(1),
      }),
      /rows and canonical coverage facts do not reconcile|missing canonical fact/iu,
    );
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: [...fixture.facts, fixture.facts[0]!],
      }),
      /duplicate or over-limit identifiers/iu,
    );

    const mismatchedIdentity = createDecisionFact({
      ...factInput(FIXTURES[0]!),
      id: 'lookup-evidence:wrong-row',
      contributors: [{
        ...factInput(FIXTURES[0]!).contributors![0]!,
        id: 'evidence:wrong-row',
      }],
    });
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: [mismatchedIdentity, ...fixture.facts.slice(1)],
      }),
      /missing canonical fact|no matching matrix row/iu,
    );

    const mismatchedState = createDecisionFact({
      ...factInput(FIXTURES[0]!),
      evidenceState: 'partial',
      contributors: [{
        ...factInput(FIXTURES[0]!).contributors![0]!,
        evidenceState: 'partial',
      }],
    });
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: [mismatchedState, ...fixture.facts.slice(1)],
      }),
      /does not match matrix state/iu,
    );

    const mismatchedContributor = createDecisionFact({
      ...factInput(FIXTURES[0]!),
      contributors: [{
        ...factInput(FIXTURES[0]!).contributors![0]!,
        label: 'Different source identity',
      }],
    });
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: [mismatchedContributor, ...fixture.facts.slice(1)],
      }),
      /mismatched contributor identity or state/iu,
    );

    const incorrectlyTyped = mutableClone(fixture.facts) as unknown as Array<Record<string, unknown>>;
    incorrectlyTyped[0]!.freshness = 'recent-enough';
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: incorrectlyTyped as unknown as readonly DecisionFact[],
      }),
      /freshness has an unsupported state/iu,
    );

    const wrongVersion = mutableClone(fixture.facts) as unknown as Array<Record<string, unknown>>;
    wrongVersion[0]!.version = 2;
    assert.throws(
      () => buildLookupEvidenceQualityModel({
        matrix: fixture.matrix,
        facts: wrongVersion as unknown as readonly DecisionFact[],
      }),
      /canonical Decision Fact values/iu,
    );
  });

  test('detaches and recursively freezes matrix, fact, contributor, limitation, and presentation values', () => {
    const fixture = buildFixture();
    const mutableMatrix = mutableClone(fixture.matrix) as unknown as {
      entries: Array<Record<string, unknown>>;
      freshnessPolicy: { thresholdsDays: Record<string, number> };
    };
    const mutableFacts = mutableClone(fixture.facts) as unknown as Array<Record<string, unknown>>;
    const model = buildLookupEvidenceQualityModel({
      matrix: mutableMatrix as unknown as LookupEvidenceQualityMatrix,
      facts: mutableFacts as unknown as readonly DecisionFact[],
    });
    const first = model.entries[0]!;
    const firstContributor = first.contributors[0]!;

    mutableMatrix.entries[0]!.endpointClass = 'Changed after construction';
    (mutableMatrix.entries[0]!.supports as string[]).push('Changed support');
    (mutableMatrix.entries[0]!.limitations as string[]).push('Changed matrix limitation');
    mutableMatrix.freshnessPolicy.thresholdsDays.registration = 365;
    mutableFacts[0]!.evidenceState = 'unknown';
    const contributors = mutableFacts[0]!.contributors as Array<Record<string, unknown>>;
    contributors[0]!.label = 'Changed contributor';
    (contributors[0]!.limitations as string[]).push('Changed contributor limitation');
    (mutableFacts[0]!.limitations as string[]).push('Changed fact limitation');

    assert.equal(first.endpointClass, 'Endpoint class 0');
    assert.deepEqual(first.supports, ['Evidence use 0', 'Secondary use 0']);
    assert.equal(first.evidenceState, 'observed');
    assert.equal(firstContributor.label, 'Provider observation');
    assert.deepEqual(firstContributor.limitations, [
      'Provider observation retains its own source limitation.',
    ]);
    assert.equal(model.freshnessPolicy.thresholdsDays.registration, 31);
    assert.notEqual(
      first.statePresentation,
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed,
    );
    assert.notEqual(
      first.freshnessPresentation,
      DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.current,
    );
    assert.throws(() => {
      (first.statePresentation as { label: string }).label = 'Changed descriptor';
    }, TypeError);
    assert.equal(first.statePresentation.label, 'Observed');
    assertRecursivelyFrozen(model);
  });

  test('keeps observed and current neutral with safe visible labels and assistive text', () => {
    const model = buildLookupEvidenceQualityModel(buildFixture());
    const observed = model.entries.find((entry) => entry.evidenceState === 'observed')!;

    assert.equal(observed.statePresentation.label, 'Observed');
    assert.equal(observed.statePresentation.tone, 'neutral');
    assert.equal(observed.freshnessPresentation.label, 'Current');
    assert.equal(observed.freshnessPresentation.tone, 'neutral');
    assert.match(observed.statePresentation.assistiveText, /does not establish safety/iu);
    assert.match(observed.freshnessPresentation.assistiveText, /does not establish safety/iu);

    for (const entry of model.entries) {
      const descriptors = [
        entry.statePresentation,
        entry.freshnessPresentation,
        ...entry.contributors.flatMap((contributor) => [
          contributor.evidencePresentation,
          contributor.provenancePresentation,
        ]),
      ];
      for (const descriptor of descriptors) {
        assert.ok(descriptor.label.length > 0);
        assert.ok(descriptor.assistiveText.length > 0);
        assert.doesNotMatch(
          `${descriptor.label} ${descriptor.assistiveText}`,
          /\b(?:is safe|is legitimate|is owned|evidence is absent|nothing was found)\b/iu,
        );
      }
    }
  });
});
