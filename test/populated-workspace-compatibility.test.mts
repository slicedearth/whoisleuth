import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mergeCases } from '../packages/cases/case-migration-model.mts';
import { mergeBrandProfiles } from '../packages/workspace/brand-profile-model.mts';
import { buildWorkspaceArchive, previewWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';

// Synthetic records emitted by the public v1.47.4 writer at 9cfba099b950162f3b4b3467a0d8338470bb9c70.
const FIXTURE_BYTES = readFileSync(new URL('./fixtures/workspace-populated-v5-public.json', import.meta.url));
const NOW = '2026-09-08T00:00:00.000Z';
const PASSPHRASE = 'Synthetic populated archive compatibility';

async function importedWorkspace(raw: unknown) {
  const archive = await readWorkspaceArchive(raw);
  const section = (id: string) => {
    const value = archive.sections.find((candidate) => candidate.id === id);
    assert.ok(value, id);
    assert.equal(value.status, 'ready', id);
    return value.data;
  };
  const cases = mergeCases([], section('cases')).cases;
  const brandProfiles = mergeBrandProfiles([], section('brandProfiles'), { nowIso: NOW }).profiles;
  const preview = await previewWorkspaceArchive(raw, {});
  assert.equal(preview.unsupportedCount, 0);
  const settings = preview.sections.find((candidate) => candidate.id === 'settings')?.normalizedSettings;
  assert.ok(settings);
  return { cases, brandProfiles, settings };
}

function assertRetainedRecords(workspace: Awaited<ReturnType<typeof importedWorkspace>>) {
  assert.equal(workspace.cases.length, 1);
  const record = workspace.cases[0]!;
  assert.equal(record.id, 'case-v12-response');
  assert.equal(record.domain, 'response-history.example');
  assert.equal(record.status, 'reviewing');
  assert.equal(record.disposition, 'suspicious');
  assert.deepEqual(record.brandProfileIds, ['profile-legacy-response']);
  assert.deepEqual(record.tags, ['response-review']);
  assert.equal(record.actions.length, 1);
  const action = record.actions[0]!;
  assert.equal(action.id, 'action-v12-response');
  assert.equal(action.state, 'acknowledged');
  assert.equal(action.reference, 'LEGACY-RESPONSE-42');
  assert.equal(action.followUpAt, '2026-08-08T12:00:00.000Z');
  assert.equal(action.routeObservedAt, null);
  assert.equal(action.routeReviewAfter, null);
  assert.equal(action.providerOutcome, null);
  assert.equal(action.history.length, 1);
  assert.equal(action.history[0]?.previousState, null);
  assert.equal(action.history[0]?.nextState, 'acknowledged');
  assert.equal(action.history[0]?.sourceClass, 'migration');
  assert.equal(action.history[0]?.provenance, 'case_v12_legacy_snapshot');
  assert.equal(action.history[0]?.occurredAt, '2026-08-01T12:00:00.000Z');
  assert.match(action.history[0]?.limitations.join(' ') ?? '', /pre-v13 transition history is unavailable/iu);
  assert.deepEqual(record.observedEffects.reviews, []);
  assert.equal(record.observedEffects.omitted, 0);
  assert.equal(record.observedEffects.preV13HistoryUnavailable, true);
  assert.deepEqual(record.closures.records, []);
  assert.equal(record.closures.omitted, 0);
  assert.equal(record.closures.preV13HistoryUnavailable, true);
  assert.equal(workspace.brandProfiles.length, 1);
  const profile = workspace.brandProfiles[0]!;
  assert.equal(profile.id, 'profile-legacy-response');
  assert.equal(profile.name, 'Example response review');
  assert.deepEqual(profile.officialDomains, ['official.example']);
  assert.deepEqual(profile.approvedPartnerDomains, ['partner.example']);
  assert.deepEqual(profile.allowlistedDomains, ['allowed.example']);
  assert.deepEqual(profile.dkimSelectors, ['primary']);
  assert.deepEqual(profile.retiredDkimSelectors, ['retired']);
  assert.equal(profile.trademarkOwner, 'Example Organisation');
  assert.equal(profile.trademarkRegistration, 'SYNTHETIC-REGISTRATION');
  assert.deepEqual(workspace.settings, { activeProfileId: 'profile-legacy-response', theme: 'light' });
}

test('imports a populated public v5 workspace without inventing response history or losing profile references', async () => {
  assert.equal(createHash('sha256').update(FIXTURE_BYTES).digest('hex'), '4f03ec8d7164e5c2100db9bc9ee96cd64ad63b58d452f0c3ed9c3a1622f601a0');
  const raw: unknown = JSON.parse(FIXTURE_BYTES.toString('utf8'));
  const before = structuredClone(raw);
  const parsed = await readWorkspaceArchive(raw);
  assert.equal(parsed.sourceVersion, 5);
  assert.equal(parsed.sections.find((section) => section.id === 'cases')?.version, 12);
  assert.equal(parsed.sections.find((section) => section.id === 'brandProfiles')?.version, 6);
  assertRetainedRecords(await importedWorkspace(raw));
  assert.deepEqual(raw, before);
});

test('preserves populated legacy records through current plain and encrypted archive restoration', async () => {
  const workspace = await importedWorkspace(JSON.parse(FIXTURE_BYTES.toString('utf8')));
  const current = await buildWorkspaceArchive(workspace, { generatedAt: NOW });
  assertRetainedRecords(await importedWorkspace(JSON.parse(JSON.stringify(current))));
  const encrypted = await encryptWorkspaceArchive(current, PASSPHRASE);
  assert.doesNotMatch(JSON.stringify(encrypted), /response-history\.example|Example Organisation|LEGACY-RESPONSE-42/u);
  const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
  assertRetainedRecords(await importedWorkspace(decrypted));
});

test('merges the populated legacy archive without deleting unrelated local records', async () => {
  const raw: unknown = JSON.parse(FIXTURE_BYTES.toString('utf8'));
  const imported = await importedWorkspace(raw);
  const localCase = { ...imported.cases[0]!, id: 'existing-case', domain: 'existing.example', brandProfileIds: ['existing-profile'], actions: [] };
  const localProfile = { ...imported.brandProfiles[0]!, id: 'existing-profile', name: 'Existing profile', officialDomains: ['existing.example'] };
  const local = { cases: [localCase], brandProfiles: [localProfile], settings: { activeProfileId: localProfile.id, theme: 'dark' as const } };
  const before = structuredClone(local);
  const preview = await previewWorkspaceArchive(raw, local);
  assert.equal(preview.unsupportedCount, 0);
  assert.equal(preview.sections.find((section) => section.id === 'cases')?.added, 1);
  assert.equal(preview.sections.find((section) => section.id === 'brandProfiles')?.added, 1);
  const cases = mergeCases(local.cases, preview.sections.find((section) => section.id === 'cases')?.data).cases;
  const profiles = mergeBrandProfiles(local.brandProfiles, preview.sections.find((section) => section.id === 'brandProfiles')?.data, { nowIso: NOW }).profiles;
  assert.equal(cases.length, 2);
  assert.equal(profiles.length, 2);
  assert.deepEqual(cases.find((record) => record.id === localCase.id), localCase);
  assert.deepEqual(profiles.find((profile) => profile.id === localProfile.id), localProfile);
  assert.deepEqual(local, before);
});
