// IANA RDAP bootstrap retrieval, bounded stale caching, and authority
// selection for domain, IP, and ASN queries.

import {
  fetchRdapDetailedWithTimeout,
  type RdapFetch,
} from './rdap-transport.mts';

type LooseRecord = Record<string, unknown>;
type BootstrapData = { services: Array<[string[], string[]]> };
type BootstrapOptions = {
  now?: () => number;
  fetchUpstream?: RdapFetch;
};

const BOOTSTRAP_TTL_MS = 60 * 60 * 1000;
const BOOTSTRAP_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_KINDS = new Set(['dns', 'ipv4', 'ipv6', 'asn']);
const BOOTSTRAP_FETCH_TIMEOUT_MS = 7000;
const MAX_RDAP_ENDPOINT_LENGTH = 2048;
const bootstrapCache = new Map<string, { data: BootstrapData; fetchedAt: number }>();
const bootstrapInflight = new Map<string, Promise<BootstrapData>>();

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce(
    (accumulator, octet) => (accumulator << 8) + (parseInt(octet, 10) & 0xff),
    0,
  ) >>> 0;
}

function ipInCidrV4(ip: string, cidr: string): boolean {
  const [range, bitsString] = cidr.split('/');
  if (!range) return false;
  const bits = bitsString !== undefined ? parseInt(bitsString, 10) : 32;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(range) & mask);
}

function expandIpv6(ip: string): string[] {
  let head = ip;
  let tail = '';
  if (ip.includes('::')) {
    const [headPart = '', tailPart = ''] = ip.split('::');
    head = headPart;
    tail = tailPart;
  }
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = ip.includes('::')
    ? [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
    : headParts;
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8);
}

function ipv6ToBigInt(ip: string): bigint {
  return expandIpv6(ip).reduce(
    (accumulator, part) => (accumulator << 16n) + BigInt(parseInt(part || '0', 16)),
    0n,
  );
}

function ipInCidrV6(ip: string, cidr: string): boolean {
  const [range, bitsString] = cidr.split('/');
  if (!range) return false;
  const bits = bitsString !== undefined ? parseInt(bitsString, 10) : 128;
  const full = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : (full << BigInt(128 - bits)) & full;
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
}

function validBootstrap(data: unknown): data is BootstrapData {
  const record = data && typeof data === 'object' && !Array.isArray(data)
    ? data as LooseRecord
    : null;
  return Boolean(record
    && Array.isArray(record.services) && record.services.length > 0
    && record.services.every((service: unknown) => Array.isArray(service) && service.length >= 2
      && Array.isArray(service[0]) && service[0].length > 0
      && service[0].every((entry: unknown) => typeof entry === 'string' && entry.length > 0)
      && Array.isArray(service[1]) && service[1].length > 0
      && service[1].some((url: unknown) => typeof url === 'string' && /^https?:\/\//i.test(url))));
}

async function fetchBootstrap(kind: string, options: BootstrapOptions = {}): Promise<BootstrapData> {
  if (!BOOTSTRAP_KINDS.has(kind)) throw new Error(`Unsupported RDAP bootstrap kind: ${kind}`);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const fetchUpstream = options.fetchUpstream || fetchRdapDetailedWithTimeout;
  const cached = bootstrapCache.get(kind);
  if (cached && now() - cached.fetchedAt < BOOTSTRAP_TTL_MS) return cached.data;
  const inflight = bootstrapInflight.get(kind);
  if (inflight) return inflight;

  const request = (async () => {
    try {
      const response = await fetchUpstream(
        `https://data.iana.org/rdap/${kind}.json`,
        {},
        BOOTSTRAP_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`IANA bootstrap fetch failed for ${kind} (${response.status})`);
      }
      let data: unknown;
      try {
        data = JSON.parse(response.text);
      } catch {
        throw new Error(`IANA bootstrap returned invalid JSON for ${kind}`);
      }
      if (!validBootstrap(data)) {
        throw new Error(`IANA bootstrap returned an unexpected format for ${kind}`);
      }
      bootstrapCache.set(kind, { data, fetchedAt: now() });
      return data;
    } catch (cause) {
      const fallback = bootstrapCache.get(kind);
      if (fallback && now() - fallback.fetchedAt <= BOOTSTRAP_STALE_TTL_MS) {
        return fallback.data;
      }
      throw cause;
    } finally {
      bootstrapInflight.delete(kind);
    }
  })();
  bootstrapInflight.set(kind, request);
  return request;
}

function clearRdapBootstrapCache() {
  bootstrapCache.clear();
  bootstrapInflight.clear();
}

function uniqueRdapBases(urls: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(urls) ? urls : [])
    .filter((url): url is string => typeof url === 'string'
      && url.length <= MAX_RDAP_ENDPOINT_LENGTH
      && !/[\u0000-\u001f\u007f]/.test(url)
      && /^https?:\/\//i.test(url))
    .sort((left, right) => Number(/^http:\/\//i.test(left)) - Number(/^http:\/\//i.test(right)))
    .filter((url) => {
      const key = url.replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function findRdapBases(type: string, value: string): Promise<string[]> {
  if (type === 'domain') {
    const bootstrap = await fetchBootstrap('dns');
    const tld = value.split('.').pop()?.toLowerCase() || '';
    for (const [tlds, urls] of bootstrap.services) {
      if (tlds.some((entry) => entry.toLowerCase() === tld)) return uniqueRdapBases(urls);
    }
    return [];
  }

  if (type === 'ipv4' || type === 'ipv6') {
    const bootstrap = await fetchBootstrap(type);
    const matcher = type === 'ipv4' ? ipInCidrV4 : ipInCidrV6;
    let best: string[] | null = null;
    let bestPrefix = -1;
    for (const [cidrs, urls] of bootstrap.services) {
      for (const cidr of cidrs) {
        if (!matcher(value, cidr)) continue;
        const fallbackPrefix = type === 'ipv4' ? '32' : '128';
        const prefix = parseInt(cidr.split('/')[1] ?? fallbackPrefix, 10);
        if (prefix > bestPrefix) {
          bestPrefix = prefix;
          best = uniqueRdapBases(urls);
        }
      }
    }
    return best || [];
  }

  if (type === 'asn') {
    const bootstrap = await fetchBootstrap('asn');
    const number = parseInt(value.replace(/^AS/i, ''), 10);
    for (const [ranges, urls] of bootstrap.services) {
      for (const range of ranges) {
        const [start, end] = range.includes('-')
          ? range.split('-').map(Number)
          : [Number(range), Number(range)];
        if (start !== undefined && end !== undefined && number >= start && number <= end) {
          return uniqueRdapBases(urls);
        }
      }
    }
  }

  return [];
}

export {
  BOOTSTRAP_STALE_TTL_MS,
  BOOTSTRAP_TTL_MS,
  MAX_RDAP_ENDPOINT_LENGTH,
  clearRdapBootstrapCache,
  fetchBootstrap,
  findRdapBases,
  ipv4ToLong,
  ipv6ToBigInt,
  uniqueRdapBases,
};
