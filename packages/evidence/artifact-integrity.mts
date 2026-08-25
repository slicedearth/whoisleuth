// Environment-neutral canonicalisation and digest helpers for deliberate local
// artefacts. Inputs must already be normalised and bounded by their owning
// contract before these helpers are called.

function canonicalArtifactJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalArtifactJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalArtifactJson(entry)}`).join(',')}}`;
}

async function sha256ArtifactDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalArtifactJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

const SORTED_JSON_V1 = 'sorted-json-v1';
const SORTED_JSON_V2 = 'sorted-json-v2';
type ArtifactCanonicalization = typeof SORTED_JSON_V1 | typeof SORTED_JSON_V2;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalArtifactJsonV2(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalArtifactJsonV2).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalArtifactJsonV2(entry)}`).join(',')}}`;
}

async function sha256ArtifactDigestV2(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalArtifactJsonV2(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

type ArtifactCanonicalizationRoute = Readonly<{
  version: number;
  canonicalization: ArtifactCanonicalization;
  explicit: boolean;
}>;

function resolveArtifactCanonicalization(
  version: unknown,
  declaredCanonicalization: unknown,
  routes: readonly ArtifactCanonicalizationRoute[],
  label = 'Artifact',
): ArtifactCanonicalization {
  const route = routes.find((candidate) => candidate.version === version);
  const expectedDeclaration = route?.explicit ? route.canonicalization : undefined;
  if (!route || declaredCanonicalization !== expectedDeclaration) {
    throw new TypeError(`${label} has an unsupported version or canonicalization.`);
  }
  return route.canonicalization;
}

function canonicalArtifactJsonFor(
  value: unknown,
  canonicalization: ArtifactCanonicalization,
): string {
  return canonicalization === SORTED_JSON_V1
    ? canonicalArtifactJson(value)
    : canonicalArtifactJsonV2(value);
}

function sha256ArtifactDigestFor(
  value: unknown,
  canonicalization: ArtifactCanonicalization,
): Promise<string> {
  return canonicalization === SORTED_JSON_V1
    ? sha256ArtifactDigest(value)
    : sha256ArtifactDigestV2(value);
}

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
};
export type { ArtifactCanonicalization, ArtifactCanonicalizationRoute };
