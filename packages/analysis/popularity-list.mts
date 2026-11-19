// Reads an analyst-selected ranked domain list, such as a downloaded Tranco
// list, so triage can show which candidates appear in it and at what rank. The
// list is never fetched or bundled. A rank only shows what the selected list
// asserts; it never establishes that a domain is safe, legitimate or owned by
// the brand.

export const MAX_POPULARITY_LIST_BYTES = 32 * 1024 * 1024;
export const MAX_POPULARITY_LIST_ENTRIES = 1_000_000;
export const POPULARITY_LIMITATION = 'A rank shows that the domain appears in the selected list. It does not show that the domain is safe, legitimate or connected to the brand, and lookalikes can also be popular.';

export type PopularityList = Readonly<{
  entries: number;
  rejectedLines: number;
  truncated: boolean;
  rank: (domain: string) => number | null;
}>;

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u;

/** Accepts "rank,domain" rows (the Tranco CSV layout) or one domain per line, ranked by position. */
export function parsePopularityList(text: string): PopularityList {
  if (typeof text !== 'string') throw new TypeError('Select a text or CSV popularity list.');
  if (new TextEncoder().encode(text).byteLength > MAX_POPULARITY_LIST_BYTES) {
    throw new TypeError(`Popularity lists are limited to ${MAX_POPULARITY_LIST_BYTES / 1024 / 1024} MiB.`);
  }
  const ranks = new Map<string, number>();
  let rejectedLines = 0, position = 0, truncated = false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/^﻿/u, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (ranks.size >= MAX_POPULARITY_LIST_ENTRIES) { truncated = true; break; }
    position += 1;
    const parts = line.split(',');
    const [rankText, domainText] = parts.length === 2 ? parts : [null, parts[0]];
    const domain = (domainText ?? '').trim().toLowerCase().replace(/\.$/u, '');
    const rank = rankText === null ? position : Number(rankText.trim());
    if (parts.length > 2 || !DOMAIN.test(domain) || !Number.isSafeInteger(rank) || rank < 1) {
      // A single header row such as "rank,domain" is not counted as rejected.
      if (!(position === 1 && /[a-z]/iu.test(rankText ?? ''))) rejectedLines += 1;
      continue;
    }
    if (!ranks.has(domain)) ranks.set(domain, rank);
  }
  return Object.freeze({
    entries: ranks.size,
    rejectedLines,
    truncated,
    rank: (domain: string) => ranks.get(domain.toLowerCase().replace(/\.$/u, '')) ?? null,
  });
}
