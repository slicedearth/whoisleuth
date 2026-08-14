import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS,
  WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
  type EncryptedWorkspaceArchiveEnvelope,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { mergeCases } from '../frontend/src/lib/analysis/case-model.ts';
import {
  BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION,
  mergeBulkSessions,
  normalizeBulkSession,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';

const PASSPHRASE = 'correct horse archive staple';
const NOW = '2026-07-28T08:00:00.000Z';

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64'));
}

function encodeBase64url(value: ArrayBuffer): string {
  return Buffer.from(value).toString('base64url');
}

async function replaceAuthenticatedPlaintext(
  envelope: EncryptedWorkspaceArchiveEnvelope,
  value: unknown,
): Promise<EncryptedWorkspaceArchiveEnvelope> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(PASSPHRASE),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: decodeBase64url(envelope.kdf.salt),
    iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const metadata = {
    schema: envelope.schema,
    version: envelope.version,
    createdAt: envelope.createdAt,
    content: envelope.content,
    kdf: envelope.kdf,
    cipher: envelope.cipher,
  };
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: decodeBase64url(envelope.cipher.iv),
    additionalData: encoder.encode(JSON.stringify(metadata)),
    tagLength: 128,
  }, key, encoder.encode(JSON.stringify(value)));
  return { ...envelope, ciphertext: encodeBase64url(ciphertext) };
}

async function workspaceArchive() {
  return buildWorkspaceArchive({
    cases: [{
      id: 'encrypted-case',
      domain: 'encrypted.invalid',
      status: 'reviewing',
      disposition: 'unreviewed',
      brandProfileIds: ['encrypted-profile'],
      tags: [],
      notes: [],
      source: 'manual',
      evidenceHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    }],
    campaigns: [],
    brandProfiles: [],
    watchlists: {},
    shortlist: [],
    detectionRules: [],
    relationshipObservations: [],
    bulkSessions: [{
      id: 'encrypted-bulk-profile-claims',
      name: 'Encrypted profile claims',
      mode: 'deep',
      state: 'complete',
      inputDigest: `sha256:${'c'.repeat(64)}`,
      domains: ['encrypted-profile-claims.invalid'],
      results: [{
        domain: 'encrypted-profile-claims.invalid',
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
          officialAssetHosts: ['assets.encrypted-profile-claims.invalid'],
        },
        sourceCoverage: [{ source: 'rdap', state: 'complete' }],
        profileContext: {
          sourceState: 'ready',
          activeProfileId: 'encrypted-profile',
          profileUpdatedAt: NOW,
          limitation: '',
        },
      }],
      profileContext: {
        sourceState: 'ready',
        activeProfileId: 'encrypted-profile',
        profileUpdatedAt: NOW,
        limitation: '',
      },
      startedAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
    }],
    websiteSnapshots: [],
    investigationTemplates: [],
    settings: { activeProfileId: '', theme: 'system' },
  }, { generatedAt: NOW });
}

async function refreshWorkspaceSectionIntegrity(
  archive: Awaited<ReturnType<typeof workspaceArchive>>,
  id: 'bulkSessions',
): Promise<void> {
  const entry = archive.manifest.sections.find((section) => section.id === id);
  assert.ok(entry);
  const data = archive.sections[id];
  entry.bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
  entry.checksum = await sha256ArtifactDigest(data);
}

async function noActiveProfileRiskArchive() {
  const archive = structuredClone(await workspaceArchive());
  const profileContext = { sourceState: 'ready' as const, activeProfileId: null, profileUpdatedAt: null, limitation: '' };
  const session = normalizeBulkSession({
    id: 'encrypted-generic-risk',
    name: 'Encrypted generic Risk',
    mode: 'deep',
    state: 'complete',
    inputDigest: `sha256:${'d'.repeat(64)}`,
    domains: ['encrypted-generic-risk.invalid'],
    results: [{
      domain: 'encrypted-generic-risk.invalid',
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
      relationship: {
        version: 2,
        nameservers: [],
        ipAddresses: [],
        trackingIdentifiers: [],
        officialAssetHosts: [],
        faviconHash: null,
        faviconPHash: null,
        certificateFingerprint: null,
        truncated: false,
      },
      sourceCoverage: [{ source: 'rdap', state: 'complete' }],
      profileContext,
    }],
    profileContext,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  });
  assert.ok(session);
  archive.sections.bulkSessions.sessions = [session];
  await refreshWorkspaceSectionIntegrity(archive, 'bulkSessions');
  return archive;
}

describe('encrypted portable workspace archives', () => {
  test('round trips a checksummed workspace archive through authenticated encryption', async () => {
    const source = await workspaceArchive();
    const encrypted = await encryptWorkspaceArchive(source, PASSPHRASE);
    const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
    const parsed = await readWorkspaceArchive(decrypted);

    assert.equal(encrypted.schema, ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(encrypted.version, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);
    assert.deepEqual(encrypted.content, {
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: WORKSPACE_ARCHIVE_VERSION,
    });
    assert.deepEqual(encrypted.kdf, {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
      salt: encrypted.kdf.salt,
    });
    assert.deepEqual(encrypted.cipher, {
      name: 'AES-GCM',
      keyBits: 256,
      tagBits: 128,
      iv: encrypted.cipher.iv,
    });
    assert.equal(parsed.generatedAt, NOW);
    assert.equal(parsed.sections.length, 12);
    const cases = parsed.sections.find((section) => section.id === 'cases');
    const caseData = cases?.data as { cases?: Array<{ brandProfileIds?: string[] }> } | undefined;
    assert.deepEqual(caseData?.cases?.[0]?.brandProfileIds, ['encrypted-profile']);
    const bulkSessions = parsed.sections.find((section) => section.id === 'bulkSessions');
    const importedBulk = mergeBulkSessions([], bulkSessions?.data).sessions[0];
    assert.equal(importedBulk?.profileContext.limitation, BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION);
    assert.equal(importedBulk?.results[0]?.trusted, null);
    assert.equal(importedBulk?.results[0]?.risk, null);
    assert.equal(importedBulk?.results[0]?.reusesOfficialAssets, null);
    assert.deepEqual(importedBulk?.results[0]?.relationship.officialAssetHosts, []);
    assert.equal(JSON.stringify(encrypted).includes(PASSPHRASE), false);
    assert.equal(JSON.stringify(encrypted).includes(WORKSPACE_ARCHIVE_SCHEMA), true);
  });

  test('retains legitimate no-profile Risk while encrypted and quarantines it after import', async () => {
    const encrypted = await encryptWorkspaceArchive(await noActiveProfileRiskArchive(), PASSPHRASE);
    const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
    const parsed = await readWorkspaceArchive(decrypted);
    const bulkSection = parsed.sections.find((section) => section.id === 'bulkSessions');
    const section = bulkSection?.data as { sessions?: Array<{ results?: Array<{ risk?: unknown; riskModelVersion?: unknown; riskFactors?: unknown }> }> } | undefined;
    const stored = section?.sessions?.[0]?.results?.[0];
    assert.equal(stored?.risk, 44);
    assert.equal(stored?.riskModelVersion, 7);
    assert.deepEqual(stored?.riskFactors, [{ label: 'Generic observed context', points: 44 }]);

    const imported = mergeBulkSessions([], bulkSection?.data).sessions[0]?.results[0];
    assert.equal(imported?.risk, null);
    assert.equal(imported?.riskModelVersion, null);
    assert.deepEqual(imported?.riskFactors, []);
  });

  test('rejects every malformed v4 Bulk result set after authenticated workspace decryption', async () => {
    const attacks: Array<{ label: string; mutate: (session: Record<string, unknown>) => void }> = [
      {
        label: 'missing row context',
        mutate: (session) => Reflect.deleteProperty((session.results as Array<Record<string, unknown>>)[0]!, 'profileContext'),
      },
      {
        label: 'malformed row context',
        mutate: (session) => {
          (session.results as Array<Record<string, unknown>>)[0]!.profileContext = {
            sourceState: 'ready', activeProfileId: null, profileUpdatedAt: NOW, limitation: '',
          };
        },
      },
      { label: 'missing session context', mutate: (session) => Reflect.deleteProperty(session, 'profileContext') },
      {
        label: 'duplicate result',
        mutate: (session) => {
          const rows = session.results as unknown[];
          rows.push(structuredClone(rows[0]!));
        },
      },
      {
        label: 'out-of-domain result',
        mutate: (session) => { (session.results as Array<Record<string, unknown>>)[0]!.domain = 'outside.invalid'; },
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
      const archive = await noActiveProfileRiskArchive();
      const session = archive.sections.bulkSessions.sessions[0] as unknown as Record<string, unknown>;
      assert.ok(session);
      attack.mutate(session);
      await refreshWorkspaceSectionIntegrity(archive, 'bulkSessions');
      const decrypted = await decryptWorkspaceArchive(
        await encryptWorkspaceArchive(archive, PASSPHRASE),
        PASSPHRASE,
      );
      const parsed = await readWorkspaceArchive(decrypted);
      const bulkSection = parsed.sections.find((section) => section.id === 'bulkSessions');
      const merged = mergeBulkSessions([], bulkSection?.data);
      assert.deepEqual(
        { sessions: merged.sessions, added: merged.added, skipped: merged.skipped },
        { sessions: [], added: 0, skipped: 1 },
        attack.label,
      );
    }

    for (const state of ['partial', 'cancelled'] as const) {
      const archive = await noActiveProfileRiskArchive();
      const session = archive.sections.bulkSessions.sessions[0] as unknown as Record<string, unknown>;
      session.state = state;
      session.completedAt = null;
      (session.domains as string[]).push('pending.invalid');
      await refreshWorkspaceSectionIntegrity(archive, 'bulkSessions');
      const decrypted = await decryptWorkspaceArchive(
        await encryptWorkspaceArchive(archive, PASSPHRASE),
        PASSPHRASE,
      );
      const parsed = await readWorkspaceArchive(decrypted);
      const bulkSection = parsed.sections.find((section) => section.id === 'bulkSessions');
      const merged = mergeBulkSessions([], bulkSection?.data);
      assert.deepEqual(
        { added: merged.added, skipped: merged.skipped },
        { added: 1, skipped: 0 },
        `valid encrypted ${state} subset`,
      );
    }
  });

  test('uses fresh salt and initialization-vector values for each export', async () => {
    const source = await workspaceArchive();
    const first = await encryptWorkspaceArchive(source, PASSPHRASE);
    const second = await encryptWorkspaceArchive(source, PASSPHRASE);

    assert.notEqual(first.kdf.salt, second.kdf.salt);
    assert.notEqual(first.cipher.iv, second.cipher.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });

  test('preserves every readable legacy content version when locking an archive', async () => {
    for (const version of [1, 2, 3]) {
      const legacy = structuredClone(await workspaceArchive());
      Reflect.set(legacy, 'version', version);
      const encrypted = await encryptWorkspaceArchive(legacy, PASSPHRASE);

      assert.equal(encrypted.content.version, version);
      const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
      const parsed = await readWorkspaceArchive(decrypted);
      assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    }
  });

  test('reports one generic failure for a wrong passphrase or authenticated-data tampering', async () => {
    const encrypted = await encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE);
    await assert.rejects(
      decryptWorkspaceArchive(encrypted, 'different archive passphrase'),
      /passphrase is incorrect or the encrypted file is corrupted/,
    );

    const tampered = structuredClone(encrypted);
    tampered.createdAt = '2026-07-28T08:01:00.000Z';
    await assert.rejects(
      decryptWorkspaceArchive(tampered, PASSPHRASE),
      /passphrase is incorrect or the encrypted file is corrupted/,
    );
  });

  test('validates the fixed envelope before performing password work', async () => {
    const encrypted = await encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE);
    assert.equal(isEncryptedWorkspaceArchive(encrypted), true);
    assert.equal(isEncryptedWorkspaceArchive({ schema: WORKSPACE_ARCHIVE_SCHEMA }), false);
    const inspection = inspectEncryptedWorkspaceArchive(encrypted);
    assert.equal(inspection.createdAt, encrypted.createdAt);
    assert.ok(inspection.ciphertextBytes > 16);
    assert.ok(JSON.stringify(encrypted).length < MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);

    const future = { ...encrypted, version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION + 1 };
    assert.throws(() => inspectEncryptedWorkspaceArchive(future), /newer schema 2/);

    const unknownField = { ...encrypted, unexpected: true };
    assert.throws(() => inspectEncryptedWorkspaceArchive(unknownField), /envelope is malformed/);

    const weakKdf = structuredClone(encrypted);
    Reflect.set(weakKdf.kdf, 'iterations', 1);
    assert.throws(() => inspectEncryptedWorkspaceArchive(weakKdf), /unsupported key-derivation contract/);

    const oversized = structuredClone(encrypted);
    oversized.ciphertext = 'A'.repeat(MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
    assert.throws(() => inspectEncryptedWorkspaceArchive(oversized), /ciphertext exceeds its byte limit/);
  });

  test('bounds passphrases before encryption or decryption', async () => {
    const source = await workspaceArchive();
    await assert.rejects(
      encryptWorkspaceArchive(source, 'x'.repeat(MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS - 1)),
      /at least 12 characters/,
    );
    await assert.rejects(
      encryptWorkspaceArchive(source, '界'.repeat(400)),
      /limited to 1024 UTF-8 bytes/,
    );
    const encrypted = await encryptWorkspaceArchive(source, PASSPHRASE);
    await assert.rejects(
      decryptWorkspaceArchive(encrypted, 'too short'),
      /at least 12 characters/,
    );
  });

  test('fails explicitly when browser cryptography is unavailable', async () => {
    await assert.rejects(
      encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE, {} as Crypto),
      /unavailable in this browser/,
    );
  });

  test('refuses to encrypt a document that is not a valid ordinary workspace archive', async () => {
    await assert.rejects(
      encryptWorkspaceArchive({
        schema: WORKSPACE_ARCHIVE_SCHEMA,
        version: WORKSPACE_ARCHIVE_VERSION,
        generatedAt: NOW,
      }, PASSPHRASE),
      /envelope contains missing or undeclared fields/,
    );
  });

  test('rejects undeclared authenticated plaintext after decryption', async () => {
    const archive = await workspaceArchive();
    Reflect.set(archive, 'rawWhoisPayload', { credential: 'private material' });
    const validEnvelope = await encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE);
    const encryptedAttack = await replaceAuthenticatedPlaintext(validEnvelope, archive);
    const decrypted = await decryptWorkspaceArchive(encryptedAttack, PASSPHRASE);
    await assert.rejects(readWorkspaceArchive(decrypted), /envelope contains missing or undeclared fields/iu);
  });

  test('keeps encrypted schema-11 Case evidence readable while stripping current-only profile provenance', async () => {
    const archive = structuredClone(await workspaceArchive());
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
    Reflect.set(archive.sections.cases, 'version', 11);
    const entry = archive.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(entry);
    entry.version = 11;
    entry.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.cases)).byteLength;
    entry.checksum = await sha256ArtifactDigest(archive.sections.cases);

    const decrypted = await decryptWorkspaceArchive(
      await encryptWorkspaceArchive(archive, PASSPHRASE),
      PASSPHRASE,
    );
    const parsed = await readWorkspaceArchive(decrypted);
    const cases = parsed.sections.find((section) => section.id === 'cases');
    const merged = mergeCases([], cases?.data);
    assert.equal(merged.cases[0]?.evidenceHistory[0]?.profileContextState, null);
    assert.equal(merged.cases[0]?.evidenceHistory[0]?.profileContextLimitation, null);
  });

  test('preserves a healthy local profile for malformed encrypted Settings and honors an exact encrypted clear', async () => {
    const local = {
      brandProfiles: [{
        id: 'local-profile',
        name: 'Local retained profile',
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
      }],
      settings: { activeProfileId: 'local-profile', theme: 'system' },
    };
    for (const importedActiveProfileId of [' malformed-profile', ''] as const) {
      const archive = structuredClone(await workspaceArchive());
      archive.sections.settings.activeProfileId = importedActiveProfileId;
      const entry = archive.manifest.sections.find((section) => section.id === 'settings');
      assert.ok(entry);
      entry.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.settings)).byteLength;
      entry.checksum = await sha256ArtifactDigest(archive.sections.settings);
      const decrypted = await decryptWorkspaceArchive(
        await encryptWorkspaceArchive(archive, PASSPHRASE),
        PASSPHRASE,
      );
      const preview = await previewWorkspaceArchive(decrypted, local, { selectedSectionIds: ['settings'] });
      const settings = preview.sections.find((section) => section.id === 'settings');
      if (importedActiveProfileId) {
        assert.equal(settings?.skipped, 1);
        assert.equal(settings?.updated, 0);
        assert.equal(settings?.normalizedSettings?.activeProfileId, 'local-profile');
        assert.match(settings?.reason ?? '', /missing or malformed.*preserved/iu);
      } else {
        assert.equal(settings?.skipped, 0);
        assert.equal(settings?.updated, 1);
        assert.equal(settings?.normalizedSettings?.activeProfileId, '');
      }
    }
  });
});
