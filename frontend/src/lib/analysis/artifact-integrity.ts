// Compatibility facade. Canonicalisation and digest ownership is runtime-
// neutral so CLI, browser, library, and maintainer tooling use one contract.
export {
  SORTED_JSON_V1,
  SORTED_JSON_V2,
  canonicalArtifactJson,
  canonicalArtifactJsonFor,
  canonicalArtifactJsonV2,
  resolveArtifactCanonicalization,
  sha256ArtifactDigest,
  sha256ArtifactDigestFor,
  sha256ArtifactDigestV2,
} from '../../../../packages/evidence/artifact-integrity.mts';
export type {
  ArtifactCanonicalization,
  ArtifactCanonicalizationRoute,
} from '../../../../packages/evidence/artifact-integrity.mts';
