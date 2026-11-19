import { MAX_POPULARITY_LIST_BYTES, createPopularityRankReader } from '../../../packages/analysis/popularity-list.mts';

const DECODE_CHUNK_BYTES = 1024 * 1024;

/** Discover never holds more candidates than this, so a reply is bounded too. */
export const MAX_POPULARITY_RANKED_DOMAINS = 10_000;

export type PopularityListWorkerRequest = Readonly<{
  kind: 'rank';
  file: Blob;
  domains: readonly string[];
}>;
export type PopularityListRanks = Readonly<{
  /** SHA-256 of the selected file's bytes, as the CLI reports for the same file. */
  listSha256: string;
  entries: number;
  rejectedLines: number;
  truncated: boolean;
  /** Ranks for the requested candidates found in the list; the rest of the list is not returned. */
  ranks: ReadonlyArray<readonly [string, number]>;
}>;
export type PopularityListWorkerResponse = { kind: 'rank'; result: PopularityListRanks } | { kind: 'error'; detail: string };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads the selected list off the main thread and returns only the requested
 * candidates' ranks. The bytes are hashed once, then decoded in slices so the
 * whole list is never held as text or as a complete map of ranks.
 */
export async function runPopularityListWorkerOperation(request: PopularityListWorkerRequest): Promise<PopularityListWorkerResponse> {
  try {
    if (request?.kind !== 'rank' || !(request.file instanceof Blob) || !Array.isArray(request.domains)
      || request.domains.length > MAX_POPULARITY_RANKED_DOMAINS || request.domains.some((domain) => typeof domain !== 'string')) {
      throw new TypeError('Choose a text or CSV popularity list.');
    }
    if (request.file.size > MAX_POPULARITY_LIST_BYTES) {
      throw new RangeError(`Popularity lists are limited to ${MAX_POPULARITY_LIST_BYTES / 1024 / 1024} MiB.`);
    }
    const bytes = await request.file.arrayBuffer();
    const listSha256 = await sha256Hex(bytes);
    // Strict UTF-8 with the byte order mark kept, exactly as the CLI reads text input.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const reader = createPopularityRankReader(request.domains);
    try {
      for (let offset = 0; offset < bytes.byteLength; offset += DECODE_CHUNK_BYTES) {
        reader.push(decoder.decode(new Uint8Array(bytes, offset, Math.min(DECODE_CHUNK_BYTES, bytes.byteLength - offset)), { stream: true }));
      }
      reader.push(decoder.decode());
    } catch (cause) {
      if (cause instanceof TypeError) throw new TypeError('Popularity lists must contain valid UTF-8 text.');
      throw cause;
    }
    const list = reader.finish();
    const ranks = [...new Set(request.domains)].flatMap((domain) => {
      const rank = list.ranks.get(domain);
      return rank === undefined ? [] : [[domain, rank] as const];
    });
    return { kind: 'rank', result: { listSha256, entries: list.entries, rejectedLines: list.rejectedLines, truncated: list.truncated, ranks } };
  } catch (cause) {
    return { kind: 'error', detail: cause instanceof Error ? cause.message.slice(0, 300) : 'The popularity list could not be read.' };
  }
}
