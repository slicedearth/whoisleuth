import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

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
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { buildInvestigationCapsule } from '../frontend/src/lib/analysis/investigation-capsule.ts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import { buildCaseResponsePacket } from '../frontend/src/lib/analysis/case-response-packet.ts';
import { buildCliCasePack } from '../cli/case-pack.mts';
import { CASE_SCHEMA_VERSION, createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  MAX_CASE_ACTIONS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import { buildDomainControlManifest, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA } from '../lib/domain-control-manifest.mts';
import { historicalCasePackFixture } from './historical-case-pack-fixtures.mts';

const PASSPHRASE = 'fixture archive passphrase';

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
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: await sha256ArtifactDigest(unsigned),
    },
  } as unknown as T;
}

async function resignCaseResponsePacket<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity: _integrity, ...unsigned } = value;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      scope: 'packet excluding integrity',
      digestSha256: (await sha256ArtifactDigest(unsigned)).slice('sha256:'.length),
    },
  } as unknown as T;
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
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /failed its SHA-256/iu);
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

  test('reports projection-scoped capsule assurance and detects changed embedded projections', async () => {
    const graph = {
      version: 2 as const,
      targetId: 'target-example',
      nodes: [{ id: 'target-example', label: 'example.test', kind: 'target' as const, detail: 'Lookup target' }],
      edges: [], sources: [], truncated: false, limitations: [],
    };
    const brief = {
      schema: 'whoisleuth.investigation-brief' as const, schemaVersion: 1 as const,
      generatedAt: '2026-08-04T00:00:00.000Z', target: 'example.test', targetType: 'domain',
      task: 'general' as const, taskLabel: 'General review', question: 'What is known?', summary: 'Review evidence.',
      observation: { observedAt: '2026-08-04T00:00:00.000Z', evidenceAgeDays: 0, completeSources: 1, limitedSources: 0, freshnessPolicy: { version: 1 as const, id: 'task-default' as const, task: 'general' as const, thresholdsDays: { registration: 30, network: 7, web: 3 } } },
      verifiedFacts: [], contradictions: [], unknowns: [], nextActions: [],
      relationships: { nodes: 1, edges: 0, truncated: false, kinds: [] }, limitations: [],
    };
    const capsule = await buildInvestigationCapsule({
      applicationVersion: '1.36.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 },
      brief, graph, generatedAt: '2026-08-04T01:00:00Z',
    });
    const report = await verifyOfflineArtifact(JSON.stringify(capsule));
    assert.equal(report.artifact.kind, 'investigation_capsule');
    assert.equal(report.state, 'integrity_valid');
    assert.equal(report.checks.contentIntegrity, 'verified');
    assert.equal(report.checks.contentIntegrityScope, 'embedded_projections');
    assert.match(report.limitations.join(' '), /outside those projection digests/iu);
    const metadataChanged = await verifyOfflineArtifact(JSON.stringify({
      ...capsule,
      generatedAt: '2026-08-04T02:00:00.000Z',
    }));
    assert.equal(metadataChanged.state, 'integrity_valid');
    assert.notEqual(metadataChanged.checks.contentIntegrityScope, 'whole_artifact');
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      ...capsule,
      graphSnapshot: { ...capsule.graphSnapshot, nodes: [{ ...capsule.graphSnapshot.nodes[0]!, label: 'changed.test' }] },
    })), /embedded projection integrity/u);

    const strictCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: { write() {} }, stderr: { write() {} },
      readArtifactInput: async () => JSON.stringify(capsule),
    });
    assert.equal(strictCode, EXIT_CODES.PARTIAL_FAILURE);
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
      ['whoisleuth.acquisition-decision', 1],
      ['whoisleuth.domain-comparison', 3],
      ['whoisleuth.bulk-mail-exposure', 1],
      ['whoisleuth.bulk-review-manifest', 1],
      ['whoisleuth.domain-control-manifest', 1],
      ['whoisleuth.domain-change-packet', 1],
      ['whoisleuth.investigation-manifest', 1],
    ] as const;
    for (const [schema, version] of schemas) {
      const unsigned = { schema, version };
      const contentFree = {
        ...unsigned,
        integrity: { algorithm: 'SHA-256', digestSha256: await sha256ArtifactDigest(unsigned) },
      };
      await assert.rejects(
        verifyOfflineArtifact(JSON.stringify(contentFree)),
        /unsupported or malformed structure/iu,
        schema,
      );
    }

    const packetUnsigned = { schema: 'whoisleuth.case-response-packet', schemaVersion: 5 };
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      ...packetUnsigned,
      integrity: {
        algorithm: 'SHA-256', canonicalization: 'sorted-json-v1', scope: 'packet excluding integrity',
        digestSha256: (await sha256ArtifactDigest(packetUnsigned)).slice('sha256:'.length),
      },
    })), /unsupported or malformed structure/iu);
    await assert.rejects(verifyOfflineArtifact(JSON.stringify({
      schema: 'whoisleuth.investigation-capsule', schemaVersion: 1,
      integrity: { algorithm: 'SHA-256', briefDigest: `sha256:${'0'.repeat(64)}`, graphDigest: `sha256:${'0'.repeat(64)}`, analystRecordsDigest: null },
    })), /unsupported or malformed structure/iu);
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
