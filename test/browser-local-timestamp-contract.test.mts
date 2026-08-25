import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
const urls = {
  brand: moduleUrl('../frontend/src/lib/analysis/brand-profile-model.ts'),
  bulkSession: moduleUrl('../frontend/src/lib/analysis/bulk-session-model.ts'),
  bulkResult: moduleUrl('../frontend/src/lib/analysis/bulk-result-model.ts'),
  campaign: moduleUrl('../frontend/src/lib/analysis/campaign-model.ts'),
  caseModel: moduleUrl('../frontend/src/lib/analysis/case-model.ts'),
  shortlist: moduleUrl('../frontend/src/lib/analysis/shortlist-model.ts'),
  relationship: moduleUrl('../frontend/src/lib/analysis/relationship-observation-model.ts'),
  investigation: moduleUrl('../frontend/src/lib/analysis/investigation-template-model.ts'),
  website: moduleUrl('../frontend/src/lib/analysis/website-snapshot-model.ts'),
  bulkReview: moduleUrl('../frontend/src/lib/analysis/bulk-review-model.ts'),
  caseLifecycle: moduleUrl('../frontend/src/lib/analysis/case-lifecycle-calendar.ts'),
};

const probeSource = `
const { normalizeBrandProfile, normalizeBrandProfileStore } = await import(${JSON.stringify(urls.brand)});
const { bulkProfileContextProvenance, normalizeBulkProfileContext } = await import(${JSON.stringify(urls.bulkSession)});
const { bulkProfileContextsMatch } = await import(${JSON.stringify(urls.bulkResult)});
const { mergeCampaigns } = await import(${JSON.stringify(urls.campaign)});
const { mergeCases, normalizeCaseStore } = await import(${JSON.stringify(urls.caseModel)});
const { normalizeShortlistRecord } = await import(${JSON.stringify(urls.shortlist)});
const { mergeRelationshipObservations } = await import(${JSON.stringify(urls.relationship)});
const { normalizeInvestigationTemplateStore } = await import(${JSON.stringify(urls.investigation)});
const { normalizeWebsiteSnapshotStore } = await import(${JSON.stringify(urls.website)});
const { mergeBulkReviewStores } = await import(${JSON.stringify(urls.bulkReview)});

const candidateTimestamp = process.env.PROBE_TIMESTAMP;
const explicitBaseline = '2026-01-15T05:00:00.000Z';
const epoch = '2026-01-01T00:00:00.000Z';

const profile = (name, updatedAt) => ({
  id: 'profile-1', name, officialDomains: ['example.invalid'], productNames: [], tlds: [],
  approvedPartnerDomains: [], allowlistedDomains: [], allowlistedRegistrars: [],
  dkimSelectors: [], retiredDkimSelectors: [], mailProtectionProfile: 'standard',
  protectionAttestations: [], desiredPostureBaselines: [], trademarkOwner: '',
  trademarkRegistration: '', officialFaviconHash: '', officialFaviconPHash: '',
  pageBaseline: null, createdAt: epoch, updatedAt,
});
const campaign = (name, updatedAt) => ({
  id: 'campaign-1', name, description: name, domains: ['example.invalid'], createdAt: epoch, updatedAt,
});
const relationship = (complete, retainedAt) => ({
  type: 'nameserver_set', normalizedValue: 'ns1.shared.invalid', domains: ['example.invalid'],
  sourceVersion: 1, observedAt: retainedAt, retainedAt, complete, truncated: false,
});
const template = (id, updatedAt) => ({
  id, label: id, summary: 'Bounded review.', recipeId: 'new_domain_triage', createdAt: epoch, updatedAt,
  stages: [{
    id: 'lookup', label: 'Lookup', detail: 'Review evidence.', expectedEvidence: 'Evidence.',
    completionCriteria: 'Reviewed.', instructions: ['Review.'], requiresApproval: true,
  }],
});
const snapshot = (id, savedAt) => ({
  id, domain: 'snapshot.invalid', observedAt: savedAt, savedAt, complete: true, truncated: false,
  technologies: [], posture: [], identity: {}, identityValues: {}, sources: [], dependencies: [], certificate: null,
});
const view = { primaryFilter: 'all', signalFilters: [], sortKey: 'risk', sortDirection: -1 };
const reviewPreset = (name, updatedAt) => ({
  kind: 'preset', id: 'view', name, view, createdAt: epoch, updatedAt,
});

const normalizedProfile = normalizeBrandProfile(profile('Candidate', candidateTimestamp));
const retainedProfileContext = normalizeBulkProfileContext({
  sourceState: 'ready', activeProfileId: 'profile-1', profileUpdatedAt: candidateTimestamp, limitation: '',
});
const currentProfileContext = bulkProfileContextProvenance('ready', normalizedProfile);
const localCases = normalizeCaseStore([{
  domain: 'shared.invalid', status: 'new', createdAt: epoch, updatedAt: explicitBaseline,
}]).cases;
const mergedCase = mergeCases(localCases, {
  version: 13,
  cases: [{ domain: 'shared.invalid', status: 'escalated', createdAt: epoch, updatedAt: candidateTimestamp }],
}).cases[0];

process.stdout.write(JSON.stringify({
  brandDuplicateWinner: normalizeBrandProfileStore({
    version: 6,
    profiles: [profile('Explicit', explicitBaseline), profile('Candidate', candidateTimestamp)],
  }).profiles[0]?.name,
  brandNormalizedUpdatedAt: normalizedProfile?.updatedAt,
  bulkProfileRevisionMatches: bulkProfileContextsMatch(retainedProfileContext, currentProfileContext),
  campaignMergeWinner: mergeCampaigns(
    [campaign('Local', explicitBaseline)],
    { schema: 'whoisleuth.campaigns', version: 1, campaigns: [campaign('Imported', candidateTimestamp)] },
  ).campaigns[0]?.name,
  caseMergeStatus: mergedCase?.status,
  shortlistSavedAt: normalizeShortlistRecord({
    domain: 'example.invalid', scanDepth: 'deep', availability: 'registered', savedAt: candidateTimestamp,
  })?.savedAt,
  relationshipMergeComplete: mergeRelationshipObservations(
    [relationship(false, explicitBaseline)],
    { schema: 'whoisleuth.relationship-observations', version: 1, observations: [relationship(true, candidateTimestamp)] },
  ).observations[0]?.complete,
  investigationOrder: normalizeInvestigationTemplateStore({
    schema: 'whoisleuth.investigation-templates', version: 2,
    templates: [template('explicit', explicitBaseline), template('candidate', candidateTimestamp)],
  }).templates.map((item) => item.id),
  websiteOrder: normalizeWebsiteSnapshotStore({
    schema: 'whoisleuth.website-profile-snapshots', version: 4,
    snapshots: [snapshot('explicit', explicitBaseline), snapshot('candidate', candidateTimestamp)],
  }).snapshots.map((item) => item.id),
  bulkReviewMergeWinner: mergeBulkReviewStores(
    {
      schema: 'whoisleuth.bulk-review', version: 1,
      presets: [reviewPreset('Local', explicitBaseline)], rows: [],
    },
    {
      schema: 'whoisleuth.bulk-review', version: 1,
      presets: [reviewPreset('Imported', candidateTimestamp)], rows: [],
    },
  ).store.presets[0]?.name,
}));
`;

function run(timezone: string, timestamp: string): Record<string, unknown> {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probeSource], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone, PROBE_TIMESTAMP: timestamp },
  })) as Record<string, unknown>;
}

test('current browser-local timestamp decisions are timezone-independent', () => {
  const zoneLess = '2026-01-15T12:00:00.000';
  const invalidUtc = run('UTC', zoneLess);
  assert.deepEqual(run('Australia/Melbourne', zoneLess), invalidUtc);
  assert.deepEqual(invalidUtc, {
    brandDuplicateWinner: 'Explicit',
    brandNormalizedUpdatedAt: '2026-01-01T00:00:00.000Z',
    bulkProfileRevisionMatches: false,
    campaignMergeWinner: 'Local',
    caseMergeStatus: 'new',
    shortlistSavedAt: '1970-01-01T00:00:00.000Z',
    relationshipMergeComplete: false,
    investigationOrder: ['explicit'],
    websiteOrder: ['explicit'],
    bulkReviewMergeWinner: 'Local',
  });

  const explicitOffset = '2026-01-15T12:00:00.000+01:00';
  const offsetUtc = run('UTC', explicitOffset);
  assert.deepEqual(run('Australia/Melbourne', explicitOffset), offsetUtc);
  assert.deepEqual(offsetUtc, {
    brandDuplicateWinner: 'Candidate',
    brandNormalizedUpdatedAt: '2026-01-15T11:00:00.000Z',
    bulkProfileRevisionMatches: true,
    campaignMergeWinner: 'Imported',
    caseMergeStatus: 'escalated',
    shortlistSavedAt: '2026-01-15T11:00:00.000Z',
    relationshipMergeComplete: true,
    investigationOrder: ['candidate', 'explicit'],
    websiteOrder: ['candidate', 'explicit'],
    bulkReviewMergeWinner: 'Imported',
  });
});

const nestedCaseProbeSource = `
const { normalizeCaseStore } = await import(${JSON.stringify(urls.caseModel)});
const { buildCaseLifecycleEvents } = await import(${JSON.stringify(urls.caseLifecycle)});
const candidate = process.env.PROBE_TIMESTAMP;
const version = Number(process.env.PROBE_VERSION);
const epoch = '2026-01-01T00:00:00.000Z';
const raw = {
  domain: 'nested.invalid', createdAt: epoch, updatedAt: epoch,
  evidenceHistory: [{ inputHostname: null, availability: 'registered', capturedAt: epoch, createdDate: candidate, expiryDate: candidate }],
  evidencePins: [{
    id: 'pin-1', checkpointId: 'checkpoint-1', field: 'certificateSha256', label: 'Certificate', value: 'a'.repeat(64),
    source: 'fixture', sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
    observedAt: candidate, createdAt: candidate,
    certificateObservation: { eventId: 'event-1', logId: 'fixture-log', certificateSha256: 'a'.repeat(64), issuer: null, notAfter: candidate, dnsNameCount: 1, namesComplete: true },
  }, {
    id: 'pin-2', field: 'tls.valid_to', label: 'TLS expiry', value: candidate, source: 'fixture', observedAt: epoch, createdAt: epoch,
  }],
  decisions: [{ id: 'decision-1', summary: 'Review', rationale: 'Fixture', evidencePinIds: ['pin-1'], createdAt: candidate }],
  actions: [{ id: 'action-1', recipient: 'Analyst', type: 'internal_review', dueAt: candidate, followUpAt: candidate, createdAt: candidate, updatedAt: candidate }],
  assertions: [{
    id: 'assertion-1', statement: 'Fixture assertion', createdAt: candidate, updatedAt: candidate,
    provenance: { origin: 'external_import', format: 'stix', sourceName: 'Fixture', sourceDigestSha256: 'b'.repeat(64), entityType: 'domain', entityValue: 'nested.invalid', observedAt: candidate, createdAt: candidate, modifiedAt: candidate },
  }],
  manualTrail: [{ id: 'trail-1', summary: 'Reviewed', createdAt: candidate }],
  sightings: [{ id: 'sighting-1', state: 'reported_by_provider', source: 'Fixture', observedAt: candidate, createdAt: candidate }],
  branches: [{ id: 'branch-1', name: 'Branch', evidencePinIds: ['pin-1'], checkpointIds: [], assertionIds: ['assertion-1'], actionIds: ['action-1'], createdAt: candidate, updatedAt: candidate }],
};
const record = normalizeCaseStore({ version, cases: [raw] }).cases[0];
const certificatePin = record?.evidencePins.find((item) => item.id === 'pin-1');
const certificateEvent = buildCaseLifecycleEvents(record ? [record] : []).find((item) => item.kind === 'certificate_expiry_review');
process.stdout.write(JSON.stringify({
  pinObservedAt: certificatePin?.observedAt,
  certificateNotAfter: certificatePin?.certificateObservation?.notAfter ?? null,
  decisionCreatedAt: record?.decisions[0]?.createdAt,
  actionDueAt: record?.actions[0]?.dueAt,
  assertionUpdatedAt: record?.assertions[0]?.updatedAt,
  provenanceObservedAt: record?.assertions[0]?.provenance?.observedAt ?? null,
  trailCreatedAt: record?.manualTrail[0]?.createdAt,
  sightingObservedAt: record?.sightings[0]?.observedAt,
  branchUpdatedAt: record?.branches[0]?.updatedAt,
  evidenceCreatedDate: record?.evidenceHistory[0]?.createdDate ?? null,
  lifecycleStartsAt: certificateEvent?.startsAt ?? null,
}));
`;

function runNestedCase(timezone: string, timestamp: string, version: number): Record<string, unknown> {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', nestedCaseProbeSource], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone, PROBE_TIMESTAMP: timestamp, PROBE_VERSION: String(version) },
  })) as Record<string, unknown>;
}

function rejectNestedCase(timezone: string, timestamp: string, version: number): string {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', nestedCaseProbeSource], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone, PROBE_TIMESTAMP: timestamp, PROBE_VERSION: String(version) },
  });
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, '');
  return child.stderr;
}

test('Case nested timestamps obey the current policy and retired schemas fail without reinterpretation', () => {
  const zoneLess = '2026-03-15T12:00:00.000';
  const current = runNestedCase('UTC', zoneLess, 13);
  assert.deepEqual(runNestedCase('Australia/Melbourne', zoneLess, 13), current);
  assert.equal(current.pinObservedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(current.certificateNotAfter, null);
  assert.equal(current.actionDueAt, null);
  assert.equal(current.provenanceObservedAt, null);
  assert.equal(current.evidenceCreatedDate, null);
  assert.equal(current.lifecycleStartsAt, null);

  for (const timezone of ['UTC', 'Australia/Melbourne']) {
    assert.match(
      rejectNestedCase(timezone, zoneLess, 11),
      /Case schema 11 is not part of the public compatibility boundary.*schema 13.*no data was changed/isu,
    );
  }

  const offset = runNestedCase('UTC', '2026-03-15T12:00:00.000+01:00', 13);
  assert.deepEqual(runNestedCase('Australia/Melbourne', '2026-03-15T12:00:00.000+01:00', 13), offset);
  assert.equal(offset.pinObservedAt, '2026-03-15T11:00:00.000Z');
  assert.equal(offset.lifecycleStartsAt, '2026-02-13T11:00:00.000Z');
});
