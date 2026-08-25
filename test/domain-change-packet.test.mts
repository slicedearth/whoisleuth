import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import {
  DOMAIN_CHANGE_PACKET_INPUT_SCHEMA,
  DOMAIN_CHANGE_PACKET_SCHEMA,
  buildDomainChangePacket,
} from '../lib/domain-change-packet.mts';

const NOW = '2026-08-05T06:00:00.000Z';

async function redigest<T extends Record<string, unknown>>(value: T): Promise<T> {
  const { integrity, ...unsigned } = value;
  return {
    ...unsigned,
    integrity: { ...(integrity as Record<string, unknown>), digestSha256: await sha256ArtifactDigestV2(unsigned) },
  } as unknown as T;
}

function changeInput(address: string) {
  return {
    schema: 'whoisleuth.domain-change.input',
    version: 1,
    domain: 'example.test',
    authoritySnapshots: [
      { label: 'Authority A', source: 'fixture authority', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: address, ttl: 300 }] },
      { label: 'Authority B', source: 'fixture authority', state: 'observed', observedAt: NOW, records: [{ owner: 'example.test', type: 'A', value: address, ttl: 600 }] },
    ],
    resolverSnapshots: [],
    acmeDependencies: [],
    certificate: null,
    hsts: null,
  };
}

function packetInput() {
  return {
    schema: DOMAIN_CHANGE_PACKET_INPUT_SCHEMA,
    version: 1,
    domain: 'example.test',
    reference: 'CHG-42',
    preChange: changeInput('192.0.2.10'),
    postChange: changeInput('192.0.2.20'),
    assurance: {
      schema: 'whoisleuth.domain-assurance.input',
      version: 2,
      kind: 'planned-change',
      domain: 'example.test',
      change: {
        reference: 'CHG-42',
        startsAt: '2026-08-05T05:00:00Z',
        endsAt: '2026-08-05T07:00:00Z',
        milestones: [{
          id: 'dns', label: 'DNS published', expectedBy: NOW, evidenceSource: 'saved authority evidence',
          state: 'observed', observedAt: NOW, evidenceReference: 'post-change:dns',
        }],
        rollbackCriteria: [{ id: 'rollback-resolution', condition: 'Resolution is unavailable', owner: 'Change lead', state: 'not_met' }],
        postChangeChecks: [{
          id: 'post-dns', label: 'DNS agrees', expectedState: 'Two authorities agree', evidenceSource: 'saved authority evidence',
          state: 'matched', evidenceReference: 'post-change:dns',
        }],
      },
    },
  };
}

describe('domain change packet', () => {
  test('assembles a ready digest-protected packet without collection', async () => {
    const packet = await buildDomainChangePacket(packetInput(), NOW);
    assert.equal(packet.schema, DOMAIN_CHANGE_PACKET_SCHEMA);
    assert.equal(packet.state, 'ready');
    assert.equal(packet.summary.changedAuthoritativeRecordSets.length, 1);
    assert.equal(packet.summary.changedAuthoritativeRecordSets[0]?.type, 'A');
    assert.match(packet.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    const verified = await verifyOfflineArtifact(JSON.stringify(packet));
    assert.equal(verified.artifact.kind, 'signed_review_artifact');
    assert.equal(verified.state, 'verified');
  });

  test('rejects mixed-domain evidence and reports incomplete inputs as review', async () => {
    const mixed = packetInput();
    mixed.postChange.domain = 'other.test';
    await assert.rejects(() => buildDomainChangePacket(mixed, NOW), /same domain/iu);

    const incomplete = packetInput();
    incomplete.postChange.authoritySnapshots = incomplete.postChange.authoritySnapshots.slice(0, 1);
    const packet = await buildDomainChangePacket(incomplete, NOW);
    assert.equal(packet.state, 'review');
    assert.match(packet.gate.reasons.join(' '), /Post-change evidence/iu);
  });

  test('rejects re-digested outer state, evidence linkage, and change-summary divergence', async () => {
    const incomplete = packetInput();
    incomplete.postChange.authoritySnapshots = incomplete.postChange.authoritySnapshots.slice(0, 1);
    const reviewPacket = await buildDomainChangePacket(incomplete, NOW);
    const forcedReady = structuredClone(reviewPacket) as unknown as Record<string, unknown>;
    forcedReady.state = 'ready';
    forcedReady.gate = { pass: true, reasons: [] };
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(forcedReady))),
      /domain change packet gate.*unsupported or malformed structure/iu,
    );

    const readyPacket = await buildDomainChangePacket(packetInput(), NOW);
    const mismatchedTime = structuredClone(readyPacket) as unknown as Record<string, unknown>;
    const evidence = mismatchedTime.evidence as Record<string, unknown>;
    (evidence.preChange as Record<string, unknown>).generatedAt = '2026-08-05T06:00:01.000Z';
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(mismatchedTime))),
      /domain change packet evidence linkage.*unsupported or malformed structure/iu,
    );

    const missingChange = structuredClone(readyPacket) as unknown as Record<string, unknown>;
    const summary = missingChange.summary as Record<string, unknown>;
    summary.changedAuthoritativeRecordSets = [];
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(await redigest(missingChange))),
      /domain change packet summary.*unsupported or malformed structure/iu,
    );
  });
});
