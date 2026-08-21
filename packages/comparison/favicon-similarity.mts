import {
  hammingDistanceHex,
  isInformativePerceptualHash,
  isPerceptualHash,
} from '../../lib/perceptual-hash-comparison.mts';

type FaviconRecord = Readonly<{
  domain: string;
  faviconHash: string | null;
  faviconPHash: string | null;
}>;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function faviconRecord(value: unknown): FaviconRecord | null {
  const record = plainRecord(value);
  if (!record || typeof record.domain !== 'string') return null;
  const faviconHash = typeof record.faviconHash === 'string' && record.faviconHash
    ? record.faviconHash
    : null;
  const faviconPHash = isPerceptualHash(record.faviconPHash)
    ? record.faviconPHash
    : null;
  return faviconHash || faviconPHash
    ? { domain: record.domain, faviconHash, faviconPHash }
    : null;
}

export function groupBySimilarFavicon(records: unknown, maxDistance: number): string[][] {
  const items = Array.isArray(records)
    ? records.map(faviconRecord).filter((record): record is FaviconRecord => record !== null)
    : [];
  const parent = items.map((_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    while ((parent[value] ?? value) !== root) {
      const next = parent[value] ?? value;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
  };

  const firstByHash = new Map<string, number>();
  items.forEach((item, index) => {
    if (!item.faviconHash) return;
    const existing = firstByHash.get(item.faviconHash);
    if (existing !== undefined) union(index, existing);
    else firstByHash.set(item.faviconHash, index);
  });

  const withPerceptualHash: Array<{ index: number; hash: string }> = [];
  items.forEach((item, index) => {
    if (isInformativePerceptualHash(item.faviconPHash)) {
      withPerceptualHash.push({ index, hash: item.faviconPHash });
    }
  });
  for (let leftIndex = 0; leftIndex < withPerceptualHash.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < withPerceptualHash.length; rightIndex += 1) {
      const left = withPerceptualHash[leftIndex];
      const right = withPerceptualHash[rightIndex];
      if (!left || !right) continue;
      const distance = hammingDistanceHex(left.hash, right.hash);
      if (distance !== null && distance <= maxDistance) union(left.index, right.index);
    }
  }

  const groups = new Map<number, string[]>();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)?.push(item.domain);
  });
  return [...groups.values()].filter((domains) => domains.length >= 2);
}
