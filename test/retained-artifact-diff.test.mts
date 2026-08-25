import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';

import EXIT_CODES from '../cli/exit-codes.mts';
import {
  CLI_COMPARISON_LEDGER_SCHEMA,
  buildCliRetainedArtifactDiff,
} from '../cli/retained-artifact-diff.mts';
import { runCli } from '../cli/runner.mts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  buildBulkSessionExport,
  summarizeBulkProfileContexts,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import {
  DOMAIN_PORTFOLIO_INPUT_SCHEMA,
  reviewDomainPortfolio,
} from '../lib/domain-portfolio-review.mts';

const EARLIER = '2026-08-01T00:00:00.000Z';
const LATER = '2026-08-02T00:00:00.000Z';
const PROFILE_CONTEXT = Object.freeze({
  sourceState: 'ready' as const,
  activeProfileId: null,
  profileUpdatedAt: null,
  limitation: '',
});

function bulkResult(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Active',
    risk: 20,
    opportunity: 30,
    mutationTypes: [],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    createdDate: EARLIER,
    expiryDate: LATER,
    nameservers: [`ns1.${domain}`],
    hasMx: true,
    hasNullMx: false,
    hasSpf: true,
    hasDmarc: true,
    activityStatus: 'active',
    pageTitle: 'Fixture',
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    idnReferenceMatch: false,
    pageBaselineMatch: false,
    hasActiveBrandProfile: false,
    hasPasswordField: false,
    hasExternalFormAction: false,
    phishingLanguageMatch: null,
    riskModelVersion: 7,
    opportunityModelVersion: 2,
    riskFactors: [],
    dns: { status: 'success', records: { a: ['192.0.2.10'], aaaa: [], cname: [], caa: [] } },
    dnssec: 'signed',
    comparisonEvidence: {
      version: 1,
      technology: { state: 'success', ids: ['fixture-stack'], truncated: false },
      tls: { state: 'success', issuerLabel: 'Example CA', spkiSha256: 'b'.repeat(64) },
    },
    relationship: {
      version: 2,
      nameservers: [`ns1.${domain}`],
      ipAddresses: ['192.0.2.10'],
      trackingIdentifiers: [],
      officialAssetHosts: [],
      faviconHash: null,
      faviconPHash: null,
      certificateFingerprint: null,
      truncated: false,
    },
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'availability', state: 'complete' },
      { source: 'http', state: 'complete' },
    ],
    profileContext: PROFILE_CONTEXT,
    ...overrides,
  };
}

function bulkSession(id: string, retainedAt: string, results: readonly ReturnType<typeof bulkResult>[]) {
  return {
    id,
    name: `Review ${id}`,
    mode: 'deep',
    state: 'complete',
    inputDigest: `sha256:${id === 'left' ? '1' : '2'}`.padEnd(71, id === 'left' ? '1' : '2'),
    domains: results.map((item) => item.domain),
    results,
    startedAt: retainedAt,
    updatedAt: retainedAt,
    completedAt: retainedAt,
    profileContext: summarizeBulkProfileContexts(results),
  };
}

function bulkExport(sessions: readonly ReturnType<typeof bulkSession>[], generatedAt: string): string {
  return JSON.stringify(buildBulkSessionExport(sessions, generatedAt));
}

function asset(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    criticality: 'standard',
    registrar: 'Example Registrar',
    registrarAccount: 'Primary',
    expiresAt: '2027-08-01T00:00:00.000Z',
    autoRenew: true,
    dnsProviders: ['Example DNS'],
    mailProviders: ['Example Mail'],
    certificateProviders: ['Example CA'],
    recoveryDomains: [],
    reviewedAt: EARLIER,
    ...overrides,
  };
}

function portfolio(label: string, generatedAt: string, assets: readonly ReturnType<typeof asset>[]): string {
  return JSON.stringify(reviewDomainPortfolio({
    schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA,
    version: 1,
    portfolioLabel: label,
    assets,
  }, generatedAt));
}

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

describe('retained artifact diff', () => {
  test('dispatches current Bulk exports through the bounded comparison ledger without retaining paths', () => {
    const left = bulkExport([bulkSession('same-session', EARLIER, [bulkResult('retained.example')])], EARLIER);
    const right = bulkExport([bulkSession('same-session', LATER, [bulkResult('retained.example', { availability: 'available' })])], LATER);
    const result = buildCliRetainedArtifactDiff(left, right, {}, LATER);
    assert.equal(result.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    if (result.schema !== CLI_COMPARISON_LEDGER_SCHEMA) throw new Error('Expected comparison ledger.');
    assert.equal(result.artifactFamily, 'bulk_sessions');
    assert.equal(result.left.id, 'same-session');
    assert.equal(result.right.id, 'same-session');
    assert.equal(result.index.items.length, 1);
    assert.equal(result.index.items[0]?.ownerHref, '');
    assert.doesNotMatch(JSON.stringify(result.index), /retained\.example/u);
    assert.equal(result.details.rows.some((row) => row.entityId === 'retained.example' && row.field === 'Availability' && row.state === 'different'), true);
    assert.equal(result.details.rows.some((row) => row.field === 'Risk score'), false);
    assert.doesNotMatch(JSON.stringify(result), /left\.json|right\.json/u);
  });

  test('requires explicit IDs for multi-session exports and rejects reversed or malformed pairs', () => {
    const first = bulkSession('left', EARLIER, [bulkResult('first.example')]);
    const second = bulkSession('second', EARLIER, [bulkResult('second.example')]);
    const rightSession = bulkSession('right', LATER, [bulkResult('first.example')]);
    const left = bulkExport([first, second], EARLIER);
    const right = bulkExport([rightSession], LATER);
    assert.throws(() => buildCliRetainedArtifactDiff(left, right), /--left-session/u);
    const selected = buildCliRetainedArtifactDiff(left, right, { leftSessionId: 'left' }, LATER);
    assert.equal(selected.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    assert.throws(() => buildCliRetainedArtifactDiff(right, left, { rightSessionId: 'left' }, LATER), /left saved session to be no later/u);

    const malformed = JSON.parse(left) as Record<string, unknown>;
    const sessions = malformed.sessions as Array<Record<string, unknown>>;
    const results = sessions[0]?.results as Array<Record<string, unknown>>;
    results.push({ ...results[0], domain: 'outside.example' });
    assert.throws(() => buildCliRetainedArtifactDiff(JSON.stringify(malformed), right, { leftSessionId: 'left' }), /silently omitted/u);
  });

  test('rejects a reader-only Bulk export without interpreting profile-derived claims', () => {
    const current = JSON.parse(bulkExport([bulkSession('left', EARLIER, [bulkResult('legacy.example')])], EARLIER)) as Record<string, unknown>;
    current.version = 3;
    const sessions = current.sessions as Array<Record<string, unknown>>;
    delete sessions[0]?.profileContext;
    for (const row of sessions[0]?.results as Array<Record<string, unknown>>) delete row.profileContext;
    const before = structuredClone(current);
    assert.throws(
      () => buildCliRetainedArtifactDiff(JSON.stringify(current), bulkExport([bulkSession('right', LATER, [])], LATER), {}, LATER),
      /supported whoisleuth\.bulk-sessions version/u,
    );
    assert.deepEqual(current, before);
  });

  test('compares exact retained portfolio assertions without turning omission into removal', () => {
    const left = portfolio('Defensive set', EARLIER, [
      asset('one.example'),
      asset('omitted.example'),
    ]);
    const right = portfolio('Defensive set', LATER, [
      asset('one.example', { dnsProviders: ['Replacement DNS'], reviewedAt: LATER }),
      asset('added.example', { reviewedAt: LATER }),
    ]);
    const result = buildCliRetainedArtifactDiff(left, right, {}, LATER);
    assert.equal(result.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    if (result.schema !== CLI_COMPARISON_LEDGER_SCHEMA) throw new Error('Expected comparison ledger.');
    assert.equal(result.artifactFamily, 'domain_portfolio');
    assert.equal(result.details.rows.some((row) => row.entityId === 'one.example' && row.field === 'DNS providers' && row.state === 'different'), true);
    assert.equal(result.details.rows.some((row) => row.entityId === 'added.example' && row.state === 'added'), true);
    assert.equal(result.details.rows.some((row) => row.entityId === 'omitted.example' && row.state === 'not_compared'), true);
    assert.equal(result.details.rows.some((row) => row.state === 'removed'), false);
    assert.equal(result.index.items[0]?.completeness, 'partial');
    assert.doesNotMatch(JSON.stringify(result.index), /one\.example|omitted\.example|added\.example/u);
  });

  test('rejects derived portfolio tampering and mixed artifact families', () => {
    const report = portfolio('Defensive set', EARLIER, [asset('one.example')]);
    const tampered = JSON.parse(report) as Record<string, unknown>;
    (tampered.unknownCounts as Record<string, unknown>).dns = 99;
    assert.throws(() => buildCliRetainedArtifactDiff(report, JSON.stringify(tampered)), /derived fields/iu);
    const bulk = bulkExport([bulkSession('right', LATER, [bulkResult('one.example')])], LATER);
    assert.throws(() => buildCliRetainedArtifactDiff(report, bulk), /same supported artifact family/iu);
  });

  test('keeps index completeness partial when an omission falls beyond the exact-row cap', () => {
    const additions = Array.from({ length: 256 }, (_, index) => asset(`added-${String(index).padStart(3, '0')}.example`, { reviewedAt: LATER }));
    const left = portfolio('Earlier', EARLIER, [asset('z-omitted.example')]);
    const right = portfolio('Later', LATER, additions);
    const result = buildCliRetainedArtifactDiff(left, right, {}, LATER);
    assert.equal(result.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    if (result.schema !== CLI_COMPARISON_LEDGER_SCHEMA) throw new Error('Expected comparison ledger.');
    assert.equal(result.index.items[0]?.completeness, 'partial');
    assert.equal(result.index.items[0]?.truncated, true);
    assert.equal(result.details.rows.length, 256);
    assert.equal(result.details.totalRows, 257);
    assert.equal(result.details.omissions.detailRows, 1);
  });

  test('dispatches retained Bulk sessions and domain portfolios through the public diff command', async () => {
    const output = capture();
    const leftBulk = bulkExport([
      bulkSession('left', EARLIER, [bulkResult('selected.example')]),
      bulkSession('unused-left', EARLIER, [bulkResult('unused-left.example')]),
    ], EARLIER);
    const rightBulk = bulkExport([
      bulkSession('right', LATER, [bulkResult('selected.example', { availability: 'available' })]),
      bulkSession('unused-right', LATER, [bulkResult('unused-right.example')]),
    ], LATER);
    const bulkCode = await runCli([
      'diff', 'left.json', 'right.json', '--left-session', 'left', '--right-session', 'right', '--json', '--no-color',
    ], {
      stdout: output.stream,
      readDiffInput: async (source) => source === 'left.json' ? leftBulk : rightBulk,
      now: () => LATER,
    });
    assert.equal(bulkCode, EXIT_CODES.SUCCESS);
    const bulkDocument = JSON.parse(output.value()) as Record<string, unknown>;
    assert.equal(bulkDocument.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    assert.equal(bulkDocument.artifactFamily, 'bulk_sessions');
    assert.doesNotMatch(output.value(), /left\.json|right\.json|unused-left\.example|unused-right\.example/u);

    const portfolioOutput = capture();
    const portfolioCode = await runCli(['diff', 'earlier.json', 'later.json', '--json', '--no-color'], {
      stdout: portfolioOutput.stream,
      readDiffInput: async (source) => source === 'earlier.json'
        ? portfolio('Defensive set', EARLIER, [asset('one.example')])
        : portfolio('Defensive set', LATER, [asset('one.example', { registrarAccount: 'Secondary', reviewedAt: LATER })]),
      now: () => LATER,
    });
    assert.equal(portfolioCode, EXIT_CODES.SUCCESS);
    const portfolioDocument = JSON.parse(portfolioOutput.value()) as Record<string, unknown>;
    assert.equal(portfolioDocument.schema, CLI_COMPARISON_LEDGER_SCHEMA);
    assert.equal(portfolioDocument.artifactFamily, 'domain_portfolio');
    assert.doesNotMatch(portfolioOutput.value(), /earlier\.json|later\.json/u);
  });
});
