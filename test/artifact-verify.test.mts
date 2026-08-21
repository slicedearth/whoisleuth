import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  formatOfflineArtifactVerification,
  verifyOfflineArtifact,
} from '../cli/artifact-verify.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  buildWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import {
  encryptWorkspaceArchive,
  WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
  type EncryptedWorkspaceArchiveEnvelope,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  sha256ArtifactDigest,
  sha256ArtifactDigestV2,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { buildInvestigationCapsule } from '../frontend/src/lib/analysis/investigation-capsule.ts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  buildCaseResponsePacket,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  MAX_RESPONSE_ACTION_HISTORY,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import { buildCliCasePack } from '../cli/case-pack.mts';
import { buildCliEvidenceExport } from '../cli/export-evidence.mts';
import * as lookupEvidenceModule from '../lib/evidence-export.mts';
import { buildRegistryInsights } from '../lib/registry-insights.mts';
import { CASE_SCHEMA_VERSION, createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  appendCaseAction,
  appendCaseActionTransition,
  MAX_CASE_ACTIONS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import { buildDomainControlManifest, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA } from '../lib/domain-control-manifest.mts';
import { historicalCasePackFixture } from './historical-case-pack-fixtures.mts';
import { historicalCaseResponsePacketFixture } from './case-response-packet-fixtures.mts';
import { loadLookupEvidenceV25CompatibilityFixtures } from './lookup-evidence-v25-fixtures.mts';
import { loadLookupEvidenceV26Fixture } from './lookup-evidence-v26-fixture.mts';
import { loadCliLookupV1Fixture } from './cli-lookup-v1-fixture.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

const PASSPHRASE = 'fixture archive passphrase';
const LOOKUP_EVIDENCE_V25_FIXTURE_SHA256 = '4ad2d13417fbfe24f9dff51d5baf77ca82a0f7c1a68c76e4c7bbdea18d055fcd';

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

async function replaceAuthenticatedWorkspacePlaintext(
  envelope: EncryptedWorkspaceArchiveEnvelope,
  value: unknown,
): Promise<EncryptedWorkspaceArchiveEnvelope> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', encoder.encode(PASSPHRASE), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'PBKDF2', hash: 'SHA-256', salt: decodeBase64url(envelope.kdf.salt), iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
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
    name: 'AES-GCM', iv: decodeBase64url(envelope.cipher.iv), additionalData: encoder.encode(JSON.stringify(metadata)), tagLength: 128,
  }, key, encoder.encode(JSON.stringify(value)));
  return { ...envelope, ciphertext: Buffer.from(ciphertext).toString('base64url') };
}

async function resignArtifact<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity: _integrity, ...unsigned } = value;
  const packetVersion = (value.packet as Record<string, unknown> | undefined)?.version;
  const casePack = packetVersion !== undefined;
  const current = packetVersion === undefined ? Number(value.version) > 1 : packetVersion === 2;
  const canonicalization = current ? 'sorted-json-v2' : casePack ? 'sorted-json-v1' : undefined;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      ...(canonicalization === undefined ? {} : { canonicalization }),
      digestSha256: await (current ? sha256ArtifactDigestV2(unsigned) : sha256ArtifactDigest(unsigned)),
    },
  } as unknown as T;
}

async function resignCaseResponsePacket<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity: _integrity, ...unsigned } = value;
  const current = Number(value.schemaVersion) >= 6;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: current ? 'sorted-json-v2' : 'sorted-json-v1',
      scope: 'packet excluding integrity',
      digestSha256: (await (current ? sha256ArtifactDigestV2(unsigned) : sha256ArtifactDigest(unsigned))).slice('sha256:'.length),
    },
  } as unknown as T;
}

async function rebindCaseResponseReview<T extends Record<string, unknown>>(value: T): Promise<T> {
  const profile = value.profile as Record<string, unknown>;
  const reviewMaterial = {
    contract: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    profile: {
      id: profile.id,
      label: profile.label,
      audience: profile.audience,
      subject: profile.subject,
      checklist: profile.checklist,
      includedEvidence: profile.includedEvidence,
      excludedEvidence: profile.excludedEvidence,
      redactions: profile.redactions,
    },
    case: value.case,
    incident: value.incident,
    contacts: value.contacts,
    selectedEvidence: value.selectedEvidence,
    contradictions: value.contradictions,
    readiness: value.readiness,
    artefactReferences: value.artefactReferences,
    escalationHistory: value.escalationHistory,
    escalationHistoryOmitted: value.escalationHistoryOmitted,
    escalationHistoryLimitations: value.escalationHistoryLimitations,
    responseLifecycle: value.responseLifecycle,
  };
  const authorisation = value.authorisation as Record<string, unknown>;
  authorisation.reviewedInputDigestSha256 = (await sha256ArtifactDigestV2(reviewMaterial)).slice('sha256:'.length);
  return value;
}

function lookupEvidenceArtifact(): Record<string, unknown> {
  const lookup = {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: '2026-07-15T00:00:00.000Z',
    mode: 'fast',
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    isSubdomain: false,
    diagnostics: {
      version: 7,
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
    rdap: {
      upstreamStatus: 200,
      rdapServer: 'https://rdap.example.test/domain/example.test',
      transportSecurity: 'https',
      fetchedAt: '2026-07-15T00:00:00.000Z',
      attempts: [],
      parsed: { domain: 'EXAMPLE.TEST' },
      data: { objectClassName: 'domain' },
    },
    availability: { applicable: true, state: 'registered', confidence: 'high' },
  };
  return buildCliEvidenceExport(
    JSON.stringify(lookup),
    lookupEvidenceModule,
    '2026-07-15T01:00:00.000Z',
  );
}

describe('offline artifact verifier', () => {
  test('validates workspace manifests and section checksums without printing contents', async () => {
    const archive = await buildWorkspaceArchive({
      cases: {
        version: 1,
        cases: [],
      },
    }, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const report = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(report.artifact.kind, 'workspace_archive');
    assert.equal(report.state, 'verified');
    assert.equal(report.checks.contentIntegrity, 'verified');
    assert.ok((report.summary.sectionCount ?? 0) > 0);
    assert.equal(report.summary.unsupportedSectionCount, 0);
    const terminal = formatOfflineArtifactVerification(report);
    assert.doesNotMatch(terminal, /fixture archive passphrase/u);
    assert.doesNotMatch(terminal, /"cases"/u);
  });

  test('reports integrity-valid archive sections that this version cannot import', async () => {
    const archive = structuredClone(await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    }));
    const cases = archive.manifest.sections.find((section) => section.id === 'cases');
    assert.ok(cases);
    Reflect.set(archive.sections.cases, 'version', 999);
    cases.version = 999;
    cases.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.cases)).byteLength;
    cases.checksum = await sha256ArtifactDigest(archive.sections.cases);
    const report = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(report.state, 'verified');
    assert.equal(report.summary.unsupportedSectionCount, 1);
    assert.match(report.limitations.join(' '), /cannot be imported/iu);
  });

  test('keeps integrity valid while reporting malformed ordinary and encrypted workspace records as partially importable', async () => {
    const archive = structuredClone(await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    }));
    const profiles = archive.manifest.sections.find((section) => section.id === 'brandProfiles');
    assert.ok(profiles);
    Reflect.set(archive.sections.brandProfiles, 'profiles', [{ secret: 'must-not-appear' }]);
    profiles.recordCount = 1;
    archive.manifest.totalRecords += 1;
    profiles.bytes = new TextEncoder().encode(JSON.stringify(archive.sections.brandProfiles)).byteLength;
    profiles.checksum = await sha256ArtifactDigest(archive.sections.brandProfiles);

    const ordinary = await verifyOfflineArtifact(JSON.stringify(archive));
    assert.equal(ordinary.state, 'verified');
    assert.equal(ordinary.summary.fullyImportable, false);
    assert.equal(ordinary.summary.skippedRecordCount, 1);
    assert.equal(ordinary.summary.unsupportedSectionCount, 0);
    assert.doesNotMatch(JSON.stringify(ordinary), /must-not-appear/iu);

    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    const decrypted = await verifyOfflineArtifact(JSON.stringify(encrypted), { passphrase: PASSPHRASE });
    assert.equal(decrypted.state, 'verified');
    assert.equal(decrypted.summary.fullyImportable, false);
    assert.equal(decrypted.summary.skippedRecordCount, 1);
    assert.doesNotMatch(JSON.stringify(decrypted), /must-not-appear|fixture archive passphrase/iu);
  });

  test('withholds workspace integrity and importability claims for undeclared ordinary or authenticated data', async () => {
    const archive = await buildWorkspaceArchive({}, { generatedAt: '2026-07-15T00:00:00.000Z' });
    Reflect.set(archive, 'uncheckedPolicy', { rawWhoisPayload: 'private material', credential: 'private material' });
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(archive)),
      /envelope contains missing or undeclared fields/iu,
    );

    const valid = await buildWorkspaceArchive({}, { generatedAt: '2026-07-15T00:00:00.000Z' });
    const envelope = await encryptWorkspaceArchive(valid, PASSPHRASE);
    const encryptedAttack = await replaceAuthenticatedWorkspacePlaintext(envelope, archive);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(encryptedAttack), { passphrase: PASSPHRASE }),
      /envelope contains missing or undeclared fields/iu,
    );
  });

  test('distinguishes structural envelope inspection from authenticated decryption', async () => {
    const archive = await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    const raw = JSON.stringify(encrypted);

    const inspected = await verifyOfflineArtifact(raw);
    assert.equal(inspected.state, 'envelope_valid');
    assert.equal(inspected.checks.contentIntegrity, 'not_checked');
    assert.equal(inspected.checks.authenticatedEncryption, 'not_checked');

    const verified = await verifyOfflineArtifact(raw, { passphrase: PASSPHRASE });
    assert.equal(verified.state, 'verified');
    assert.equal(verified.checks.contentIntegrity, 'verified');
    assert.equal(verified.checks.authenticatedEncryption, 'verified');
    await assert.rejects(
      verifyOfflineArtifact(raw, { passphrase: 'incorrect fixture passphrase' }),
      /incorrect or .* corrupted/iu,
    );
  });

  test('validates known signed review manifests and rejects changes', async () => {
    const artifact = (await buildBulkReviewManifest({
      rows: [], reviewStates: [], lookupProfile: 'fast',
      generatedAt: '2026-07-15T00:00:00.000Z', observedAt: '2026-07-15T00:00:00.000Z',
      view: {
        primaryFilter: 'all', mutationFilter: '', signalFilters: [], sourceFilter: '', lifecycleFilter: '',
        ageFilter: '', mailFilter: '', registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '',
        groupBy: '', sortKey: 'risk', sortDirection: -1,
      },
    })).document;
    const report = await verifyOfflineArtifact(JSON.stringify(artifact));
    assert.equal(report.artifact.kind, 'signed_review_artifact');
    assert.equal(report.checks.contentIntegrity, 'verified');

    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ ...artifact, generatedAt: '2026-07-16T00:00:00.000Z' })),
      /failed its SHA-256/iu,
    );

    const mismatchedCount = structuredClone(artifact) as unknown as Record<string, unknown>;
    (mismatchedCount.selection as Record<string, unknown>).count = 1;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await resignArtifact(mismatchedCount))),
      /selection.*malformed structure/iu,
    );
    const extraField = structuredClone(artifact) as unknown as Record<string, unknown>;
    (extraField.selection as Record<string, unknown>).extra = true;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await resignArtifact(extraField))),
      /selection.*malformed structure/iu,
    );

    const contentFree = {
      schema: 'whoisleuth.bulk-review-manifest', version: 1,
      integrity: { algorithm: 'SHA-256', digestSha256: await sha256ArtifactDigest({ schema: 'whoisleuth.bulk-review-manifest', version: 1 }) },
    };
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(contentFree)), /malformed structure/iu);
  });

  test('verifies a reviewed CLI case pack before browser import', async () => {
    const cases = normalizeCaseStore({
      version: CASE_SCHEMA_VERSION,
      cases: [{
        id: 'portable-case', domain: 'portable.invalid', status: 'new', disposition: 'unreviewed',
        brandProfileIds: [],
        tags: [], notes: [], source: 'lookup', evidenceHistory: [],
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }],
    });
    const pack = buildCliCasePack(JSON.stringify(cases), {
      audience: 'trusted',
      reviewed: true,
    }, '2026-07-15T01:00:00.000Z');
    const report = await verifyOfflineArtifact(JSON.stringify(pack));
    assert.equal(report.artifact.kind, 'cli_case_pack');
    assert.equal(report.artifact.schema, 'whoisleuth.cli.case-pack');
    assert.equal(report.summary.recordCount, 1);
    assert.equal(report.checks.contentIntegrity, 'verified');

    const changed = structuredClone(pack);
    changed.cases[0]!.status = 'closed';
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /would be repaired|failed its SHA-256/iu);
  });

  test('inherits strict nested Brand Profile reference checks for recomputed CLI case packs', async () => {
    const source = normalizeCaseStore({
      version: CASE_SCHEMA_VERSION,
      cases: [{
        id: 'strict-portable-case', domain: 'strict-portable.invalid', status: 'new', disposition: 'unreviewed',
        brandProfileIds: [], tags: [], notes: [], source: 'lookup', evidenceHistory: [],
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }],
    });
    const pack = structuredClone(buildCliCasePack(JSON.stringify(source), {
      audience: 'public',
      reviewed: true,
    }, '2026-07-15T01:00:00.000Z')) as unknown as Record<string, unknown>;
    (pack.packet as Record<string, unknown>).unexpected = { brandProfileIds: ['hidden-reference'] };
    const recomputed = await resignArtifact(pack);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(recomputed)),
      /unexpected packet envelope field/iu,
    );
  });

  test('inherits authentic historical Case identities and strict report projection across every audience', async () => {
    for (const audience of ['public', 'trusted', 'internal'] as const) {
      const authentic = historicalCasePackFixture(11, audience);
      const verified = await verifyOfflineArtifact(JSON.stringify(authentic));
      assert.equal(verified.state, 'verified', audience);
      assert.equal(verified.summary.recordCount, 1, audience);

      for (const field of ['id', 'fingerprint'] as const) {
        const changed = structuredClone(authentic);
        const item = (changed.cases as Array<Record<string, unknown>>)[0]!;
        const snapshot = (item.evidenceHistory as Array<Record<string, unknown>>)[0]!;
        snapshot[field] = field === 'id' ? 'ev-forged' : 'forged';
        await assert.rejects(
          verifyOfflineArtifact(JSON.stringify(await resignArtifact(changed))),
          /invalid historical evidence identity|changed or unbounded historical evidenceHistory/iu,
        );
      }

      const scalar = structuredClone(authentic);
      const report = (((scalar.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
      report.application = 'private material';
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(await resignArtifact(scalar))),
        /invalid or mismatched historical Case report projection/iu,
      );
    }
  });

  test('validates saved Lookup structure without claiming content integrity', async () => {
    const lookup = {
      schema: 'whoisleuth.cli.lookup',
      version: 1,
      generatedAt: '2026-07-15T00:00:00.000Z',
      mode: 'fast',
      query: 'example.test',
      type: 'domain',
      registrableDomain: 'example.test',
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'skipped' },
      },
      rdap: { parsed: { domain: 'EXAMPLE.TEST' } },
    };
    const report = await verifyOfflineArtifact(JSON.stringify(lookup));
    assert.equal(report.artifact.kind, 'saved_lookup');
    assert.equal(report.state, 'structure_valid');
    assert.equal(report.checks.structure, 'verified');
    assert.equal(report.checks.contentIntegrity, 'not_checked');
    assert.match(report.limitations[0] || '', /no embedded checksum or signature/u);
    assert.doesNotMatch(JSON.stringify(report), /example\.test|\bfast\b/u);

    const frozenLegacy = await verifyOfflineArtifact(await loadCliLookupV1Fixture());
    assert.equal(frozenLegacy.artifact.version, 1);
    const current = await verifyOfflineArtifact(JSON.stringify({ ...lookup, version: 2 }));
    assert.equal(current.artifact.version, 2);
    const asn = await verifyOfflineArtifact(
      await readFile(new URL('./fixtures/cli-lookup-asn-v2.json', import.meta.url), 'utf8'),
    );
    assert.equal(asn.artifact.kind, 'saved_lookup');
    assert.equal(asn.artifact.version, 2);
    assert.equal(asn.state, 'structure_valid');
    assert.doesNotMatch(JSON.stringify(asn), /AS64496|\bfast\b/u);

    const strictCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: { write() {} }, stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(lookup),
    });
    assert.equal(strictCode, EXIT_CODES.SUCCESS);

    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ ...lookup, diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } } })),
      /missing normalised parsed data/iu,
    );
  });

  test('validates a real current Lookup-evidence export without claiming content integrity', async () => {
    const evidence = lookupEvidenceArtifact();
    const report = await verifyOfflineArtifact(JSON.stringify(evidence));
    assert.equal(report.artifact.kind, 'lookup_evidence');
    assert.equal(report.artifact.schema, lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA);
    assert.equal(report.artifact.version, lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(report.state, 'structure_valid');
    assert.equal(report.checks.structure, 'verified');
    assert.equal(report.checks.contentIntegrity, 'not_checked');
    assert.equal(report.checks.contentIntegrityScope, 'not_applicable');
    assert.match(report.limitations.join(' '), /no embedded checksum or signature/iu);
    assert.match(report.limitations.join(' '), /manifest-entry identity/iu);

    let stdout = '';
    const strictCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(evidence),
    });
    assert.equal(strictCode, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout).artifact.kind, 'lookup_evidence');
  });

  test('keeps one frozen internally consistent schema-25 Lookup export readable', async () => {
    const raw = await readFile(new URL('./fixtures/lookup-evidence-v25.json', import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(raw).digest('hex'), LOOKUP_EVIDENCE_V25_FIXTURE_SHA256);
    const report = await verifyOfflineArtifact(raw);
    assert.deepEqual(report.artifact, {
      kind: 'lookup_evidence',
      schema: lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA,
      version: lookupEvidenceModule.LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION,
    });
    assert.equal(report.state, 'structure_valid');
  });

  test('keeps one frozen strict schema-26 Lookup export readable after later schemas become current', async () => {
    const report = await verifyOfflineArtifact(await loadLookupEvidenceV26Fixture());
    assert.deepEqual(report.artifact, {
      kind: 'lookup_evidence',
      schema: lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA,
      version: lookupEvidenceModule.PREVIOUS_LOOKUP_EVIDENCE_SCHEMA_VERSION,
    });
    assert.equal(report.state, 'structure_valid');
  });

  test('keeps schema-27 homepage evidence readable after the privacy-minimized schema becomes current', async () => {
    const legacy = structuredClone(lookupEvidenceArtifact());
    legacy.schemaVersion = lookupEvidenceModule.HOMEPAGE_LOOKUP_EVIDENCE_SCHEMA_VERSION;
    const sources = legacy.sources as Record<string, Record<string, unknown>>;
    const diagnostics = legacy.diagnostics as Record<string, Record<string, unknown>>;
    sources.rdap!.raw = null;
    const analysis = legacy.analysis as Record<string, unknown>;
    analysis.availability = lookupEvidenceModule.projectLookupEvidenceAvailabilityLegacy(
      analysis.availability,
    );
    analysis.registryInsights = buildRegistryInsights({
      rdapParsed: sources.rdap!.parsed,
      rdapStatus: diagnostics.rdap!.status,
      rdapFetchedAt: sources.rdap!.fetchedAt,
      whoisParsed: sources.whois!.parsed,
      whoisStatus: diagnostics.whois!.status,
      whoisQueriedAt: sources.whois!.queriedAt,
    });
    const report = await verifyOfflineArtifact(JSON.stringify(legacy));
    assert.equal(report.artifact.version, lookupEvidenceModule.HOMEPAGE_LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(report.state, 'structure_valid');
  });

  test('accepts exact current homepage metadata while rejecting malformed and pre-homepage injection', async () => {
    const current = lookupEvidenceArtifact();
    const availability = (current.analysis as Record<string, Record<string, unknown>>).availability!;
    availability.pageIdentity = { status: 'success', publicationMetadata: pagePublicationMetadataFixture() };
    availability.http = { status: 'success', response: { deliveryMetadata: httpDeliveryMetadataFixture() } };
    const report = await verifyOfflineArtifact(JSON.stringify(current));
    assert.equal(report.artifact.version, lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA_VERSION);

    const malformed = structuredClone(current);
    const malformedAvailability = (malformed.analysis as Record<string, Record<string, unknown>>).availability!;
    (((malformedAvailability.http as Record<string, unknown>).response as Record<string, unknown>).deliveryMetadata as Record<string, unknown>).version = 2;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(malformed)),
      /Lookup evidence HTTP delivery metadata.*malformed structure/iu,
    );

    for (const family of ['page', 'http'] as const) {
      const unavailableParent = structuredClone(current);
      const unavailableAvailability = (unavailableParent.analysis as Record<string, Record<string, unknown>>).availability!;
      if (family === 'page') {
        (unavailableAvailability.pageIdentity as Record<string, unknown>).status = 'error';
      } else {
        (unavailableAvailability.http as Record<string, unknown>).status = 'error';
      }
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(unavailableParent)),
        /(?:page publication|HTTP delivery) metadata source state/iu,
      );
    }

    const legacy = JSON.parse(await loadLookupEvidenceV26Fixture()) as Record<string, unknown>;
    const legacyAvailability = (legacy.analysis as Record<string, Record<string, unknown>>).availability!;
    legacyAvailability.pageIdentity = { publicationMetadata: pagePublicationMetadataFixture() };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(legacy)),
      /Lookup evidence homepage metadata epoch.*malformed structure/iu,
    );
  });

  test('verifies authentic frozen schema-25 Fast, unavailable, error, and not-found wrapper states', async () => {
    const fixtures = await loadLookupEvidenceV25CompatibilityFixtures();
    for (const fixture of fixtures) {
      const report = await verifyOfflineArtifact(JSON.stringify(fixture.document));
      assert.equal(report.artifact.kind, 'lookup_evidence', fixture.name);
      assert.equal(report.artifact.version, lookupEvidenceModule.LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION, fixture.name);
      assert.equal(report.state, 'structure_valid', fixture.name);
    }
  });

  test('rejects malformed, over-bound, legacy, and future Lookup-evidence documents', async () => {
    const missingSource = structuredClone(lookupEvidenceArtifact());
    delete (missingSource.sources as Record<string, unknown>).whois;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(missingSource)),
      /Lookup evidence sources.*malformed structure/iu,
    );

    const unexpected = structuredClone(lookupEvidenceArtifact());
    Reflect.set(unexpected, 'credential', 'must not be accepted');
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(unexpected)),
      /Lookup evidence.*malformed structure/iu,
    );

    const unknownSourceState = structuredClone(lookupEvidenceArtifact());
    (unknownSourceState.sources as Record<string, Record<string, unknown>>).whois!.status = 'pending';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(unknownSourceState)),
      /Lookup evidence WHOIS status.*malformed structure/iu,
    );

    const contradictorySourceState = structuredClone(lookupEvidenceArtifact());
    (contradictorySourceState.diagnostics as Record<string, Record<string, unknown>>).rdap!.status = 'unsupported';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(contradictorySourceState)),
      /Lookup evidence RDAP source state.*malformed structure/iu,
    );

    const privateAttemptField = structuredClone(lookupEvidenceArtifact());
    (privateAttemptField.sources as Record<string, Record<string, unknown>>).rdap!.attempts = [{
      endpoint: 'https://rdap.example.test/domain/example.test',
      transportSecurity: 'https', status: 200, outcome: 'success', detail: null, selected: true,
      authorization: 'Bearer private',
    }];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(privateAttemptField)),
      /Lookup evidence RDAP attempt.*malformed structure/iu,
    );

    const secretBearingAttemptUrl = structuredClone(lookupEvidenceArtifact());
    (secretBearingAttemptUrl.sources as Record<string, Record<string, unknown>>).rdap!.attempts = [{
      endpoint: 'https://rdap.example.test/domain/example.test?token=private',
      transportSecurity: 'https', status: 200, outcome: 'success', detail: null, selected: true,
    }];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(secretBearingAttemptUrl)),
      /Lookup evidence RDAP attempt 1 endpoint.*malformed structure/iu,
    );

    const privateDiagnosticField = structuredClone(lookupEvidenceArtifact());
    const privateDiagnosticRdap = (privateDiagnosticField.diagnostics as Record<string, Record<string, unknown>>).rdap!;
    privateDiagnosticRdap.authorization = 'Bearer private';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(privateDiagnosticField)),
      /Lookup evidence RDAP diagnostics.*malformed structure/iu,
    );

    const secretDiagnosticEndpoint = structuredClone(lookupEvidenceArtifact());
    (secretDiagnosticEndpoint.diagnostics as Record<string, Record<string, unknown>>).rdap!.endpoint = 'https://rdap.example.test/domain/example.test?token=private';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(secretDiagnosticEndpoint)),
      /Lookup evidence RDAP diagnostic endpoint.*malformed structure/iu,
    );

    const secretMainEndpoint = structuredClone(lookupEvidenceArtifact());
    (secretMainEndpoint.sources as Record<string, Record<string, unknown>>).rdap!.endpoint = 'https://rdap.example.test/domain/example.test?token=private';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(secretMainEndpoint)),
      /Lookup evidence RDAP endpoint.*malformed structure/iu,
    );

    for (const branch of ['availability', 'idn', 'registryInsights', 'registrarPublicationComparison'] as const) {
      const privateAnalysis = structuredClone(lookupEvidenceArtifact());
      const analysis = privateAnalysis.analysis as Record<string, Record<string, unknown>>;
      const target = analysis[branch] || (analysis[branch] = {});
      target.sessionToken = 'must-not-be-accepted';
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(privateAnalysis)),
        /Lookup evidence.*malformed structure/iu,
      );
    }

    const compositePrivateAnalysis = structuredClone(lookupEvidenceArtifact());
    const compositeAvailability = (compositePrivateAnalysis.analysis as Record<string, Record<string, unknown>>).availability!;
    compositeAvailability.http = {
      sessionCookie: 'session=private',
      authorizationHeader: 'Bearer private',
      password: 'private',
      xApiKey: 'private',
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(compositePrivateAnalysis)),
      /Lookup evidence availability analysis.*malformed structure/iu,
    );

    for (const field of [
      'authHeader', 'sessionKey', 'passwordValue', 'credentialSurfaceSecret', 'unknownExtension',
    ]) {
      const nestedAvailabilityExtension = structuredClone(lookupEvidenceArtifact());
      const availability = (nestedAvailabilityExtension.analysis as Record<string, Record<string, unknown>>).availability!;
      availability.http = { status: 'success', [field]: 'unreviewed-value' };
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(nestedAvailabilityExtension)),
        /Lookup evidence availability analysis.*malformed structure/iu,
      );
    }

    const submittedUrl = structuredClone(lookupEvidenceArtifact());
    (submittedUrl.query as Record<string, unknown>).submitted = 'https://example.test/private/path?token=private#fragment';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(submittedUrl)),
      /Lookup evidence query.*malformed structure/iu,
    );

    const unknownRegistryInsight = structuredClone(lookupEvidenceArtifact());
    (unknownRegistryInsight.analysis as Record<string, Record<string, unknown>>).registryInsights!.unknownExtension = 'self-asserted';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(unknownRegistryInsight)),
      /registry insight derivation.*malformed structure/iu,
    );

    const privateWhoisHopField = structuredClone(lookupEvidenceArtifact());
    (privateWhoisHopField.sources as Record<string, Record<string, unknown>>).whois!.chain = [{
      server: 'whois.example.test', address: null, queriedAt: null, queryProfile: null,
      responseEncoding: null, status: 'unknown', detail: null, cookie: 'private',
    }];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(privateWhoisHopField)),
      /Lookup evidence WHOIS chain item.*malformed structure/iu,
    );

    const unavailableNetworkPublication = structuredClone(lookupEvidenceArtifact());
    (unavailableNetworkPublication.sources as Record<string, unknown>).network = {
      contextVersion: 1, version: 1, status: 'unsupported', observedAt: null,
      scanMode: null, source: null, durationMs: null, complete: true, truncated: false,
      limitations: [], diagnostics: null, detail: null,
      endpoint: { address: '192.0.2.10', family: 4, selectedFrom: 'dns_a' },
      rdap: null, network: null,
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(unavailableNetworkPublication)),
      /Lookup evidence unavailable network publication.*malformed structure/iu,
    );

    const unavailablePtrPublication = structuredClone(lookupEvidenceArtifact());
    (unavailablePtrPublication.sources as Record<string, unknown>).reverseDns = {
      version: 1, status: 'unsupported', observedAt: null, scanMode: null,
      source: 'reverse_dns', durationMs: null, complete: false, truncated: false,
      limitations: [], diagnostics: null, records: { ptr: ['injected.example.test'] },
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(unavailablePtrPublication)),
      /Lookup evidence reverse DNS unavailable records.*malformed structure/iu,
    );

    const injectedComparison = structuredClone(lookupEvidenceArtifact());
    const comparison = (injectedComparison.analysis as Record<string, Record<string, unknown>>).registryComparison!;
    comparison.fields = [{
      label: 'Registrar', status: 'rdap_only', rdapState: 'value', whoisState: 'unavailable',
      rdapDisplay: 'Injected Registrar', whoisDisplay: 'Source skipped',
    }];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(injectedComparison)),
      /registry comparison derivation.*malformed structure/iu,
    );

    const injectedDisclosure = structuredClone(lookupEvidenceArtifact());
    const insights = (injectedDisclosure.analysis as Record<string, Record<string, unknown>>).registryInsights!;
    (insights.contactDisclosure as Record<string, Record<string, unknown>>).whois = {
      source: 'whois', state: 'public', detail: 'Injected positive source claim.',
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(injectedDisclosure)),
      /registry insight derivation.*malformed structure/iu,
    );

    const impossibleSslbl = structuredClone(lookupEvidenceArtifact());
    (impossibleSslbl.sources as Record<string, unknown>).sslbl = {
      sslblVersion: 1,
      source: 'sslbl',
      status: 'success',
      verdict: 'inconclusive',
      complete: true,
      observedAt: '2026-07-15T00:00:00.000Z',
      fingerprintSha1: 'a'.repeat(40),
      referenceUrl: 'https://other.example.test/ssl-certificates/sha1/value/',
      snapshot: { sourceUpdatedAt: null, generatedAt: null, ageSeconds: null, entryCount: null, digestSha256: null },
      detail: null,
      limitations: [],
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(impossibleSslbl)),
      /Lookup evidence SSLBL (?:state|reference).*malformed structure/iu,
    );

    const oversizedArray = structuredClone(lookupEvidenceArtifact());
    (oversizedArray.analysis as Record<string, unknown>).privateValues = Array.from({ length: 10_001 }, () => null);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(oversizedArray)),
      /(?:Lookup evidence portable bounds.*malformed structure|container with more than 10000 items)/iu,
    );

    const overDepth = structuredClone(lookupEvidenceArtifact());
    let nested: Record<string, unknown> = {};
    (overDepth.analysis as Record<string, unknown>).availability = nested;
    for (let depth = 0; depth < 25; depth += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(overDepth)),
      /Lookup evidence portable bounds.*malformed structure/iu,
    );

    const overBytes = structuredClone(lookupEvidenceArtifact());
    (overBytes.analysis as Record<string, Record<string, unknown>>).availability = {
      padding: Array.from({ length: 5_500 }, () => 'x'.repeat(1_000)),
    };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(overBytes)),
      /limited to 5 MiB/iu,
    );

    for (const schemaVersion of [lookupEvidenceModule.LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION - 1, lookupEvidenceModule.LOOKUP_EVIDENCE_SCHEMA_VERSION + 1]) {
      const unsupported = { ...lookupEvidenceArtifact(), schemaVersion };
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(unsupported)),
        /Lookup-evidence document version is not supported/iu,
      );
    }
  });

  test('accepts complete no-data network observations and rejects diagnostic/source contradictions', async () => {
    const artifact = structuredClone(lookupEvidenceArtifact());
    const diagnostics = artifact.diagnostics as Record<string, unknown>;
    diagnostics.reverseDns = {
      status: 'not_found', observedAt: '2026-07-15T00:00:00.000Z', complete: true, truncated: false,
    };
    diagnostics.network = {
      status: 'not_found', address: null, family: null, addressSource: null,
      endpoint: null, transportSecurity: null, httpStatus: null, fetchedAt: null, attempts: [],
    };
    const sources = artifact.sources as Record<string, unknown>;
    sources.reverseDns = {
      version: 1, status: 'not_found', observedAt: '2026-07-15T00:00:00.000Z',
      scanMode: 'deep', source: 'reverse_dns', durationMs: 1, complete: true,
      truncated: false, limitations: [], diagnostics: null, records: { ptr: [] },
    };
    sources.network = {
      contextVersion: 1, version: 1, status: 'not_found', observedAt: '2026-07-15T00:00:00.000Z',
      scanMode: 'deep', source: 'ip_rdap', durationMs: 1, complete: true,
      truncated: false, limitations: [], diagnostics: null, detail: 'No matching network object was published.',
      endpoint: null, rdap: null, network: null,
    };

    const report = await verifyOfflineArtifact(JSON.stringify(artifact));
    assert.equal(report.state, 'structure_valid');

    (sources.reverseDns as Record<string, unknown>).complete = false;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(artifact)),
      /Lookup evidence reverse DNS completeness.*malformed structure/iu,
    );
  });

  test('reports whole-capsule assurance and detects changed metadata or embedded projections', async () => {
    const graph = {
      version: 2 as const,
      targetId: 'target-example',
      nodes: [{ id: 'target-example', label: 'example.test', kind: 'target' as const, detail: 'Lookup target' }],
      edges: [], sources: [], truncated: false, limitations: [],
    };
    const brief = {
      schema: 'whoisleuth.investigation-brief' as const, schemaVersion: 2 as const,
      generatedAt: '2026-08-04T00:00:00.000Z', target: 'example.test', targetType: 'domain',
      task: 'general' as const, taskLabel: 'General review', question: 'What is known?', summary: 'Review evidence.',
      observation: { observedAt: '2026-08-04T00:00:00.000Z', evidenceAgeDays: 0, completeSources: 1, limitedSources: 0, freshnessPolicy: { version: 1 as const, id: 'task-default' as const, task: 'general' as const, thresholdsDays: { registration: 30, network: 7, web: 3 } } },
      decisionFacts: {
        version: 1 as const, total: 0, displayed: 0, omitted: 0,
        contradictory: 0, unresolved: 0, facts: [],
      },
      relationships: { nodes: 1, edges: 0, truncated: false, kinds: [] }, limitations: [],
    };
    const capsule = await buildInvestigationCapsule({
      applicationVersion: '1.36.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 },
      brief, graph, generatedAt: '2026-08-04T01:00:00Z',
    });
    const report = await verifyOfflineArtifact(JSON.stringify(capsule));
    assert.equal(report.artifact.kind, 'investigation_capsule');
    assert.equal(report.state, 'verified');
    assert.equal(report.checks.contentIntegrity, 'verified');
    assert.equal(report.checks.contentIntegrityScope, 'whole_artifact');
    assert.match(report.limitations.join(' '), /whole capsule/iu);
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      ...capsule,
      generatedAt: '2026-08-04T02:00:00.000Z',
    })), /integrity checks/iu);
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      ...capsule,
      graphSnapshot: { ...capsule.graphSnapshot, nodes: [{ ...capsule.graphSnapshot.nodes[0]!, label: 'changed.test' }] },
    })), /embedded projection integrity/u);

    const strictCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: { write() {} }, stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(capsule),
    });
    assert.equal(strictCode, EXIT_CODES.SUCCESS);
  });

  test('rejects unsupported, malformed, and oversized input', async () => {
    await assert.rejects(verifyOfflineArtifact('{'), /not valid JSON/iu);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify({ schema: 'whoisleuth.unknown', version: 1 })),
      /not supported/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact('x'.repeat(MAX_OFFLINE_ARTIFACT_BYTES + 1)),
      /between 1 byte/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact('{"schema":"whoisleuth.bulk-review-manifest","schema":"whoisleuth.bulk-review-manifest","version":1}'),
      /duplicate object key/iu,
    );
    await assert.rejects(
      verifyOfflineArtifact(`${'{"nested":'.repeat(50)}null${'}'.repeat(50)}`),
      /nesting limit/iu,
    );
  });

  test('rejects recomputed content-free digest envelopes for every supported review schema', async () => {
    const schemas = [
      ['whoisleuth.acquisition-decision', 1, null], ['whoisleuth.acquisition-decision', 2, 'sorted-json-v2'],
      ['whoisleuth.domain-comparison', 3, null], ['whoisleuth.domain-comparison', 4, 'sorted-json-v2'],
      ['whoisleuth.bulk-mail-exposure', 1, null], ['whoisleuth.bulk-mail-exposure', 2, 'sorted-json-v2'],
      ['whoisleuth.bulk-review-manifest', 1, null], ['whoisleuth.bulk-review-manifest', 2, 'sorted-json-v2'],
      ['whoisleuth.domain-control-manifest', 1, 'sorted-json-v1'], ['whoisleuth.domain-control-manifest', 2, 'sorted-json-v2'],
      ['whoisleuth.domain-change-packet', 1, null], ['whoisleuth.domain-change-packet', 2, 'sorted-json-v2'],
      ['whoisleuth.investigation-manifest', 1, null], ['whoisleuth.investigation-manifest', 2, 'sorted-json-v2'],
    ] as const;
    for (const [schema, version, canonicalization] of schemas) {
      const unsigned = { schema, version };
      const contentFree = {
        ...unsigned,
        integrity: {
          algorithm: 'SHA-256',
          ...(canonicalization ? { canonicalization } : {}),
          digestSha256: await (canonicalization === 'sorted-json-v2'
            ? sha256ArtifactDigestV2(unsigned)
            : sha256ArtifactDigest(unsigned)),
        },
      };
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(contentFree)),
        /unsupported or malformed structure/iu,
        schema,
      );
    }

    for (const schemaVersion of [5, 6] as const) {
      const packetUnsigned = { schema: 'whoisleuth.case-response-packet', schemaVersion };
      await assert.rejects(verifyOfflineArtifact(JSON.stringify({
        ...packetUnsigned,
        integrity: {
          algorithm: 'SHA-256', canonicalization: schemaVersion === 6 ? 'sorted-json-v2' : 'sorted-json-v1', scope: 'packet excluding integrity',
          digestSha256: (await (schemaVersion === 6 ? sha256ArtifactDigestV2(packetUnsigned) : sha256ArtifactDigest(packetUnsigned))).slice('sha256:'.length),
        },
      })), /unsupported or malformed structure/iu);
    }
    for (const schemaVersion of [1, 2] as const) {
      await assert.rejects(verifyOfflineArtifact(JSON.stringify({
        schema: 'whoisleuth.investigation-capsule', schemaVersion,
        integrity: schemaVersion === 1
          ? { algorithm: 'SHA-256', briefDigest: `sha256:${'0'.repeat(64)}`, graphDigest: `sha256:${'0'.repeat(64)}`, analystRecordsDigest: null }
          : { algorithm: 'SHA-256', canonicalization: 'sorted-json-v2', scope: 'capsule excluding integrity', briefDigest: `sha256:${'0'.repeat(64)}`, graphDigest: `sha256:${'0'.repeat(64)}`, analystRecordsDigest: null, digestSha256: `sha256:${'0'.repeat(64)}` },
      })), /unsupported or malformed structure/iu);
    }
  });

  test('verifies frozen response packets v5 and v6, current v7, and the exact v7 review binding', async () => {
    for (const version of [5, 6] as const) {
      const historical = historicalCaseResponsePacketFixture(version);
      const verified = await verifyOfflineArtifact(JSON.stringify(historical));
      assert.equal(verified.state, 'verified');
      assert.equal(verified.artifact.version, version);
    }

    const caseRecord = createCase({
      domain: 'review-binding.example',
      status: 'escalated',
      disposition: 'confirmed_abuse',
      evidence: { availability: 'registered', capturedAt: '2026-07-15T00:00:00.000Z' },
    }, '2026-07-15T00:00:00.000Z');
    const packet = (await buildCaseResponsePacket(caseRecord, {
      category: 'Reserved review',
      affectedParty: 'Reserved service',
      abusiveUrls: ['https://review-binding.example/review'],
      observedHarm: 'A reserved synthetic observation.',
      observedAt: '2026-07-15T00:00:00.000Z',
    }, '2026-07-15T01:00:00.000Z')).json;
    const verified = await verifyOfflineArtifact(JSON.stringify(packet));
    assert.equal(verified.state, 'verified');
    assert.equal(verified.artifact.version, 7);

    const forged = structuredClone(packet) as unknown as Record<string, unknown>;
    const authorisation = forged.authorisation as Record<string, unknown>;
    authorisation.reviewedInputDigestSha256 = 'f'.repeat(64);
    authorisation.suppliedReviewDigestSha256 = 'f'.repeat(64);
    authorisation.digestMatches = true;
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await resignCaseResponsePacket(forged))),
      /case-response .*unsupported or malformed structure/iu,
    );
  });

  test('reconstructs the v7 provider lifecycle projection instead of trusting a re-signed summary', async () => {
    const base = createCase({
      domain: 'provider-lifecycle.example',
      status: 'escalated',
      disposition: 'confirmed_abuse',
      evidence: { availability: 'registered', capturedAt: '2026-07-15T00:00:00.000Z' },
      action: { recipient: 'Reserved response desk', type: 'registrar_report' },
    }, '2026-07-15T00:00:00.000Z');
    const actionId = base.actions[0]!.id;
    let actions = base.actions;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst' },
        new Date(Date.parse('2026-07-15T00:00:00.000Z') + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'provider_reports_resolved',
      outcomeDetail: 'The provider reported resolution.', provenance: 'provider_reported_resolution',
    }, '2026-07-15T01:00:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider',
      outcomeDetail: 'A later response supplied procedural detail only.', provenance: 'provider_detail_only',
    }, '2026-07-15T01:30:00.000Z');
    const packet = (await buildCaseResponsePacket({ ...base, actions, updatedAt: '2026-07-15T01:30:00.000Z' }, {
      category: 'Reserved review',
      affectedParty: 'Reserved service',
      abusiveUrls: ['https://provider-lifecycle.example/review'],
      observedHarm: 'A reserved synthetic observation.',
      observedAt: '2026-07-15T00:00:00.000Z',
    }, '2026-07-15T02:00:00.000Z')).json;
    const verified = await verifyOfflineArtifact(JSON.stringify(packet));
    assert.equal(verified.state, 'verified');
    assert.equal(packet.escalationHistory[0]?.providerOutcome, 'provider_reports_resolved');

    const forged = structuredClone(packet) as unknown as Record<string, unknown>;
    const lifecycle = forged.responseLifecycle as Record<string, unknown>;
    const latest = lifecycle.latestProviderOutcome as Record<string, unknown>;
    latest.outcome = 'duplicate';
    await rebindCaseResponseReview(forged);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await resignCaseResponsePacket(forged))),
      /case-response .*unsupported or malformed structure/iu,
    );
  });

  test('accepts explicit bounded packet action omissions only with conservative provider timing', async () => {
    const base = createCase({
      domain: 'bounded-packet-actions.example',
      status: 'reviewing',
      disposition: 'suspicious',
      evidence: { availability: 'registered', capturedAt: '2026-07-15T00:00:00.000Z' },
    }, '2026-07-15T00:00:00.000Z');
    let actions = base.actions;
    for (let index = 0; index <= MAX_RESPONSE_ACTION_HISTORY; index += 1) {
      actions = appendCaseAction(actions, { recipient: `Bounded local reviewer ${index}` },
        new Date(Date.parse('2026-07-15T00:00:00.000Z') + index * 60_000).toISOString());
    }
    const packet = (await buildCaseResponsePacket({ ...base, actions }, {
      category: 'Reserved review', affectedParty: 'Reserved service',
      abusiveUrls: ['https://bounded-packet-actions.example/review'],
      observedHarm: 'A reserved synthetic observation.', observedAt: '2026-07-15T00:00:00.000Z',
    }, '2026-07-15T02:00:00.000Z')).json;
    assert.equal(packet.escalationHistoryOmitted, 1);
    assert.equal(packet.responseLifecycle.providerOutcomeState, 'ambiguous');
    assert.equal((await verifyOfflineArtifact(JSON.stringify(packet))).state, 'verified');

    const forged = structuredClone(packet) as unknown as Record<string, unknown>;
    (forged.responseLifecycle as Record<string, unknown>).providerOutcomeState = 'missing';
    await rebindCaseResponseReview(forged);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await resignCaseResponsePacket(forged))),
      /case-response .*unsupported or malformed structure/iu,
    );
  });

  test('enforces the real Case v5 collection maxima before accepting a recomputed packet digest', async () => {
    const caseRecord = createCase({
      domain: 'bounded-response.example',
      status: 'escalated',
      disposition: 'confirmed_abuse',
      evidence: { availability: 'registered', capturedAt: '2026-07-15T00:00:00.000Z' },
    }, '2026-07-15T00:00:00.000Z');
    const packet = (await buildCaseResponsePacket(caseRecord, {
      category: 'Credential review',
      affectedParty: 'Example service',
      abusiveUrls: ['https://bounded-response.example/review'],
      observedHarm: 'A credential request was observed.',
      observedAt: '2026-07-15T00:00:00.000Z',
      contacts: [{
        kind: 'registrar',
        contact: 'c'.repeat(320),
        source: 's'.repeat(80),
        limitations: Array.from({ length: 8 }, (_, index) => `${String(index)}${'l'.repeat(239)}`),
      }],
    }, '2026-07-15T01:00:00.000Z')).json;
    const verified = await verifyOfflineArtifact(JSON.stringify(packet));
    assert.equal(verified.state, 'verified');
    assert.equal(packet.contacts[0]?.contact.length, 320);
    assert.equal(packet.contacts[0]?.source.length, 80);
    assert.deepEqual(packet.contacts[0]?.limitations.map((item) => item.length), Array(8).fill(240));

    const overBoundMutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        const preflight = value.preflight as Record<string, unknown>;
        const summary = preflight.actionSummary as Record<string, unknown>;
        summary.total = MAX_CASE_ACTIONS + 1;
        summary.active = MAX_CASE_ACTIONS + 1;
      },
      (value) => { (value.provenance as Record<string, unknown>).evidencePinCount = MAX_CASE_EVIDENCE_PINS + 1; },
      (value) => { (value.provenance as Record<string, unknown>).decisionCount = MAX_CASE_DECISIONS + 1; },
      (value) => { (value.provenance as Record<string, unknown>).assertionCount = MAX_CASE_ASSERTIONS + 1; },
    ];
    for (const mutate of overBoundMutations) {
      const changed = structuredClone(packet) as unknown as Record<string, unknown>;
      mutate(changed);
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(await resignCaseResponsePacket(changed))),
        /case-response .*unsupported or malformed structure/iu,
      );
    }

    const parityMutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { (value.profile as Record<string, unknown>).label = 'Changed profile label'; },
      (value) => {
        const urls = (value.incident as Record<string, unknown>).abusiveUrls as string[];
        urls[0] = 'https://bounded-response.example:443/review';
      },
      (value) => {
        const checks = ((value.preflight as Record<string, unknown>).checks as unknown[]);
        [checks[0], checks[1]] = [checks[1], checks[0]];
      },
      (value) => { ((value.provenance as Record<string, unknown>).observationAge as Record<string, unknown>).ageSeconds = 3_601; },
      (value) => {
        const contact = { kind: 'registrar', contact: 'abuse@example.test', source: 'fixture', limitations: [] };
        value.contacts = [contact, { ...contact, contact: 'ABUSE@EXAMPLE.TEST' }];
      },
      (value) => {
        const contact = ((value.contacts as Array<Record<string, unknown>>)[0]!);
        contact.limitations = Array.from({ length: 9 }, (_, index) => `limit-${index}`);
      },
      (value) => {
        const contact = ((value.contacts as Array<Record<string, unknown>>)[0]!);
        contact.limitations = ['l'.repeat(241)];
      },
      (value) => {
        const contact = ((value.contacts as Array<Record<string, unknown>>)[0]!);
        contact.freshness = 'current';
      },
      (value) => {
        const rows = (value.readiness as Record<string, unknown>).rows as Array<Record<string, unknown>>;
        rows.find((row) => row.id === 'exact_url')!.requiredForAuthorisation = false;
      },
      (value) => {
        const rows = (value.readiness as Record<string, unknown>).rows as Array<Record<string, unknown>>;
        rows.find((row) => row.id === 'exact_url')!.state = 'partial';
      },
      (value) => {
        value.escalationHistory = [{
          type: 'unregistered_action', recipient: 'Fixture reviewer', contactSource: 'fixture', state: 'submitted',
          reference: null, outcome: null, createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
        }];
      },
    ];
    for (const mutate of parityMutations) {
      const changed = structuredClone(packet) as unknown as Record<string, unknown>;
      mutate(changed);
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(await resignCaseResponsePacket(changed))),
        /case-response .*unsupported or malformed structure/iu,
      );
    }
  });

  test('redacts attacker-selected domain-control field names at the offline verification boundary', async () => {
    const manifest = buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: 1,
      expiresAt: '2026-09-15T00:00:00.000Z',
      entries: [{ domain: 'bounded-control.example', nameservers: ['ns1.bounded-control.example'] }],
    }, '2026-07-15T00:00:00.000Z');
    const unknownKey = 'privateCredentialTokenMustNotAppear';
    const malformed = { ...manifest, [unknownKey]: true };
    let message = '';
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(malformed)), (error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
      return /domain control manifest.*unsupported or malformed structure/iu.test(message);
    });
    assert.doesNotMatch(message, new RegExp(unknownKey, 'u'));
  });

  test('runs through the CLI without exposing the passphrase or artifact contents', async () => {
    const archive = await buildWorkspaceArchive({}, {
      generatedAt: '2026-07-15T00:00:00.000Z',
    });
    const encrypted = await encryptWorkspaceArchive(archive, PASSPHRASE);
    let stdout = '';
    let stderr = '';
    const code = await runCli([
      'verify-artifact',
      'fixture.workspace.json',
      '--passphrase-file',
      'fixture.passphrase',
      '--json',
    ], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(encrypted),
      readPassphraseFile: async () => `${PASSPHRASE}\n`,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    const report = JSON.parse(stdout);
    assert.equal(report.state, 'verified');
    assert.equal(report.checks.authenticatedEncryption, 'verified');
    assert.doesNotMatch(stdout, new RegExp(PASSPHRASE, 'u'));
    assert.equal(stdout.includes(encrypted.ciphertext.slice(0, 32)), false);

    const envelopeCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: { write() {} }, stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(encrypted),
    });
    assert.equal(envelopeCode, EXIT_CODES.PARTIAL_FAILURE);
  });
});
