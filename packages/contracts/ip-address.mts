// Syntax and numeric ordering only; outbound address safety is a separate policy.
export type AddressValue = Readonly<{ family: 4; value: number } | { family: 6; value: bigint }>;
export type CompiledCidr = Readonly<{ cidr: string } & (
  { family: 4; mask: number; network: number }
  | { family: 6; mask: bigint; network: bigint }
)>;

export function compileCidr(value: unknown): CompiledCidr | null {
  if (typeof value !== 'string' || value.length > 96) return null;
  const [rangeText, prefixText, ...rest] = value.split('/');
  if (rest.length || !rangeText || !prefixText || !/^\d{1,3}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  const range = addressValue(rangeText);
  if (range?.family === 4 && prefix <= 32) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { cidr: value, family: 4, mask, network: (range.value & mask) >>> 0 };
  }
  if (range?.family !== 6 || prefix > 128) return null;
  const full = (1n << 128n) - 1n;
  const mask = prefix === 0 ? 0n : (full << BigInt(128 - prefix)) & full;
  return { cidr: value, family: 6, mask, network: range.value & mask };
}

export function inCompiledCidr(address: AddressValue, range: CompiledCidr): boolean {
  if (address.family === 4 && range.family === 4) return ((address.value & range.mask) >>> 0) === range.network;
  return address.family === 6 && range.family === 6 && (address.value & range.mask) === range.network;
}

/** Syntactic identity only: private and reserved addresses remain valid evidence. */
export function canonicalIpAddress(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : value;
  const parsed = addressValue(candidate);
  if (!parsed) return null;
  if (parsed.family === 4) return [24, 16, 8, 0].map(shift => (parsed.value >>> shift) & 255).join('.');
  return new URL(`https://[${candidate}]/`).hostname.slice(1, -1);
}

export function ipv6Groups(value: unknown): string[] {
  const address = addressValue(value);
  if (address?.family !== 6) return [];
  return Array.from({ length: 8 }, (_, index) => ((address.value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16).padStart(4, '0'));
}

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
