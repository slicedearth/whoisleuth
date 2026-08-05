import { requiredValue } from './value-assertions.mts';
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
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { createRelationshipObservation } from '../frontend/src/lib/analysis/relationship-observation-model.ts';

const NOW = '2026-07-19T02:00:00.000Z';

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

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

function relationshipObservation() {
  return createRelationshipObservation({
    type: 'ip_address',
    label: 'Shared IP address',
    method: 'Exact normalized address',
    normalizedValue: '192.0.2.20',
    value: '192.0.2.20',
    domains: ['archive-one.invalid', 'archive-two.invalid'],
    description: 'Bounded archive fixture.',
  }, {
    observedAt: NOW,
    retainedAt: NOW,
    complete: true,
    sourceVersion: 2,
  });
}

function bulkSession() {
  return {
    id: 'bulk-session-one',
    name: 'Archive Bulk review',
    mode: 'fast',
    state: 'partial',
    inputDigest: `sha256:${'a'.repeat(64)}`,
    domains: ['archive-one.invalid'],
    results: [],
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function websiteSnapshot() {
  return {
    id: 'website-snapshot-one',
    domain: 'archive-one.invalid',
    observedAt: NOW,
    savedAt: NOW,
    complete: true,
    truncated: false,
    technologies: [{ id: 'cms-one', name: 'CMS One', category: 'cms', confidence: 'high' }],
    posture: [{ id: 'https', state: 'observed' }],
    identity: {
      normalizedHtml: 'a'.repeat(64),
      visibleText: null,
      domStructure: null,
      formStructure: null,
      resourceHosts: null,
      trackingIdentifiers: null,
      faviconHash: null,
    },
    sources: [{ source: 'page', state: 'success' }],
  };
}

function investigationTemplate() {
  return {
    id: 'template-one',
    label: 'Archive review template',
    summary: 'A portable bounded guide template.',
    recipeId: 'new_domain_triage',
    stages: [{
      id: 'lookup',
      label: 'Collect evidence',
      detail: 'Review one bounded target.',
      expectedEvidence: 'Separately attributed evidence.',
      completionCriteria: 'Source states were reviewed.',
      instructions: ['Run a Deep lookup.'],
      requiresApproval: true,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function bulkReview() {
  return {
    schema: 'whoisleuth.bulk-review' as const,
    version: 1 as const,
    presets: [{
      kind: 'preset' as const,
      id: 'priority-review',
      name: 'Priority review',
      view: {
        primaryFilter: 'high_risk',
        mutationFilter: '',
        signalFilters: [],
        sourceFilter: '',
        lifecycleFilter: '',
        ageFilter: '',
        mailFilter: '',
        registrarFilter: '',
        caseDispositionFilter: '',
        reviewStateFilter: 'reviewing' as const,
        groupBy: '',
        sortKey: 'risk' as const,
        sortDirection: -1 as const,
      },
      createdAt: NOW,
      updatedAt: NOW,
    }],
    rows: [{
      kind: 'row' as const,
      id: 'd-archive-one.invalid',
      domain: 'archive-one.invalid',
      state: 'reviewing' as const,
      updatedAt: NOW,
    }],
  };
}

type WorkspaceFixture = {
  cases: ReturnType<typeof caseRecord>[];
  campaigns: ReturnType<typeof campaign>[];
  brandProfiles: ReturnType<typeof profile>[];
  watchlists: Record<string, unknown>;
  shortlist: Record<string, unknown>[];
  detectionRules: Record<string, unknown>[];
  relationshipObservations: ReturnType<typeof relationshipObservation>[];
  bulkSessions: ReturnType<typeof bulkSession>[];
  websiteSnapshots: ReturnType<typeof websiteSnapshot>[];
  investigationTemplates: ReturnType<typeof investigationTemplate>[];
  bulkReview: ReturnType<typeof bulkReview>;
  settings: { activeProfileId: string; theme: string };
};

function input(): WorkspaceFixture {
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
    relationshipObservations: [relationshipObservation()],
    bulkSessions: [bulkSession()],
    websiteSnapshots: [websiteSnapshot()],
    investigationTemplates: [investigationTemplate()],
    bulkReview: bulkReview(),
    settings: { activeProfileId: 'profile-one', theme: 'light' },
  };
}

function emptyInput(): WorkspaceFixture {
  return {
    cases: [], campaigns: [], brandProfiles: [], watchlists: {}, shortlist: [], detectionRules: [], relationshipObservations: [], bulkSessions: [], websiteSnapshots: [], investigationTemplates: [],
    bulkReview: { schema: 'whoisleuth.bulk-review', version: 1, presets: [], rows: [] },
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
    assert.equal(left.manifest.sectionCount, 12);
    assert.equal(left.manifest.totalRecords, 13);
    assert.ok(left.manifest.sections.every((section) => /^sha256:[a-f0-9]{64}$/.test(section.checksum)));
    const settings = recordValue(left.sections.settings);
    assert.equal(settings.activeProfileId, 'profile-one');
    assert.equal(settings.theme, 'light');
  });

  test('reads and verifies every manifest byte count and checksum', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const parsed = await readWorkspaceArchive(archive);

    assert.equal(parsed.generatedAt, NOW);
    assert.equal(parsed.sections.length, 12);
    assert.equal(parsed.sections.every((section) => section.status === 'ready'), true);
    const cases = parsed.sections.find((section) => section.id === 'cases');
    const relationships = parsed.sections.find((section) => section.id === 'relationshipObservations');
    assert.ok(cases);
    assert.ok(relationships);
    assert.equal(cases.recordCount, 1);
    assert.equal(relationships.recordCount, 1);
    assert.ok(parsed.bytes > 0 && parsed.bytes < MAX_WORKSPACE_ARCHIVE_BYTES);
  });

  test('keeps version 1 archives readable without inventing newer saved-data sections', async () => {
    const legacy = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    Reflect.set(legacy, 'version', 1);
    const bulkEntry = legacy.manifest.sections.find((section) => section.id === 'bulkSessions');
    const websiteEntry = legacy.manifest.sections.find((section) => section.id === 'websiteSnapshots');
    const templateEntry = legacy.manifest.sections.find((section) => section.id === 'investigationTemplates');
    const bulkReviewEntry = legacy.manifest.sections.find((section) => section.id === 'bulkReview');
    assert.ok(bulkEntry);
    assert.ok(websiteEntry);
    assert.ok(templateEntry);
    assert.ok(bulkReviewEntry);
    legacy.manifest.sections = legacy.manifest.sections.filter((section) => !['bulkSessions', 'websiteSnapshots', 'investigationTemplates', 'bulkReview'].includes(section.id));
    legacy.manifest.sectionCount -= 4;
    legacy.manifest.totalRecords -= bulkEntry.recordCount + websiteEntry.recordCount + templateEntry.recordCount + bulkReviewEntry.recordCount;
    Reflect.deleteProperty(legacy.sections, 'bulkSessions');
    Reflect.deleteProperty(legacy.sections, 'websiteSnapshots');
    Reflect.deleteProperty(legacy.sections, 'investigationTemplates');
    Reflect.deleteProperty(legacy.sections, 'bulkReview');

    const parsed = await readWorkspaceArchive(legacy);
    assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(parsed.sourceVersion, 1);
    assert.equal(parsed.sections.length, 8);
    assert.equal(parsed.sections.some((section) => section.id === 'bulkSessions'), false);
    assert.equal(parsed.sections.some((section) => section.id === 'websiteSnapshots'), false);
    assert.equal(parsed.sections.some((section) => section.id === 'investigationTemplates'), false);
  });

  test('keeps version 2 archives readable without inventing website snapshots or templates', async () => {
    const legacy = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    Reflect.set(legacy, 'version', 2);
    const websiteEntry = legacy.manifest.sections.find((section) => section.id === 'websiteSnapshots');
    const templateEntry = legacy.manifest.sections.find((section) => section.id === 'investigationTemplates');
    const bulkReviewEntry = legacy.manifest.sections.find((section) => section.id === 'bulkReview');
    assert.ok(websiteEntry);
    assert.ok(templateEntry);
    assert.ok(bulkReviewEntry);
    legacy.manifest.sections = legacy.manifest.sections.filter((section) => !['websiteSnapshots', 'investigationTemplates', 'bulkReview'].includes(section.id));
    legacy.manifest.sectionCount -= 3;
    legacy.manifest.totalRecords -= websiteEntry.recordCount + templateEntry.recordCount + bulkReviewEntry.recordCount;
    Reflect.deleteProperty(legacy.sections, 'websiteSnapshots');
    Reflect.deleteProperty(legacy.sections, 'investigationTemplates');
    Reflect.deleteProperty(legacy.sections, 'bulkReview');

    const parsed = await readWorkspaceArchive(legacy);
    assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(parsed.sourceVersion, 2);
    assert.equal(parsed.sections.length, 9);
    assert.equal(parsed.sections.some((section) => section.id === 'websiteSnapshots'), false);
    assert.equal(parsed.sections.some((section) => section.id === 'investigationTemplates'), false);
  });

  test('keeps version 3 archives readable without inventing investigation templates', async () => {
    const legacy = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    Reflect.set(legacy, 'version', 3);
    const templateEntry = legacy.manifest.sections.find((section) => section.id === 'investigationTemplates');
    assert.ok(templateEntry);
    const bulkReviewEntry = legacy.manifest.sections.find((section) => section.id === 'bulkReview');
    assert.ok(bulkReviewEntry);
    legacy.manifest.sections = legacy.manifest.sections.filter((section) => !['investigationTemplates', 'bulkReview'].includes(section.id));
    legacy.manifest.sectionCount -= 2;
    legacy.manifest.totalRecords -= templateEntry.recordCount + bulkReviewEntry.recordCount;
    Reflect.deleteProperty(legacy.sections, 'investigationTemplates');
    Reflect.deleteProperty(legacy.sections, 'bulkReview');

    const parsed = await readWorkspaceArchive(legacy);
    assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(parsed.sourceVersion, 3);
    assert.equal(parsed.sections.length, 10);
    assert.equal(parsed.sections.some((section) => section.id === 'investigationTemplates'), false);
    assert.equal(parsed.sections.some((section) => section.id === 'bulkReview'), false);
  });

  test('keeps version 4 archives readable without inventing Bulk review state', async () => {
    const legacy = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    Reflect.set(legacy, 'version', 4);
    const bulkReviewEntry = legacy.manifest.sections.find((section) => section.id === 'bulkReview');
    assert.ok(bulkReviewEntry);
    legacy.manifest.sections = legacy.manifest.sections.filter((section) => section.id !== 'bulkReview');
    legacy.manifest.sectionCount -= 1;
    legacy.manifest.totalRecords -= bulkReviewEntry.recordCount;
    Reflect.deleteProperty(legacy.sections, 'bulkReview');

    const parsed = await readWorkspaceArchive(legacy);
    assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    assert.equal(parsed.sourceVersion, 4);
    assert.equal(parsed.sections.length, 11);
    assert.equal(parsed.sections.some((section) => section.id === 'bulkReview'), false);
  });

  test('rejects a changed section even when its manifest still looks valid', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const casesSection = recordValue(archive.sections.cases);
    assert.ok(Array.isArray(casesSection.cases));
    const firstCase = recordValue(casesSection.cases[0]);
    firstCase.domain = 'tampered.invalid';
    await assert.rejects(readWorkspaceArchive(archive), /byte-count check|checksum check/);
  });

  test('rejects an incorrect declared byte count', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    requiredValue(archive.manifest.sections[0]).bytes += 1;
    await assert.rejects(readWorkspaceArchive(archive), /byte-count check/);
  });

  test('rejects malformed checksum metadata', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    requiredValue(archive.manifest.sections[0]).checksum = 'sha256:nope';
    await assert.rejects(readWorkspaceArchive(archive), /invalid, duplicate, or missing section/);
  });

  test('rejects a future archive envelope before inspecting sections', async () => {
    const archive = {
      ...await buildWorkspaceArchive(input(), { generatedAt: NOW }),
      version: WORKSPACE_ARCHIVE_VERSION + 1,
    };
    await assert.rejects(readWorkspaceArchive(archive), new RegExp(`newer schema ${WORKSPACE_ARCHIVE_VERSION + 1}`));
  });

  test('reports a future section as unsupported without reinterpreting it', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const watchlists = archive.manifest.sections.find((section) => section.id === 'watchlists');
    assert.ok(watchlists);
    watchlists.version = 999;
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const section = preview.sections.find((item) => item.id === 'watchlists');

    assert.ok(section);
    assert.equal(section.status, 'unsupported');
    assert.match(section.reason, /newer schema 999/);
    assert.equal(section.selected, false);
    assert.equal(preview.unsupportedCount, 1);
  });

  test('reports a checksummed unknown section rather than applying it', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const index = archive.manifest.sections.findIndex((section) => section.id === 'settings');
    archive.manifest.sections[index] = {
      ...requiredValue(archive.manifest.sections[index]),
      id: 'futureSection',
    };
    Reflect.set(archive.sections, 'futureSection', archive.sections.settings);
    Reflect.deleteProperty(archive.sections, 'settings');
    const parsed = await readWorkspaceArchive(archive);
    const section = parsed.sections.find((item) => item.id === 'futureSection');

    assert.ok(section);
    assert.equal(section.status, 'unsupported');
    assert.match(section.reason, /does not recognise/);
  });

  test('rejects undeclared section data', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    Reflect.set(archive.sections, 'extra', {});
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
    const archive: Record<string, unknown> = { schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION };
    archive.self = archive;
    await assert.rejects(readWorkspaceArchive(archive), /cannot be serialised/);
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
    assert.ok(cases);
    assert.ok(campaigns);
    assert.ok(settings);
    assert.deepEqual({ added: cases.added, updated: cases.updated, skipped: cases.skipped }, { added: 0, updated: 1, skipped: 0 });
    assert.deepEqual({ added: campaigns.added, updated: campaigns.updated }, { added: 1, updated: 0 });
    assert.equal(settings.updated, 1);
    assert.equal(settings.skipped, 0);
    assert.deepEqual(archive, beforeArchive);
    assert.deepEqual(local, beforeLocal);
  });

  test('keeps the active profile setting only when the merged profile exists', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const settingsEntry = archive.manifest.sections.find((section) => section.id === 'settings');
    assert.ok(settingsEntry);
    archive.manifest.sections = [
      settingsEntry,
      ...archive.manifest.sections.filter((section) => section.id !== 'settings'),
    ];
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const settings = preview.sections.find((section) => section.id === 'settings');

    assert.ok(settings);
    const normalizedSettings = recordValue(settings.normalizedSettings);
    assert.deepEqual(preview.sections.map((section) => section.id), [...WORKSPACE_ARCHIVE_SECTION_IDS]);
    assert.equal(settings.skipped, 0);
    assert.equal(normalizedSettings.activeProfileId, 'profile-one');
    assert.equal(normalizedSettings.theme, 'light');
  });

  test('sanitizes unsupported theme and dangling active-profile settings at export', async () => {
    const source = emptyInput();
    source.settings = { activeProfileId: 'missing-profile', theme: 'neon' };
    const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });

    assert.deepEqual(archive.sections.settings, {
      schema: 'whoisleuth.workspace-settings',
      version: 1,
      activeProfileId: '',
      theme: 'system',
    });
  });
});
