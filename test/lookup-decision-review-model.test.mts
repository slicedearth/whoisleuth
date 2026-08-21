import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createDecisionFact,
  type DecisionFact,
  type DecisionFactContributorInput,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactInput,
  type DecisionFactProvenance,
} from '../packages/evidence/decision-fact.mts';
import {
  MAX_LOOKUP_DECISION_REVIEW_ENTRIES,
  buildLookupDecisionReviewModel,
} from '../frontend/src/lib/analysis/lookup-decision-review-model.ts';
import type {
  LookupDecisionEntry,
  LookupDecisionSupport,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';

type MutableRecord = Record<string, unknown>;

function mutableClone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
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

function supportFixture(): LookupDecisionSupport {
  return {
    version: 1,
    guidance: {
      task: 'general',
      label: 'General investigation',
      summary: 'Keep bounded evidence states and source identities separate.',
      questions: [
        'Which attributed observations support the conclusion?',
        'Which limitation prevents a resolved comparison?',
      ],
      prioritySections: ['overview', 'registry', 'source-quality'],
    },
    entries: [{
      id: 'registry-conflict',
      state: 'conflict',
      importance: 'high',
      title: 'Registration sources disagree',
      detail: 'The separately published registrar values differ.',
      sources: ['Registry RDAP', 'WHOIS'],
      href: '#registry',
    }, {
      id: 'partial-comparison',
      state: 'uncertain',
      importance: 'medium',
      title: 'Registration comparison is incomplete',
      detail: 'Analyst-supplied context is partial and cannot resolve the comparison.',
      sources: ['Brand Profile'],
      href: '#evidence-quality',
    }, {
      id: 'unavailable-conflict',
      state: 'conflict',
      importance: 'low',
      title: 'A derived service comparison disagrees',
      detail: 'The retained service states differ while one source is unavailable.',
      sources: ['Derived review'],
      href: '#web-evidence',
    }, {
      id: 'unknown-comparison',
      state: 'uncertain',
      importance: 'low',
      title: 'The remaining comparison is indeterminate',
      detail: 'The bounded evidence does not support a resolved conclusion.',
      sources: ['Derived review'],
      href: '#source-quality',
    }],
    actions: [],
    counts: { conflicts: 2, uncertainties: 2 },
  };
}

function contributor(
  id: string,
  label: string,
  evidenceState: DecisionFactEvidenceState,
  provenance: DecisionFactProvenance,
  freshness: DecisionFactFreshness,
  limitations: readonly string[] = [],
): DecisionFactContributorInput {
  return {
    id,
    label,
    evidenceState,
    provenance,
    references: [`lookup-evidence:${id.replace(/^evidence:/u, '')}`],
    observedAt: freshness === 'current' || freshness === 'stale'
      ? '2026-08-20T00:00:00.000Z'
      : null,
    limitations,
  };
}

function factInput(
  entry: LookupDecisionEntry,
  overrides: Partial<DecisionFactInput> = {},
): DecisionFactInput {
  return {
    id: `lookup-decision:${entry.id}`,
    question: `What does the separately attributed evidence establish for "${entry.title}"?`,
    conclusion: `${entry.title}. ${entry.detail}`,
    importance: entry.importance,
    evidenceState: entry.state === 'conflict' ? 'observed' : 'unknown',
    freshness: 'unknown',
    consistency: entry.state === 'conflict' ? 'contradictory' : 'unknown',
    contributors: [contributor(
      `evidence:${entry.id}`,
      'Bounded source',
      entry.state === 'conflict' ? 'observed' : 'unknown',
      'derived',
      'unknown',
    )],
    references: [`inspection-destination:${entry.href}`, entry.href],
    contradictions: entry.state === 'conflict'
      ? [`${entry.title}: ${entry.detail}`]
      : [],
    limitations: [],
    nextActions: [],
    ...overrides,
  };
}

function factFixture(support: LookupDecisionSupport): readonly DecisionFact[] {
  const [conflict, partial, unavailable, unknown] = support.entries;
  return [
    createDecisionFact(factInput(conflict!, {
      evidenceState: 'observed',
      freshness: 'current',
      contributors: [
        contributor('evidence:dns', 'DNS observation', 'observed', 'direct_observation', 'current'),
        contributor(
          'evidence:rdap',
          'Registry RDAP',
          'observed',
          'provider_reported',
          'current',
          ['The provider publication is a point-in-time statement.'],
        ),
      ],
      contradictions: ['Registry RDAP reports Registrar One while WHOIS reports Registrar Two.'],
      limitations: [
        'The provider publication is a point-in-time statement.',
        'Authority requires analyst review.',
      ],
      nextActions: [{
        id: 'review-registry-conflict',
        label: 'Review the attributed registration values',
        reason: 'The separately published values conflict.',
        expectedOutcome: 'Record which observation is authoritative, current, or unresolved.',
        href: '#registry',
        importance: 'high',
      }],
    })),
    createDecisionFact(factInput(partial!, {
      evidenceState: 'partial',
      freshness: 'stale',
      contributors: [contributor(
        'source:brand-profile',
        'Analyst profile context',
        'partial',
        'analyst_supplied',
        'stale',
        ['The analyst context is incomplete.'],
      )],
      limitations: [
        'The analyst context is incomplete.',
        'The comparison cannot be resolved from retained evidence.',
      ],
      nextActions: [{
        id: 'inspect-partial-context',
        label: 'Inspect the partial context',
        reason: 'Incomplete analyst context limits the comparison.',
        expectedOutcome: 'Clarify which evidence remains unknown.',
        href: '#evidence-quality',
        importance: 'medium',
      }],
    })),
    createDecisionFact(factInput(unavailable!, {
      evidenceState: 'unavailable',
      freshness: 'not_applicable',
      contributors: [contributor(
        'source:derived-service-review',
        'Derived service review',
        'unavailable',
        'derived',
        'not_applicable',
      )],
      contradictions: ['The retained service observations report different bounded states.'],
    })),
    createDecisionFact(factInput(unknown!, {
      evidenceState: 'unknown',
      freshness: 'unknown',
      contributors: [contributor(
        'source:provider-context',
        'Provider context',
        'unknown',
        'provider_reported',
        'unknown',
      )],
    })),
  ];
}

function group(
  model: ReturnType<typeof buildLookupDecisionReviewModel>,
  id: 'disagreements' | 'unresolved',
) {
  return model.groups.find((candidate) => candidate.id === id)!;
}

describe('Lookup decision-review presentation model', () => {
  test('joins every support entry to one canonical fact in deterministic support order', () => {
    const support = supportFixture();
    const facts = factFixture(support);
    const model = buildLookupDecisionReviewModel({ support, facts: [...facts].reverse() });
    const disagreements = group(model, 'disagreements');
    const unresolved = group(model, 'unresolved');

    assert.equal(model.version, 1);
    assert.equal(model.total, 4);
    assert.equal(model.canonicalDecisionFactCount, 4);
    assert.deepEqual(model.groups.map((item) => item.id), ['disagreements', 'unresolved']);
    assert.deepEqual(model.groups.map((item) => item.countLabel), ['disagreements', 'unresolved comparisons']);
    assert.deepEqual(disagreements.contributingFactIds, [
      'lookup-decision:registry-conflict',
      'lookup-decision:unavailable-conflict',
    ]);
    assert.deepEqual(unresolved.contributingFactIds, [
      'lookup-decision:partial-comparison',
      'lookup-decision:unknown-comparison',
    ]);
    assert.deepEqual(disagreements.displayedEntries.map((entry) => entry.id), [
      'registry-conflict',
      'unavailable-conflict',
    ]);
    assert.deepEqual(unresolved.displayedEntries.map((entry) => entry.id), [
      'partial-comparison',
      'unknown-comparison',
    ]);
    for (const aggregate of model.groups) {
      assert.equal(aggregate.total, aggregate.displayedEntries.length + aggregate.omittedCount);
      assert.equal(aggregate.omittedCount, 0);
      assert.deepEqual(
        aggregate.displayedEntries.map((entry) => entry.factId),
        aggregate.contributingFactIds,
      );
    }

    assert.deepEqual(
      [...disagreements.displayedEntries, ...unresolved.displayedEntries]
        .map((entry) => entry.evidenceState),
      ['observed', 'unavailable', 'partial', 'unknown'],
    );
    assert.deepEqual(
      [...disagreements.displayedEntries, ...unresolved.displayedEntries]
        .map((entry) => entry.freshness),
      ['current', 'not_applicable', 'stale', 'unknown'],
    );
    assert.deepEqual(
      new Set(facts.flatMap((fact) => fact.contributors.map((item) => item.provenance))),
      new Set(['direct_observation', 'provider_reported', 'analyst_supplied', 'derived']),
    );
  });

  test('preserves source identity, canonical qualifiers, internal destinations, and fact-specific actions', () => {
    const support = supportFixture();
    const model = buildLookupDecisionReviewModel({ support, facts: factFixture(support) });
    const conflict = group(model, 'disagreements').displayedEntries[0]!;
    const partial = group(model, 'unresolved').displayedEntries[0]!;

    assert.equal(conflict.consistency, 'contradictory');
    assert.equal(conflict.consistencyPresentation.label, 'Contradictory');
    assert.equal(partial.consistency, 'unknown');
    assert.equal(partial.consistencyPresentation.label, 'Consistency unknown');
    assert.deepEqual(conflict.contributors.map((item) => ({
      id: item.id,
      label: item.label,
      provenance: item.provenancePresentation.label,
      evidence: item.evidencePresentation.label,
    })), [{
      id: 'evidence:dns',
      label: 'DNS observation',
      provenance: 'Direct observation',
      evidence: 'Observed',
    }, {
      id: 'evidence:rdap',
      label: 'Registry RDAP',
      provenance: 'Provider reported',
      evidence: 'Observed',
    }]);
    assert.deepEqual(conflict.contradictions, [
      'Registry RDAP reports Registrar One while WHOIS reports Registrar Two.',
    ]);
    assert.deepEqual(conflict.contributors[1]?.limitations, [
      'The provider publication is a point-in-time statement.',
    ]);
    assert.deepEqual(conflict.limitations, [
      'Authority requires analyst review.',
      'The provider publication is a point-in-time statement.',
    ]);
    assert.deepEqual(conflict.unattributedLimitations, ['Authority requires analyst review.']);
    assert.equal(conflict.destination, '#registry');
    assert.deepEqual(conflict.nextActions.map((action) => ({
      id: action.id,
      href: action.href,
      importance: action.importanceLabel,
    })), [{ id: 'review-registry-conflict', href: '#registry', importance: 'High' }]);
    assert.equal(partial.destination, '#evidence-quality');
    assert.ok([...model.groups]
      .flatMap((aggregate) => aggregate.displayedEntries)
      .flatMap((entry) => [entry.destination, ...entry.nextActions.map((action) => action.href)])
      .every((href) => /^#[a-z0-9]/u.test(href)));
  });

  test('rejects missing, duplicate, ambiguous, extra, and over-bound identities', () => {
    const support = supportFixture();
    const facts = factFixture(support);
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: facts.slice(1) }),
      /do not reconcile|missing canonical fact/iu,
    );
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: [...facts, facts[0]!] }),
      /duplicate or over-limit identifiers/iu,
    );
    const ambiguous = mutableClone(facts[0]!) as unknown as MutableRecord;
    ambiguous.conclusion = 'A different conclusion under the same identifier.';
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support,
        facts: [...facts, ambiguous as unknown as DecisionFact],
      }),
      /identifier is ambiguous/iu,
    );
    const extraEntry: LookupDecisionEntry = {
      id: 'extra',
      state: 'uncertain',
      importance: 'low',
      title: 'An extra comparison is unresolved',
      detail: 'No matching support entry exists.',
      sources: ['Derived review'],
      href: '#source-quality',
    };
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support,
        facts: [...facts, createDecisionFact(factInput(extraEntry))],
      }),
      /do not reconcile|no matching support entry/iu,
    );

    const duplicateSupport = mutableClone(support) as unknown as {
      entries: LookupDecisionEntry[];
      counts: { conflicts: number; uncertainties: number };
    };
    duplicateSupport.entries.push(duplicateSupport.entries[0]!);
    duplicateSupport.counts.conflicts += 1;
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support: duplicateSupport as unknown as LookupDecisionSupport,
        facts,
      }),
      /identifier is ambiguous/iu,
    );

    const overBound = mutableClone(support) as unknown as {
      entries: LookupDecisionEntry[];
      counts: { conflicts: number; uncertainties: number };
    };
    overBound.entries = Array.from(
      { length: MAX_LOOKUP_DECISION_REVIEW_ENTRIES + 1 },
      (_, index) => ({
        ...overBound.entries[1]!,
        id: `bounded-${index}`,
      }),
    );
    overBound.counts = { conflicts: 0, uncertainties: overBound.entries.length };
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support: overBound as unknown as LookupDecisionSupport,
        facts: [],
      }),
      /16-record bound/iu,
    );
  });

  test('rejects unsupported, mistyped, and non-canonical fact values', () => {
    const support = supportFixture();
    const facts = factFixture(support);

    const wrongVersion = mutableClone(facts) as unknown as MutableRecord[];
    wrongVersion[0]!.version = 2;
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: wrongVersion as unknown as DecisionFact[] }),
      /canonical Decision Fact values/iu,
    );

    const wrongContributorCount = mutableClone(facts) as unknown as MutableRecord[];
    wrongContributorCount[0]!.contributorCount = 99;
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: wrongContributorCount as unknown as DecisionFact[] }),
      /canonical Decision Fact values/iu,
    );

    const mistyped = mutableClone(facts) as unknown as MutableRecord[];
    mistyped[0]!.evidenceState = 'complete';
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: mistyped as unknown as DecisionFact[] }),
      /unsupported state/iu,
    );

    const reordered = mutableClone(facts) as unknown as MutableRecord[];
    (reordered[0]!.references as string[]).reverse();
    assert.throws(
      () => buildLookupDecisionReviewModel({ support, facts: reordered as unknown as DecisionFact[] }),
      /canonical Decision Fact values/iu,
    );
  });

  test('rejects consistency, importance, conclusion, destination, and count drift', () => {
    const support = supportFixture();
    const facts = factFixture(support);
    const replaceFirst = (fact: DecisionFact) => [fact, ...facts.slice(1)];

    assert.throws(
      () => buildLookupDecisionReviewModel({
        support,
        facts: replaceFirst(createDecisionFact({ ...facts[0]!, consistency: 'unknown' })),
      }),
      /does not match support state/iu,
    );
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support,
        facts: replaceFirst(createDecisionFact({ ...facts[0]!, importance: 'medium' })),
      }),
      /does not match support importance/iu,
    );
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support,
        facts: replaceFirst(createDecisionFact({
          ...facts[0]!,
          conclusion: 'The canonical conclusion silently changed.',
        })),
      }),
      /title and detail semantics/iu,
    );

    for (const references of [
      ['#registry'],
      ['#registry', 'inspection-destination:https://outside.invalid/review'],
      ['#registry', 'inspection-destination:#web-evidence'],
      ['#registry', 'inspection-destination:#registry', 'inspection-destination:#web-evidence'],
    ]) {
      assert.throws(
        () => buildLookupDecisionReviewModel({
          support,
          facts: replaceFirst(createDecisionFact({ ...facts[0]!, references })),
        }),
        /inspection destination/iu,
      );
    }

    const unsafeSupport = mutableClone(support) as unknown as MutableRecord;
    const unsafeEntries = unsafeSupport.entries as MutableRecord[];
    unsafeEntries[0]!.href = 'https://outside.invalid/review';
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support: unsafeSupport as unknown as LookupDecisionSupport,
        facts,
      }),
      /not a canonical bounded value/iu,
    );

    const driftedCounts = mutableClone(support) as unknown as MutableRecord;
    (driftedCounts.counts as MutableRecord).conflicts = 1;
    assert.throws(
      () => buildLookupDecisionReviewModel({
        support: driftedCounts as unknown as LookupDecisionSupport,
        facts,
      }),
      /counts did not reconcile/iu,
    );
  });

  test('detaches and recursively freezes support, facts, descriptors, contributors, qualifiers, and actions', () => {
    const mutableSupport = mutableClone(supportFixture()) as unknown as MutableRecord;
    const mutableFacts = mutableClone(factFixture(mutableSupport as unknown as LookupDecisionSupport)) as unknown as MutableRecord[];
    const model = buildLookupDecisionReviewModel({
      support: mutableSupport as unknown as LookupDecisionSupport,
      facts: mutableFacts as unknown as DecisionFact[],
    });
    const conflict = group(model, 'disagreements').displayedEntries[0]!;

    (mutableSupport.guidance as MutableRecord).label = 'Changed guidance';
    ((mutableSupport.guidance as MutableRecord).questions as string[]).push('Changed question');
    const mutableEntries = mutableSupport.entries as MutableRecord[];
    mutableEntries[0]!.title = 'Changed support title';
    mutableEntries[0]!.detail = 'Changed support detail';
    mutableEntries[0]!.href = '#changed';
    mutableFacts[0]!.conclusion = 'Changed fact conclusion';
    const mutableContributors = mutableFacts[0]!.contributors as MutableRecord[];
    mutableContributors[0]!.label = 'Changed contributor';
    (mutableContributors[0]!.limitations as string[]).push('Changed contributor limitation');
    (mutableFacts[0]!.contradictions as string[]).push('Changed contradiction');
    (mutableFacts[0]!.limitations as string[]).push('Changed fact limitation');
    const mutableActions = mutableFacts[0]!.nextActions as MutableRecord[];
    mutableActions[0]!.href = '#changed';

    assert.equal(model.guidance.label, 'General investigation');
    assert.equal(model.guidance.questions.length, 2);
    assert.equal(conflict.title, 'Registration sources disagree');
    assert.equal(conflict.detail, 'The separately published registrar values differ.');
    assert.equal(conflict.destination, '#registry');
    assert.equal(conflict.contributors[0]?.label, 'DNS observation');
    assert.deepEqual(conflict.contradictions, [
      'Registry RDAP reports Registrar One while WHOIS reports Registrar Two.',
    ]);
    assert.equal(conflict.nextActions[0]?.href, '#registry');
    assertRecursivelyFrozen(model);
  });

  test('keeps observed and current neutral while every descriptor carries non-favourable accessible meaning', () => {
    const support = supportFixture();
    const model = buildLookupDecisionReviewModel({ support, facts: factFixture(support) });
    const observed = group(model, 'disagreements').displayedEntries[0]!;

    assert.equal(observed.evidencePresentation.label, 'Observed');
    assert.equal(observed.evidencePresentation.tone, 'neutral');
    assert.match(observed.evidencePresentation.assistiveText, /does not establish safety/iu);
    assert.equal(observed.freshnessPresentation.label, 'Current');
    assert.equal(observed.freshnessPresentation.tone, 'neutral');
    assert.match(observed.freshnessPresentation.assistiveText, /does not establish safety/iu);

    const descriptors = model.groups.flatMap((aggregate) => [
      aggregate.presentation,
      ...aggregate.displayedEntries.flatMap((entry) => [
        entry.consistencyPresentation,
        entry.evidencePresentation,
        entry.freshnessPresentation,
        ...entry.contributors.flatMap((source) => [
          source.evidencePresentation,
          source.provenancePresentation,
        ]),
      ]),
    ]);
    for (const descriptor of descriptors) {
      assert.ok(descriptor.label.length > 0);
      assert.ok(descriptor.explanation.length > 0);
      assert.ok(descriptor.icon.length > 0);
      assert.ok(descriptor.assistiveText.length > descriptor.label.length);
      assert.doesNotMatch(
        `${descriptor.label} ${descriptor.assistiveText}`,
        /\b(?:is safe|is legitimate|is owned|evidence is absent|nothing was found)\b/iu,
      );
    }
  });
});
