export const MAX_HAR_ENTRIES = 10_000;
export const HAR_TIMING_PHASES = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'] as const;
export type HarEntry = Readonly<{
  sequence: number;
  startedAt: string | null;
  origin: string | null;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'PATCH' | 'CONNECT' | 'TRACE' | 'other' | 'unknown';
  status: number | null;
  mimeCategory: 'html' | 'text' | 'script' | 'json' | 'xml' | 'image' | 'font' | 'media' | 'binary' | 'other' | 'unknown';
  durationMs: number | null;
  timings: Readonly<Record<typeof HAR_TIMING_PHASES[number], number | null>>;
  resourceType: 'document' | 'script' | 'stylesheet' | 'image' | 'font' | 'media' | 'xhr' | 'fetch' | 'ping' | 'websocket' | 'other' | 'unknown';
  reportedFailure: boolean;
}>;
export type HarReview = Readonly<{ entries: readonly HarEntry[]; invalidEntries: number }>;
