import { MAX_POPULARITY_LIST_BYTES, parsePopularityList } from '../../../packages/analysis/popularity-list.mts';

/** Discover never holds more candidates than this, so a reply is bounded too. */
export const MAX_POPULARITY_RANKED_DOMAINS = 10_000;

export type PopularityListWorkerRequest = Readonly<{
  kind: 'rank';
  file: Blob;
  domains: readonly string[];
}>;
export type PopularityListRanks = Readonly<{
  entries: number;
  rejectedLines: number;
  truncated: boolean;
  /** Ranks for the requested candidates found in the list; the rest of the list is not returned. */
  ranks: ReadonlyArray<readonly [string, number]>;
}>;
export type PopularityListWorkerResponse = { kind: 'rank'; result: PopularityListRanks } | { kind: 'error'; detail: string };

/** Parses the selected list off the main thread and returns only the requested candidates' ranks. */
export async function runPopularityListWorkerOperation(request: PopularityListWorkerRequest): Promise<PopularityListWorkerResponse> {
  try {
    if (request?.kind !== 'rank' || !(request.file instanceof Blob) || !Array.isArray(request.domains)
      || request.domains.length > MAX_POPULARITY_RANKED_DOMAINS || request.domains.some((domain) => typeof domain !== 'string')) {
      throw new TypeError('Choose a text or CSV popularity list.');
    }
    if (request.file.size > MAX_POPULARITY_LIST_BYTES) {
      throw new RangeError(`Popularity lists are limited to ${MAX_POPULARITY_LIST_BYTES / 1024 / 1024} MiB.`);
    }
    const list = parsePopularityList(await request.file.text());
    const ranks = [...new Set(request.domains)].flatMap((domain) => {
      const rank = list.rank(domain);
      return rank === null ? [] : [[domain, rank] as const];
    });
    return { kind: 'rank', result: { entries: list.entries, rejectedLines: list.rejectedLines, truncated: list.truncated, ranks } };
  } catch (cause) {
    return { kind: 'error', detail: cause instanceof Error ? cause.message.slice(0, 300) : 'The popularity list could not be read.' };
  }
}
