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
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { createCase, mergeCases, normalizeCaseStore, updateCase, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { mergeBrandProfiles } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION,
  mergeBulkSessions,
  summarizeBulkProfileContexts,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';

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
    brandProfileIds: ['profile-one'],
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
    profileContext: summarizeBulkProfileContexts([]),
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function bulkSessionWithProfileClaims() {
  const profileContext = {
    sourceState: 'ready' as const,
    activeProfileId: 'profile-one',
    profileUpdatedAt: NOW,
    limitation: '',
  };
  return {
    id: 'bulk-profile-claims',
    name: 'Archive profile claims',
    mode: 'deep' as const,
    state: 'complete' as const,
    inputDigest: `sha256:${'b'.repeat(64)}`,
    domains: ['profile-claims.invalid'],
    results: [{
      domain: 'profile-claims.invalid',
      status: 'complete',
      scanDepth: 'deep',
      trusted: 'official',
      risk: 95,
      riskModelVersion: 7,
      riskFactors: [{ label: 'Profile-derived match', points: 95 }],
      faviconMatch: true,
      faviconNearMatch: true,
      reusesOfficialAssets: true,
      idnReferenceMatch: true,
      pageBaselineMatch: true,
      hasActiveBrandProfile: true,
      relationship: {
        version: 2,
        officialAssetHosts: ['assets.profile-claims.invalid'],
      },
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
      profileContext,
    }],
    profileContext,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  };
}

function bulkSessionWithoutActiveProfileRisk() {
  const profileContext = {
    sourceState: 'ready' as const,
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: '',
  };
  return {
    id: 'bulk-no-active-profile-risk',
    name: 'Archive generic Risk',
    mode: 'deep' as const,
    state: 'complete' as const,
    inputDigest: `sha256:${'d'.repeat(64)}`,
    domains: ['generic-risk.invalid'],
    results: [{
      domain: 'generic-risk.invalid',
      status: 'complete',
      scanDepth: 'deep',
      trusted: null,
      risk: 44,
      riskModelVersion: 7,
      riskFactors: [{ label: 'Generic observed context', points: 44 }],
      faviconMatch: false,
      faviconNearMatch: false,
      reusesOfficialAssets: false,
      idnReferenceMatch: false,
      pageBaselineMatch: false,
      hasActiveBrandProfile: false,
      relationship: { version: 2, officialAssetHosts: [] },
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
      profileContext,
    }],
    profileContext,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
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
  cases: Array<ReturnType<typeof caseRecord> | CaseRecord>;
  campaigns: ReturnType<typeof campaign>[];
  brandProfiles: ReturnType<typeof profile>[];
  watchlists: Record<string, unknown>;
  shortlist: Record<string, unknown>[];
  detectionRules: Record<string, unknown>[];
  relationshipObservations: ReturnType<typeof relationshipObservation>[];
  bulkSessions: unknown[];
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

async function retargetSectionVersion(archive: Awaited<ReturnType<typeof buildWorkspaceArchive>>, id: string, version: number): Promise<void> {
  const entry = archive.manifest.sections.find((section) => section.id === id);
  assert.ok(entry);
  const section = recordValue(archive.sections[id as keyof typeof archive.sections]);
  Reflect.set(section, 'version', version);
  entry.version = version;
  entry.bytes = new TextEncoder().encode(JSON.stringify(section)).byteLength;
  entry.checksum = await sha256ArtifactDigest(section);
}

async function refreshSectionIntegrity(archive: Awaited<ReturnType<typeof buildWorkspaceArchive>>, id: string): Promise<void> {
  const entry = archive.manifest.sections.find((section) => section.id === id);
  assert.ok(entry);
  const section = recordValue(archive.sections[id as keyof typeof archive.sections]);
  entry.bytes = new TextEncoder().encode(JSON.stringify(section)).byteLength;
  entry.checksum = await sha256ArtifactDigest(section);
}

function removeSections(archive: Awaited<ReturnType<typeof buildWorkspaceArchive>>, ids: readonly string[]): void {
  const removed = archive.manifest.sections.filter((section) => ids.includes(section.id));
  archive.manifest.sections = archive.manifest.sections.filter((section) => !ids.includes(section.id));
  archive.manifest.sectionCount -= removed.length;
  archive.manifest.totalRecords -= removed.reduce((sum, section) => sum + section.recordCount, 0);
  for (const id of ids) Reflect.deleteProperty(archive.sections, id);
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
    assert.deepEqual(archive.sections.cases.cases[0]?.brandProfileIds, ['profile-one']);
  });

  test('preserves and existing-first unions Case v12 Brand Profile references', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const local = emptyInput();
    local.cases = [{ ...caseRecord('archive-one.invalid', 'local-case'), brandProfileIds: ['local-profile'] }];
    const preview = await previewWorkspaceArchive(archive, local);
    const cases = preview.sections.find((section) => section.id === 'cases');
    assert.ok(cases);
    assert.equal(cases.status, 'ready');
    assert.equal(cases.brandProfileReferencesOmitted, 0);
    const merged = mergeCases(normalizeCaseStore(local.cases).cases, archive.sections.cases);
    assert.deepEqual(merged.cases[0]?.brandProfileIds, ['local-profile', 'profile-one']);
  });

  test('keeps archive v5 while round-tripping embedded Case v14 lifecycle histories', async () => {
    let record = createCase({
      domain: 'response-archive.invalid',
      source: 'lookup',
      evidence: {
        inputHostname: 'login.response-archive.invalid',
        scanDepth: 'deep',
        availability: 'registered',
      },
    }, NOW);
    record = updateCase([record], record.id, {
      action: { type: 'registrar_report', recipient: 'Reviewed response route', contactSource: 'analyst supplied' },
    }, NOW).record;
    const actionId = record.actions[0]!.id;
    record = updateCase([record], record.id, {
      actionUpdate: {
        id: actionId,
        transition: { nextState: 'ready_for_review', sourceClass: 'analyst', provenance: 'archive_fixture_review' },
      },
    }, '2026-07-19T02:01:00.000Z').record;
    record = updateCase([record], record.id, {
      observedEffectReview: {
        state: 'not_checked', observedAt: '2026-07-19T02:02:00.000Z', sourceClass: 'analyst',
        source: 'Scheduled local follow-up', completeness: 'unknown', followUpAt: '2026-07-26T02:02:00.000Z',
        limitations: ['No request was made.'],
      },
    }, '2026-07-19T02:02:00.000Z').record;
    record = updateCase([record], record.id, {
      closure: {
        reason: 'monitoring_transferred', summary: 'Monitoring was deliberately transferred to the local follow-up calendar.',
        limitations: ['No remediation or absence conclusion was made.'],
      },
    }, '2026-07-19T02:03:00.000Z').record;

    const source = input();
    source.cases = [record];
    const archive = await buildWorkspaceArchive(source, { generatedAt: '2026-07-19T02:04:00.000Z' });
    assert.equal(archive.version, 5);
    assert.equal(archive.sections.cases.version, 14);
    const parsed = await readWorkspaceArchive(archive);
    const cases = parsed.sections.find((section) => section.id === 'cases');
    assert.equal(cases?.status, 'ready');
    const restored = mergeCases([], cases?.data).cases[0]!;
    assert.equal(restored.evidenceHistory[0]?.inputHostname, 'login.response-archive.invalid');
    assert.equal(restored.actions[0]?.history.length, 2);
    assert.equal(restored.actions[0]?.history[1]?.id, record.actions[0]?.history[1]?.id);
    assert.equal(restored.observedEffects.reviews[0]?.id, record.observedEffects.reviews[0]?.id);
    assert.equal(restored.closures.records[0]?.id, record.closures.records[0]?.id);
    assert.equal(restored.status, 'resolved');
  });

  test('quarantines profile-derived Bulk claims that arrive through a workspace section', async () => {
    const source = input();
    source.bulkSessions = [bulkSessionWithProfileClaims()];
    const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });
    const parsed = await readWorkspaceArchive(archive);
    const bulkSection = parsed.sections.find((section) => section.id === 'bulkSessions');
    const merged = mergeBulkSessions([], bulkSection?.data);
    const imported = merged.sessions[0];
    assert.equal(imported?.profileContext.limitation, BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION);
    assert.equal(imported?.results[0]?.trusted, null);
    assert.equal(imported?.results[0]?.risk, null);
    assert.equal(imported?.results[0]?.faviconMatch, null);
    assert.deepEqual(imported?.results[0]?.relationship.officialAssetHosts, []);
  });

  test('retains legitimate no-profile Risk in an ordinary archive while quarantining it on import', async () => {
    const source = input();
    source.bulkSessions = [bulkSessionWithoutActiveProfileRisk()];
    const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });
    const parsed = await readWorkspaceArchive(archive);
    const bulkSection = parsed.sections.find((section) => section.id === 'bulkSessions');
    const stored = recordValue(bulkSection?.data);
    const storedSession = requiredValue((stored.sessions as Array<Record<string, unknown>>)[0]);
    const storedRow = requiredValue((storedSession.results as Array<Record<string, unknown>>)[0]);
    assert.equal(storedRow.risk, 44);
    assert.equal(storedRow.riskModelVersion, 7);
    assert.deepEqual(storedRow.riskFactors, [{ label: 'Generic observed context', points: 44 }]);

    const imported = mergeBulkSessions([], bulkSection?.data).sessions[0]?.results[0];
    assert.equal(imported?.risk, null);
    assert.equal(imported?.riskModelVersion, null);
    assert.deepEqual(imported?.riskFactors, []);
  });

  test('rejects every malformed v4 Bulk result set through an ordinary workspace preview', async () => {
    const attacks: Array<{ label: string; mutate: (session: Record<string, unknown>) => void }> = [
      {
        label: 'missing row context',
        mutate: (session) => Reflect.deleteProperty(requiredValue(session.results as Array<Record<string, unknown>>)[0]!, 'profileContext'),
      },
      {
        label: 'malformed row context',
        mutate: (session) => {
          requiredValue(session.results as Array<Record<string, unknown>>)[0]!.profileContext = {
            sourceState: 'ready', activeProfileId: null, profileUpdatedAt: NOW, limitation: '',
          };
        },
      },
      { label: 'missing session context', mutate: (session) => Reflect.deleteProperty(session, 'profileContext') },
      {
        label: 'duplicate result',
        mutate: (session) => {
          const rows = session.results as unknown[];
          rows.push(structuredClone(requiredValue(rows[0])));
        },
      },
      {
        label: 'out-of-domain result',
        mutate: (session) => { requiredValue(session.results as Array<Record<string, unknown>>)[0]!.domain = 'outside.invalid'; },
      },
      {
        label: 'missing declared domain',
        mutate: (session) => { (session.domains as string[]).push('missing.invalid'); },
      },
      {
        label: 'fully settled partial session',
        mutate: (session) => { session.state = 'partial'; session.completedAt = null; },
      },
      {
        label: 'fully settled cancelled session',
        mutate: (session) => { session.state = 'cancelled'; session.completedAt = null; },
      },
    ];
    for (const attack of attacks) {
      const source = input();
      source.bulkSessions = [bulkSessionWithoutActiveProfileRisk()];
      const archive = structuredClone(await buildWorkspaceArchive(source, { generatedAt: NOW }));
      const section = recordValue(archive.sections.bulkSessions);
      const storedSession = requiredValue((section.sessions as Array<Record<string, unknown>>)[0]);
      attack.mutate(storedSession);
      await refreshSectionIntegrity(archive, 'bulkSessions');

      const preview = await previewWorkspaceArchive(archive, emptyInput(), { selectedSectionIds: ['bulkSessions'] });
      const bulk = preview.sections.find((item) => item.id === 'bulkSessions');
      assert.equal(bulk?.status, 'ready', attack.label);
      assert.deepEqual(
        { added: bulk?.added, updated: bulk?.updated, skipped: bulk?.skipped },
        { added: 0, updated: 0, skipped: 1 },
        attack.label,
      );
    }

    for (const state of ['partial', 'cancelled'] as const) {
      const source = input();
      source.bulkSessions = [bulkSessionWithoutActiveProfileRisk()];
      const archive = structuredClone(await buildWorkspaceArchive(source, { generatedAt: NOW }));
      const section = recordValue(archive.sections.bulkSessions);
      const storedSession = requiredValue((section.sessions as Array<Record<string, unknown>>)[0]);
      storedSession.state = state;
      storedSession.completedAt = null;
      (storedSession.domains as string[]).push('pending.invalid');
      await refreshSectionIntegrity(archive, 'bulkSessions');
      const preview = await previewWorkspaceArchive(archive, emptyInput(), { selectedSectionIds: ['bulkSessions'] });
      const bulk = preview.sections.find((item) => item.id === 'bulkSessions');
      assert.deepEqual(
        { added: bulk?.added, updated: bulk?.updated, skipped: bulk?.skipped },
        { added: 1, updated: 0, skipped: 0 },
        `valid ${state} subset`,
      );
    }
  });

  test('does not remap an opaque Case reference when a profile name collides', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const local = emptyInput();
    local.brandProfiles = [{ ...profile(), id: 'local-profile' }];

    const mergedProfiles = mergeBrandProfiles(local.brandProfiles, archive.sections.brandProfiles, { nowIso: NOW });
    const mergedCases = mergeCases(normalizeCaseStore(local.cases).cases, archive.sections.cases);

    assert.deepEqual(mergedProfiles.profiles.map((item) => item.id), ['local-profile']);
    assert.deepEqual(mergedCases.cases[0]?.brandProfileIds, ['profile-one']);
    assert.equal(mergedProfiles.profiles.some((item) => item.id === 'profile-one'), false);
  });

  test('blocks profile, Case, and Settings sections atomically when one exact profile id names a different profile', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const local = emptyInput();
    local.brandProfiles = [{ ...profile(), id: 'profile-one', name: 'Local distinct profile' }];
    local.cases = [{ ...caseRecord('local-associated.invalid', 'local-associated-case'), brandProfileIds: ['profile-one'] }];
    const before = structuredClone(local);

    const preview = await previewWorkspaceArchive(archive, local);
    const profiles = preview.sections.find((section) => section.id === 'brandProfiles');
    const cases = preview.sections.find((section) => section.id === 'cases');
    const settings = preview.sections.find((section) => section.id === 'settings');

    assert.equal(profiles?.status, 'blocked');
    assert.match(profiles?.reason ?? '', /one exact identifier for different normalised profile names/iu);
    assert.equal(cases?.status, 'blocked');
    assert.match(cases?.reason ?? '', /opaque references can be imported safely/iu);
    assert.equal(settings?.status, 'blocked');
    assert.equal(settings?.selected, false);
    assert.equal(settings?.normalizedSettings, null);
    assert.match(settings?.reason ?? '', /active Brand Profile preference.*different local profile/iu);
    assert.deepEqual(local, before);
    assert.equal(local.brandProfiles[0]?.name, 'Local distinct profile');
    assert.deepEqual(local.cases[0]?.brandProfileIds, ['profile-one']);
  });

  test('skips malformed workspace profile identifiers consistently in preview', async () => {
    const archive = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    const profileSection = archive.sections.brandProfiles as unknown as { profiles: Array<Record<string, unknown>> };
    profileSection.profiles[0]!.id = ' malformed-profile';
    const entry = archive.manifest.sections.find((section) => section.id === 'brandProfiles');
    assert.ok(entry);
    entry.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.brandProfiles)).byteLength;
    entry.checksum = await sha256ArtifactDigest(archive.sections.brandProfiles);

    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const profiles = preview.sections.find((section) => section.id === 'brandProfiles');
    const settings = preview.sections.find((section) => section.id === 'settings');
    assert.equal(profiles?.status, 'ready');
    assert.deepEqual({ added: profiles?.added, skipped: profiles?.skipped }, { added: 0, skipped: 1 });
    assert.equal(settings?.normalizedSettings?.activeProfileId, '');
    assert.equal(settings?.skipped, 1);
  });

  test('keeps Settings preview selection-aware when imported Profiles are deselected', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const local = emptyInput();
    local.brandProfiles = [{ ...profile(), id: 'local-profile', name: 'Local profile' }];
    local.settings.activeProfileId = 'local-profile';

    const withoutProfiles = await previewWorkspaceArchive(archive, local, {
      selectedSectionIds: ['settings'],
    });
    const settingsWithoutProfiles = withoutProfiles.sections.find((section) => section.id === 'settings');
    assert.equal(settingsWithoutProfiles?.selected, true);
    assert.equal(settingsWithoutProfiles?.skipped, 1);
    assert.equal(settingsWithoutProfiles?.normalizedSettings?.activeProfileId, 'local-profile');
    assert.match(settingsWithoutProfiles?.reason ?? '', /not available in the selected Profile data/iu);

    const withProfiles = await previewWorkspaceArchive(archive, local, {
      selectedSectionIds: ['brandProfiles', 'settings'],
    });
    const settingsWithProfiles = withProfiles.sections.find((section) => section.id === 'settings');
    assert.equal(settingsWithProfiles?.skipped, 0);
    assert.equal(settingsWithProfiles?.normalizedSettings?.activeProfileId, 'profile-one');
  });

  test('distinguishes an intentional Settings clear from missing, non-string, and invalid active-profile values', async () => {
    const local = emptyInput();
    local.brandProfiles = [{ ...profile(), id: 'local-profile', name: 'Local retained profile' }];
    local.settings = { activeProfileId: 'local-profile', theme: 'light' };

    for (const mutation of ['missing', 'non-string', 'invalid'] as const) {
      const archive = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
      const settingsData = recordValue(archive.sections.settings);
      if (mutation === 'missing') Reflect.deleteProperty(settingsData, 'activeProfileId');
      else if (mutation === 'non-string') Reflect.set(settingsData, 'activeProfileId', 42);
      else Reflect.set(settingsData, 'activeProfileId', ' malformed-profile');
      await refreshSectionIntegrity(archive, 'settings');

      const preview = await previewWorkspaceArchive(archive, local, { selectedSectionIds: ['settings'] });
      const settings = preview.sections.find((section) => section.id === 'settings');
      assert.equal(settings?.selected, true, mutation);
      assert.equal(settings?.skipped, 1, mutation);
      assert.equal(settings?.updated, 0, mutation);
      assert.equal(settings?.normalizedSettings?.activeProfileId, 'local-profile', mutation);
      assert.equal(settings?.normalizedSettings?.theme, 'light', mutation);
      assert.match(settings?.reason ?? '', /missing or malformed.*preserved/iu, mutation);
    }

    const clearArchive = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    clearArchive.sections.settings.activeProfileId = '';
    await refreshSectionIntegrity(clearArchive, 'settings');
    const clearPreview = await previewWorkspaceArchive(clearArchive, local, { selectedSectionIds: ['settings'] });
    const clearSettings = clearPreview.sections.find((section) => section.id === 'settings');
    assert.equal(clearSettings?.selected, true);
    assert.equal(clearSettings?.skipped, 0);
    assert.equal(clearSettings?.updated, 1);
    assert.equal(clearSettings?.normalizedSettings?.activeProfileId, '');
    assert.equal(clearSettings?.reason, '');
  });

  test('keeps a schema 10 case section readable after the case schema advances', async () => {
    const archive = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
    const entry = archive.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(entry);
    const legacyCase = archive.sections.cases.cases[0] as unknown as Record<string, unknown>;
    legacyCase.evidenceHistory = [{
      scanDepth: 'deep',
      availability: 'registered',
      riskModelVersion: 1,
      riskScore: 40,
      profileContextState: 'ready',
      profileContextLimitation: 'Smuggled current-only provenance.',
      capturedAt: NOW,
    }];
    Reflect.set(archive.sections.cases, 'version', 10);
    entry.version = 10;
    entry.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.cases)).byteLength;
    entry.checksum = await sha256ArtifactDigest(archive.sections.cases);
    const parsed = await readWorkspaceArchive(archive);
    const cases = parsed.sections.find((section) => section.id === 'cases');
    assert.equal(cases?.status, 'ready');
    const merged = mergeCases([], cases?.data);
    assert.equal(merged.cases[0]?.evidenceHistory[0]?.profileContextState, null);
    assert.equal(merged.cases[0]?.evidenceHistory[0]?.profileContextLimitation, null);
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    assert.equal(preview.sections.find((section) => section.id === 'cases')?.status, 'ready');
  });

  test('restores the inner section contracts emitted by every historical archive envelope', async () => {
    const fixtures = [
      { version: 1, versions: { cases: 2, brandProfiles: 2, shortlist: 2 }, remove: ['bulkSessions', 'websiteSnapshots', 'investigationTemplates', 'bulkReview'] },
      { version: 2, versions: { cases: 3, brandProfiles: 3, shortlist: 2, bulkSessions: 1 }, remove: ['websiteSnapshots', 'investigationTemplates', 'bulkReview'] },
      { version: 3, versions: { cases: 3, brandProfiles: 3, shortlist: 2, bulkSessions: 1, websiteSnapshots: 1 }, remove: ['investigationTemplates', 'bulkReview'] },
      { version: 4, versions: { cases: 3, brandProfiles: 3, shortlist: 2, bulkSessions: 1, websiteSnapshots: 1 }, remove: ['bulkReview'] },
      { version: 5, versions: { cases: 4, brandProfiles: 3, shortlist: 2, bulkSessions: 1, websiteSnapshots: 1 }, remove: [] },
    ] as const;
    for (const fixture of fixtures) {
      const archive = structuredClone(await buildWorkspaceArchive(input(), { generatedAt: NOW }));
      Reflect.set(archive, 'version', fixture.version);
      removeSections(archive, fixture.remove);
      for (const [id, version] of Object.entries(fixture.versions)) await retargetSectionVersion(archive, id, version);
      const parsed = await readWorkspaceArchive(archive);
      assert.equal(parsed.sourceVersion, fixture.version);
      assert.equal(parsed.sections.every((section) => section.status === 'ready'), true);
      const preview = await previewWorkspaceArchive(archive, emptyInput());
      assert.equal(preview.unsupportedCount, 0);
      assert.equal(preview.sections.every((section) => section.status === 'ready'), true);
    }
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

  test('closes versioned workspace envelopes, manifests, and manifest entries before integrity claims', async () => {
    const attacks: Array<{ label: string; mutate: (archive: Awaited<ReturnType<typeof buildWorkspaceArchive>>) => void }> = [
      { label: 'version 5 envelope', mutate: (archive) => { Reflect.set(archive, 'rawWhoisPayload', { credential: 'private material' }); } },
      { label: 'manifest', mutate: (archive) => { Reflect.set(archive.manifest, 'uncheckedPolicy', 'private material'); } },
      { label: 'manifest section entry', mutate: (archive) => { Reflect.set(archive.manifest.sections[0]!, 'credential', 'private material'); } },
    ];
    for (const attack of attacks) {
      const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
      attack.mutate(archive);
      await assert.rejects(readWorkspaceArchive(archive), new RegExp(`${attack.label} contains missing or undeclared fields`, 'iu'));
    }
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
    await retargetSectionVersion(archive, 'watchlists', 999);
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const section = preview.sections.find((item) => item.id === 'watchlists');

    assert.ok(section);
    assert.equal(section.status, 'unsupported');
    assert.match(section.reason, /newer schema 999/);
    assert.equal(section.selected, false);
    assert.equal(preview.unsupportedCount, 1);
  });

  test('isolates a checksummed future Case v15 section as unsupported', async () => {
    const archive = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    await retargetSectionVersion(archive, 'cases', 15);
    const parsed = await readWorkspaceArchive(archive);
    assert.equal(parsed.sections.find((section) => section.id === 'cases')?.status, 'unsupported');
    const preview = await previewWorkspaceArchive(archive, emptyInput());
    const cases = preview.sections.find((section) => section.id === 'cases');
    assert.equal(cases?.status, 'unsupported');
    assert.equal(cases?.selected, false);
    assert.match(cases?.reason ?? '', /newer schema 15/iu);
  });

  test('binds every checksummed section contract to its manifest declaration', async () => {
    const manifestAhead = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const casesEntry = manifestAhead.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(casesEntry);
    casesEntry.version = 999;
    await assert.rejects(readWorkspaceArchive(manifestAhead), /section contract does not match/iu);

    const sectionAhead = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    Reflect.set(sectionAhead.sections.cases, 'version', 999);
    const sectionAheadEntry = sectionAhead.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(sectionAheadEntry);
    sectionAheadEntry.bytes = new TextEncoder().encode(JSON.stringify(sectionAhead.sections.cases)).byteLength;
    sectionAheadEntry.checksum = await sha256ArtifactDigest(sectionAhead.sections.cases);
    await assert.rejects(readWorkspaceArchive(sectionAhead), /section contract does not match/iu);

    const schemaMismatch = await buildWorkspaceArchive(input(), { generatedAt: NOW });
    const watchlistDocument = recordValue(schemaMismatch.sections.watchlists);
    Reflect.set(watchlistDocument, 'schema', 'whoisleuth.other-contract');
    const watchlistEntry = schemaMismatch.manifest.sections.find((section) => section.id === 'watchlists');
    assert.ok(watchlistEntry);
    watchlistEntry.bytes = new TextEncoder().encode(JSON.stringify(watchlistDocument)).byteLength;
    watchlistEntry.checksum = await sha256ArtifactDigest(watchlistDocument);
    await assert.rejects(readWorkspaceArchive(schemaMismatch), /section contract does not match/iu);
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
      generatedAt: NOW,
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
    const archive: Record<string, unknown> = {
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: WORKSPACE_ARCHIVE_VERSION,
      generatedAt: NOW,
    };
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
