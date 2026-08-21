import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupDecisionSupport,
  buildLookupEvidenceQualityMatrix,
  projectLookupNextActions,
  rankLookupNextActions,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import type { EvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupSourceRefreshPlan } from '../frontend/src/lib/analysis/lookup-source-refresh.ts';

const coverage: EvidenceCoverageLedger = {
  version: 1,
  entries: [
    {
      id: 'rdap',
      label: 'Registry RDAP',
      category: 'registry',
      state: 'complete',
      statusLabel: 'Complete',
      truncated: false,
      limitations: [],
      manualReviewSuggested: false,
    },
    {
      id: 'whois',
      label: 'WHOIS',
      category: 'registry',
      state: 'partial',
      statusLabel: 'Partial',
      truncated: false,
      limitations: ['The referral chain ended before an authoritative record was returned.'],
      manualReviewSuggested: true,
    },
    {
      id: 'http',
      label: 'HTTP',
      category: 'web',
      state: 'complete',
      statusLabel: 'Complete',
      truncated: false,
      limitations: [],
      manualReviewSuggested: false,
    },
  ],
  counts: {
    complete: 2,
    not_found: 0,
    partial: 1,
    skipped: 0,
    unavailable: 0,
    unknown: 0,
    unsupported: 0,
  },
  completeCount: 2,
  limitedCount: 1,
};

const refreshPlan: LookupSourceRefreshPlan = {
  version: 1,
  stale: false,
  ageDays: 1,
  freshnessPolicy: { version: 1, id: 'task-default', task: 'general', thresholdsDays: { registration: 30, network: 7, web: 3 } },
  items: [{
    id: 'whois',
    label: 'WHOIS',
    endpoint: '/api/whois',
    evidenceIds: ['whois'],
    reason: 'limited',
    requestDisclosure: 'Starts one bounded referral-aware WHOIS operation for this target.',
    supersedesObservedAt: '2026-07-30T00:00:00.000Z',
  }],
  limitations: [],
};

test('action ranking is exact for every task and preserves source order as the final tie-breaker', () => {
  const actions = [
    { id: 'generic-medium-first', priority: 'medium' },
    { id: 'generic-low', priority: 'low' },
    { id: 'review-acquisition-dependencies', priority: 'medium' },
    { id: 'generic-high', priority: 'high' },
    { id: 'review-page-identity', priority: 'medium' },
    { id: 'review-owned-posture', priority: 'medium' },
  ].map(({ id, priority }) => ({
    id,
    label: `Review ${id}`,
    reason: `Review the bounded ${id} context.`,
    expectedOutcome: 'Clarify what the retained evidence supports without changing it.',
    href: '#evidence-quality' as const,
    priority: priority as 'high' | 'medium' | 'low',
  }));
  const expected = {
    general: ['generic-high', 'generic-medium-first', 'review-acquisition-dependencies', 'review-page-identity', 'review-owned-posture', 'generic-low'],
    acquisition: ['generic-high', 'review-acquisition-dependencies', 'generic-medium-first', 'review-page-identity', 'review-owned-posture', 'generic-low'],
    brand: ['generic-high', 'review-page-identity', 'generic-medium-first', 'review-acquisition-dependencies', 'review-owned-posture', 'generic-low'],
    incident: ['generic-high', 'generic-medium-first', 'review-acquisition-dependencies', 'review-page-identity', 'review-owned-posture', 'generic-low'],
    owned: ['generic-high', 'review-owned-posture', 'generic-medium-first', 'review-acquisition-dependencies', 'review-page-identity', 'generic-low'],
  } as const;
  const before = structuredClone(actions);
  for (const task of ['general', 'acquisition', 'brand', 'incident', 'owned'] as const) {
    const ranked = rankLookupNextActions(actions, task);
    assert.deepEqual(ranked.map((action) => action.id), expected[task], task);
    assert.equal(Object.isFrozen(ranked), true);
    assert.ok(ranked.every(Object.isFrozen));
  }
  assert.deepEqual(actions, before);
});

test('decision support keeps conflicts separate from incomplete source comparisons', () => {
  const support = buildLookupDecisionSupport({
    task: 'acquisition',
    coverage,
    refreshPlan,
    registryComparison: {
      fields: [
        {
          label: 'Registrar',
          status: 'conflict',
          rdapDisplay: 'Registrar One',
          whoisDisplay: 'Registrar Two',
        },
        {
          label: 'Statuses',
          status: 'whois_incomplete',
          rdapDisplay: 'transfer prohibited',
          whoisDisplay: 'Not observed (partial source)',
        },
      ],
    },
    registrarPublicationComparison: { fields: [] },
    requestedHost: 'example.test',
    registrableDomain: 'example.test',
    finalUrl: 'https://example.test/',
    canonicalUrl: 'https://example.test/',
    tlsAuthorization: { authorized: true },
    targetType: 'domain',
    availableEvidence: ['dns', 'delegation', 'mail', 'dependency'],
    hasCaseSection: true,
  });

  assert.equal(support.guidance.task, 'acquisition');
  assert.equal(support.counts.conflicts, 1);
  assert.equal(support.counts.uncertainties, 1);
  assert.equal(support.entries[0]?.title, 'Registrar differs between registration sources');
  assert.match(support.entries[1]?.detail ?? '', /no disagreement or equivalence conclusion/u);
  assert.ok(support.actions.some((action) => action.id === 'review-priority-conflict'));
  assert.ok(support.actions.some((action) => action.id === 'review-refresh-options'));
  assert.ok(support.actions.length <= 6);
  const presentedActions = projectLookupNextActions(support.actions, 'acquisition');
  assert.deepEqual(
    presentedActions.slice(0, 2).map((action) => action.id),
    ['review-priority-conflict', 'review-acquisition-dependencies'],
  );
  assert.ok(presentedActions.length <= 3);
  assert.ok(support.actions.every((action) => action.expectedOutcome.length > 20));
  assert.match(support.actions.find((action) => action.id === 'review-priority-conflict')?.expectedOutcome ?? '', /authoritative|unresolved/u);
});

test('decision support does not turn an unsupported WHOIS service into incident uncertainty', () => {
  const support = buildLookupDecisionSupport({
    task: 'incident',
    coverage: {
      ...coverage,
      entries: coverage.entries.map((entry) => entry.id === 'whois'
        ? {
            ...entry,
            state: 'unsupported',
            statusLabel: 'Unsupported',
            limitations: ['IANA publishes an RDAP service but no domain WHOIS referral.'],
            manualReviewSuggested: false,
          }
        : entry),
      counts: { ...coverage.counts, partial: 0, unsupported: 1 },
      limitedCount: 0,
    },
    refreshPlan: { ...refreshPlan, items: [] },
    registryComparison: {
      sourceHealth: {
        rdap: { status: 'success', condition: 'complete' },
        whois: { status: 'unsupported', condition: 'unavailable' },
      },
      fields: [{
        label: 'Registrar',
        status: 'whois_unavailable',
        rdapDisplay: 'Example Registrar',
        whoisDisplay: 'Unsupported by source',
      }],
    },
    registrarPublicationComparison: { fields: [] },
    targetType: 'domain',
    availableEvidence: [],
  });

  assert.equal(support.counts.uncertainties, 0);
  assert.equal(support.entries.some((entry) => entry.sources.includes('WHOIS')), false);
  assert.equal(support.actions.some((action) => action.id === 'inspect-limited-source'), false);
});

test('identity inconsistencies are bounded review leads with direct evidence links', () => {
  const support = buildLookupDecisionSupport({
    task: 'brand',
    coverage,
    refreshPlan: { ...refreshPlan, items: [] },
    registryComparison: { fields: [] },
    registrarPublicationComparison: { fields: [] },
    requestedHost: 'example.test',
    registrableDomain: 'example.test',
    finalUrl: 'https://external.example/',
    canonicalUrl: 'https://canonical.example/',
    openGraphUrl: 'https://social.example/',
    tlsAuthorization: { authorized: false, error: 'Hostname mismatch' },
    targetType: 'domain',
    availableEvidence: ['tls', 'http', 'redirect', 'page', 'identity'],
  });

  assert.deepEqual(
    support.entries.filter((entry) => entry.state === 'conflict').map((entry) => entry.id),
    [
      'tls-hostname-authorization',
      'page-canonical-origin',
      'http-cross-site-final-origin',
      'page-open-graph-origin',
    ],
  );
  assert.equal(support.entries.find((entry) => entry.id === 'page-open-graph-origin')?.href, '#evidence-page');
});

test('certificate policy differences remain review leads while incomplete policy remains uncertain', () => {
  const support = buildLookupDecisionSupport({
    task: 'owned',
    coverage,
    refreshPlan: { ...refreshPlan, items: [] },
    certificatePolicyReview: {
      findings: [{
        id: 'expected_spki',
        label: 'Reviewed expected certificate public key',
        state: 'changed',
        detail: 'The observed key differs from the reviewed baseline.',
        sources: ['TLS certificate', 'Brand Profile'],
      }, {
        id: 'caa',
        label: 'Current CAA and observed issuer',
        state: 'indeterminate',
        detail: 'CAA evidence was incomplete.',
        sources: ['DNS', 'TLS certificate'],
      }],
    },
    targetType: 'domain',
    availableEvidence: ['dns', 'tls'],
  });
  assert.equal(support.entries.find((entry) => entry.id === 'certificate-policy-expected_spki')?.state, 'conflict');
  assert.equal(support.entries.find((entry) => entry.id === 'certificate-policy-caa')?.state, 'uncertain');
  assert.ok(support.entries
    .filter((entry) => entry.id.startsWith('certificate-policy-'))
    .every((entry) => entry.href === '#evidence-certificate-policy'));
});

test('task actions require exact retained evidence and a domain destination', () => {
  const taskActionIds = new Set([
    'review-page-identity',
    'review-acquisition-dependencies',
    'review-owned-posture',
  ]);
  const expectedTaskAction = {
    general: null,
    acquisition: 'review-acquisition-dependencies',
    brand: 'review-page-identity',
    incident: null,
    owned: 'review-owned-posture',
  } as const;
  const tasks = ['general', 'acquisition', 'brand', 'incident', 'owned'] as const;
  for (const task of tasks) {
    const common = {
      task,
      coverage,
      refreshPlan: { ...refreshPlan, items: [] },
      registryComparison: { fields: [] },
      registrarPublicationComparison: { fields: [] },
      requestedHost: 'target.example.test',
      registrableDomain: 'target.example.test',
      finalUrl: 'https://different.example.test/',
      targetType: 'domain',
      hasCaseSection: true,
    };
    const withoutSupportedEvidence = buildLookupDecisionSupport({ ...common, availableEvidence: [] });
    assert.equal(withoutSupportedEvidence.actions.some((action) => taskActionIds.has(action.id)), false, task);
    assert.equal(withoutSupportedEvidence.actions.some((action) => action.href === '#web-evidence'), false, task);
    assert.ok(withoutSupportedEvidence.actions.every((action) => ['inspect-limited-source', 'review-case-handoff'].includes(action.id)), task);

    const evidenceByTask = {
      general: ['page'],
      acquisition: ['dns'],
      brand: ['identity'],
      incident: ['http'],
      owned: ['delegation'],
    } as const;
    const withSupportedEvidence = buildLookupDecisionSupport({
      ...common,
      availableEvidence: evidenceByTask[task],
    });
    const expected = expectedTaskAction[task];
    assert.equal(withSupportedEvidence.actions.some((action) => taskActionIds.has(action.id)), expected !== null, task);
    if (expected) assert.ok(withSupportedEvidence.actions.some((action) => action.id === expected), task);
  }

  for (const task of tasks) {
    const base = {
      task,
      coverage,
      refreshPlan: { ...refreshPlan, items: [] },
      registryComparison: { fields: [] },
      registrarPublicationComparison: { fields: [] },
    };
    const ptrOnly = buildLookupDecisionSupport({
      ...base,
      targetType: 'ipv4',
      availableEvidence: ['ptr'],
    });
    assert.equal(ptrOnly.actions.some((action) => taskActionIds.has(action.id)), false, `${task} PTR`);
    const nonDomainWithWeb = buildLookupDecisionSupport({
      ...base,
      targetType: 'asn',
      availableEvidence: ['dns', 'delegation', 'page', 'tls'],
    });
    assert.equal(nonDomainWithWeb.actions.some((action) => taskActionIds.has(action.id)), false, `${task} non-domain`);
  }

  const dnsOnly = (task: 'acquisition' | 'brand' | 'owned') => buildLookupDecisionSupport({
    task,
    coverage,
    refreshPlan: { ...refreshPlan, items: [] },
    registryComparison: { fields: [] },
    registrarPublicationComparison: { fields: [] },
    targetType: 'domain',
    availableEvidence: ['dns', 'delegation'],
  });
  assert.ok(dnsOnly('acquisition').actions.some((action) => action.id === 'review-acquisition-dependencies'));
  assert.equal(dnsOnly('brand').actions.some((action) => taskActionIds.has(action.id)), false);
  assert.ok(dnsOnly('owned').actions.some((action) => action.id === 'review-owned-posture'));
});

test('importance outranks task affinity and unavailable web destinations are not recommended', () => {
  const base = {
    task: 'brand' as const,
    coverage,
    refreshPlan: { ...refreshPlan, items: [] },
    registryComparison: {
      fields: [{
        label: 'Registrar',
        status: 'conflict',
        rdapDisplay: 'Registrar One',
        whoisDisplay: 'Registrar Two',
      }],
    },
    registrarPublicationComparison: { fields: [] },
    requestedHost: 'example.test',
    registrableDomain: 'example.test',
    finalUrl: 'https://example.test/',
    openGraphUrl: 'https://outside.example/',
    targetType: 'domain',
  };
  const noPageEvidence = buildLookupDecisionSupport({ ...base, availableEvidence: ['dns'] });
  assert.equal(noPageEvidence.entries[0]?.importance, 'high');
  assert.match(noPageEvidence.entries[0]?.title ?? '', /Registrar differs/u);
  assert.equal(noPageEvidence.actions[0]?.href, '#registry');
  assert.equal(noPageEvidence.actions.some((action) => action.href === '#evidence-page'), false);

  const withPageEvidence = buildLookupDecisionSupport({ ...base, availableEvidence: ['page'] });
  assert.equal(withPageEvidence.entries[0]?.importance, 'high');
  assert.equal(withPageEvidence.actions[0]?.href, '#registry');
});

test('quality matrix joins coverage, timing, freshness, refresh, and downstream use', () => {
  const matrix = buildLookupEvidenceQualityMatrix({
    coverage,
    refreshPlan,
    timing: {
      version: 1,
      totalMs: 1_250,
      sources: [
        { source: 'rdap', outcome: 'fulfilled', durationMs: 180, completedAfterMs: 180 },
        { source: 'whois', outcome: 'rejected', durationMs: 900, completedAfterMs: 1_020 },
        { source: 'domain_evidence', outcome: 'fulfilled', durationMs: 700, completedAfterMs: 1_250 },
      ],
    },
    observedAt: '2026-07-30T00:00:00.000Z',
    observedAtByEvidence: {
      whois: '2026-07-31T00:00:00.000Z',
    },
    now: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(matrix.totalMs, 1_250);
  assert.equal(matrix.ageDays, 1);
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.durationMs, 900);
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.timingOutcome, 'rejected');
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.observedAt, '2026-07-31T00:00:00.000Z');
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.ageDays, 0);
  assert.equal(matrix.entries.find((entry) => entry.id === 'rdap')?.observedAt, '2026-07-30T00:00:00.000Z');
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.refreshAvailable, true);
  assert.equal(matrix.entries.find((entry) => entry.id === 'rdap')?.endpointClass, 'Authoritative registry endpoint');
  assert.match(
    matrix.entries.find((entry) => entry.id === 'rdap')?.description ?? '',
    /Structured registration data/u,
  );
  assert.match(
    matrix.entries.find((entry) => entry.id === 'http')?.description ?? '',
    /bounded homepage request/ui,
  );
  assert.equal(matrix.entries.find((entry) => entry.id === 'rdap')?.truncated, false);
  assert.deepEqual(matrix.entries.find((entry) => entry.id === 'rdap')?.supports, [
    'Registration summary',
    'Lifecycle',
    'Availability',
  ]);
});
