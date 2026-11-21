// Reads an analyst-selected ranked domain list, such as a downloaded Tranco
// list, so triage can show which candidates appear in it and at what rank. The
// list is never fetched or bundled. A rank only shows what the selected list
// asserts; it never establishes that a domain is safe, legitimate or owned by
// the brand.

export const MAX_POPULARITY_LIST_BYTES = 32 * 1024 * 1024;
export const MAX_POPULARITY_LIST_ENTRIES = 1_000_000;
export const POPULARITY_LIMITATION = 'A rank shows that the domain appears in the selected list. It does not show that the domain is safe, legitimate or connected to the brand, and lookalikes can also be popular.';

// Fits a maximum-length hostname and rank, with room for CSV whitespace, BOM and CRLF.
const MAX_ROW_LENGTH = 512;

/** Ranks a selected list gives to the requested domains; the rest of the list is not retained. */
export type PopularityRanks = Readonly<{
  /** Valid ranked rows read from the list, counting any repeated domain each time it appears. */
  entries: number;
  rejectedLines: number;
  /** Rows after the entry limit were not read. */
  truncated: boolean;
  ranks: ReadonlyMap<string, number>;
}>;

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u;

function canonicalDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '');
}

export type PopularityRankReader = Readonly<{
  /** Adds the next chunk; a line split across chunks is completed by the next one. */
  push: (text: string) => void;
  finish: () => PopularityRanks;
}>;

/**
 * Reads "rank,domain" rows (the Tranco CSV layout) or one domain per line,
 * ranked by position, in chunks of text. Only the requested domains' first
 * ranks are kept, so a full list never needs to be held in memory. The CLI
 * and the browser worker both use this reader.
 */
export function createPopularityRankReader(domains: Iterable<string>): PopularityRankReader {
  const wanted = new Set([...domains].map(canonicalDomain));
  const ranks = new Map<string, number>();
  let remainder = '', entries = 0, rejectedLines = 0, position = 0, truncated = false;
  let oversized = false;

  function finishRow(): void {
    const value = remainder.replace(/^\uFEFF/u, '').trim();
    const tooLong = oversized;
    remainder = '';
    oversized = false;
    if (!tooLong && (!value || value.startsWith('#'))) return;
    if (entries >= MAX_POPULARITY_LIST_ENTRIES) { truncated = true; return; }
    position += 1;
    const comma = value.indexOf(',');
    if (tooLong || (comma >= 0 && value.indexOf(',', comma + 1) >= 0)) {
      rejectedLines += 1;
      return;
    }
    const rankText = comma < 0 ? null : value.slice(0, comma);
    const domain = canonicalDomain(value.slice(comma + 1));
    const rank = rankText === null ? position : Number(rankText.trim());
    if (!DOMAIN.test(domain) || !Number.isSafeInteger(rank) || rank < 1) {
      // A single header row such as "rank,domain" is not counted as rejected.
      if (!(position === 1 && /[a-z]/iu.test(rankText ?? ''))) rejectedLines += 1;
      return;
    }
    entries += 1;
    if (wanted.has(domain) && !ranks.has(domain)) ranks.set(domain, rank);
  }

  return Object.freeze({
    push(text: string) {
      for (let start = 0; start < text.length && !truncated;) {
        const newline = text.indexOf('\n', start);
        const end = newline < 0 ? text.length : newline;
        if (!oversized) {
          oversized = remainder.length + (end - start) > MAX_ROW_LENGTH;
          remainder = oversized ? '' : remainder + text.slice(start, end);
        }
        if (newline < 0) break;
        finishRow();
        start = newline + 1;
      }
    },
    finish() {
      if (remainder || oversized) finishRow();
      return Object.freeze({ entries, rejectedLines, truncated, ranks });
    },
  });
}

/** Ranks for the requested domains from a whole list already read as text. */
export function readPopularityRanks(text: string, domains: Iterable<string>): PopularityRanks {
  if (typeof text !== 'string') throw new TypeError('Select a text or CSV popularity list.');
  if (new TextEncoder().encode(text).byteLength > MAX_POPULARITY_LIST_BYTES) {
    throw new TypeError(`Popularity lists are limited to ${MAX_POPULARITY_LIST_BYTES / 1024 / 1024} MiB.`);
  }
  const reader = createPopularityRankReader(domains);
  reader.push(text);
  return reader.finish();
}
