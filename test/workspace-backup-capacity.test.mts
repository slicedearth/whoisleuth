import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { BROWSER_LOCAL_COLLECTION_MANIFEST } from '../packages/contracts/browser-local-collection-manifest.mts';
import { MAX_WORKSPACE_ARCHIVE_BYTES, MAX_WORKSPACE_ARCHIVE_SECTION_BYTES } from '../packages/contracts/case-portability.mts';
import { MAX_DOMAIN_CONTROL_MANIFEST_BYTES } from '../packages/contracts/domain-control-manifest.mts';
import { buildWorkspaceArchive, prepareWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive, MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES } from '../packages/workspace/workspace-archive-crypto.mts';
import { mergeCases } from '../packages/cases/case-model.mts';
import { mergeBrandProfiles } from '../packages/workspace/brand-profile-model.mts';
import { mergeBulkSessions } from '../packages/workspace/bulk-session-model.mts';
import { inspectWorkspaceArchive } from '../cli/archive-inspect.mts';
import { MAX_OFFLINE_ARTIFACT_BYTES, verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { combinedWorkspaceAtCapacity } from './workspace-backup-capacity-fixture.mts';

const NOW = '2026-09-09T00:00:00.000Z';

test('archive intake covers the archived collection budgets and encrypted representation', () => {
  const archived = BROWSER_LOCAL_COLLECTION_MANIFEST.filter((collection) => collection.id !== 'ct_history');
  assert.ok(archived.reduce((sum, collection) => sum + collection.maximumBytes, 0) < MAX_WORKSPACE_ARCHIVE_BYTES);
  assert.ok(archived.every((collection) => collection.maximumBytes < MAX_WORKSPACE_ARCHIVE_SECTION_BYTES));
  assert.ok(MAX_OFFLINE_ARTIFACT_BYTES >= MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
});

test('full Case, Bulk and Profile stores survive combined plain and encrypted backup', async (t) => {
  const source = combinedWorkspaceAtCapacity();
  const archive = await buildWorkspaceArchive(source, { generatedAt: NOW });
  const raw = JSON.stringify(archive);
  const plainBytes = Buffer.byteLength(raw);
  assert.ok(plainBytes > 12 * 1024 * 1024 && plainBytes < MAX_WORKSPACE_ARCHIVE_BYTES);
  assert.ok(archive.manifest.sections.every((section) => section.bytes <= MAX_WORKSPACE_ARCHIVE_SECTION_BYTES));
  const prepared = await prepareWorkspaceArchive(archive);
  const preview = prepared.preview({});
  assert.ok(preview.sections.every((section) => section.status === 'ready'));
  const cases = preview.sections.find((section) => section.id === 'cases')!;
  const profiles = preview.sections.find((section) => section.id === 'brandProfiles')!;
  const bulk = preview.sections.find((section) => section.id === 'bulkSessions')!;
  assert.equal(cases.added, 500);
  assert.equal(profiles.added, 100);
  assert.equal(bulk.added, 1);
  const restoredCases = mergeCases([], cases.data);
  const restoredProfiles = mergeBrandProfiles([], profiles.data, { nowIso: NOW });
  const restoredBulk = mergeBulkSessions([], bulk.data);
  assert.equal(restoredCases.skipped, 0);
  assert.equal(restoredProfiles.skipped, 0);
  assert.equal(restoredBulk.skipped, 0);
  assert.ok(isDeepStrictEqual(restoredCases.cases, source.cases), 'Case fields and all notes survive the combined backup.');
  assert.ok(isDeepStrictEqual(restoredProfiles.profiles, source.brandProfiles), 'All Profile fields survive the combined backup.');
  assert.equal(restoredBulk.sessions[0]?.results.length, 2_000);
  assert.ok(isDeepStrictEqual(restoredBulk.sessions[0]?.domains, source.bulkSessions[0]?.domains), 'Every admitted Bulk target is restored.');
  assert.ok(isDeepStrictEqual(
    restoredBulk.sessions[0]!.results.map(({ profileContext: _context, ...row }) => row),
    source.bulkSessions[0]!.results.map(({ profileContext: _context, ...row }) => ({ ...row, hasActiveBrandProfile: null })),
  ), 'All Bulk row fields survive except the independently quarantined local-profile claim.');
  assert.ok(restoredBulk.sessions[0]!.results.every((row) => row.profileContext.sourceState === 'unavailable'));
  const passphrase = 'synthetic combined workspace capacity phrase';
  const envelope = await encryptWorkspaceArchive(archive, passphrase);
  const encrypted = JSON.stringify(envelope);
  assert.ok(Buffer.byteLength(encrypted) > MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
  assert.ok(Buffer.byteLength(encrypted) < MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
  assert.ok(isDeepStrictEqual(await decryptWorkspaceArchive(envelope, passphrase), archive), 'Authenticated decoding retains the full archive.');
  for (const [input, options] of [[raw, {}], [encrypted, { passphrase }]] as const) {
    const inspection = await inspectWorkspaceArchive(input, options);
    assert.equal(inspection.summary.sectionCount, archive.manifest.sectionCount);
    assert.equal(inspection.sections.find((section) => section.id === 'cases')?.recordCount, 500);
    const verified = await verifyOfflineArtifact(input, options);
    assert.equal(verified.checks.structure, 'verified');
    assert.equal(verified.checks.contentIntegrity, 'verified');
  }
  t.diagnostic(JSON.stringify({ plainBytes, prettyBytes: Buffer.byteLength(JSON.stringify(archive, null, 2)), encryptedBytes: Buffer.byteLength(encrypted), sectionBytes: archive.manifest.sections.map(({ id, bytes }) => ({ id, bytes })) }));
});

test('larger archive intake does not increase the non-workspace artefact limit', async () => {
  const raw = JSON.stringify({ schema: 'unknown', text: 'x'.repeat(MAX_DOMAIN_CONTROL_MANIFEST_BYTES) });
  assert.ok(Buffer.byteLength(raw) < MAX_OFFLINE_ARTIFACT_BYTES);
  await assert.rejects(verifyOfflineArtifact(raw), /Non-workspace artefacts are limited/u);
});
