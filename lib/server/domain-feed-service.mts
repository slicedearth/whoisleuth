import { createServer, type IncomingMessage } from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DOMAIN_FEED_BODY_BYTES, DOMAIN_FEED_QUERY_TIMEOUT_MS, DOMAIN_FEED_RESPONSE_BYTES, acceptsDomainFeedBearer,
  selectedDomainFeeds } from './domain-feed-config.mts';
import { parseDomainFeedOperation } from './domain-feed-client.mts';
import { DOMAIN_FEED_REFRESH_TIMEOUT_MS, prepareDomainFeedCache, createOwnedFeedFile, removeOwnedFeedFile,
  type FeedFileIdentity } from './domain-feed-cache.mts';
import type { DomainFeedWorkerTask } from './domain-feed-worker.mts';

type FeedWorker = (task: DomainFeedWorkerTask, signal: AbortSignal, timeoutMs: number) => Promise<unknown>;
class FeedServiceInputError extends Error {
  readonly status: number;
  constructor(status: number) { super('Invalid service request.'); this.status = status; }
}

function executeDomainFeedWorker(task: DomainFeedWorkerTask, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./domain-feed-worker.mts', import.meta.url), { workerData: task,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
    let settled = false;
    const finish = (error: boolean, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate().then(() => error ? reject(new Error('Feed worker unavailable.')) : resolve(value), reject);
    };
    const abort = () => finish(true);
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    worker.once('message', (reply: { ok: boolean; value?: unknown }) => finish(reply.ok !== true, reply.value));
    worker.once('error', () => finish(true));
    worker.once('exit', () => { if (!settled) finish(true); });
  });
}

async function readServiceBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new FeedServiceInputError(415);
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new FeedServiceInputError(415);
  const length = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(length) || length > DOMAIN_FEED_BODY_BYTES) throw new FeedServiceInputError(413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    signal.throwIfAborted();
    const part = Buffer.from(chunk);
    bytes += part.byteLength;
    if (bytes > DOMAIN_FEED_BODY_BYTES) throw new FeedServiceInputError(413);
    chunks.push(part);
  }
  signal.throwIfAborted();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

async function startDomainFeedService(options: { directory: string; token: string; feedIds: string[]; port?: number;
  refreshIntervalMs?: number; worker?: FeedWorker; automaticRefresh?: boolean;
  removeOwnedFile?: typeof removeOwnedFeedFile }) {
  const feedIds = selectedDomainFeeds(options.feedIds);
  if (!acceptsDomainFeedBearer(`Bearer ${options.token}`, options.token)) throw new Error('A strong service token is required.');
  await prepareDomainFeedCache(options.directory);
  const lockFilename = path.join(options.directory, 'service.lock');
  const lock = await createOwnedFeedFile(lockFilename);
  const worker = options.worker ?? executeDomainFeedWorker;
  const removeOwnedFile = options.removeOwnedFile ?? removeOwnedFeedFile;
  const jobs = new Set<Promise<unknown>>();
  const runWorker: FeedWorker = (task, signal, timeout) => {
    signal.throwIfAborted();
    const job = worker(task, signal, timeout);
    jobs.add(job);
    void job.finally(() => { jobs.delete(job); }).catch(() => {});
    return job;
  };
  const lifetime = new AbortController();
  const refreshing = new Set<string>();
  const failures = new Map<string, string>();
  let activeQueries = 0;
  let windowStarted = Date.now();
  let requests = 0;
  let origin = '';
  const server = createServer({ maxHeaderSize: 4096 }, async (request, response) => {
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return;
      const text = JSON.stringify(body);
      if (Buffer.byteLength(text) > DOMAIN_FEED_RESPONSE_BYTES) { response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end('{"error":"Feed response exceeds budget."}'); return; }
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close' });
      response.end(text);
    };
    const countHeader = (name: string) => request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === name).length;
    if (countHeader('host') !== 1 || countHeader('authorization') > 1 || countHeader('origin') > 1
      || request.headers.host !== new URL(origin).host || (request.headers.origin !== undefined && request.headers.origin !== origin)
      || request.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Request origin is not permitted.' });
    if (Date.now() - windowStarted >= 60_000) { windowStarted = Date.now(); requests = 0; }
    if (++requests > 60) return send(429, { error: 'Service request rate exceeded.' });
    if (!acceptsDomainFeedBearer(request.headers.authorization, options.token)) return send(401, { error: 'Service authentication required.' });
    if (request.method !== 'POST' || !['/status', '/query'].includes(request.url ?? '')) return send(404, { error: 'Unknown service operation.' });
    if (activeQueries >= 2) return send(429, { error: 'Service query concurrency exceeded.' });
    activeQueries += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once('close', abort);
    const timeout = setTimeout(() => { controller.abort(); request.destroy(); }, DOMAIN_FEED_QUERY_TIMEOUT_MS + 1000);
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    let admitted = false;
    try {
      const body = await readServiceBody(request, signal);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'operation')) throw new Error('Invalid service request.');
      const operation = request.url === '/status' ? parseDomainFeedOperation({ ...body, operation: 'status' })
        : parseDomainFeedOperation({ ...body, operation: 'query' });
      const selected = operation.operation === 'query' ? operation.feedIds : feedIds;
      if (selected.some(id => !feedIds.includes(id))) return send(400, { error: 'Feed is not selected by this service.' });
      admitted = true;
      const reply = await runWorker({ directory: options.directory, feedIds: selected, operation: operation.operation,
        ...(operation.operation === 'query' ? { selection: operation.selection } : {}) }, signal, DOMAIN_FEED_QUERY_TIMEOUT_MS);
      if (reply && typeof reply === 'object' && Array.isArray((reply as { feeds?: unknown }).feeds)) {
        for (const feed of (reply as { feeds: Array<{ feedId: string; error: string | null }> }).feeds) feed.error = failures.get(feed.feedId) ?? feed.error;
      }
      send(200, reply);
    } catch (error) { send(signal.aborted ? 408 : error instanceof FeedServiceInputError ? error.status : admitted ? 503 : 400,
      { error: signal.aborted ? 'Service request interrupted.' : 'Feed request could not be completed.' }); }
    finally { clearTimeout(timeout); response.off('close', abort); activeQueries -= 1; }
  });
  server.requestTimeout = DOMAIN_FEED_QUERY_TIMEOUT_MS + 1000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  server.maxConnections = 8;
  server.keepAliveTimeout = 1000;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  } catch (error) { await removeOwnedFile(lockFilename, lock); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Service listener unavailable.');
  origin = `http://127.0.0.1:${address.port}`;

  let activeRefresh: Promise<boolean> | null = null;
  function refresh(feedId: string): Promise<boolean> {
    if (!feedIds.includes(feedId)) throw new Error('Feed is not selected.');
    if (refreshing.size !== 0 || lifetime.signal.aborted) return Promise.resolve(false);
    refreshing.add(feedId);
    const stagingFilename = path.join(options.directory, `${feedId}.${randomUUID()}.pending.sqlite`);
    activeRefresh = (async () => {
      let stagingIdentity: FeedFileIdentity | null = null;
      let completed = false;
      try {
        stagingIdentity = await createOwnedFeedFile(stagingFilename);
        await runWorker({ operation: 'refresh', directory: options.directory, feedIds: [feedId], stagingFilename, stagingIdentity }, lifetime.signal, DOMAIN_FEED_REFRESH_TIMEOUT_MS + 5000);
        failures.delete(feedId);
        completed = true;
      } catch { failures.set(feedId, 'Latest refresh failed; last-good snapshot, if present, is retained.'); }
      finally {
        try { if (stagingIdentity) await removeOwnedFile(stagingFilename, stagingIdentity); }
        catch {
          failures.set(feedId, completed
            ? 'Latest refresh completed, but temporary-file cleanup failed. Retained snapshot remains available; operator review is needed.'
            : 'Latest refresh and temporary-file cleanup failed; last-good snapshot, if present, is retained. Operator review is needed.');
          completed = false;
        } finally { refreshing.delete(feedId); }
      }
      return completed;
    })().finally(() => { activeRefresh = null; });
    return activeRefresh;
  }
  let refreshCycle: Promise<void> | null = null;
  const refreshAll = () => {
    if (refreshCycle || lifetime.signal.aborted) return;
    refreshCycle = (async () => { for (const feedId of feedIds) { if (lifetime.signal.aborted) break; await refresh(feedId); } })()
      .catch(() => { for (const feedId of feedIds) failures.set(feedId, 'Automatic refresh interrupted; retained snapshots remain available. Operator review is needed.'); })
      .finally(() => { refreshCycle = null; });
  };
  const intervalMs = options.refreshIntervalMs ?? 6 * 60 * 60 * 1000;
  if (!Number.isInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 24 * 60 * 60 * 1000) { server.close(); await removeOwnedFile(lockFilename, lock); throw new Error('Invalid refresh interval.'); }
  const interval = options.automaticRefresh === false ? null : setInterval(refreshAll, intervalMs);
  if (options.automaticRefresh !== false) refreshAll();
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    lifetime.abort();
    if (interval) clearInterval(interval);
    server.closeAllConnections();
    closing = (async () => {
      const settled = await Promise.allSettled([
        new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
        refreshCycle, activeRefresh,
      ]);
      // Retain the directory lock until every owned worker has stopped writing.
      await Promise.allSettled([...jobs]);
      let cleanupFailed = false;
      try { await removeOwnedFile(lockFilename, lock); } catch { cleanupFailed = true; }
      if (cleanupFailed || settled.some(result => result.status === 'rejected')) {
        throw new Error('Feed service stopped, but shutdown cleanup could not be completed. Operator review is needed.');
      }
    })();
    return closing;
  };
  return { origin, refresh, close };
}

export { startDomainFeedService, executeDomainFeedWorker };
export type { FeedWorker };
