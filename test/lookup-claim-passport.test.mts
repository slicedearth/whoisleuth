import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { signEvidencePackage, verifyEvidencePackageSignature } from '../cli/evidence-signing.mts';
import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';
import {
  buildLookupClaimPassport,
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
} from '../frontend/src/lib/analysis/lookup-claim-passport.ts';
import { buildLookupClaimReadiness } from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import { sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import type { EvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupDecisionSupport } from '../frontend/src/lib/analysis/lookup-decision-support.ts';

const decisionSupport: LookupDecisionSupport = {
  version: 1,
  guidance: { task: 'brand', label: 'Brand', summary: '', questions: [], prioritySections: [] },
  entries: [],
  actions: [],
  counts: { conflicts: 0, uncertainties: 0 },
};

function ledger(states: Readonly<Record<string, EvidenceCoverageLedger['entries'][number]['state']>>): EvidenceCoverageLedger {
  const entries = Object.entries(states).map(([id, state]) => ({
    id,
    label: id,
    category: id === 'rdap' || id === 'whois' ? 'registry' as const : 'web' as const,
    state,
    statusLabel: state,
    truncated: false,
    limitations: state === 'complete' ? [] : [`${id} was ${state}.`],
    manualReviewSuggested: state === 'partial' || state === 'unavailable' || state === 'unknown',
  }));
  const counts = { complete: 0, not_found: 0, partial: 0, skipped: 0, unavailable: 0, unknown: 0, unsupported: 0 };
  for (const entry of entries) counts[entry.state] += 1;
  return {
    version: 1,
    entries,
    counts,
    completeCount: counts.complete,
    limitedCount: counts.partial + counts.unavailable + counts.unknown,
  };
}

function readiness() {
  return buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'brand',
    coverage: ledger({ availability: 'complete', http: 'complete', tls: 'complete', 'page-identity': 'partial' }),
    decisionSupport,
    availabilityState: 'registered',
    availabilitySource: 'rdap',
    hasActiveProfile: false,
    profileSourceState: 'unavailable',
  });
}

async function passport() {
  return buildLookupClaimPassport({
    readiness: readiness(),
    claimId: 'brand-resemblance',
    targetType: 'domain',
    target: 'Example.COM.',
    lookupDepth: 'deep',
    observedAt: '2026-08-10T00:00:00Z',
    evidenceObservedAtById: {
      'page-identity': '2026-08-09T23:59:00Z',
    },
    riskModelVersion: 7,
    applicationVersion: '1.48.0',
    generatedAt: '2026-08-10T01:00:00Z',
  });
}

async function resign<T extends Record<string, unknown>>(document: T): Promise<T> {
  const { integrity: _integrity, ...unsigned } = document;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      digestSha256: await sha256ArtifactDigestV2(unsigned),
    },
  } as unknown as T;
}

test('builds a bounded source-aware claim passport and verifies it offline', async () => {
  const exported = await passport();
  assert.equal(exported.document.schema, LOOKUP_CLAIM_PASSPORT_SCHEMA);
  assert.deepEqual(exported.document.target, { type: 'domain', value: 'example.com' });
  assert.equal(exported.document.claim.state, 'limited');
  assert.deepEqual(exported.document.claim.requiredEvidenceIds, ['page-identity-observation', 'reviewed-brand-profile']);
  assert.deepEqual(exported.document.claim.missingEvidenceIds, ['page-identity-observation', 'reviewed-brand-profile']);
  assert.equal(exported.document.claim.requirements[0]?.state, 'partial');
  assert.equal(exported.document.claim.requirements[0]?.observedAt, '2026-08-09T23:59:00.000Z');
  assert.equal(exported.document.claim.requirements[1]?.state, 'unavailable');
  assert.equal(exported.document.claim.requirements[1]?.observedAt, null);
  assert.deepEqual(exported.document.models, { claimReadiness: 2, risk: 7 });
  assert.doesNotMatch(exported.content, /rawWhoisPayload|contact@example|password|\/lookup\?/iu);
  assert.ok(new TextEncoder().encode(exported.content).byteLength < 64 * 1024);

  const report = await verifyOfflineArtifact(exported.content);
  assert.equal(report.artifact.kind, 'signed_review_artifact');
  assert.equal(report.artifact.schema, LOOKUP_CLAIM_PASSPORT_SCHEMA);
  assert.equal(report.state, 'verified');
  assert.equal(report.checks.structure, 'verified');
  assert.equal(report.checks.contentIntegrity, 'verified');

  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signed = await signEvidencePackage(exported.content, privateKey, '2026-08-10T01:02:00.000Z');
  const signature = await verifyEvidencePackageSignature(JSON.stringify(signed), publicKey);
  assert.equal(signature.state, 'signature_valid');
  assert.equal(signature.signature.signerTrust, 'trusted_key');
  assert.equal(signature.artifact.assurance.state, 'verified');

  const interchange = await buildInterchangeFidelityReport(exported.content, {
    generatedAt: '2026-08-10T01:05:00.000Z',
  });
  assert.equal(interchange.artifact.id, 'lookup_claim_passport');
  assert.equal(interchange.verification.assuranceSatisfied, true);
  assert.equal(interchange.compatibility.browser?.export, 'supported');
  assert.equal(interchange.compatibility.browser?.import, 'unsupported');
  assert.equal(interchange.compatibility.cli?.verify, 'supported');
  assert.doesNotMatch(JSON.stringify(interchange), /example\.com|page-identity/iu);
});

test('claim-passport verification rejects tampering and internally inconsistent re-digested documents', async () => {
  const exported = await passport();
  await assert.rejects(
    verifyOfflineArtifact(JSON.stringify({ ...exported.document, generatedAt: '2026-08-11T00:00:00.000Z' })),
    /failed its SHA-256/iu,
  );

  const missing = structuredClone(exported.document) as unknown as Record<string, unknown>;
  const missingClaim = missing.claim as Record<string, unknown>;
  missingClaim.missingEvidenceIds = [];
  await assert.rejects(
    verifyOfflineArtifact(JSON.stringify(await resign(missing))),
    /evidence identifiers.*malformed structure/iu,
  );

  const extra = structuredClone(exported.document) as unknown as Record<string, unknown>;
  (extra.claim as Record<string, unknown>).rawPage = '<html>private</html>';
  await assert.rejects(
    verifyOfflineArtifact(JSON.stringify(await resign(extra))),
    /claim.*malformed structure/iu,
  );

  const duplicate = structuredClone(exported.document) as unknown as Record<string, unknown>;
  const requirements = (duplicate.claim as Record<string, unknown>).requirements as unknown[];
  requirements.push(structuredClone(requirements[0]));
  (duplicate.claim as Record<string, unknown>).requiredEvidenceIds = requirements.map((item) => (item as Record<string, unknown>).id);
  (duplicate.claim as Record<string, unknown>).missingEvidenceIds = requirements.map((item) => (item as Record<string, unknown>).id);
  await assert.rejects(
    verifyOfflineArtifact(JSON.stringify(await resign(duplicate))),
    /requirements.*malformed structure/iu,
  );
});

test('claim-passport target normalization is type-specific and fail closed', async () => {
  for (const [type, target, expected] of [
    ['ipv4', '192.0.2.10', '192.0.2.10'],
    ['ipv6', '2001:db8::10', '2001:db8::10'],
    ['asn', 'as64496', 'AS64496'],
  ] as const) {
    const exported = await buildLookupClaimPassport({
      readiness: buildLookupClaimReadiness({
        targetType: type,
        task: 'general',
        coverage: ledger({ rdap: 'complete' }),
        decisionSupport,
      }),
      claimId: 'network-context',
      targetType: type,
      target,
      lookupDepth: 'fast',
      applicationVersion: '1.48.0',
      generatedAt: '2026-08-10T01:00:00Z',
    });
    assert.equal(exported.document.target.value, expected);
    assert.equal((await verifyOfflineArtifact(exported.content)).state, 'verified');
  }
  await assert.rejects(
    buildLookupClaimPassport({
      readiness: readiness(),
      claimId: 'brand-resemblance',
      targetType: 'domain',
      target: 'example.test/private/path',
      lookupDepth: 'deep',
      applicationVersion: '1.48.0',
    }),
    /canonical domain/iu,
  );
  await assert.rejects(
    buildLookupClaimPassport({
      readiness: readiness(),
      claimId: 'brand-resemblance',
      targetType: 'domain',
      target: `${'a'.repeat(250)}.test`,
      lookupDepth: 'deep',
      applicationVersion: '1.48.0',
    }),
    /canonical domain/iu,
  );
  await assert.rejects(
    buildLookupClaimPassport({
      readiness: readiness(),
      claimId: 'brand-resemblance',
      targetType: 'domain',
      target: 'example.test',
      lookupDepth: 'deep',
      applicationVersion: `1.2.3-${'a'.repeat(80)}`,
    }),
    /application version/iu,
  );
});
