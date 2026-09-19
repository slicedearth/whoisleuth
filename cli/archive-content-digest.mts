import type { ArtifactCanonicalization } from '../packages/evidence/artifact-integrity.mts';

/** Bare hashes retain their original v1 meaning; new identities declare v2. */
export function parseArchiveContentDigest(value: unknown): Readonly<{
  canonicalization: ArtifactCanonicalization;
  digestSha256: string;
}> | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 'sorted-json-v2:sha256:'.length + 64) {
    throw new TypeError('Expected archive content digest must be sha256:<64 lowercase hex> or sorted-json-v2:sha256:<64 lowercase hex>.');
  }
  const explicit = value.startsWith('sorted-json-v2:');
  const digestSha256 = explicit ? value.slice('sorted-json-v2:'.length) : value;
  if (!/^sha256:[a-f0-9]{64}$/u.test(digestSha256)) {
    throw new TypeError('Expected archive content digest must be sha256:<64 lowercase hex> or sorted-json-v2:sha256:<64 lowercase hex>.');
  }
  return Object.freeze({ canonicalization: explicit ? 'sorted-json-v2' : 'sorted-json-v1', digestSha256 });
}
