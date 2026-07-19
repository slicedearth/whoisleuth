import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_SECTION_IDS,
  WORKSPACE_ARCHIVE_VERSION,
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.js';

const NOW = '2026-07-19T02:00:00.000Z';

function caseRecord(domain = 'archive-one.invalid', id = 'case-one') {
  return {
    id,
    domain,
    status: 'new',
    disposition: 'unreviewed',
    tags: ['review'],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function campaign() {
  return {
    id: 'campaign-one',
    name: 'Archive review',
    description: 'Portable fixture',
    domains: ['archive-one.invalid'],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function profile() {
  return {
    id: 'profile-one',
    name: 'Archive profile',
    officialDomains: ['official.invalid'],
    productNames: [],
    tlds: [],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function input() {
  return {
    cases: [caseRecord()],
    campaigns: [campaign()],
    brandProfiles: [profile()],
    watchlists: {
      Review: { updatedAt: NOW, results: [], baseline: [], history: [] },
    },
    shortlist: [{ domain: 'archive-one.invalid', availability: 'unknown', mutationTypes: [], savedAt: NOW }],
    detectionRules: [{
      id: 'rule-one',
      name: 'Review new cases',
      enabled: true,
      match: 'all',
      conditions: [{ field: 'status', operator: 'equals', value: 'new' }],
      riskDelta: 0,
      tag: 'review',
    }],
    settings: { activeProfileId: 'profile-one', theme: 'light' },
  };
}

function emptyInput() {
  return {
    cases: [], campaigns: [], brandProfiles: [], watchlists: {}, shortlist: [], detectionRules: [],
    settings: { activeProfileId: '', theme: 'dark' },
  };
}

describe('portable workspace archive', () => {
  test('builds a deterministic versioned manifest for every supported section', async () => {
    const source = input();
    const before = structuredClone(source);
    const left = await buildWorkspaceArchive(source, { generatedAt: NOW });
    const right = await buildWorkspaceArchive(source, { generatedAt: NOW });

    assert.deepEqual(left, right);
    assert.deepEqual(source, before);
    assert.equal(left.schema, WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(left.version, WORKSPACE_ARCHIVE_VERSION);
    assert.deepEqual(left.manifest.sections.map((section) => section.id), [...WORKSPACE_ARCHIVE_SECTION_IDS]);
    assert.equal(left.manifest.sectionCount, 7);
    assert.equal(left.manifest.totalRecords, 7);
    assert.ok(left.manifest.sections.every((section) => /^sha256:[a-f0-9]{64}$/.test(section.checksum)));
    assert.equal(left.sections.settings.activeProfileId, 'profile-one');
    assert.equal(left.sections.settings.theme, 'light');
  });

  test('reads and verifies every manifest byte count and checksum', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const parsed = await readWorkspaceArchive(archive);

    assert.equal(parsed.generatedAt, NOW);
    assert.equal(parsed.sections.length, 7);
    assert.equal(parsed.sections.every((section) => section.status === 'ready'), true);
    assert.equal(parsed.sections.find((section) => section.id === 'cases').recordCount, 1);
    assert.ok(parsed.bytes > 0 && parsed.bytes < MAX_WORKSPACE_ARCHIVE_BYTES);
  });

  test('rejects a changed section even when its manifest still looks valid', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.sections.cases.cases[0].domain = 'tampered.invalid';
    await assert.rejects(readWorkspaceArchive(archive), /byte-count check|checksum check/);
  });

  test('rejects an incorrect declared byte count', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.manifest.sections[0].bytes += 1;
    await assert.rejects(readWorkspaceArchive(archive), /byte-count check/);
  });

  test('rejects malformed checksum metadata', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.manifest.sections[0].checksum = 'sha256:nope';
    await assert.rejects(readWorkspaceArchive(archive), /invalid, duplicate, or missing section/);
  });

  test('rejects a future archive envelope before inspecting sections', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.version = WORKSPACE_ARCHIVE_VERSION + 1;
    await assert.rejects(readWorkspaceArchive(archive), /newer schema 2/);
  });

  test('reports a future section as unsupported without reinterpreting it', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.manifest.sections.find((section) => section.id === 'watchlists').version = 999;
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const section = preview.sections.find((item) => item.id === 'watchlists');

    assert.equal(section.status, 'unsupported');
    assert.match(section.reason, /newer schema 999/);
    assert.equal(section.selected, false);
    assert.equal(preview.unsupportedCount, 1);
  });

  test('reports a checksummed unknown section rather than applying it', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const index = archive.manifest.sections.findIndex((section) => section.id === 'settings');
    archive.manifest.sections[index] = { ...archive.manifest.sections[index], id: 'futureSection' };
    archive.sections.futureSection = archive.sections.settings;
    delete archive.sections.settings;
    const parsed = await readWorkspaceArchive(archive);
    const section = parsed.sections.find((item) => item.id === 'futureSection');

    assert.equal(section.status, 'unsupported');
    assert.match(section.reason, /does not recognize/);
  });

  test('rejects undeclared section data', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.sections.extra = {};
    await assert.rejects(readWorkspaceArchive(archive), /not declared/);
  });

  test('rejects manifest total drift', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.manifest.totalRecords += 1;
    await assert.rejects(readWorkspaceArchive(archive), /manifest totals/);
  });

  test('rejects archives above the serialized byte budget', async () => {
    const archive = {
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: WORKSPACE_ARCHIVE_VERSION,
      padding: 'x'.repeat(MAX_WORKSPACE_ARCHIVE_BYTES),
    };
    await assert.rejects(readWorkspaceArchive(archive), /limited to 10 MiB/);
  });

  test('fails explicitly when checksum support is unavailable', async () => {
    await assert.rejects(
      buildWorkspaceArchive(emptyInput(), { generatedAt: NOW, cryptoProvider: {} }),
      /checksums are unavailable/,
    );
  });

  test('rejects a cyclic imported archive instead of traversing it indefinitely', async () => {
    const archive = { schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION };
    archive.self = archive;
    await assert.rejects(readWorkspaceArchive(archive), /cannot be serialized/);
  });

  test('previews additive records and existing identities without mutating either side', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const local = emptyInput();
    local.cases = [caseRecord('archive-one.invalid', 'different-local-id')];
    local.settings.theme = 'dark';
    const beforeArchive = structuredClone(archive);
    const beforeLocal = structuredClone(local);
    const preview = await previewWorkspaceArchive(archive, local);

    const cases = preview.sections.find((section) => section.id === 'cases');
    const campaigns = preview.sections.find((section) => section.id === 'campaigns');
    const settings = preview.sections.find((section) => section.id === 'settings');
    assert.deepEqual({ added: cases.added, updated: cases.updated, skipped: cases.skipped }, { added: 0, updated: 1, skipped: 0 });
    assert.deepEqual({ added: campaigns.added, updated: campaigns.updated }, { added: 1, updated: 0 });
    assert.equal(settings.updated, 1);
    assert.equal(settings.skipped, 0);
    assert.deepEqual(archive, beforeArchive);
    assert.deepEqual(local, beforeLocal);
  });

  test('keeps the active profile setting only when the merged profile exists', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    archive.manifest.sections = [
      archive.manifest.sections.find((section) => section.id === 'settings'),
      ...archive.manifest.sections.filter((section) => section.id !== 'settings'),
    ];
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const settings = preview.sections.find((section) => section.id === 'settings');

    assert.deepEqual(preview.sections.map((section) => section.id), [...WORKSPACE_ARCHIVE_SECTION_IDS]);
    assert.equal(settings.skipped, 0);
    assert.equal(settings.normalizedSettings.activeProfileId, 'profile-one');
    assert.equal(settings.normalizedSettings.theme, 'light');
  });

  test('sanitizes unsupported theme and dangling active-profile settings at export', async () => {
    const source = emptyInput();
    source.settings = { activeProfileId: 'missing-profile', theme: 'neon' };
    const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });

    assert.deepEqual(archive.sections.settings, {
      schema: 'whoisleuth.workspace-settings',
      version: 1,
      activeProfileId: '',
      theme: 'dark',
    });
  });
});
