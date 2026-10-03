// Browser-safe comparison contract for the 64-bit perceptual hashes produced
// by the bounded image decoder. Keeping comparison and informativeness here
// prevents Node and browser consumers from drifting into different matches.

export const PERCEPTUAL_HASH_HEX_RE = /^[0-9a-f]{16}$/u;
export const MIN_INFORMATIVE_HASH_BITS = 10;

const POPCOUNT = new Uint8Array(16);
for (let index = 0; index < POPCOUNT.length; index += 1) {
  POPCOUNT[index] = (index & 1) + ((index >> 1) & 1) + ((index >> 2) & 1) + ((index >> 3) & 1);
}

export function isPerceptualHash(value: unknown): value is string {
  return typeof value === 'string' && PERCEPTUAL_HASH_HEX_RE.test(value);
}

function popcountHex(hex: string): number {
  let bits = 0;
  for (let index = 0; index < hex.length; index += 1) {
    bits += POPCOUNT[parseInt(hex.charAt(index), 16)] ?? 0;
  }
  return bits;
}

export function isInformativePerceptualHash(value: unknown): value is string {
  if (!isPerceptualHash(value)) return false;
  const bits = popcountHex(value);
  return bits >= MIN_INFORMATIVE_HASH_BITS && bits <= 64 - MIN_INFORMATIVE_HASH_BITS;
}

export function hammingDistanceHex(left: unknown, right: unknown): number | null {
  if (!isPerceptualHash(left) || !isPerceptualHash(right)) return null;
  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    distance += POPCOUNT[parseInt(left.charAt(index), 16) ^ parseInt(right.charAt(index), 16)] ?? 0;
  }
  return distance;
}
