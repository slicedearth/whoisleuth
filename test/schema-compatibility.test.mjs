import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
  MAX_SCHEMA_COMPATIBILITY_ENTRIES,
  SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA,
  SCHEMA_COMPATIBILITY_INVENTORY_VERSION,
  validateSchemaCompatibilityEntries,
} from '../tools/schema-compatibility.mts';
import {
  buildBrandProfileExport,
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  brandProfileStoreVersion,
} from '../frontend/src/lib/analysis/brand-profile-model.js';
import {
  buildCampaignExport,
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/campaign-model.js';
import {
  buildCaseReport,
  CASE_REPORT_SCHEMA,
  CASE_REPORT_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-report.js';
import {
  buildCaseExport,
  CASE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-model.js';
import {
  buildDetectionRuleExport,
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/detection-rule-model.js';
import {
  buildShortlistExport,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
  shortlistStoreVersion,
} from '../frontend/src/lib/analysis/shortlist-model.js';
import {
  buildWatchlistExport,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
  watchlistStoreVersion,
} from '../frontend/src/lib/analysis/watchlist-store.js';
import {
  buildCliBulkDocument,
  buildCliCompareDocument,
  buildCliCtSearchDocument,
  buildCliDiscoverDocument,
  buildCliHttpDocument,
  buildCliLookupDocument,
  buildCliPostureDocument,
  buildCliTlsDocument,
} from '../cli/formatters/json.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  buildLookupEvidence,
} from '../lib/evidence-export.mts';

const NOW = '2026-07-19T00:00:00.000Z';

function byId(inventory, id) {
  const value = inventory.entries.find((entry) => entry.id === id);
  assert.ok(value, `Missing schema compatibility entry ${id}`);
  return value;
}

describe('schema compatibility inventory', () => {
  test('enumerates the reviewed persisted, exported, CLI, and derived contracts', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.equal(inventory.schema, SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA);
    assert.equal(inventory.version, SCHEMA_COMPATIBILITY_INVENTORY_VERSION);
    assert.equal(inventory.generatedAt, NOW);
    assert.equal(inventory.entries.length, 41);
    assert.deepEqual(new Set(inventory.entries.map((entry) => entry.kind)), new Set([
      'browser_store', 'tab_store', 'hosted_store', 'export', 'cli_document', 'derived',
    ]));
    assert.ok(inventory.entries.length <= MAX_SCHEMA_COMPATIBILITY_ENTRIES);
    assert.equal(byId(inventory, 'browser.cases').currentVersion, CASE_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.lookup-evidence').schema, LOOKUP_EVIDENCE_SCHEMA);
    assert.equal(byId(inventory, 'export.lookup-evidence').currentVersion, LOOKUP_EVIDENCE_SCHEMA_VERSION);
  });

  test('returns a fresh non-mutating document for each report build', () => {
    const first = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    first.entries[0].supportedVersions.push(999);
    first.entries[0].note = 'changed';
    const second = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.ok(!second.entries[0].supportedVersions.includes(999));
    assert.notEqual(second.entries[0].note, 'changed');
  });

  test('fails closed when a version changes without a supported-version decision', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const entries = structuredClone(inventory.entries);
    entries[0].currentVersion += 1;
    assert.throws(
      () => validateSchemaCompatibilityEntries(entries),
      /must explicitly end its supported-version list at current version/i,
    );
  });

  test('rejects duplicate ids, unsorted versions, invalid schemas, paths, and budgets', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const duplicate = structuredClone(inventory.entries);
    duplicate[1].id = duplicate[0].id;
    assert.throws(() => validateSchemaCompatibilityEntries(duplicate), /invalid or duplicated/i);

    const unsorted = structuredClone(inventory.entries);
    unsorted[0].supportedVersions = [2, 1, unsorted[0].currentVersion];
    assert.throws(() => validateSchemaCompatibilityEntries(unsorted), /supported-version list/i);

    const schema = structuredClone(inventory.entries);
    schema[0].schema = 'bad schema';
    assert.throws(() => validateSchemaCompatibilityEntries(schema), /schema identifier/i);

    const owner = structuredClone(inventory.entries);
    owner[0].owner = '/private/source.mts';
    assert.throws(() => validateSchemaCompatibilityEntries(owner), /owner path/i);

    const budget = structuredClone(inventory.entries);
    budget[0].byteBudget = -1;
    assert.throws(() => validateSchemaCompatibilityEntries(budget), /byte budget/i);

    const metadata = structuredClone(inventory.entries);
    metadata[0].futureVersionBehavior = 'guess';
    assert.throws(() => validateSchemaCompatibilityEntries(metadata), /compatibility metadata/i);

    const writeSemantics = structuredClone(inventory.entries);
    writeSemantics[0].writeSemantics = 'silent_overwrite';
    assert.throws(() => validateSchemaCompatibilityEntries(writeSemantics), /compatibility metadata/i);
  });

  test('binds browser export entries to the schemas emitted by their real builders', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const fixtures = [
      ['export.cases', buildCaseExport([], NOW), null, CASE_SCHEMA_VERSION],
      ['export.brand-profiles', buildBrandProfileExport([], NOW), BRAND_PROFILE_SCHEMA, BRAND_PROFILE_SCHEMA_VERSION],
      ['export.campaigns', buildCampaignExport([], NOW), CAMPAIGN_SCHEMA, CAMPAIGN_SCHEMA_VERSION],
      ['export.watchlists', buildWatchlistExport({}, NOW), WATCHLIST_SCHEMA, WATCHLIST_SCHEMA_VERSION],
      ['export.shortlist', buildShortlistExport([], NOW), SHORTLIST_SCHEMA, SHORTLIST_SCHEMA_VERSION],
      ['export.detection-rules', buildDetectionRuleExport([], NOW), DETECTION_RULE_SCHEMA, DETECTION_RULE_SCHEMA_VERSION],
    ];
    for (const [id, document, schema, version] of fixtures) {
      const listed = byId(inventory, id);
      assert.equal(document.schema ?? null, schema);
      assert.equal(document.version, version);
      assert.equal(listed.schema, document.schema ?? null);
      assert.equal(listed.currentVersion, document.version);
    }

    const caseReport = buildCaseReport({
      id: 'case-fixture', domain: 'schema.invalid', status: 'new', disposition: 'unreviewed',
      tags: [], notes: [], source: 'manual', evidenceHistory: [], createdAt: NOW, updatedAt: NOW,
    }, { generatedAt: NOW });
    assert.equal(byId(inventory, 'export.case-report').schema, caseReport.json.schema);
    assert.equal(byId(inventory, 'export.case-report').currentVersion, caseReport.json.schemaVersion);
    assert.equal(caseReport.json.schema, CASE_REPORT_SCHEMA);
    assert.equal(caseReport.json.schemaVersion, CASE_REPORT_SCHEMA_VERSION);
  });

  test('binds CLI entries to the schemas emitted by their real builders', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const fixtures = [
      ['cli.lookup', buildCliLookupDocument('schema.invalid', { type: 'domain', inputHostname: 'schema.invalid', registrableDomain: 'schema.invalid', isSubdomain: false }, {}, NOW)],
      ['cli.bulk', buildCliBulkDocument([], { generatedAt: NOW })],
      ['cli.ct-search', buildCliCtSearchDocument('schema', {}, NOW)],
      ['cli.discover', buildCliDiscoverDocument('schema', {}, { generatedAt: NOW, seed: 'schema', preset: 'balanced', keyboardLayout: 'qwerty', tlds: [] })],
      ['cli.posture', buildCliPostureDocument('schema.invalid', {}, NOW)],
      ['cli.http', buildCliHttpDocument('schema.invalid', {}, NOW)],
      ['cli.tls', buildCliTlsDocument('schema.invalid', {}, NOW)],
      ['cli.compare', buildCliCompareDocument({}, NOW)],
    ];
    for (const [id, document] of fixtures) {
      const listed = byId(inventory, id);
      assert.equal(listed.schema, document.schema);
      assert.equal(listed.currentVersion, document.version);
    }
  });

  test('records deployed legacy readers separately from current-only import contracts', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.equal(brandProfileStoreVersion([]), 1);
    assert.equal(watchlistStoreVersion({ Legacy: { results: [] } }), 1);
    assert.equal(shortlistStoreVersion([]), 1);
    assert.deepEqual(byId(inventory, 'browser.brand-profiles').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'browser.watchlists').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'browser.shortlist').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'export.brand-profiles').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'export.watchlists').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'export.shortlist').supportedVersions, [2]);
  });

  test('formats a deterministic maintainer report without absolute paths or user data', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const report = formatSchemaCompatibilityInventory(inventory);
    assert.match(report, /^# WHOISleuth schema compatibility inventory/m);
    assert.match(report, /\| browser\.cases \| browser_store \|/);
    assert.match(report, /\| cli\.compare \| cli_document \|/);
    assert.match(report, /\| browser\.cases \| browser_store \|[^\n]+\| normalized_rewrite \|/);
    assert.match(report, /\| export\.cases \| export \|[^\n]+\| non_destructive_merge \|/);
    assert.match(report, /## Contract notes/);
    assert.match(report, /## Limitations/);
    assert.doesNotMatch(report, /\/Users\//);
    assert.doesNotMatch(report, /localStorage|sessionStorage/);

    assert.throws(
      () => formatSchemaCompatibilityInventory({ ...inventory, version: 2 }),
      /current inventory contract/i,
    );
    assert.throws(
      () => formatSchemaCompatibilityInventory({ ...inventory, limitations: ['bad\nvalue'] }),
      /limitations are invalid/i,
    );
  });

  test('keeps the normalized lookup evidence export tied to its listed contract', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const evidence = buildLookupEvidence({ query: 'schema.invalid', type: 'domain' }, { generatedAt: NOW });
    assert.equal(evidence.schema, byId(inventory, 'export.lookup-evidence').schema);
    assert.equal(evidence.schemaVersion, byId(inventory, 'export.lookup-evidence').currentVersion);
  });
});
