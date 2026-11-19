import { safeFetch } from './safe-fetch.mts';
import { requestJsonCapped } from './bounded-json-response.mts';
import { parseBoundedJson } from './bounded-json.mts';
import {
  WEB_ARCHIVE_HISTORY_SCHEMA, WEB_ARCHIVE_HISTORY_TIMEOUT_MS, WEB_ARCHIVE_HISTORY_VERSION, WEB_ARCHIVE_LIMITATIONS,
  WEB_ARCHIVE_PROVIDER, WEB_ARCHIVE_QUERIES, WEB_ARCHIVE_RESPONSE_BYTES, normaliseWebArchiveRequest,
  readWebArchiveHistory, webArchiveTimestamp, type WebArchiveHistory, type WebArchiveQuery, type WebArchiveQueryKind,
} from '../packages/evidence/web-archive-history.mts';

type CollectorOptions = Readonly<{ signal?: AbortSignal }>;
type CollectorDependencies = Readonly<{ fetch?: typeof safeFetch; now?: () => string }>;

/** CDX JSON is a header row followed by at most one capture row for these queries. */
function parseCaptures(body: unknown): Pick<WebArchiveQuery, 'outcome' | 'capturedAt' | 'capturedStatus'> {
  if (!Array.isArray(body) || body.length > 2) throw new TypeError('Invalid archive response.');
  if (!body.length) return { outcome: 'no_capture', capturedAt: null, capturedStatus: null };
  const [header, row] = body;
  if (!Array.isArray(header) || header.length !== 2 || header[0] !== 'timestamp' || header[1] !== 'statuscode') {
    throw new TypeError('Invalid archive response.');
  }
  if (row === undefined) return { outcome: 'no_capture', capturedAt: null, capturedStatus: null };
  if (!Array.isArray(row) || row.length !== 2 || typeof row[1] !== 'string') throw new TypeError('Invalid archive response.');
  const capturedAt = webArchiveTimestamp(row[0]);
  if (!capturedAt) throw new TypeError('Invalid archive timestamp.');
  // Revisit records report "-" instead of a status.
  const status = /^[1-5]\d\d$/u.test(row[1]) ? Number(row[1]) : null;
  return { outcome: 'capture', capturedAt, capturedStatus: status };
}

/** Explicit action only: two bounded requests for the homepage's first and last capture, without retries. */
export async function collectWebArchiveHistory(domain: unknown,
  options: CollectorOptions = {}, dependencies: CollectorDependencies = {}): Promise<WebArchiveHistory> {
  const request = normaliseWebArchiveRequest(domain);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const deadline = AbortSignal.timeout(WEB_ARCHIVE_HISTORY_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  options.signal?.throwIfAborted();
  const queries: WebArchiveQuery[] = [];
  for (const kind of WEB_ARCHIVE_QUERIES) {
    options.signal?.throwIfAborted();
    if (signal.aborted) {
      queries.push({ kind, observedAt: now(), requestStarted: false, outcome: 'skipped', capturedAt: null, capturedStatus: null });
      continue;
    }
    queries.push(await collectQuery(kind, request.domain, signal, options, dependencies, now));
  }
  options.signal?.throwIfAborted();
  return readWebArchiveHistory({ schema: WEB_ARCHIVE_HISTORY_SCHEMA, version: WEB_ARCHIVE_HISTORY_VERSION,
    domain: request.domain, startedAt, completedAt: now(), queries });
}

async function collectQuery(kind: WebArchiveQueryKind, domain: string, signal: AbortSignal, options: CollectorOptions,
  dependencies: CollectorDependencies, now: () => string): Promise<WebArchiveQuery> {
  const url = new URL(WEB_ARCHIVE_PROVIDER.endpoint);
  url.searchParams.set('url', domain);
  url.searchParams.set('output', 'json');
  url.searchParams.set('fl', 'timestamp,statuscode');
  // Exact-URL captures are ordered by time, so the first and last rows are the earliest and latest.
  url.searchParams.set('limit', kind === 'earliest' ? '1' : '-1');
  let responseReceived = false;
  try {
    const { response, body } = await requestJsonCapped(url.toString(), { signal, headers: { Accept: 'application/json' } }, {
      fetchImpl: async (input, init) => {
        const result = await (dependencies.fetch ?? safeFetch)(String(input), init, 0);
        responseReceived = true;
        return result;
      },
      maximumBytes: WEB_ARCHIVE_RESPONSE_BYTES, timeoutMs: WEB_ARCHIVE_HISTORY_TIMEOUT_MS,
      validateRawJson: raw => { parseBoundedJson(raw, { maximumBytes: WEB_ARCHIVE_RESPONSE_BYTES,
        limits: { maximumDepth: 3, maximumKeys: 0, maximumValues: 16, maximumContainerItems: 2, maximumStringCodeUnits: 64 } }); },
    });
    if (!response.ok) throw new TypeError('Archive HTTP request failed.');
    return { kind, observedAt: now(), requestStarted: true, ...parseCaptures(body) };
  } catch (error) {
    options.signal?.throwIfAborted();
    const timeout = signal.aborted || error instanceof Error && 'code' in error && error.code === 'timeout';
    return { kind, observedAt: now(), requestStarted: true, outcome: timeout ? 'timeout' : responseReceived ? 'invalid_response' : 'error',
      capturedAt: null, capturedStatus: null };
  }
}

export function formatWebArchiveHistory(report: WebArchiveHistory): string {
  const line = (query: WebArchiveQuery) => `${query.kind === 'earliest' ? 'Earliest capture' : 'Latest capture'}: ${
    query.capturedAt ? `${query.capturedAt}${query.capturedStatus ? ` · HTTP ${query.capturedStatus}` : ''}` : query.outcome.replaceAll('_', ' ')}`;
  return [`Web archive history · ${report.domain} · ${WEB_ARCHIVE_PROVIDER.label}`, ...report.queries.map(line), ...WEB_ARCHIVE_LIMITATIONS].join('\n');
}
