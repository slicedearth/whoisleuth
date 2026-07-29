// Small environment-neutral integrity helper for deliberate local exports.
// Inputs must already be normalized and bounded by the owning artifact model.

export function canonicalArtifactJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalArtifactJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalArtifactJson(entry)}`).join(',')}}`;
}

export async function sha256ArtifactDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalArtifactJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
