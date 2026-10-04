import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, open, opendir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { scanDomainFeed, buildDomainFeedReview, normalizeDomainFeedSelection, domainFeedDefinition,
  type DomainFeedSnapshotMetadata, type DomainFeedSelection } from '../../packages/monitoring/domain-feed.mts';
import { safeFetchDetailed } from '../safe-fetch.mts';
import { DOMAIN_FEED_STALE_MS, DOMAIN_FEED_MAX_RESULTS } from './domain-feed-config.mts';
import { normalizeExplicitIsoTimestamp } from '../../packages/evidence/observation.mts';

const DOMAIN_FEED_DATABASE_BYTES = 512 * 1024 * 1024;
const DOMAIN_FEED_CACHE_BYTES = 5 * 1024 * 1024 * 1024;
const DOMAIN_FEED_REFRESH_TIMEOUT_MS = 600_000;
type FeedFetch = (url: string, init: RequestInit) => Promise<Response>;
type FeedCacheStatus = Readonly<{ feedId: string; cached: boolean; metadata: DomainFeedSnapshotMetadata | null; checkedAt: string | null;
  stale: boolean; error: string | null }>;
type CacheMetadata = { snapshot: DomainFeedSnapshotMetadata; checkedAt: string; etag: string | null; modified: string | null };
type FeedFileIdentity = Readonly<{ dev: number; ino: number }>;

async function createOwnedFeedFile(filename: string): Promise<FeedFileIdentity> {
  const file = await open(filename, 'wx', 0o600);
  try { const identity = await file.stat(); return { dev: identity.dev, ino: identity.ino }; }
  finally { await file.close(); }
}

async function removeOwnedFeedFile(filename: string, identity: FeedFileIdentity) {
  let current;
  try { current = await lstat(filename); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await rm(filename);
}

function cacheFilename(directory: string, feedId: string): string {
  if (!domainFeedDefinition(feedId)) throw new Error('Unknown feed ID.');
  return path.join(directory, `${feedId}.sqlite`);
}

async function prepareDomainFeedCache(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (process.getuid && info.uid !== process.getuid())) throw new Error('Cache requires an owned private real directory.');
  let bytes = 0;
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    if (++entries > 32 || !/^(?:service\.lock|[a-z0-9-]+\.sqlite(?:-journal)?|[a-z0-9-]+\.[a-f0-9-]+\.pending\.sqlite)$/u.test(entry.name)) throw new Error('Unexpected cache entry.');
    const file = await lstat(path.join(directory, entry.name));
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o077) !== 0
      || (process.getuid && file.uid !== process.getuid())) throw new Error('Unexpected cache entry.');
    bytes += file.size;
    if (bytes > DOMAIN_FEED_CACHE_BYTES) throw new Error('Cache disk budget exceeded.');
  }
  return bytes;
}

async function openSnapshot(directory: string, feedId: string): Promise<DatabaseSync | null> {
  const filename = cacheFilename(directory, feedId);
  let info;
  try { info = await lstat(filename); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0
    || (process.getuid && info.uid !== process.getuid()) || info.size > DOMAIN_FEED_DATABASE_BYTES) throw new Error('Invalid cache snapshot.');
  const database = new DatabaseSync(filename, { readOnly: true, allowExtension: false, defensive: true, timeout: 0 });
  try {
    if (database.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new Error('Unsupported cache version.');
    database.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA cache_size=-8192; PRAGMA hard_heap_limit=67108864;');
    return database;
  } catch (error) { database.close(); throw error; }
}

function readCacheMetadata(database: DatabaseSync): CacheMetadata {
  const row = database.prepare('SELECT value FROM metadata WHERE id = 1').get();
  if (typeof row?.value !== 'string' || Buffer.byteLength(row.value) > 16 * 1024) throw new Error('Invalid cache metadata.');
  const result = JSON.parse(row.value) as CacheMetadata;
  if (!result || Object.keys(result).sort().join(',') !== 'checkedAt,etag,modified,snapshot') throw new Error('Invalid cache metadata.');
  if (!result.snapshot || !/^sha256:[a-f0-9]{64}$/u.test(result.snapshot.revision)
    || normalizeExplicitIsoTimestamp(result.checkedAt) !== result.checkedAt || !Number.isFinite(Date.parse(result.snapshot.importedAt))) throw new Error('Invalid cache metadata.');
  if (Object.keys(result.snapshot).sort().join(',') !== 'acquiredAt,bytes,declaredPublishedAt,declaredVersion,feedId,importedAt,revision,rows') throw new Error('Invalid cache snapshot fields.');
  buildDomainFeedReview(result.snapshot, normalizeDomainFeedSelection({ hosts: ['validation.invalid'] }), [], { matched: null, omitted: null, truncated: false });
  if (result.etag !== conditionalHeader(result.etag) || result.modified !== conditionalHeader(result.modified)) throw new Error('Invalid cache validators.');
  return result;
}

function isStale(saved: CacheMetadata, now: number): boolean {
  const checked = Date.parse(saved.checkedAt);
  const published = saved.snapshot.declaredPublishedAt === null ? null : Date.parse(saved.snapshot.declaredPublishedAt);
  return now - checked > DOMAIN_FEED_STALE_MS || checked > now
    || (published !== null && (!Number.isFinite(published) || now - published > DOMAIN_FEED_STALE_MS || published > now));
}

async function domainFeedCacheStatus(directory: string, feedId: string, now = Date.now()): Promise<FeedCacheStatus> {
  const database = await openSnapshot(directory, feedId);
  if (!database) return { feedId, cached: false, metadata: null, checkedAt: null, stale: true, error: null };
  try {
    const saved = readCacheMetadata(database);
    if (saved.snapshot.feedId !== feedId) throw new Error('Cache source identity mismatch.');
    return { feedId, cached: true, metadata: saved.snapshot, checkedAt: saved.checkedAt,
      stale: isStale(saved, now), error: null };
  } finally { database.close(); }
}

async function queryDomainFeedCache(directory: string, feedId: string, selection: DomainFeedSelection, now = Date.now(), limit = DOMAIN_FEED_MAX_RESULTS) {
  const database = await openSnapshot(directory, feedId);
  if (!database) return { stale: true, review: null, error: 'No retained snapshot is available.' };
  try {
    const saved = readCacheMetadata(database);
    if (saved.snapshot.feedId !== feedId) throw new Error('Cache source identity mismatch.');
    const normalized = normalizeDomainFeedSelection(selection);
    const clauses: string[] = [];
    const parameters: string[] = [];
    for (const host of normalized.hosts) { clauses.push('domain = ?'); parameters.push(host); }
    for (const term of normalized.terms) { clauses.push('instr(domain, ?) > 0'); parameters.push(term); }
    if (clauses.length === 0) throw new Error('A literal selection is required.');
    // Query work runs in a deadline-owned worker, including literal substring scans.
    if (!Number.isInteger(limit) || limit < 1 || limit > DOMAIN_FEED_MAX_RESULTS) throw new Error('Invalid result bound.');
    const rows = database.prepare(`SELECT domain FROM domains WHERE ${clauses.join(' OR ')} ORDER BY domain LIMIT ${limit + 1}`).all(...parameters);
    const domains = rows.slice(0, limit).map(row => String(row.domain));
    const truncated = rows.length > limit;
    const review = buildDomainFeedReview(saved.snapshot, normalized, domains, { matched: null, omitted: null, truncated });
    const stale = isStale(saved, now);
    return { stale, review, error: null };
  } finally { database.close(); }
}

async function* responseChunks(response: Response, signal: AbortSignal) {
  if (!response.body) throw new Error('Missing feed response body.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      yield value;
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function conditionalHeader(value: string | null): string | null {
  return value && value.length <= 1024 && /^[\x20-\x7e]+$/u.test(value) ? value : null;
}

async function refreshDomainFeedCache(options: { directory: string; feedId: string; stagingFilename: string;
  stagingIdentity?: FeedFileIdentity; signal?: AbortSignal; now?: () => number; fetch?: FeedFetch }) {
  const now = options.now ?? Date.now;
  const signal = AbortSignal.any([AbortSignal.timeout(DOMAIN_FEED_REFRESH_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]);
  const filename = cacheFilename(options.directory, options.feedId);
  if (path.dirname(options.stagingFilename) !== options.directory || !/^[a-z0-9-]+\.[a-f0-9-]+\.pending\.sqlite$/u.test(path.basename(options.stagingFilename))) throw new Error('Invalid staging path.');
  const existingBytes = await prepareDomainFeedCache(options.directory);
  const previous = await openSnapshot(options.directory, options.feedId);
  let retained: CacheMetadata | null = null;
  try { if (previous) retained = readCacheMetadata(previous); } finally { previous?.close(); }
  const headers = new Headers({ accept: 'text/plain', 'accept-encoding': 'identity' });
  if (retained?.etag) headers.set('if-none-match', retained.etag);
  if (retained?.modified) headers.set('if-modified-since', retained.modified);
  const definition = domainFeedDefinition(options.feedId)!;
  const fetchFeed = options.fetch ?? (async (url, init) => (await safeFetchDetailed(url, init, { maxRedirects: 0 })).response);
  const response = await fetchFeed(definition.url, { headers, signal, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 304 && retained) {
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    const database = new DatabaseSync(filename, { allowExtension: false, defensive: true, timeout: 0 });
    try {
      retained.checkedAt = new Date(now()).toISOString();
      database.prepare('UPDATE metadata SET value = ? WHERE id = 1').run(JSON.stringify(retained));
    } finally { database.close(); }
    return { changed: false };
  }
  if (response.status !== 200 || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Feed refresh was unavailable or unsupported.');
  }
  let database: DatabaseSync | null = null;
  let owned: FeedFileIdentity | null = null;
  try {
    const pageLimit = Math.floor(Math.min(DOMAIN_FEED_DATABASE_BYTES, DOMAIN_FEED_CACHE_BYTES - existingBytes) / 4096);
    if (pageLimit < 4) throw new Error('Cache disk budget exhausted.');
    if (options.stagingIdentity) {
      const info = await lstat(options.stagingFilename);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 0
        || info.dev !== options.stagingIdentity.dev || info.ino !== options.stagingIdentity.ino) throw new Error('Staging ownership changed.');
      owned = options.stagingIdentity;
    } else owned = await createOwnedFeedFile(options.stagingFilename);
    database = new DatabaseSync(options.stagingFilename, { allowExtension: false, defensive: true, timeout: 0 });
    database.exec(`PRAGMA page_size=4096; PRAGMA max_page_count=${pageLimit}; PRAGMA user_version=1; PRAGMA journal_mode=OFF; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-8192; PRAGMA hard_heap_limit=67108864; CREATE TABLE domains(domain TEXT PRIMARY KEY) WITHOUT ROWID; CREATE TABLE metadata(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);`);
    const insert = database.prepare('INSERT OR IGNORE INTO domains(domain) VALUES (?)');
    database.exec('BEGIN');
    const review = await scanDomainFeed(responseChunks(response, signal), { feedId: options.feedId, selection: normalizeDomainFeedSelection({}),
      importedAt: new Date(now()).toISOString(), signal, onDomains: async domains => { for (const domain of domains) insert.run(domain); } });
    const acquiredAt = new Date(now()).toISOString();
    const snapshot: DomainFeedSnapshotMetadata = { feedId: review.feedId, revision: review.revision, importedAt: review.importedAt,
      acquiredAt, declaredPublishedAt: review.declaredPublishedAt, declaredVersion: review.declaredVersion,
      bytes: review.bytes, rows: review.rows };
    database.prepare('INSERT INTO metadata(id,value) VALUES(1,?)').run(JSON.stringify({ snapshot, checkedAt: new Date(now()).toISOString(),
      etag: conditionalHeader(response.headers.get('etag')), modified: conditionalHeader(response.headers.get('last-modified')) }));
    database.exec('COMMIT');
    database.close(); database = null;
    signal.throwIfAborted();
    await prepareDomainFeedCache(options.directory);
    await rename(options.stagingFilename, filename);
    return { changed: true };
  } finally {
    database?.close();
    await response.body?.cancel().catch(() => {});
    if (owned) await removeOwnedFeedFile(options.stagingFilename, owned);
  }
}

export { DOMAIN_FEED_DATABASE_BYTES, DOMAIN_FEED_CACHE_BYTES, DOMAIN_FEED_REFRESH_TIMEOUT_MS, prepareDomainFeedCache,
  domainFeedCacheStatus, queryDomainFeedCache, refreshDomainFeedCache };
export { createOwnedFeedFile, removeOwnedFeedFile };
export type { FeedFetch, FeedCacheStatus, FeedFileIdentity };
