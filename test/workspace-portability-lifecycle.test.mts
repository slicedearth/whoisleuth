import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as brand from '../packages/workspace/brand-profile-model.mts';
import * as bulkReview from '../packages/workspace/bulk-review-model.mts';
import * as bulkSession from '../packages/workspace/bulk-session-model.mts';
import * as campaign from '../packages/workspace/campaign-model.mts';
import * as ctHistory from '../packages/workspace/ct-history.mts';
import * as detection from '../packages/workspace/detection-rule-model.mts';
import * as template from '../packages/workspace/investigation-template-model.mts';
import * as relationship from '../packages/workspace/relationship-observation-model.mts';
import * as shortlist from '../packages/workspace/shortlist-model.mts';
import * as watchlist from '../packages/workspace/watchlist-store.mts';
import * as website from '../packages/workspace/website-snapshot-model.mts';
import {
  MAX_WORKSPACE_INPUT_ARRAY_LENGTH,
  WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES,
  WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY,
  serialiseWorkspacePortableJson,
  serialiseWorkspacePortableJsonLine,
} from '../packages/contracts/workspace-portability.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXED = '2000-01-01T00:00:00.000Z';

const NORMALIZERS = {
  brand: brand.normalizeBrandProfileStore,
  bulk: bulkSession.normalizeBulkSessionStore,
  campaign: campaign.normalizeCampaignStore,
  ct: ctHistory.normalizeCtHistoryStore,
  detection: detection.normalizeDetectionRuleStore,
  relationship: relationship.normalizeRelationshipObservationStore,
  review: bulkReview.normalizeBulkReviewStore,
  shortlist: shortlist.normalizeShortlistStore,
  template: template.normalizeInvestigationTemplateStore,
  watchlist: watchlist.normalizeWatchlistStore,
  website: website.normalizeWebsiteSnapshotStore,
} as const;

const BUILDERS = {
  brand: brand.buildBrandProfileExport,
  bulk: bulkSession.buildBulkSessionExport,
  campaign: campaign.buildCampaignExport,
  detection: detection.buildDetectionRuleExport,
  relationship: relationship.buildRelationshipObservationExport,
  review: bulkReview.buildBulkReviewExport,
  shortlist: shortlist.buildShortlistExport,
  template: template.buildInvestigationTemplateExport,
  watchlist: watchlist.buildWatchlistExport,
  website: website.buildWebsiteSnapshotExport,
} as const;

const MERGERS = {
  brand: brand.mergeBrandProfiles,
  bulk: bulkSession.mergeBulkSessions,
  campaign: campaign.mergeCampaigns,
  detection: detection.mergeDetectionRules,
  relationship: relationship.mergeRelationshipObservations,
  review: bulkReview.mergeBulkReviewStores,
  shortlist: shortlist.mergeShortlistStores,
  template: template.mergeInvestigationTemplates,
  watchlist: watchlist.mergeWatchlistStores,
  website: website.mergeWebsiteSnapshots,
} as const;

const PORTABLE_READERS: Record<keyof typeof BUILDERS, (raw: unknown) => unknown> = {
  brand: (raw) => brand.mergeBrandProfiles([], raw, { nowIso: FIXED }).profiles,
  bulk: (raw) => bulkSession.mergeBulkSessions([], raw).sessions,
  campaign: (raw) => campaign.mergeCampaigns([], raw).campaigns,
  detection: (raw) => detection.mergeDetectionRules([], raw).rules,
  relationship: (raw) => relationship.mergeRelationshipObservations([], raw).observations,
  review: (raw) => bulkReview.mergeBulkReviewStores([], raw).store,
  shortlist: (raw) => shortlist.mergeShortlistStores([], raw).entries,
  template: (raw) => template.mergeInvestigationTemplates([], raw).templates,
  watchlist: (raw) => watchlist.mergeWatchlistStores({}, raw).watchlists,
  website: (raw) => website.mergeWebsiteSnapshots([], raw).snapshots,
};

async function fixtureValue(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
}

describe('workspace portability lifecycle', () => {
  test('owns every browser and portable compatibility contract with immutable fixture evidence', () => {
    const family = WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY;
    assert.ok(family.compatibility.length > 0);
    assert.ok(family.contracts.length > 0);
    assert.ok(family.fixtures.length > 0);
    assert.ok(Object.isFrozen(family));
    assert.ok(Object.isFrozen(family.contracts));
    assert.ok(Object.isFrozen(family.fixtures));
    assert.equal(new Set(family.fixtures.map((fixture) => fixture.path)).size, family.fixtures.length);
    assert.ok(family.compatibility.filter((item) => item.kind === 'browser_store')
      .every((item) => item.futureVersionBehavior === 'preserve_without_write'));
    assert.ok(family.compatibility.filter((item) => item.kind === 'export')
      .every((item) => item.futureVersionBehavior === 'reject'));
  });

  test('normalises every registered version to its exact current fixture', async () => {
    const family = WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY;
    for (const fixture of family.fixtures) {
      const [, plane, slug] = fixture.id.split('.');
      assert.ok(plane === 'browser' || plane === 'portable', fixture.id);
      assert.ok(slug && Object.hasOwn(NORMALIZERS, slug), fixture.id);
      const contract = family.contracts.find((candidate) => (
        candidate.schema === fixture.schema && candidate.version === fixture.version
      ));
      assert.ok(contract, fixture.id);
      const current = family.contracts.find((candidate) => (
        candidate.compatibilityId === contract.compatibilityId && candidate.lifecycle === 'current'
      ));
      assert.ok(current, fixture.id);
      const expectedFixture = family.fixtures.find((candidate) => (
        candidate.schema === fixture.schema
        && candidate.version === current.version
        && candidate.id.endsWith('.v' + current.version)
      ));
      assert.ok(expectedFixture, fixture.id);
      const raw = await fixtureValue(fixture.path);
      const expected = await fixtureValue(expectedFixture.path);
      const actual = plane === 'browser'
        ? NORMALIZERS[slug as keyof typeof NORMALIZERS](raw)
        : BUILDERS[slug as keyof typeof BUILDERS](
          PORTABLE_READERS[slug as keyof typeof PORTABLE_READERS](raw),
          FIXED,
        );
      assert.deepEqual(actual, expected, fixture.id);
    }
  });

  test('portable formats reject unsupported future versions before merge', () => {
    const family = WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY;
    for (const descriptor of family.compatibility.filter((item) => item.kind === 'export')) {
      const slug = descriptor.id.replace('export.', '').replace('brand-profiles', 'brand')
        .replace('bulk-sessions', 'bulk')
        .replace('campaigns', 'campaign')
        .replace('detection-rules', 'detection')
        .replace('relationship-observations', 'relationship')
        .replace('bulk-review', 'review')
        .replace('investigation-templates', 'template')
        .replace('watchlists', 'watchlist')
        .replace('website-snapshots', 'website');
      const collectionKey = {
        brand: 'profiles', bulk: 'sessions', campaign: 'campaigns', detection: 'rules',
        relationship: 'observations', review: 'presets', shortlist: 'entries',
        template: 'templates', watchlist: 'watchlists', website: 'snapshots',
      }[slug];
      assert.ok(collectionKey && descriptor.schema && Object.hasOwn(MERGERS, slug), descriptor.id);
      const future = {
        schema: descriptor.schema,
        version: descriptor.currentVersion + 1,
        [collectionKey]: slug === 'watchlist' || slug === 'review' ? {} : [],
        ...(slug === 'review' ? { rows: [] } : {}),
      };
      assert.throws(
        () => MERGERS[slug as keyof typeof MERGERS]([], future),
        /newer|unsupported|expected/i,
        descriptor.id,
      );
    }
  });

  test('rejects accessors, sparse graphs, hard-ceiling arrays, and malformed declared versions before normalisation', () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'version', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const sparse = new Array(2);
    sparse[1] = null;
    const oversized = Array.from({ length: MAX_WORKSPACE_INPUT_ARRAY_LENGTH + 1 }, () => null);
    for (const [slug, normalise] of Object.entries(NORMALIZERS)) {
      assert.throws(() => normalise(accessor), /accessor properties/u, slug);
      assert.throws(() => normalise(sparse), /sparse arrays/u, slug);
      assert.throws(() => normalise(oversized), /length ceiling/u, slug);
      const malformedVersion = slug === 'watchlist'
        ? { schema: 'whoisleuth.watchlists', version: '1', watchlists: {} }
        : { version: '1' };
      assert.throws(() => normalise(malformedVersion), /declared version/u, slug);
    }
    assert.equal(getterCalls, 0);
  });

  test('keeps archive identity with the Case portability owner and excludes CT history', () => {
    assert.ok(WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES.length > 0);
    assert.equal(WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES.some((item) => (
      item.sectionId.includes('certificate') || item.sectionId.includes('ct-history')
    )), false);
    assert.equal(new Set(WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES.map((item) => item.sectionId)).size, WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES.length);
  });

  test('preserves existing portable JSON byte conventions', () => {
    const value = { schema: 'whoisleuth.example', version: 1, records: [] };
    assert.equal(serialiseWorkspacePortableJson(value), JSON.stringify(value, null, 2));
    assert.equal(serialiseWorkspacePortableJsonLine(value), JSON.stringify(value, null, 2) + '\n');
  });
});
