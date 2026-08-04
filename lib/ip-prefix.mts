import { isIP } from 'node:net';

type IpPrefix = Readonly<{
  family: 4 | 6;
  address: string;
  length: number;
  value: bigint;
  mask: bigint;
}>;

function ipv4Value(value: string): bigint {
  return value.split('.').reduce((total, part) => (total << 8n) | BigInt(Number(part)), 0n);
}

function ipv6Parts(value: string): number[] | null {
  if (value.includes('.')) return null;
  const halves = value.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))
    || right.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0 || halves.length === 2 && missing < 1) return null;
  return [...left, ...Array(missing).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
}

function ipValue(value: string, family: 4 | 6): bigint | null {
  if (family === 4) return ipv4Value(value);
  const parts = ipv6Parts(value);
  return parts?.reduce((total, part) => (total << 16n) | BigInt(part), 0n) ?? null;
}

function parseIpPrefix(value: unknown): IpPrefix | null {
  if (typeof value !== 'string' || value.length > 96 || /[\s%\u0000-\u001f\u007f]/u.test(value)) return null;
  const [addressValue, lengthValue, ...rest] = value.toLowerCase().split('/');
  if (!addressValue || rest.length > 0) return null;
  const family = isIP(addressValue);
  if (family !== 4 && family !== 6) return null;
  const maximum = family === 4 ? 32 : 128;
  if (lengthValue !== undefined && !/^\d{1,3}$/u.test(lengthValue)) return null;
  const length = lengthValue === undefined ? maximum : Number(lengthValue);
  if (!Number.isInteger(length) || length < 0 || length > maximum) return null;
  const numeric = ipValue(addressValue, family);
  if (numeric === null) return null;
  const full = (1n << BigInt(maximum)) - 1n;
  const mask = length === 0 ? 0n : (full << BigInt(maximum - length)) & full;
  return Object.freeze({ family, address: addressValue, length, value: numeric & mask, mask });
}

function prefixContains(container: IpPrefix, candidate: IpPrefix): boolean {
  return container.family === candidate.family
    && container.length <= candidate.length
    && (candidate.value & container.mask) === container.value;
}

function formatIpPrefix(prefix: IpPrefix): string {
  if (prefix.family === 4) {
    const parts = [24n, 16n, 8n, 0n].map((shift) => Number((prefix.value >> shift) & 255n));
    return `${parts.join('.')}/${prefix.length}`;
  }
  const parts = Array.from({ length: 8 }, (_, index) => {
    const shift = BigInt((7 - index) * 16);
    return ((prefix.value >> shift) & 0xffffn).toString(16);
  });
  return `${parts.join(':')}/${prefix.length}`;
}

export { parseIpPrefix, prefixContains, formatIpPrefix };
export type { IpPrefix };
