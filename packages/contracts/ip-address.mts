// Syntax and numeric ordering only; outbound address safety is a separate policy.
export type AddressValue = Readonly<{ family: 4; value: number } | { family: 6; value: bigint }>;

export function addressValue(value: unknown): AddressValue | null {
  if (typeof value !== 'string' || value.length > 96) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) {
    const octets = value.split('.').map(Number);
    return octets.every(octet => octet >= 0 && octet <= 255)
      ? { family: 4, value: octets.reduce((total, octet) => (total << 8) + octet, 0) >>> 0 } : null;
  }
  if (!value.includes(':') || !/^[0-9a-f:.]+$/iu.test(value)) return null;
  try {
    const hostname = new URL(`https://[${value}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    const pieces = hostname.slice(1, -1).split('::');
    const left = pieces[0] ? pieces[0].split(':') : [];
    const right = pieces[1] ? pieces[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (pieces.length > 2 || pieces.length === 1 && missing !== 0 || pieces.length === 2 && missing < 1
      || [...left, ...right].some(part => !/^[0-9a-f]{1,4}$/iu.test(part))) return null;
    const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
    return { family: 6, value: parts.reduce((total, part) => (total << 16n) + BigInt(`0x${part}`), 0n) };
  } catch { return null; }
}
