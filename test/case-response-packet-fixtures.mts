import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { canonicalArtifactJsonV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';

const LEGACY_VECTOR_RAW = readFileSync(new URL('./fixtures/artifact-integrity-v1.json', import.meta.url), 'utf8');
const LEGACY_VECTOR = JSON.parse(LEGACY_VECTOR_RAW) as Readonly<{
  artifacts: Readonly<{ caseResponse: Record<string, unknown> }>;
}>;
const FROZEN_V6_DIGEST = '29a5185a3d944af38c9656706fe89d96e60f949e8684646a55c8bcd10de54746';

/** Exact historical packet vectors. The v6 digest is pinned independently of the runtime verifier. */
export function historicalCaseResponsePacketFixture(version: 5 | 6): Record<string, unknown> {
  const v5 = structuredClone(LEGACY_VECTOR.artifacts.caseResponse);
  if (version === 5) return v5;
  const { integrity: _legacyIntegrity, ...unsignedV5 } = v5;
  const unsignedV6 = { ...unsignedV5, schemaVersion: 6 };
  const actualDigest = createHash('sha256').update(canonicalArtifactJsonV2(unsignedV6)).digest('hex');
  if (actualDigest !== FROZEN_V6_DIGEST) {
    throw new TypeError('Historical case-response packet v6 no longer matches its frozen digest.');
  }
  return {
    ...unsignedV6,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      scope: 'packet excluding integrity',
      digestSha256: FROZEN_V6_DIGEST,
    },
  };
}
