import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDecisionFact,
  type DecisionFact,
  type DecisionFactEvidenceState,
  type DecisionFactFreshness,
  type DecisionFactProvenance,
} from '../packages/evidence/decision-fact.mts';
import { buildLookupEvidenceImpactPlan } from '../frontend/src/lib/analysis/lookup-evidence-impact.ts';
import type {
  LookupClaimReadiness,
  LookupClaimRequirement,
} from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import type { EvidenceCoverageState } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupEvidenceQualityMatrix } from '../frontend/src/lib/analysis/lookup-decision-support.ts';

const EVIDENCE_STATE: Readonly<Record<EvidenceCoverageState, DecisionFactEvidenceState>> = {
  complete: 'observed',
  not_found: 'not_observed_in_bounded_evidence',
  skipped: 'not_collected',
  partial: 'partial',
  unsupported: 'unsupported',
  unavailable: 'unavailable',
  unknown: 'unknown',
};

type EvidenceFixture = Readonly<{
  requirementId: LookupClaimRequirement['id'];
  evidenceId: string;
  label: string;
  state: EvidenceCoverageState;
  freshness: DecisionFactFreshness;
  provenance: DecisionFactProvenance;
  limitation?: string;
}>;

const EVIDENCE_FIXTURES: readonly EvidenceFixture[] = [
  { requirementId: 'authority-aware-availability', evidenceId: 'availability', label: 'Availability decision', state: 'complete', freshness: 'current', provenance: 'derived' },
  { requirementId: 'registry-rdap', evidenceId: 'rdap', label: 'Registry RDAP', state: 'not_found', freshness: 'current', provenance: 'provider_reported' },
  { requirementId: 'registry-whois', evidenceId: 'whois', label: 'WHOIS', state: 'skipped', freshness: 'not_applicable', provenance: 'provider_reported' },
  { requirementId: 'dns-observation', evidenceId: 'dns', label: 'DNS', state: 'partial', freshness: 'stale', provenance: 'direct_observation', limitation: 'One authority timed out.' },
  { requirementId: 'http-observation', evidenceId: 'http', label: 'HTTP', state: 'unsupported', freshness: 'not_applicable', provenance: 'derived' },
  { requirementId: 'tls-observation', evidenceId: 'tls', label: 'TLS', state: 'unavailable', freshness: 'unknown', provenance: 'analyst_supplied', limitation: 'The bounded handshake did not complete.' },
  { requirementId: 'page-identity-observation', evidenceId: 'page-identity', label: 'Page identity', state: 'unknown', freshness: 'current', provenance: 'derived', limitation: 'The bounded page identity state is unknown.' },
];

function requirement(fixture: EvidenceFixture): LookupClaimRequirement {
  return {
    id: fixture.requirementId,
    label: `${fixture.label} requirement`,
    evidenceId: fixture.evidenceId,
    mode: 'network_collection',
    href: fixture.evidenceId === 'rdap' || fixture.evidenceId === 'whois'
      ? '#registry'
      : `#evidence-${fixture.evidenceId}`,
    coverageState: fixture.state,
    state: fixture.state,
    limitations: fixture.limitation ? [fixture.limitation] : [],
  };
}

function quality(fixtures: readonly EvidenceFixture[]): LookupEvidenceQualityMatrix {
  return {
    version: 1,
    observedAt: '2026-08-20T00:00:00.000Z',
    totalMs: 300,
    entries: fixtures.map((fixture) => ({
      id: fixture.evidenceId,
      label: fixture.label,
      category: fixture.provenance === 'provider_reported' ? 'registry' : 'web',
      endpointClass: `${fixture.label} bounded endpoint`,
      description: `${fixture.label} evidence.`,
      state: fixture.state,
      statusLabel: `Legacy ${fixture.state}`,
      truncated: false,
      observedAt: fixture.freshness === 'not_applicable' ? null : '2026-08-20T00:00:00.000Z',
      ageDays: fixture.freshness === 'not_applicable' ? null : 1,
      durationMs: 10,
      timingOutcome: 'fulfilled',
      refreshAvailable: fixture.evidenceId === 'dns',
      requestDisclosure: fixture.evidenceId === 'dns'
        ? 'Starts one bounded DNS collection for this target.'
        : null,
      limitations: fixture.limitation ? [fixture.limitation] : [],
      supports: [],
    })),
    completeCount: fixtures.filter((fixture) => fixture.state === 'complete').length,
    limitedCount: fixtures.filter((fixture) => (
      fixture.state === 'partial' || fixture.state === 'unavailable' || fixture.state === 'unknown'
    )).length,
    stale: fixtures.some((fixture) => fixture.freshness === 'stale'),
    ageDays: 1,
    freshnessPolicy: {
      version: 1,
      id: 'task-default',
      task: 'general',
      thresholdsDays: { registration: 30, network: 7, web: 3 },
    },
  };
}

function facts(fixtures: readonly EvidenceFixture[]): DecisionFact[] {
  return fixtures.map((fixture) => createDecisionFact({
    id: `lookup-evidence:${fixture.evidenceId}`,
    question: `What did ${fixture.label} establish?`,
    conclusion: `${fixture.label} retained its bounded evidence state without a broader inference.`,
    importance: 'medium',
    evidenceState: EVIDENCE_STATE[fixture.state],
    freshness: fixture.freshness,
    consistency: 'not_applicable',
    contributors: [{
      id: `evidence:${fixture.evidenceId}`,
      label: fixture.label,
      provenance: fixture.provenance,
      evidenceState: EVIDENCE_STATE[fixture.state],
      references: [`lookup-evidence:${fixture.evidenceId}`],
      observedAt: fixture.freshness === 'not_applicable' ? null : '2026-08-20T00:00:00.000Z',
      limitations: fixture.limitation ? [fixture.limitation] : [],
    }],
    references: [`lookup-evidence:${fixture.evidenceId}`],
    contradictions: [],
    limitations: fixture.limitation ? [fixture.limitation] : [],
    nextActions: [],
  }));
}

function readiness(requirements: readonly LookupClaimRequirement[]): LookupClaimReadiness {
  const missing = requirements.filter((item) => item.state !== 'complete');
  return {
    version: 2,
    entries: [{
      id: 'controlled-change',
      label: 'Controlled-change planning',
      state: 'limited',
      conclusion: 'Whether a reviewed change can be prepared.',
      requiredEvidence: requirements.map((item) => item.label),
      missingEvidence: missing.map((item) => item.label),
      requiredEvidenceIds: requirements.map((item) => item.id),
      missingEvidenceIds: missing.map((item) => item.id),
      requirements,
      limitations: missing.flatMap((item) => item.limitations),
      href: '#evidence-quality',
    }],
    disagreements: [],
    counts: { ready: 0, limited: 1, not_ready: 0 },
    limitation: 'Readiness is not truth.',
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

test('evidence impact joins every retained state to canonical freshness and provenance without using legacy labels', () => {
  const requirements = EVIDENCE_FIXTURES.map(requirement);
  const matrix = quality(EVIDENCE_FIXTURES);
  const plan = buildLookupEvidenceImpactPlan({
    readiness: readiness(requirements),
    quality: matrix,
    facts: facts(EVIDENCE_FIXTURES),
  });

  assert.equal(plan.total, 6);
  assert.equal(plan.displayedCount, 6);
  assert.equal(plan.omittedCount, 0);
  for (const fixture of EVIDENCE_FIXTURES.filter((item) => item.state !== 'complete')) {
    const item = plan.items.find((candidate) => candidate.evidenceId === fixture.evidenceId);
    assert.ok(item, fixture.evidenceId);
    assert.equal(item.factId, `lookup-evidence:${fixture.evidenceId}`);
    assert.equal(item.evidenceState, EVIDENCE_STATE[fixture.state]);
    assert.equal(item.freshness, fixture.freshness);
    assert.equal(item.contributors[0]?.provenance, fixture.provenance);
    assert.equal(item.basis, 'decision_fact');
    assert.doesNotMatch(item.reason, /Legacy/iu);
  }
  assert.equal(plan.items.find((item) => item.evidenceId === 'dns')?.disclosure,
    'Starts one bounded DNS collection for this target.');
  assert.deepEqual(plan.items.find((item) => item.evidenceId === 'dns')?.contributors[0]?.limitations,
    ['One authority timed out.']);
  assert.match(plan.limitation, /never guarantees.*claim becomes true.*safe or available.*authorised.*complete evidence/iu);
  assertRecursivelyFrozen(plan);
});

test('evidence impact keeps approved local context and unbound network requirements separate from evidence facts', () => {
  const contextualRequirements: LookupClaimRequirement[] = [{
    id: 'reviewed-brand-profile',
    label: 'Reviewed Brand Profile',
    evidenceId: null,
    mode: 'local_review',
    href: '#case-response',
    coverageState: null,
    state: 'unknown',
    limitations: ['No reviewed profile context is active.'],
  }, {
    id: 'reviewed-case-recipient',
    label: 'Reviewed case and recipient route',
    evidenceId: null,
    mode: 'local_review',
    href: '#case-response',
    coverageState: null,
    state: 'unknown',
    limitations: ['A reviewed route remains required.'],
  }, {
    id: 'registry-control-selection',
    label: 'Registry control evidence selection',
    evidenceId: null,
    mode: 'network_collection',
    href: '#registry',
    coverageState: null,
    state: 'unknown',
    limitations: ['The authority did not bind a control source.'],
  }];
  const plan = buildLookupEvidenceImpactPlan({
    readiness: readiness(contextualRequirements),
    quality: quality([]),
    facts: [],
  });

  assert.deepEqual(plan.items.map((item) => item.basis), [
    'task_context',
    'case_context',
    'unbound_requirement',
  ]);
  assert.ok(plan.items.slice(0, 2).every((item) => (
    item.mode === 'local_review'
    && item.factId === null
    && item.contributors.length === 0
    && /does not start a network request/iu.test(item.disclosure)
  )));
  assert.ok(plan.items.slice(0, 2).every((item) => (
    /Completing this contextual review could/iu.test(item.expectedEffect)
    && !/additional complete observation/iu.test(item.expectedEffect)
  )));
  const unbound = plan.items[2]!;
  assert.equal(unbound.mode, 'network_collection');
  assert.equal(unbound.factId, null);
  assert.equal(unbound.refreshAvailable, false);
  assert.match(unbound.reason, /no source evidence identifier.*unbound/iu);
  assert.match(unbound.disclosure, /starts no request/iu);
  assert.match(unbound.expectedEffect, /separately authorised collection could/iu);
  assert.equal(plan.networkCollectionCount, 1);
  assert.equal(plan.localReviewCount, 2);
});

test('evidence impact rejects missing or mismatched facts and unknown context-only requirements', () => {
  const dns = EVIDENCE_FIXTURES.find((item) => item.evidenceId === 'dns')!;
  const dnsRequirement = requirement(dns);
  const dnsQuality = quality([dns]);
  const dnsFacts = facts([dns]);

  assert.throws(
    () => buildLookupEvidenceImpactPlan({
      readiness: readiness([dnsRequirement]),
      quality: dnsQuality,
      facts: [],
    }),
    /coverage facts|missing canonical|reconcile/iu,
  );
  assert.throws(
    () => buildLookupEvidenceImpactPlan({
      readiness: readiness([{ ...dnsRequirement, coverageState: 'unavailable' }]),
      quality: dnsQuality,
      facts: dnsFacts,
    }),
    /does not match canonical fact/iu,
  );
  assert.throws(
    () => buildLookupEvidenceImpactPlan({
      readiness: readiness([{ ...dnsRequirement, evidenceId: null }]),
      quality: dnsQuality,
      facts: dnsFacts,
    }),
    /mismatched evidence identity and coverage state/iu,
  );
  assert.throws(
    () => buildLookupEvidenceImpactPlan({
      readiness: readiness([{
        ...dnsRequirement,
        id: 'unknown-context' as LookupClaimRequirement['id'],
        evidenceId: null,
        coverageState: null,
        mode: 'local_review',
      }]),
      quality: quality([]),
      facts: [],
    }),
    /no evidence identifier or approved contextual basis/iu,
  );
});

test('evidence impact keeps claim sufficiency separate from canonical coverage state', () => {
  const availability = EVIDENCE_FIXTURES[0]!;
  const requirementValue = {
    ...requirement(availability),
    state: 'partial' as const,
    limitations: ['The authority-aware availability state is not settled.'],
  };
  const plan = buildLookupEvidenceImpactPlan({
    readiness: readiness([requirementValue]),
    quality: quality([availability]),
    facts: facts([availability]),
  });

  assert.equal(plan.total, 1);
  assert.equal(plan.items[0]?.evidenceState, 'observed');
  assert.equal(plan.items[0]?.currentState, 'limited');
  assert.deepEqual(plan.items[0]?.limitations, []);
});

test('evidence impact detaches mutable readiness, quality, facts, contributors, and limitations', () => {
  const dns = EVIDENCE_FIXTURES.find((item) => item.evidenceId === 'dns')!;
  const mutableReadiness = structuredClone(readiness([requirement(dns)]));
  const mutableQuality = structuredClone(quality([dns]));
  const mutableFacts = structuredClone(facts([dns]));
  const plan = buildLookupEvidenceImpactPlan({
    readiness: mutableReadiness,
    quality: mutableQuality,
    facts: mutableFacts,
  });

  const readinessMutation = mutableReadiness as unknown as {
    entries: Array<{ requirements: Array<{ limitations: string[] }> }>;
  };
  const qualityMutation = mutableQuality as unknown as {
    entries: Array<{ label: string; limitations: string[] }>;
  };
  const factMutation = mutableFacts as unknown as Array<{
    contributors: Array<{ label: string; limitations: string[] }>;
    limitations: string[];
  }>;
  readinessMutation.entries[0]!.requirements[0]!.limitations[0] = 'Changed requirement.';
  qualityMutation.entries[0]!.label = 'Changed quality label';
  qualityMutation.entries[0]!.limitations[0] = 'Changed matrix limitation.';
  factMutation[0]!.contributors[0]!.label = 'Changed contributor';
  factMutation[0]!.contributors[0]!.limitations[0] = 'Changed contributor limitation.';
  factMutation[0]!.limitations[0] = 'Changed fact limitation.';

  assert.equal(plan.items[0]?.evidenceLabel, 'DNS');
  assert.equal(plan.items[0]?.contributors[0]?.label, 'DNS');
  assert.deepEqual(plan.items[0]?.limitations, ['One authority timed out.']);
  assertRecursivelyFrozen(plan);
});
