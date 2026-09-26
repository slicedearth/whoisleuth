import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkDomainAvailability } from '../lib/availability.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { projectLookupEvidenceAvailability } from '../lib/evidence-export-privacy.mts';
import { isWebCollectionQuality, normalizeWebCollectionQuality, webCollectionQualityForCapture } from '../packages/evidence/collection-quality.mts';
import { compareCaseEvidence, caseEvidenceIncomparableReasons, normalizeSnapshot } from '../packages/cases/case-evidence-model.mts';
import { publishedCaseEvidenceTimelineForVerification } from '../packages/cases/case-evidence-model.mts';
import { appendWatchlistScan, normalizeWatchlistEntry } from '../packages/workspace/watchlist-history.mts';
import { buildWatchlistExport, mergeWatchlistStores, normalizeWatchlistStore } from '../packages/workspace/watchlist-store.mts';
import { normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { fromBulkSessionResult, toBulkSessionResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import { buildLookupWatchlistRecord } from '../frontend/src/lib/analysis/lookup-watchlist-handoff.ts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';
import { recordValue, requiredValue } from './value-assertions.mts';
import { currentEvidenceSummary } from '../frontend/src/lib/analysis/evidence-display.ts';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';

const COMPLETE = { version: 1, page: 'complete', favicon: 'complete', combined: 'complete' } as const;
const FAILED = { version: 1, page: 'unavailable', favicon: 'unknown', combined: 'partial' } as const;
const NOW = '2026-09-01T00:00:00.000Z';
const LATER = '2026-09-02T00:00:00.000Z';
const raw = (overrides: Record<string, unknown> = {}) => ({
  domain: 'example.test', inputHostname: 'example.test', scanDepth: 'deep', capturedAt: NOW,
  availability: 'registered', activityStatus: 'active', pageTitle: 'Account access',
  hasPasswordField: true, phishingLanguageMatch: 'verify your account', faviconHash: 'a'.repeat(64),
  faviconMatch: true, riskModelVersion: 8, riskScore: 80, webCollectionQuality: COMPLETE, ...overrides,
});
const snap = (overrides: Record<string, unknown> = {}) => requiredValue(normalizeSnapshot(raw(overrides)));

describe('collection-quality contract', () => {
  test('accepts only the bounded versioned outcomes without retaining extensions', () => {
    for (const state of ['complete', 'partial', 'unavailable', 'not_collected', 'unknown']) {
      assert.equal(isWebCollectionQuality({ version: 1, page: state, favicon: state, combined: state }), true);
    }
    for (const value of [null, [], {}, { ...COMPLETE, version: 2 }, { ...COMPLETE, page: 'safe' }, { ...COMPLETE, url: 'https://example.test/private' }]) {
      assert.equal(isWebCollectionQuality(value), false);
      assert.throws(() => normalizeWebCollectionQuality(value), /invalid web collection quality/u);
    }
    assert.equal(normalizeWebCollectionQuality(undefined), undefined);
    assert.equal(isWebCollectionQuality(Object.create(COMPLETE)), false);
    assert.equal(isWebCollectionQuality({ ...COMPLETE, get page() { throw new Error('Must not read accessor'); } }), false);
    assert.equal(isWebCollectionQuality({ ...COMPLETE, page: 'partial' }), false);
    assert.deepEqual(webCollectionQualityForCapture(undefined, 'deep'), { version: 1, page: 'unknown', favicon: 'unknown', combined: 'unknown' });
    assert.deepEqual(webCollectionQualityForCapture(COMPLETE, 'fast'), { version: 1, page: 'not_collected', favicon: 'not_collected', combined: 'not_collected' });
  });

  test('derives page and favicon outcomes independently from injected collectors', async () => {
    for (const [status, complete, truncated, icon, expected] of [
      ['fetched', true, false, true, COMPLETE],
      ['fetched', false, true, true, { ...COMPLETE, page: 'partial', combined: 'partial' }],
      ['inconclusive', false, false, false, FAILED],
      ['responded', true, false, true, { ...COMPLETE, page: 'unavailable', combined: 'partial' }],
    ] as const) {
      let faviconCalls = 0;
      const options = {
        featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1', WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1' }),
        rdapRecord: { upstreamStatus: 200, parsed: { domain: 'example.test', statuses: [], nameservers: [], events: [], lifecycle: {} } },
        includeTechnologyProfile: false, includeSecurityPosture: false,
        fetchHomepage: async () => ({ status, detail: 'Fixture observation', text: status === 'fetched' ? '<html><title>Example</title><body>Example</body></html>' : null,
          http: { complete, response: { bodyTruncated: truncated }, observedAt: NOW } }),
        fetchFaviconHash: async () => { faviconCalls++; return icon ? { hash: 'a'.repeat(64), phash: null } : null; },
        resolveNs: async () => { throw new Error('Unexpected delegation request'); },
      };
      const result = recordValue(await checkDomainAvailability('example.test', options as unknown as Parameters<typeof checkDomainAvailability>[1]));
      assert.deepEqual(result.webCollectionQuality, expected);
      assert.equal(faviconCalls, 1);
    }
  });

  test('portable current evidence retains outcomes but no added payload or personal field', () => {
    const projected = requiredValue(projectLookupEvidenceAvailability({ webCollectionQuality: COMPLETE, rawBody: 'private body' }));
    assert.deepEqual(projected, { webCollectionQuality: COMPLETE, registryContactsExcluded: true });
    assert.throws(() => projectLookupEvidenceAvailability({ webCollectionQuality: { ...COMPLETE, secret: 'private' } }), /invalid web collection/u);
  });
});

describe('Case collection-quality comparisons', () => {
  test('a missing HTTP response does not establish removed origins or security headers', () => {
    const previous = snap({ httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpResponseStatus: 200,
      httpFinalOrigin: 'https://example.test', httpSecurityHeaders: ['hsts'] });
    const failed = snap({ capturedAt: LATER, webCollectionQuality: FAILED });
    assert.deepEqual(compareCaseEvidence(previous, failed), []);
    assert.ok(caseEvidenceIncomparableReasons(previous, failed).includes('collection-quality'));
    const partialBody = snap({ capturedAt: LATER, webCollectionQuality: { ...COMPLETE, page: 'partial', combined: 'partial' },
      httpSummaryVersion: 1, httpEvidenceStatus: 'partial', httpResponseStatus: 200,
      httpFinalOrigin: 'https://example.test', httpSecurityHeaders: [] });
    assert.ok(compareCaseEvidence(previous, partialBody).some(change => change.field === 'httpSecurityHeaders'));
  });

  test('current Case summaries and readable reports qualify retained incomplete scores', () => {
    const record = createCase({ domain: 'example.test', evidence: raw({ webCollectionQuality: FAILED, riskScore: 10 }) }, NOW);
    const summary = requiredValue(currentEvidenceSummary(record.evidenceHistory));
    assert.equal(summary.riskScore, 10);
    assert.match(summary.riskCollectionLimitation ?? '', /web collection.*not comparable/iu);
    const report = buildCaseReport(record, { generatedAt: NOW });
    assert.equal(report.json.currentAssessment?.riskScore, 10);
    assert.deepEqual(report.json.currentAssessment?.webCollectionQuality, FAILED);
    assert.match(report.markdown, /\*\*Risk score:\*\* 10.*web collection.*not comparable/iu);
    assert.match(report.markdown, /- Risk score: 10.*web collection.*not comparable/iu);
    for (const [overrides, expected] of [
      [{ webCollectionQuality: COMPLETE }, null],
      [{ scanDepth: 'fast', webCollectionQuality: undefined }, null],
      [{ scanDepth: 'unknown', webCollectionQuality: undefined }, 'Collection depth is unknown; score is not comparable.'],
      [{ webCollectionQuality: FAILED, riskScore: null }, null],
    ] as const) {
      const snapshot = snap(overrides);
      assert.equal(requiredValue(currentEvidenceSummary([snapshot])).riskCollectionLimitation, expected);
    }
  });

  test('failed collection is not removal of page or favicon signals or a favourable score change', () => {
    const previous = snap();
    const failed = snap({ capturedAt: LATER, webCollectionQuality: FAILED, activityStatus: 'unreachable', pageTitle: null,
      hasPasswordField: false, phishingLanguageMatch: null, faviconMatch: false, riskScore: 10 });
    assert.equal(failed.hasPasswordField, null);
    assert.equal(failed.faviconMatch, null);
    assert.deepEqual(compareCaseEvidence(previous, failed), []);
    assert.ok(caseEvidenceIncomparableReasons(previous, failed).includes('collection-quality'));
    assert.deepEqual(normalizeSnapshot(failed), failed);
  });

  test('confirmed complete page changes still compare after qualification', () => {
    const current = snap({ capturedAt: LATER, hasPasswordField: false, phishingLanguageMatch: null, riskScore: 10 });
    const fields = new Set(compareCaseEvidence(snap(), current).map(change => change.field));
    assert.ok(fields.has('hasPasswordField'));
    assert.ok(fields.has('phishingLanguageMatch'));
    assert.ok(fields.has('riskScore'));
  });

  test('historical identity survives while absent quality remains unknown', () => {
    const legacy = snap({ webCollectionQuality: undefined });
    assert.equal(Object.hasOwn(legacy, 'webCollectionQuality'), false);
    assert.deepEqual(normalizeSnapshot(legacy), legacy);
    assert.equal(compareCaseEvidence(legacy, snap({ riskScore: 10 })).some(change => change.field === 'riskScore'), false);
    assert.throws(() => normalizeSnapshot(raw(), { sourceVersion: 16 }), /requires Case schema/u);
    assert.throws(() => normalizeSnapshot(raw({ webCollectionQuality: { ...COMPLETE, version: 2 } })), /Unsupported/u);
  });

  test('published report verification reproduces historical comparisons without adding quality claims', () => {
    const before = snap({ webCollectionQuality: undefined });
    const after = snap({ capturedAt: LATER, hasPasswordField: false, riskScore: 10, webCollectionQuality: undefined });
    const published = publishedCaseEvidenceTimelineForVerification([before, after])[1]!;
    assert.ok(published.changes?.some(change => change.field === 'hasPasswordField' && change.after === false));
    assert.ok(published.changes?.some(change => change.field === 'riskScore' && change.before === 80 && change.after === 10));
    assert.equal(published.snapshot.webCollectionQuality, undefined);
    assert.deepEqual(compareCaseEvidence(before, after), []);
  });
});

describe('Watchlist qualified baselines', () => {
  test('retains the latest failed attempt without replacing the last usable baseline, including after reload', () => {
    const first = appendWatchlistScan(null, [raw()], { checkedAt: NOW, mode: 'deep' }).entry;
    const failed = appendWatchlistScan(first, [raw({ webCollectionQuality: FAILED, pageTitle: null,
      hasPasswordField: false, faviconHash: null, faviconMatch: false, riskScore: 10 })], { checkedAt: LATER, mode: 'deep' });
    assert.deepEqual(failed.changes, []);
    const reloaded = normalizeWatchlistEntry(JSON.parse(JSON.stringify(failed.entry)));
    assert.deepEqual(reloaded.results[0]!.webCollectionQuality, FAILED);
    assert.equal(reloaded.results[0]!.riskScore, 10);
    assert.equal(reloaded.baseline[0]!.riskScore, 80);
    assert.equal(reloaded.baseline[0]!.hasPasswordField, true);
    assert.equal(reloaded.baseline[0]!.faviconHash, 'a'.repeat(64));
    assert.equal(reloaded.history.at(-1)!.webComparisonLimitedCount, 1);
    const recovered = appendWatchlistScan(reloaded, [raw({ hasPasswordField: false, riskScore: 10 })], { mode: 'deep' });
    assert.ok(recovered.changes.some(change => change.field === 'hasPasswordField' && change.before === true && change.after === false));
    assert.ok(recovered.changes.some(change => change.field === 'riskScore' && change.before === 80 && change.after === 10));
  });

  test('separate partial observations cannot promote an incomplete score to a complete baseline', () => {
    const first = appendWatchlistScan(null, [raw({ webCollectionQuality: { ...COMPLETE, favicon: 'unknown', combined: 'partial' } })]).entry;
    const next = appendWatchlistScan(first, [raw({ webCollectionQuality: { ...COMPLETE, page: 'unavailable', combined: 'partial' }, riskScore: 10 })]).entry;
    const reloaded = normalizeWatchlistEntry(JSON.parse(JSON.stringify(next)));
    assert.equal(reloaded.baseline[0]!.riskScore, 80);
    assert.deepEqual(reloaded.baseline[0]!.webCollectionQuality, { ...COMPLETE, combined: 'partial' });
    const complete = appendWatchlistScan(reloaded, [raw({ riskScore: 20 })]);
    assert.equal(complete.changes.some(change => change.field === 'riskScore'), false);
    assert.equal(complete.entry.baseline[0]!.riskScore, 20);
  });

  test('Lookup handoffs and portable round trips retain the outcomes', () => {
    const handoff = requiredValue(buildLookupWatchlistRecord('example.test', raw(), 'deep'));
    const entry = appendWatchlistScan(null, [handoff], { checkedAt: NOW }).entry;
    const document = buildWatchlistExport({ Review: entry }, NOW);
    assert.equal(document.version, 3);
    assert.deepEqual(mergeWatchlistStores({}, document).watchlists.Review!.results[0]!.webCollectionQuality, COMPLETE);
    assert.throws(() => normalizeWatchlistStore({ ...document, version: 2 }), /requires Watchlist schema/u);
    assert.throws(() => normalizeWatchlistStore({ ...document, version: 4 }), /unsupported/u);
    const legacy = normalizeWatchlistStore({ schema: document.schema, version: 2, watchlists: { Review: { results: [raw({ webCollectionQuality: undefined })] } } });
    assert.equal(legacy.watchlists.Review!.results[0]!.webCollectionQuality, undefined);
  });

  test('saved Bulk rows retain collection outcomes through restoration and reject backdated claims', () => {
    const store = normalizeBulkSessionStore(richBulkSessionStore(1));
    const row = store.sessions[0]!.results[0]!;
    row.webCollectionQuality = FAILED;
    const restored = fromBulkSessionResult(row);
    assert.deepEqual(restored.saved.webCollectionQuality, FAILED);
    assert.deepEqual(toBulkSessionResult(restored).webCollectionQuality, FAILED);
    const encoded = serializeBulkSessionStore(store);
    assert.deepEqual(normalizeBulkSessionStore(JSON.parse(encoded)).sessions[0]!.results[0]!.webCollectionQuality, FAILED);
    assert.throws(() => normalizeBulkSessionStore({ ...store, version: 5 }), /requires Bulk schema/u);
  });
});
