import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { TECHNOLOGY_PROFILE_VERSION, WEBSITE_SECURITY_POSTURE_VERSION } from '../lib/lookup-child-profile-contract.mts';
import { createPageBaseline } from '../packages/workspace/page-baseline.mts';
import { mergeBrandProfiles, normalizeBrandProfileStore, serializeBrandProfileStore } from '../packages/workspace/brand-profile-model.mts';
import { normalizeWebsiteSnapshotStore, serializeWebsiteSnapshotStore } from '../packages/workspace/website-snapshot-model.mts';
import { buildLookupWebsiteSnapshot } from '../frontend/src/lib/analysis/lookup-snapshot-input.ts';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { encryptWorkspaceArchive, decryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-09-08T00:00:00.000Z';
const bytes = readFileSync(new URL('./fixtures/workspace-html-baseline-v8-public.json', import.meta.url));
const publicArchive = JSON.parse(bytes.toString('utf8'));

test('preserves the exact public page baseline through current profile and archive writers', async () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'dbec1a6b6fbe86d575509330ea791cfffbb97b519939030de44c100c38247de4');
  assert.equal(publicArchive.sections.brandProfiles.version, 8);
  assert.equal(publicArchive.sections.websiteSnapshots.version, 5);
  const parsed = await readWorkspaceArchive(publicArchive);
  assert.equal(parsed.sections.filter((section) => ['brandProfiles', 'websiteSnapshots'].includes(section.id)).every((section) => section.status === 'ready'), true);
  const profiles = mergeBrandProfiles([], publicArchive.sections.brandProfiles, { nowIso: NOW }).profiles;
  assert.deepEqual(profiles[0]?.pageBaseline, publicArchive.sections.brandProfiles.profiles[0].pageBaseline);
  assert.equal(normalizeBrandProfileStore(JSON.parse(serializeBrandProfileStore(profiles))).profiles[0]?.pageBaseline?.fingerprintVersion, 1);
  const snapshots = normalizeWebsiteSnapshotStore(publicArchive.sections.websiteSnapshots).snapshots;
  assert.equal(snapshots[0]?.profileProvenance.pageFingerprint.version, 1);
  assert.deepEqual(snapshots[0]?.identity, publicArchive.sections.websiteSnapshots.snapshots[0].identity);
  const rebuilt = await buildWorkspaceArchive({ brandProfiles: profiles, websiteSnapshots: snapshots }, { generatedAt: NOW });
  assert.equal(rebuilt.sections.brandProfiles.version, 9);
  assert.equal(rebuilt.sections.websiteSnapshots.version, 6);
  const passphrase = 'Synthetic archive round trip only';
  const decrypted = await decryptWorkspaceArchive(await encryptWorkspaceArchive(rebuilt, passphrase), passphrase);
  const restored = await readWorkspaceArchive(decrypted);
  const restoredProfiles = mergeBrandProfiles([], restored.sections.find((section) => section.id === 'brandProfiles')?.data, { nowIso: NOW }).profiles;
  assert.deepEqual(restoredProfiles[0]?.pageBaseline, profiles[0]?.pageBaseline);
  const restoredSnapshots = normalizeWebsiteSnapshotStore(restored.sections.find((section) => section.id === 'websiteSnapshots')?.data).snapshots;
  assert.deepEqual(restoredSnapshots, snapshots);
});

test('current native fingerprints survive the whole retained-data boundary', async () => {
  const domain = 'current.example';
  const signals = extractHtmlSignals('<main><h1>Account centre</h1><form><input type=password></form></main>', domain, { observedAt: NOW });
  const baseline = requiredValue(createPageBaseline(domain, { domain, ...signals }));
  assert.equal(baseline.fingerprintVersion, 2);
  assert.equal(baseline.domStructure.parser, 'html-tree-v2');
  const profiles = normalizeBrandProfileStore([{
    id: 'current-profile', name: 'Current profile', officialDomains: [domain], pageBaseline: baseline,
    createdAt: NOW, updatedAt: NOW, rawHtml: '<p>Private raw content</p>',
  }]).profiles;
  const snapshot = buildLookupWebsiteSnapshot({
    id: 'current-snapshot', domain, observedAt: NOW, savedAt: NOW, lookupEvidenceDepth: 'deep',
    baseline, pageIdentity: signals.pageIdentity ?? {}, technologyProfile: { profileVersion: TECHNOLOGY_PROFILE_VERSION, complete: true },
    securityPosture: { postureVersion: WEBSITE_SECURITY_POSTURE_VERSION, complete: true }, tlsEvidence: {}, technologyFindings: [], securityPostureFindings: [], diagnostics: {},
  });
  const snapshots = normalizeWebsiteSnapshotStore([snapshot]).snapshots;
  assert.equal(snapshots[0]?.profileProvenance.pageFingerprint.version, 2);
  assert.equal(snapshots[0]?.profileProvenance.technology.version, 12);
  assert.equal(snapshots[0]?.profileProvenance.securityPosture.version, 3);
  assert.deepEqual(normalizeWebsiteSnapshotStore(JSON.parse(serializeWebsiteSnapshotStore(snapshots))).snapshots, snapshots);
  assert.deepEqual(normalizeBrandProfileStore(JSON.parse(serializeBrandProfileStore(profiles))).profiles, profiles);
  const archive = await buildWorkspaceArchive({ brandProfiles: profiles, websiteSnapshots: snapshots }, { generatedAt: NOW });
  const passphrase = 'Synthetic current archive round trip';
  const restored = await readWorkspaceArchive(await decryptWorkspaceArchive(await encryptWorkspaceArchive(archive, passphrase), passphrase));
  assert.equal(restored.sections.find((section) => section.id === 'brandProfiles')?.status, 'ready');
  const importedProfiles = mergeBrandProfiles([], restored.sections.find((section) => section.id === 'brandProfiles')?.data, { nowIso: NOW }).profiles;
  assert.deepEqual(importedProfiles[0]?.pageBaseline, baseline);
  assert.equal(normalizeWebsiteSnapshotStore(restored.sections.find((section) => section.id === 'websiteSnapshots')?.data).snapshots[0]?.profileProvenance.pageFingerprint.version, 2);
  assert.doesNotMatch(JSON.stringify(archive), /Private raw content|<main>|<input/u);
});
