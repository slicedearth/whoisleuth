import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMPARISON_LEDGER_MODES,
  COMPARISON_LEDGER_STATES,
  MAX_COMPARISON_LEDGER_DETAIL_ROWS,
  MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST,
  MAX_COMPARISON_LEDGER_INDEX_ITEMS,
  MAX_COMPARISON_LEDGER_LIMITATIONS,
  buildComparisonLedgerDetails,
  buildComparisonLedgerIndex,
  comparisonLedgerBulkPairIndexId,
  normaliseComparisonLedgerRow,
  safeComparisonLedgerHref,
  stableComparisonLedgerId,
  stableComparisonLedgerJson,
  type ComparisonLedgerInput,
} from '../frontend/src/lib/analysis/comparison-ledger.ts';
import * as cases from '../frontend/src/lib/analysis/case-model.ts';
import { buildLookupWebsiteSnapshot } from '../frontend/src/lib/analysis/lookup-snapshot-input.ts';
import type { JsonRecord } from '../frontend/src/lib/analysis/lookup-display-model.ts';
import type { PageBaseline } from '../frontend/src/lib/analysis/page-baseline.ts';
import { normalizeWebsiteSnapshotStore } from '../frontend/src/lib/analysis/website-snapshot-model.ts';

const EARLIER = '2026-06-01T00:00:00.000Z';
const MIDDLE = '2026-06-01T12:00:00.000Z';
const LATER = '2026-06-02T00:00:00.000Z';
const DIGEST = 'a'.repeat(64);

const PAGE_BASELINE: PageBaseline = {
  baselineVersion: 1,
  domain: 'builder.reservation.invalid',
  lookupDomain: 'builder.reservation.invalid',
  observedAt: EARLIER,
  pageIdentityVersion: 3,
  fingerprintVersion: 1,
  pageTitle: 'Retained page',
  canonicalHost: 'builder.reservation.invalid',
  faviconHash: DIGEST,
  faviconPHash: 'b'.repeat(16),
  normalizedHtml: { algorithm: 'sha256', value: DIGEST, tokenCount: 4, truncated: false },
  visibleText: { algorithm: 'simhash64-v1', value: 'b'.repeat(16), tokenCount: 4, featureCount: 4, truncated: false },
  domStructure: { algorithm: 'sha256', value: DIGEST, nodeCount: 4, parser: 'static-tag-sequence-v1', truncated: false },
  formStructure: { algorithm: 'sha256', value: DIGEST, formCount: 0, controlCount: 0, truncated: false },
  resourceHosts: { algorithm: 'set-sha256', value: DIGEST, values: [], truncated: false },
  trackingIdentifiers: { algorithm: 'set-sha256', value: DIGEST, values: [], truncated: false },
  complete: true,
  truncated: false,
};

function caseEvidence(overrides: Record<string, unknown> = {}) {
  return {
    scanDepth: 'deep',
    availability: 'registered',
    riskModelVersion: 1,
    riskScore: 40,
    registrar: 'Example Registrar',
    activityStatus: 'active',
    pageTitle: 'Earlier title',
    ...overrides,
  };
}

function caseWithSnapshots(
  domain: string,
  earlier: Record<string, unknown>,
  later: Record<string, unknown>,
) {
  const opened = cases.openOrCreateCase([], {
    domain,
    source: 'lookup',
    evidence: earlier,
  }, EARLIER);
  return cases.updateCase(opened.cases, opened.record.id, { evidence: later }, LATER).record;
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    normalizedHtml: 'a'.repeat(64),
    visibleText: 'b'.repeat(64),
    domStructure: 'c'.repeat(64),
    formStructure: 'd'.repeat(64),
    resourceHosts: 'e'.repeat(64),
    trackingIdentifiers: 'f'.repeat(64),
    faviconHash: '1'.repeat(64),
    ...overrides,
  };
}

function websiteSnapshot(
  id: string,
  domain: string,
  observedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    domain,
    observedAt,
    savedAt: observedAt,
    complete: true,
    truncated: false,
    profileProvenance: { technology: { version: 11, state: 'known' }, securityPosture: { version: 2, state: 'known' } },
    technologies: [{ id: 'cms', name: 'Example CMS', category: 'framework', confidence: 'high', roles: ['framework_runtime'] }],
    posture: [{ id: 'headers', state: 'present' }],
    identity: identity(),
    identityValues: { resourceHosts: ['assets.reservation.invalid'], trackingIdentifiers: [], formActionOrigins: [] },
    sources: [{ source: 'http', state: 'complete' }, { source: 'tls', state: 'complete' }],
    dependencies: [],
    certificate: null,
    ...overrides,
  };
}

function builderWebsiteSnapshot(
  id: string,
  observedAt: string,
  options: Readonly<{
    complete?: boolean;
    diagnostics?: JsonRecord;
    technologies?: readonly { id: string; name: string; category: string; confidence: string; roles: readonly string[] }[];
  }> = {},
) {
  const complete = options.complete ?? true;
  return buildLookupWebsiteSnapshot({
    id,
    domain: 'builder.reservation.invalid',
    observedAt,
    savedAt: observedAt,
    lookupEvidenceDepth: 'deep',
    technologyProfile: { profileVersion: 11, complete, truncated: false },
    securityPosture: { postureVersion: 2, complete: true, truncated: false },
    tlsEvidence: {},
    baseline: complete ? PAGE_BASELINE : { ...PAGE_BASELINE, complete: false },
    technologyFindings: options.technologies ?? [{ id: 'cms', name: 'Example CMS', category: 'framework', confidence: 'high', roles: ['framework_runtime'] }],
    securityPostureFindings: [],
    diagnostics: options.diagnostics ?? { rdap: { status: 'success' }, whois: { status: 'partial' } },
  });
}

function bulkResult(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    status: 'complete',
    scanDepth: 'deep',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Observed response',
    activityStatus: 'active',
    risk: 20,
    opportunity: 30,
    trusted: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    idnReferenceMatch: false,
    pageBaselineMatch: false,
    hasActiveBrandProfile: false,
    riskModelVersion: 1,
    opportunityModelVersion: 1,
    riskFactors: [],
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'availability', state: 'complete' },
      { source: 'http', state: 'complete' },
    ],
    comparisonEvidence: {
      version: 1,
      technology: { state: 'success', ids: ['cms'], truncated: false },
      tls: { state: 'success', issuerLabel: 'Example CA', spkiSha256: 'a'.repeat(64) },
    },
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
    ...overrides,
  };
}

function bulkSession(
  id: string,
  name: string,
  updatedAt: string,
  results: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name,
    mode: 'deep',
    state: 'complete',
    inputDigest: `sha256:${id === 'bulk-earlier' ? '1' : '2'}`.padEnd(71, id === 'bulk-earlier' ? '1' : '2'),
    domains: results.map((item) => item.domain),
    results,
    startedAt: updatedAt,
    updatedAt,
    completedAt: updatedAt,
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
    ...overrides,
  };
}

function watchlistEvent(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: LATER,
    mode: 'deep',
    resultCount: 1,
    conclusiveCount: 1,
    changeCount: 1,
    omittedChanges: 0,
    changes: [{
      domain: 'watch.reservation.invalid',
      field: 'pageTitle',
      before: 'Earlier title',
      after: 'Later title',
      kind: 'field_changed',
      tone: 'neutral',
    }],
    ...overrides,
  };
}

describe('comparison ledger row contract', () => {
  test('keeps every semantic mode and state explicit', () => {
    for (const mode of COMPARISON_LEDGER_MODES) {
      for (const state of COMPARISON_LEDGER_STATES) {
        const row = normaliseComparisonLedgerRow({
          ownerId: 'owner-1',
          entityId: 'entity-1',
          mode,
          state,
          field: 'Field',
          family: 'family',
          earlier: { source: 'Earlier source', sourceState: 'complete', value: 'before' },
          later: { source: 'Later source', sourceState: 'complete', value: 'after' },
          completeness: 'complete',
        });
        assert.equal(row?.mode, mode);
        assert.equal(row?.state, state);
      }
    }
  });

  test('bounds exact strings and limitations while exposing the row truncation', () => {
    const row = normaliseComparisonLedgerRow({
      ownerId: 'owner-1', entityId: 'entity-1', mode: 'reconciliation', state: 'conflict',
      field: 'Field', family: 'family',
      earlier: { source: 'Earlier', sourceState: 'complete', value: 'x'.repeat(2_000) },
      later: { source: 'Later', sourceState: 'partial', value: 'different' },
      completeness: 'partial',
      limitations: Array.from({ length: 20 }, (_, index) => `Limitation ${index}`),
    });
    assert.ok(row);
    assert.equal(row.earlier.value?.length, 500);
    assert.equal(row.truncated, true);
    assert.equal(row.limitations.length, MAX_COMPARISON_LEDGER_LIMITATIONS);
    assert.equal(row.omittedLimitations, 12);
  });

  test('bounds adversarial collection scans and distinguishes a former 32-bit hash collision', () => {
    const limitations = Array.from({ length: 10_000 }, (_, index) => `Limitation ${index}`);
    const largeObject = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`field-${index}`, index]));
    const row = normaliseComparisonLedgerRow({
      ownerId: 'owner-1', entityId: 'entity-1', mode: 'temporal', state: 'different',
      field: 'Field', family: 'family',
      earlier: { source: 'Earlier', sourceState: 'complete', value: Array.from({ length: 10_000 }, (_, index) => index) },
      later: { source: 'Later', sourceState: 'complete', value: largeObject },
      completeness: 'complete', limitations,
    });
    assert.ok(row);
    assert.equal(row.truncated, true);
    assert.equal(row.earlier.value?.length, 500);
    assert.equal(row.later.value?.length, 500);
    assert.equal(row.limitations.length, MAX_COMPARISON_LEDGER_LIMITATIONS);
    assert.equal(row.omittedLimitations, limitations.length - MAX_COMPARISON_LEDGER_LIMITATIONS);

    const formerCollisionLeft = stableComparisonLedgerId('candidate', ['candidate-4a6']);
    const formerCollisionRight = stableComparisonLedgerId('candidate', ['candidate-1l00']);
    assert.notEqual(formerCollisionLeft, formerCollisionRight);
    assert.equal(formerCollisionLeft, stableComparisonLedgerId('candidate', ['candidate-4a6']));
    assert.notEqual(
      stableComparisonLedgerId('candidate', ['a', 'b']),
      stableComparisonLedgerId('candidate', ['a\u001fb']),
      'tuple encoding must not confuse a separator inside one part with two parts',
    );
  });

  test('uses the full bounded rendered identity for repeated owner, entity, and field rows', () => {
    const base = {
      comparisonId: 'interval-1', ownerId: 'owner-1', entityId: 'entity-1', mode: 'temporal',
      field: 'Registrar', family: 'registration', completeness: 'partial',
      earlier: { source: 'Earlier', sourceState: 'not_reported', value: 'Registrar A', observedAt: EARLIER },
      later: { source: 'Later', sourceState: 'not_reported', value: 'Registrar B', observedAt: LATER },
    } as const;
    const different = normaliseComparisonLedgerRow({ ...base, state: 'different' });
    const collection = normaliseComparisonLedgerRow({ ...base, state: 'collection_changed' });
    const otherValue = normaliseComparisonLedgerRow({
      ...base,
      state: 'different',
      later: { ...base.later, value: 'Registrar C' },
    });
    assert.ok(different && collection && otherValue);
    assert.equal(new Set([different.id, collection.id, otherValue.id]).size, 3);
  });

  test('bounds aggregate JSON traversal and output across deeply branching retained values', () => {
    let branching: unknown = 'retained leaf';
    for (let depth = 0; depth < 9; depth += 1) branching = new Array(256).fill(branching);
    const first = stableComparisonLedgerJson(branching);
    const second = stableComparisonLedgerJson(branching);
    assert.equal(first, second);
    assert.equal(first.length <= 8_192, true);
    const row = normaliseComparisonLedgerRow({
      ownerId: 'aggregate-owner', entityId: 'aggregate-entity', mode: 'temporal', state: 'different',
      field: 'Bounded aggregate', family: 'test',
      earlier: { source: 'Earlier', sourceState: 'retained', value: branching },
      later: { source: 'Later', sourceState: 'retained', value: [] },
      completeness: 'not_reported',
    });
    assert.equal(row?.truncated, true);
    assert.equal(row?.earlier.value?.length, 500);
  });

  test('keeps owner links same-origin and rejects slash variants that resolve as authority URLs', () => {
    const base = new URL('https://comparison-ledger.invalid/');
    const safe = [
      '/monitor?view=cases&case=case-1',
      '/%2f%2foutside.invalid',
      '/%5c%5coutside.invalid',
    ];
    for (const candidate of safe) {
      const projected = safeComparisonLedgerHref(candidate);
      assert.equal(projected, candidate);
      assert.equal(new URL(projected, base).origin, base.origin);
    }
    for (const candidate of [
      '//outside.invalid/path',
      '///outside.invalid/path',
      '/\\outside.invalid/path',
      '\\outside.invalid/path',
      'https://outside.invalid/path',
    ]) {
      assert.equal(safeComparisonLedgerHref(candidate), '');
    }
  });
});

describe('retained comparison adapters', () => {
  test('derives adjacent case rows without treating an inconclusive later observation as removal', () => {
    const record = caseWithSnapshots(
      'case-change.reservation.invalid',
      caseEvidence({ availability: 'registered', registrar: 'Earlier Registrar' }),
      caseEvidence({ availability: 'unknown', registrar: 'Later Registrar' }),
    );
    const input = { cases: [record] };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items.length, 1);
    const details = buildComparisonLedgerDetails(input, { itemIds: [index.items[0]?.id] });
    assert.equal(details.rows.find((row) => row.field === 'Availability')?.state, 'incomplete');
    const registrar = details.rows.find((row) => row.field === 'Registrar');
    assert.equal(registrar?.state, 'different');
    assert.equal(registrar?.completeness, 'not_reported');
    assert.equal(registrar?.earlier.sourceState, 'retained');
    assert.equal(registrar?.later.sourceState, 'retained');
    assert.equal(index.items[0]?.earlier.retainedAt, null);
    assert.equal(index.items[0]?.later.retainedAt, null);
    assert.equal(registrar?.earlier.retainedAt, null);
    assert.equal(registrar?.later.retainedAt, null);
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
  });

  test('does not invent source completeness for equivalent case snapshots', () => {
    const record = caseWithSnapshots(
      'case-equivalent.reservation.invalid',
      caseEvidence({ privacyProtected: false }),
      caseEvidence({ privacyProtected: true }),
    );
    const index = buildComparisonLedgerIndex({ cases: [record] });
    const details = buildComparisonLedgerDetails({ cases: [record] }, { itemIds: index.items[0]?.id });
    const equivalent = details.rows.find((row) => row.state === 'equivalent');
    assert.equal(equivalent?.completeness, 'not_reported');
    assert.equal(equivalent?.earlier.sourceState, 'retained');
    assert.equal(equivalent?.later.sourceState, 'retained');
  });

  test('keeps row IDs unique across adjacent intervals for the same owner and field', () => {
    const opened = cases.openOrCreateCase([], {
      domain: 'case-intervals.reservation.invalid',
      source: 'lookup',
      evidence: caseEvidence({ registrar: 'Registrar A' }),
    }, EARLIER);
    const second = cases.updateCase(opened.cases, opened.record.id, {
      evidence: caseEvidence({ registrar: 'Registrar B' }),
    }, MIDDLE);
    const third = cases.updateCase(second.cases, opened.record.id, {
      evidence: caseEvidence({ registrar: 'Registrar C' }),
    }, LATER);
    const input = { cases: [third.record] };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items.length, 2);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items.map((item) => item.id) });
    const registrarRows = details.rows.filter((row) => row.field === 'Registrar');
    assert.equal(registrarRows.length, 2);
    assert.equal(new Set(registrarRows.map((row) => row.id)).size, registrarRows.length);
  });

  test('separates collection and model changes from retained evidence changes', () => {
    const record = caseWithSnapshots(
      'case-model.reservation.invalid',
      caseEvidence({ scanDepth: 'deep', riskModelVersion: 1, riskScore: 20, pageTitle: 'Earlier' }),
      caseEvidence({ scanDepth: 'fast', riskModelVersion: 2, riskScore: 80, pageTitle: null }),
    );
    const index = buildComparisonLedgerIndex({ cases: [record] });
    const details = buildComparisonLedgerDetails({ cases: [record] }, { itemIds: index.items[0]?.id });
    assert.ok(details.rows.some((row) => row.state === 'collection_changed' && row.field === 'Collection depth'));
    assert.ok(details.rows.some((row) => row.state === 'model_changed' && row.field === 'Risk model version'));
    assert.equal(details.rows.some((row) => row.field === 'Risk score'), false);
  });

  test('classifies a changed submitted hostname as observation context rather than target or model change', () => {
    const record = caseWithSnapshots(
      'example.test',
      caseEvidence({ inputHostname: 'login.example.test' }),
      caseEvidence({ inputHostname: 'account.example.test' }),
    );
    const index = buildComparisonLedgerIndex({ cases: [record] });
    const details = buildComparisonLedgerDetails({ cases: [record] }, { itemIds: index.items[0]?.id });
    const context = details.rows.find((row) => row.field === 'Submitted hostname context');
    assert.equal(context?.state, 'not_compared');
    assert.equal(context?.earlier.value, 'login.example.test');
    assert.equal(context?.later.value, 'account.example.test');
    assert.match(context?.limitations.join(' ') ?? '', /observation context only.*not evidence/iu);
    assert.equal(details.rows.some((row) => ['added', 'different', 'model_changed', 'removed'].includes(row.state)), false);
  });

  test('allows website-family removal only from a later complete family', () => {
    const completeEarlier = websiteSnapshot('web-complete-1', 'complete.reservation.invalid', EARLIER);
    const completeLater = websiteSnapshot('web-complete-2', 'complete.reservation.invalid', LATER, { technologies: [] });
    const partialEarlier = websiteSnapshot('web-partial-1', 'partial.reservation.invalid', EARLIER);
    const partialLater = websiteSnapshot('web-partial-2', 'partial.reservation.invalid', LATER, {
      complete: false,
      technologies: [],
      sources: [{ source: 'http', state: 'partial' }],
    });
    const input = { websiteSnapshots: [completeLater, partialLater, completeEarlier, partialEarlier] };
    const index = buildComparisonLedgerIndex(input);
    const completeItem = index.items.find((item) => item.entityId === 'complete.reservation.invalid');
    const partialItem = index.items.find((item) => item.entityId === 'partial.reservation.invalid');
    const complete = buildComparisonLedgerDetails(input, { itemIds: completeItem?.id });
    const partial = buildComparisonLedgerDetails(input, { itemIds: partialItem?.id });
    assert.equal(complete.rows.find((row) => row.field === 'technology.cms')?.state, 'removed');
    assert.equal(partial.rows.find((row) => row.field === 'technology.cms')?.state, 'incomplete');
    assert.equal(partial.rows.some((row) => row.state === 'removed'), false);
  });

  test('requires complete retained HTTP state before technology removal', () => {
    const earlier = websiteSnapshot('web-http-1', 'http-state.reservation.invalid', EARLIER);
    const later = websiteSnapshot('web-http-2', 'http-state.reservation.invalid', LATER, {
      complete: true,
      technologies: [],
      sources: [{ source: 'http', state: 'partial' }],
    });
    const input = { websiteSnapshots: [earlier, later] };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.find((row) => row.field === 'technology.cms')?.state, 'incomplete');
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
  });

  test('canonicalises imported source identity before gating website removal', () => {
    const earlier = websiteSnapshot('web-import-case-1', 'import-case.reservation.invalid', EARLIER);
    const later = websiteSnapshot('web-import-case-2', 'import-case.reservation.invalid', LATER, {
      technologies: [],
      sources: [{ source: ' HTTP ', state: 'partial' }],
    });
    const imported = normalizeWebsiteSnapshotStore([later, earlier]).snapshots;
    assert.equal(imported.some((snapshot) => snapshot.sources.some((source) => source.source === 'HTTP')), true);
    const input = { websiteSnapshots: imported };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'partial');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const technology = details.rows.find((row) => row.field === 'technology.cms');
    assert.equal(technology?.state, 'incomplete');
    assert.equal(technology?.later.sourceState, 'partial');
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
  });

  test('reconciles every duplicate imported source state independently of order', () => {
    const sourceOrders = [
      [{ source: 'http', state: 'complete' }, { source: 'http', state: 'partial' }],
      [{ source: 'http', state: 'partial' }, { source: 'http', state: 'complete' }],
    ];
    const rowSets = sourceOrders.map((sources) => {
      const domain = 'duplicate-source.reservation.invalid';
      const earlier = websiteSnapshot('web-duplicate-1', domain, EARLIER);
      const later = websiteSnapshot('web-duplicate-2', domain, LATER, { technologies: [], sources });
      const imported = normalizeWebsiteSnapshotStore([later, earlier]).snapshots;
      const input = { websiteSnapshots: imported };
      const index = buildComparisonLedgerIndex(input);
      assert.equal(index.items[0]?.completeness, 'partial');
      const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
      const technology = details.rows.find((row) => row.field === 'technology.cms');
      assert.equal(technology?.state, 'incomplete');
      assert.equal(technology?.later.sourceState, 'partial');
      assert.equal(details.rows.some((row) => row.state === 'removed'), false);
      return details.rows;
    });
    assert.deepEqual(rowSets[0], rowSets[1]);
  });

  test('canonicalises website source case before deriving exact row sets', () => {
    const sourceCases = [
      {
        earlier: [{ source: 'http', state: 'complete' }, { source: 'tls', state: 'complete' }],
        later: [{ source: 'HTTP', state: 'complete' }, { source: 'tls', state: 'complete' }],
      },
      {
        earlier: [{ source: 'HTTP', state: 'complete' }, { source: 'tls', state: 'complete' }],
        later: [{ source: 'http', state: 'complete' }, { source: 'tls', state: 'complete' }],
      },
    ];
    const rowSets = sourceCases.map((sources) => {
      const domain = 'source-case.reservation.invalid';
      const earlier = websiteSnapshot('web-source-case-1', domain, EARLIER, { sources: sources.earlier });
      const later = websiteSnapshot('web-source-case-2', domain, LATER, { sources: sources.later });
      const imported = normalizeWebsiteSnapshotStore([later, earlier]).snapshots;
      const input = { websiteSnapshots: imported };
      const index = buildComparisonLedgerIndex(input);
      assert.equal(index.items[0]?.completeness, 'complete');
      const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
      assert.equal(details.rows.length, 1);
      assert.equal(details.rows[0]?.field, 'Curated website profile');
      assert.equal(details.rows[0]?.state, 'equivalent');
      assert.equal(details.rows.some((row) => row.field.startsWith('source.')), false);
      return details.rows;
    });
    assert.deepEqual(rowSets[0], rowSets[1]);
  });

  test('follows real Lookup website snapshot completeness without synthetic source rows', () => {
    const earlier = builderWebsiteSnapshot('builder-complete-1', EARLIER);
    const later = builderWebsiteSnapshot('builder-complete-2', LATER, { technologies: [] });
    assert.deepEqual(later.sources, [
      { source: 'rdap', state: 'success' },
      { source: 'whois', state: 'partial' },
    ]);
    const input = { websiteSnapshots: [earlier, later] };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const removed = details.rows.find((row) => row.field === 'technology.cms');
    assert.equal(removed?.state, 'removed');
    assert.equal(removed?.completeness, 'complete');

    const successLater = builderWebsiteSnapshot('builder-success-2', LATER, {
      diagnostics: { http: { status: 'success' } },
      technologies: [],
    });
    const successInput = { websiteSnapshots: [earlier, successLater] };
    const successIndex = buildComparisonLedgerIndex(successInput);
    const successDetails = buildComparisonLedgerDetails(successInput, { itemIds: successIndex.items[0]?.id });
    assert.equal(successDetails.rows.find((row) => row.field === 'technology.cms')?.state, 'removed');
  });

  test('derives website candidate completeness from both real Lookup snapshots', () => {
    const earlier = builderWebsiteSnapshot('builder-earlier-partial', EARLIER, {
      complete: false,
      diagnostics: { http: { status: 'partial' } },
    });
    const later = builderWebsiteSnapshot('builder-later-complete', LATER, {
      diagnostics: { http: { status: 'success' } },
    });
    assert.equal(earlier.complete, false);
    assert.equal(later.complete, true);
    const input = { websiteSnapshots: [later, earlier] };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'partial');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.some((row) => row.state === 'collection_changed' && row.completeness === 'partial'), true);
  });

  test('keeps identical real Lookup snapshots partial when retained HTTP is partial', () => {
    const earlier = builderWebsiteSnapshot('builder-http-partial-1', EARLIER, {
      diagnostics: { http: { status: 'partial' } },
    });
    const later = builderWebsiteSnapshot('builder-http-partial-2', LATER, {
      diagnostics: { http: { status: 'partial' } },
    });
    assert.equal(earlier.complete, true);
    assert.equal(later.complete, true);
    const input = { websiteSnapshots: [earlier, later] };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'partial');
    assert.equal(index.items[0]?.earlier.sourceState, 'partial');
    assert.equal(index.items[0]?.later.sourceState, 'partial');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows[0]?.field, 'Curated website profile');
    assert.equal(details.rows[0]?.state, 'incomplete');
    assert.equal(details.rows[0]?.completeness, 'partial');
    assert.equal(details.rows.some((row) => row.state === 'equivalent'), false);
  });

  test('preserves unavailable relevant source state in an identical website summary', () => {
    const earlier = builderWebsiteSnapshot('builder-http-unavailable-1', EARLIER, {
      diagnostics: { http: { status: 'unavailable' } },
    });
    const later = builderWebsiteSnapshot('builder-http-unavailable-2', LATER, {
      diagnostics: { http: { status: 'unavailable' } },
    });
    const input = { websiteSnapshots: [earlier, later] };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'unavailable');
    assert.equal(index.items[0]?.earlier.sourceState, 'unavailable');
    assert.equal(index.items[0]?.later.sourceState, 'unavailable');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows[0]?.state, 'unavailable');
    assert.equal(details.rows[0]?.completeness, 'unavailable');
  });

  test('keeps added and different website fields partial when the later real snapshot is partial', () => {
    const earlier = builderWebsiteSnapshot('builder-partial-1', EARLIER);
    const later = builderWebsiteSnapshot('builder-partial-2', LATER, {
      complete: false,
      diagnostics: { http: { status: 'partial' } },
      technologies: [
        { id: 'cms', name: 'Changed CMS', category: 'framework', confidence: 'high', roles: ['framework_runtime'] },
        { id: 'widget', name: 'Added widget', category: 'widget', confidence: 'medium', roles: ['embedded_dependency'] },
      ],
    });
    const input = { websiteSnapshots: [earlier, later] };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const changed = details.rows.find((row) => row.field === 'technology.cms');
    const added = details.rows.find((row) => row.field === 'technology.widget');
    assert.equal(changed?.state, 'different');
    assert.equal(changed?.completeness, 'partial');
    assert.equal(added?.state, 'added');
    assert.equal(added?.completeness, 'partial');
    assert.equal(changed?.later.sourceState, 'partial');
  });

  test('adapts exact retained watchlist changes and reports source omissions', () => {
    const changes = Array.from({ length: 300 }, (_, index) => ({
      domain: `watch-${index}.reservation.invalid`,
      field: 'registrarName',
      before: `Earlier registrar ${index}`,
      after: `Later registrar ${index}`,
      kind: 'infrastructure_changed',
      tone: 'warn',
    }));
    const input = {
      watchlists: {
        Review: {
          updatedAt: LATER,
          results: [{ domain: 'watch.reservation.invalid', scanDepth: 'deep', availability: 'registered' }],
          baseline: [],
          history: [watchlistEvent({ checkedAt: EARLIER, changeCount: 0, changes: [] }), watchlistEvent({ changeCount: 304, omittedChanges: 4, changes })],
        },
      },
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.length, MAX_COMPARISON_LEDGER_DETAIL_ROWS);
    assert.equal(details.totalRows, 300);
    assert.equal(details.omissions.detailRows, 44);
    assert.equal(details.omissions.sourceRows, 4);
    assert.equal(details.rows[0]?.earlier.value?.startsWith('Earlier registrar'), true);
  });

  test('does not turn a value missing from a partial later watchlist check into removal', () => {
    const input = {
      watchlists: {
        'Partial review': {
          updatedAt: LATER,
          results: [{ domain: 'watch.reservation.invalid', scanDepth: 'deep', availability: 'unknown' }],
          baseline: [],
          history: [
            watchlistEvent({ checkedAt: EARLIER, changeCount: 0, changes: [] }),
            watchlistEvent({
              resultCount: 2,
              conclusiveCount: 1,
              changes: [{
                domain: 'watch.reservation.invalid',
                field: 'pageTitle',
                before: 'Earlier title',
                after: null,
                kind: 'field_changed',
                tone: 'warn',
              }],
            }),
          ],
        },
      },
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.find((row) => row.field === 'Page title')?.state, 'incomplete');
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
  });

  test('does not infer field removal from a conclusive Deep watchlist event', () => {
    const input = {
      watchlists: {
        'Conclusive review': {
          updatedAt: LATER,
          results: [{ domain: 'watch.reservation.invalid', scanDepth: 'deep', availability: 'registered' }],
          baseline: [],
          history: [watchlistEvent({
            resultCount: 1,
            conclusiveCount: 1,
            changes: [{
              domain: 'watch.reservation.invalid',
              field: 'pageTitle',
              before: 'Earlier title',
              after: null,
              kind: 'field_changed',
              tone: 'warn',
            }],
          })],
        },
      },
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const pageTitle = details.rows.find((row) => row.field === 'Page title');
    assert.equal(pageTitle?.state, 'incomplete');
    assert.equal(pageTitle?.completeness, 'not_reported');
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
    assert.match(pageTitle?.limitations.join(' ') ?? '', /does not retain field-level completeness/iu);
  });

  test('retains a capacity-pruned first watchlist event with position-independent IDs', () => {
    const events = Array.from({ length: 13 }, (_, index) => watchlistEvent({
      checkedAt: new Date(Date.parse(EARLIER) + index * 1_000).toISOString(),
      changes: [{
        domain: `pruned-${index}.reservation.invalid`,
        field: 'pageTitle',
        before: `Earlier ${index}`,
        after: `Later ${index}`,
        kind: 'field_changed',
        tone: 'neutral',
      }],
    }));
    const entry = { updatedAt: LATER, results: [], baseline: [], history: events };
    const index = buildComparisonLedgerIndex({ watchlists: { Pruned: entry } });
    assert.equal(index.items.length, 12);
    assert.equal(index.items.some((item) => item.later.observedAt === events[1]?.checkedAt), true);

    const retainedEvent = watchlistEvent({ checkedAt: MIDDLE });
    const withoutPrefix = buildComparisonLedgerIndex({
      watchlists: { Stable: { updatedAt: LATER, results: [], baseline: [], history: [retainedEvent] } },
    });
    const withPrefix = buildComparisonLedgerIndex({
      watchlists: { Stable: { updatedAt: LATER, results: [], baseline: [], history: [watchlistEvent({ checkedAt: EARLIER, mode: 'saved', changeCount: 0, changes: [] }), retainedEvent] } },
    });
    assert.equal(withoutPrefix.items[0]?.id, withPrefix.items[0]?.id);
  });

  test('discloses duplicate watchlist events and reconciles retained rows with changeCount', () => {
    const event = watchlistEvent({
      checkedAt: LATER,
      changeCount: 7,
      omittedChanges: 1,
      changes: [{
        domain: 'reconciled.reservation.invalid',
        field: 'pageTitle',
        before: 'Earlier',
        after: 'Later',
        kind: 'field_changed',
        tone: 'neutral',
      }],
    });
    const input = {
      watchlists: { Reconciled: { updatedAt: LATER, results: [], baseline: [], history: [event, structuredClone(event)] } },
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items.length, 1);
    assert.equal(index.omissions.duplicateRecords, 1);
    assert.equal(index.items[0]?.sourceOmittedRows, 6);
    assert.equal(index.items[0]?.truncated, true);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.omissions.sourceRows, 6);
    assert.match(details.rows[0]?.limitations.join(' ') ?? '', /does not include 6 declared bounded change rows/iu);

    const omissionOnlyInput = {
      watchlists: {
        'Omission only': {
          updatedAt: LATER,
          results: [],
          baseline: [],
          history: [watchlistEvent({ changeCount: 7, omittedChanges: 1, changes: [] })],
        },
      },
    };
    const omissionOnlyIndex = buildComparisonLedgerIndex(omissionOnlyInput);
    const omissionOnly = buildComparisonLedgerDetails(omissionOnlyInput, { itemIds: omissionOnlyIndex.items[0]?.id });
    assert.equal(omissionOnly.rows.length, 0);
    assert.equal(omissionOnly.omissions.sourceRows, 7);
    assert.equal(omissionOnly.truncated, true);
  });

  test('suppresses duplicate exact rows without counting them as detail-bound omissions', () => {
    const change = {
      domain: 'duplicate-row.reservation.invalid',
      field: 'pageTitle',
      before: 'Earlier title',
      after: 'Later title',
      kind: 'field_changed',
      tone: 'neutral',
    };
    const input = {
      watchlists: {
        'Duplicate rows': {
          updatedAt: LATER,
          results: [],
          baseline: [],
          history: [watchlistEvent({ changeCount: 2, changes: [change, structuredClone(change)] })],
        },
      },
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.length, 1);
    assert.equal(details.totalRows, 1);
    assert.equal(details.omissions.duplicateDetailRows, 1);
    assert.equal(details.omissions.detailRows, 0);
    assert.equal(details.omissions.duplicateRecords, 0);
    assert.equal(details.truncated, true);
  });

  test('bounds watchlist property discovery and reports the stopped input scan', () => {
    const watchlists: Record<string, unknown> = {};
    for (let index = 0; index < 1_000; index += 1) {
      watchlists[`Review ${String(index).padStart(4, '0')}`] = {
        updatedAt: LATER,
        results: [],
        baseline: [],
        history: [watchlistEvent({ mode: 'saved', changeCount: 0, changes: [] })],
      };
    }
    const index = buildComparisonLedgerIndex({ watchlists });
    assert.equal(index.omissions.inputRecords, 300);
    assert.equal(index.omissions.inputScanTruncations, 1);
    assert.equal(index.truncated, true);
  });

  test('never creates a Bulk ledger item until an exact pair is supplied', () => {
    const earlier = bulkSession('bulk-earlier', 'Earlier saved session', EARLIER, [
      bulkResult('shared.reservation.invalid'),
      bulkResult('earlier-only.reservation.invalid'),
    ]);
    const later = bulkSession('bulk-later', 'Later saved session', LATER, [
      bulkResult('shared.reservation.invalid', { registrar: 'Later Registrar', risk: 80, riskModelVersion: 2 }),
      bulkResult('later-only.reservation.invalid'),
    ]);
    const baseInput = { bulkSessions: [later, earlier] };
    assert.equal(buildComparisonLedgerIndex(baseInput).items.length, 0);
    const input = {
      ...baseInput,
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items.length, 1);
    assert.equal(index.items[0]?.id, comparisonLedgerBulkPairIndexId(earlier.id, later.id));
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.find((row) => row.entityId === 'earlier-only.reservation.invalid')?.state, 'not_compared');
    assert.equal(details.rows.find((row) => row.entityId === 'later-only.reservation.invalid')?.state, 'added');
    assert.ok(details.rows.some((row) => row.entityId === 'shared.reservation.invalid' && row.state === 'model_changed'));
    assert.equal(details.rows.some((row) => row.entityId === 'shared.reservation.invalid' && row.field === 'Risk score'), false);
  });

  test('keeps technology and TLS source-state changes separate from value changes', () => {
    const earlier = bulkSession('bulk-evidence-earlier', 'Earlier evidence', EARLIER, [
      bulkResult('projection.reservation.invalid'),
    ]);
    const later = bulkSession('bulk-evidence-later', 'Later evidence', LATER, [
      bulkResult('projection.reservation.invalid', {
        sourceCoverage: [{ source: 'http', state: 'complete' }],
        comparisonEvidence: {
          version: 1,
          technology: { state: 'partial', ids: [], truncated: false },
          tls: { state: 'partial', issuerLabel: null, spkiSha256: null },
        },
      }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.find((row) => row.field === 'Technology IDs')?.state, 'collection_changed');
    assert.equal(details.rows.find((row) => row.field === 'TLS issuer')?.state, 'collection_changed');
    assert.equal(details.rows.find((row) => row.field === 'TLS public key')?.state, 'collection_changed');
    assert.equal(details.rows.some((row) => row.state === 'removed'), false);
  });

  test('does not turn unavailable-to-success technology collection into an observed addition', () => {
    const earlier = bulkSession('bulk-tech-unavailable', 'Unavailable technology', EARLIER, [
      bulkResult('technology-state.reservation.invalid', {
        comparisonEvidence: {
          version: 1,
          technology: { state: 'unavailable', ids: [], truncated: false },
          tls: { state: 'success', issuerLabel: 'Example CA', spkiSha256: 'a'.repeat(64) },
        },
      }),
    ]);
    const later = bulkSession('bulk-tech-success', 'Successful technology', LATER, [
      bulkResult('technology-state.reservation.invalid'),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const technology = details.rows.find((row) => row.field === 'Technology IDs');
    assert.equal(technology?.state, 'collection_changed');
    assert.equal(technology?.earlier.sourceState, 'unavailable');
    assert.equal(technology?.later.sourceState, 'success');
    assert.equal(details.rows.some((row) => row.field === 'Technology IDs' && row.state === 'added'), false);
  });

  test('does not compare same-model scores across Fast and Deep result rows', () => {
    const earlier = bulkSession('bulk-fast-score', 'Fast score', EARLIER, [
      bulkResult('depth-score.reservation.invalid', { scanDepth: 'fast', risk: 20, opportunity: 30 }),
    ], { mode: 'fast' });
    const later = bulkSession('bulk-deep-score', 'Deep score', LATER, [
      bulkResult('depth-score.reservation.invalid', { scanDepth: 'deep', risk: 80, opportunity: 70 }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.find((row) => row.field === 'Risk score')?.state, 'not_compared');
    assert.equal(details.rows.find((row) => row.field === 'Opportunity score')?.state, 'not_compared');
    assert.equal(details.rows.some((row) => row.field === 'Risk score' && row.state === 'different'), false);
    assert.ok(details.rows.some((row) => row.field === 'Bulk collection mode' && row.state === 'collection_changed'));
  });

  test('keeps registrar provenance conservative across RDAP and WHOIS source switches', () => {
    const earlier = bulkSession('bulk-rdap-registrar', 'RDAP registrar', EARLIER, [
      bulkResult('registrar-source.reservation.invalid', {
        registrar: 'Earlier Registrar',
        sourceCoverage: [
          { source: 'rdap', state: 'complete' },
          { source: 'whois', state: 'unavailable' },
          { source: 'availability', state: 'complete' },
        ],
      }),
    ]);
    const later = bulkSession('bulk-whois-registrar', 'WHOIS registrar', LATER, [
      bulkResult('registrar-source.reservation.invalid', {
        registrar: '—',
        sourceCoverage: [
          { source: 'rdap', state: 'unavailable' },
          { source: 'whois', state: 'complete' },
          { source: 'availability', state: 'complete' },
        ],
      }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const registrar = details.rows.find((row) => row.field === 'Registrar');
    assert.equal(registrar?.state, 'not_compared');
    assert.equal(registrar?.earlier.sourceState, 'not_reported');
    assert.equal(registrar?.later.sourceState, 'not_reported');
    assert.match(registrar?.limitations.join(' ') ?? '', /exact retained registrar texts.*field-level registrar provenance/iu);
    assert.equal(details.rows.some((row) => row.field === 'Registrar' && row.state === 'removed'), false);
    assert.ok(details.rows.some((row) => row.field === 'rdap source state' && row.state === 'collection_changed'));
    assert.ok(details.rows.some((row) => row.field === 'whois source state' && row.state === 'collection_changed'));
  });

  test('uses the exact availability source instead of another registration source', () => {
    const earlier = bulkSession('bulk-availability-partial', 'Partial availability', EARLIER, [
      bulkResult('availability-source.reservation.invalid', {
        availability: 'registered',
        sourceCoverage: [{ source: 'rdap', state: 'complete' }, { source: 'availability', state: 'partial' }],
      }),
    ]);
    const later = bulkSession('bulk-availability-complete', 'Complete availability', LATER, [
      bulkResult('availability-source.reservation.invalid', {
        availability: 'available',
        sourceCoverage: [{ source: 'rdap', state: 'complete' }, { source: 'availability', state: 'complete' }],
      }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const availability = details.rows.find((row) => row.field === 'Availability');
    assert.equal(availability?.state, 'collection_changed');
    assert.equal(availability?.earlier.sourceState, 'partial');
    assert.equal(availability?.later.sourceState, 'complete');
  });

  test('keeps identical rows incomplete when their retained source evidence is partial', () => {
    const partialResult = bulkResult('partial-equivalence.reservation.invalid', {
      sourceCoverage: [
        { source: 'rdap', state: 'complete' },
        { source: 'availability', state: 'complete' },
        { source: 'http', state: 'partial' },
      ],
      comparisonEvidence: {
        version: 1,
        technology: { state: 'success', ids: ['cms'], truncated: false },
        tls: { state: 'success', issuerLabel: 'Example CA', spkiSha256: 'a'.repeat(64) },
      },
    });
    const earlier = bulkSession('bulk-partial-equal-earlier', 'Earlier partial', EARLIER, [partialResult]);
    const later = bulkSession('bulk-partial-equal-later', 'Later partial', LATER, [structuredClone(partialResult)]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'partial');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.length, 1);
    assert.equal(details.rows[0]?.field, 'Compact comparable saved rows');
    assert.equal(details.rows[0]?.state, 'incomplete');
    assert.equal(details.rows[0]?.completeness, 'partial');
    assert.equal(details.rows.some((row) => row.state === 'equivalent'), false);
  });

  test('allows an identical fully source-complete non-empty Bulk pair to be equivalent', () => {
    const retained = bulkResult('complete-equivalence.reservation.invalid', {
      sourceCoverage: [
        { source: 'rdap', state: 'complete' },
        { source: 'whois', state: 'unsupported' },
        { source: 'availability', state: 'complete' },
        { source: 'http', state: 'complete' },
      ],
    });
    const earlier = bulkSession('bulk-complete-equal-earlier', 'Earlier complete', EARLIER, [retained]);
    const later = bulkSession('bulk-complete-equal-later', 'Later complete', LATER, [structuredClone(retained)]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'complete');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.length, 1);
    assert.equal(details.rows[0]?.state, 'equivalent');
    assert.equal(details.rows[0]?.completeness, 'complete');
  });

  test('downgrades identical rows when a retained registration source is partial', () => {
    const retained = bulkResult('partial-registration.reservation.invalid', {
      sourceCoverage: [
        { source: 'rdap', state: 'partial' },
        { source: 'availability', state: 'complete' },
        { source: 'http', state: 'complete' },
      ],
    });
    const earlier = bulkSession('bulk-registration-partial-earlier', 'Earlier registration', EARLIER, [retained]);
    const later = bulkSession('bulk-registration-partial-later', 'Later registration', LATER, [structuredClone(retained)]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.completeness, 'partial');
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows[0]?.state, 'incomplete');
    assert.equal(details.rows[0]?.completeness, 'partial');
  });

  test('compares Website activity by activity status rather than mail-summary text', () => {
    const earlier = bulkSession('bulk-mail-earlier', 'Earlier mail summary', EARLIER, [
      bulkResult('mail-only.reservation.invalid', { activity: 'Active site · MX observed', activityStatus: 'active' }),
    ]);
    const later = bulkSession('bulk-mail-later', 'Later mail summary', LATER, [
      bulkResult('mail-only.reservation.invalid', { activity: 'Active site · no MX observed', activityStatus: 'active' }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.some((row) => row.field === 'Website activity'), false);
  });

  test('compares every retained technology ID rather than display-bounded serialisation', () => {
    const common = Array.from({ length: 11 }, (_, index) => `tech-${String(index).padStart(2, '0')}`);
    const evidence = (ids: string[]) => ({
      version: 1,
      technology: { state: 'success', ids, truncated: false },
      tls: { state: 'success', issuerLabel: 'Example CA', spkiSha256: 'a'.repeat(64) },
    });
    const earlier = bulkSession('bulk-tail-earlier', 'Earlier tail', EARLIER, [
      bulkResult('tail.reservation.invalid', { comparisonEvidence: evidence([...common, 'zz-tail-a']) }),
    ]);
    const later = bulkSession('bulk-tail-later', 'Later tail', LATER, [
      bulkResult('tail.reservation.invalid', { comparisonEvidence: evidence([...common, 'zz-tail-b']) }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    const technology = details.rows.find((row) => row.field === 'Technology IDs');
    assert.equal(technology?.state, 'different');
    assert.match(technology?.earlier.value ?? '', /zz-tail-a/u);
    assert.match(technology?.later.value ?? '', /zz-tail-b/u);
  });

  test('does not compare scores whose retained model versions are absent', () => {
    const earlier = bulkSession('bulk-unversioned-earlier', 'Earlier unversioned', EARLIER, [
      bulkResult('unversioned.reservation.invalid', {
        risk: 20,
        opportunity: 30,
        riskModelVersion: null,
        opportunityModelVersion: null,
      }),
    ]);
    const later = bulkSession('bulk-unversioned-later', 'Later unversioned', LATER, [
      bulkResult('unversioned.reservation.invalid', {
        risk: 80,
        opportunity: 70,
        riskModelVersion: null,
        opportunityModelVersion: null,
      }),
    ]);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.rows.some((row) => row.field === 'Risk score'), false);
    assert.equal(details.rows.some((row) => row.field === 'Opportunity score'), false);
    assert.equal(details.rows.find((row) => row.field === 'Risk model version')?.state, 'not_compared');
    assert.equal(details.rows.find((row) => row.field === 'Opportunity model version')?.state, 'not_compared');
  });

  test('rejects reversed explicit Bulk pairs in the pure adapter', () => {
    const earlier = bulkSession('bulk-direction-earlier', 'Earlier', EARLIER, [bulkResult('direction.reservation.invalid')]);
    const later = bulkSession('bulk-direction-later', 'Later', LATER, [bulkResult('direction.reservation.invalid')]);
    const index = buildComparisonLedgerIndex({
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: later.id, laterSessionId: earlier.id }],
    });
    assert.equal(index.items.length, 0);
    assert.equal(index.omissions.invalidRecords, 1);
  });

  test('deduplicates explicit Bulk pairs before deriving their comparison', () => {
    const earlier = bulkSession('bulk-dedupe-earlier', 'Earlier', EARLIER, [bulkResult('dedupe.reservation.invalid')]);
    const later = bulkSession('bulk-dedupe-later', 'Later', LATER, [bulkResult('dedupe.reservation.invalid')]);
    const pair = { earlierSessionId: earlier.id, laterSessionId: later.id };
    const index = buildComparisonLedgerIndex({
      bulkSessions: [earlier, later],
      bulkPairs: Array.from({ length: 2_000 }, () => pair),
    });
    assert.equal(index.items.length, 1);
    assert.equal(index.omissions.duplicateRecords, 1_999);
  });

  test('does not infer truncation from an exact 2,000-row Bulk comparison', () => {
    const earlierResults = Array.from({ length: 2_000 }, (_, index) => (
      bulkResult(`row-${index}.reservation.invalid`, { registrar: 'Earlier Registrar' })
    ));
    const laterResults = Array.from({ length: 2_000 }, (_, index) => (
      bulkResult(`row-${index}.reservation.invalid`, { registrar: 'Later Registrar' })
    ));
    const earlier = bulkSession('bulk-cap-earlier', 'Earlier cap review', EARLIER, earlierResults);
    const later = bulkSession('bulk-cap-later', 'Later cap review', LATER, laterResults);
    const input = {
      bulkSessions: [earlier, later],
      bulkPairs: [{ earlierSessionId: earlier.id, laterSessionId: later.id }],
    };
    const index = buildComparisonLedgerIndex(input);
    assert.equal(index.items[0]?.truncated, false);
    const details = buildComparisonLedgerDetails(input, { itemIds: index.items[0]?.id });
    assert.equal(details.totalRows, 2_000);
    assert.equal(details.rows.length, MAX_COMPARISON_LEDGER_DETAIL_ROWS);
    assert.equal(details.omissions.detailRows, 2_000 - MAX_COMPARISON_LEDGER_DETAIL_ROWS);
  });
});

describe('ledger bounds, stability, and privacy', () => {
  test('keeps the metadata index value-free, stable, and non-mutating', () => {
    const secret = 'exact-evidence-value-must-not-enter-index';
    const record = caseWithSnapshots(
      'metadata.reservation.invalid',
      caseEvidence({ registrar: secret }),
      caseEvidence({ registrar: 'Later registrar' }),
    );
    const input: ComparisonLedgerInput = { cases: [record] };
    const original = structuredClone(input);
    const first = buildComparisonLedgerIndex(input);
    const second = buildComparisonLedgerIndex(input);
    assert.deepEqual(first, second);
    assert.deepEqual(input, original);
    assert.equal(JSON.stringify(first).includes(secret), false);
    const details = buildComparisonLedgerDetails(input, { itemIds: first.items[0]?.id });
    assert.equal(JSON.stringify(details.rows).includes(secret), true);
    assert.deepEqual(input, original);
  });

  test('rejects an over-cap raw case history without reading a sentinel element', () => {
    const record = caseWithSnapshots(
      'history-cap.reservation.invalid',
      caseEvidence({ registrar: 'Earlier Registrar' }),
      caseEvidence({ registrar: 'Later Registrar' }),
    );
    const history = new Array<unknown>(1_100);
    Object.defineProperty(history, 999, {
      get() {
        throw new Error('history scan escaped its bound');
      },
    });
    const index = buildComparisonLedgerIndex({ cases: [{ ...record, evidenceHistory: history }] });
    assert.equal(index.items.length, 0);
    assert.equal(index.omissions.inputRecords, 1_000);
    assert.equal(index.omissions.inputScanTruncations, 1);
    assert.equal(index.omissions.invalidRecords, 1);
  });

  test('caps a deterministic adversarial index and reports every discarded item', () => {
    const records = Array.from({ length: 84 }, (_, caseIndex) => ({
      id: `case-${caseIndex}`,
      domain: `case-${caseIndex}.reservation.invalid`,
      source: 'lookup',
      evidenceHistory: Array.from({ length: 25 }, (_, snapshotIndex) => ({
        ...caseEvidence({ registrar: `Registrar ${snapshotIndex}` }),
        id: `case-${caseIndex}-snapshot-${snapshotIndex}`,
        capturedAt: new Date(Date.parse(EARLIER) + (caseIndex * 25 + snapshotIndex) * 1_000).toISOString(),
      })),
      createdAt: EARLIER,
      updatedAt: LATER,
    }));
    const first = buildComparisonLedgerIndex({ cases: records });
    const second = buildComparisonLedgerIndex({ cases: structuredClone(records).reverse() });
    assert.equal(first.items.length, MAX_COMPARISON_LEDGER_INDEX_ITEMS);
    assert.equal(first.counts.candidates, 84 * 24);
    assert.equal(first.omissions.indexItems, 16);
    assert.deepEqual(first.items.map((item) => item.id), second.items.map((item) => item.id));
  });

  test('caps entity requests, rejects malformed IDs, and reports string truncation', () => {
    const snapshots = Array.from({ length: 22 }, (_, index) => websiteSnapshot(
      `web-${index}`,
      'many.reservation.invalid',
      new Date(Date.parse(EARLIER) + index * 1_000).toISOString(),
      { technologies: [{ id: 'cms', name: `CMS ${index}`, category: 'framework', confidence: 'high' }] },
    ));
    const input = { websiteSnapshots: snapshots };
    const index = buildComparisonLedgerIndex(input);
    const requests = [...index.items.map((item) => item.id), index.items[0]?.id, '', 'x'.repeat(1_000)];
    const details = buildComparisonLedgerDetails(input, { itemIds: requests });
    assert.equal(details.selectedItems.length, MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST);
    assert.equal(details.omissions.entityRequests, 1);
    assert.equal(details.omissions.duplicateEntityRequests, 1);
    assert.equal(details.omissions.invalidEntityRequests, 2);
    assert.equal(details.omissions.truncatedStrings > 0, true);
  });

  test('rejects non-canonical request ID aliases', () => {
    const record = caseWithSnapshots(
      'request-alias.reservation.invalid',
      caseEvidence({ registrar: 'Earlier Registrar' }),
      caseEvidence({ registrar: 'Later Registrar' }),
    );
    const input = { cases: [record] };
    const id = buildComparisonLedgerIndex(input).items[0]?.id ?? '';
    const details = buildComparisonLedgerDetails(input, { itemIds: [id, ` ${id}`, `${id}!`] });
    assert.equal(details.selectedItems.length, 1);
    assert.equal(details.omissions.invalidEntityRequests, 2);
    assert.equal(details.omissions.missingEntities, 0);
  });

  test('caps the raw request scan before iterating a million supplied IDs', () => {
    const record = caseWithSnapshots(
      'request-cap.reservation.invalid',
      caseEvidence({ registrar: 'Earlier Registrar' }),
      caseEvidence({ registrar: 'Later Registrar' }),
    );
    const input = { cases: [record] };
    const index = buildComparisonLedgerIndex(input);
    const requests = new Array<unknown>(1_000_000).fill(index.items[0]?.id);
    const details = buildComparisonLedgerDetails(input, { itemIds: requests });
    assert.equal(details.selectedItems.length, 1);
    assert.equal(
      details.omissions.entityRequests,
      requests.length - (MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST * 4),
    );
    assert.equal(details.omissions.duplicateEntityRequests, (MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST * 4) - 1);
  });
});
