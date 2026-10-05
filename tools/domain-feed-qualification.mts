import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  refreshDomainFeedCache,
  domainFeedCacheStatus,
  queryDomainFeedCache,
} from '../lib/server/domain-feed-cache.mts';
import {
  DOMAIN_FEED_LIMITS,
  domainFeedDefinition,
  normalizeDomainFeedSelection,
} from '../packages/monitoring/domain-feed.mts';

/** Offline full-file replay through the actual bounded parser, cache and query owners. */
export async function qualifyDomainFeedFile(feedId: string, filename: string, directory: string) {
  domainFeedDefinition(feedId);
  const info = await lstat(filename);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 1 ||
    info.size > DOMAIN_FEED_LIMITS.bytes
  )
    throw new Error('Select a bounded regular plain-domain source file.');
  let sampledRssBytes = process.memoryUsage().rss,
    sampledHeapBytes = process.memoryUsage().heapUsed;
  const sample = () => {
    const memory = process.memoryUsage();
    sampledRssBytes = Math.max(sampledRssBytes, memory.rss);
    sampledHeapBytes = Math.max(sampledHeapBytes, memory.heapUsed);
  };
  const sampling = setInterval(sample, 100);
  const started = performance.now();
  try {
    await refreshDomainFeedCache({
      directory,
      feedId,
      stagingFilename: path.join(directory, `${feedId}.${randomUUID()}.pending.sqlite`),
      fetch: async () =>
        new Response(
          Readable.toWeb(
            createReadStream(filename, { highWaterMark: 64 * 1024 }),
          ) as ReadableStream<Uint8Array>,
        ),
    });
    sample();
    const ingestionMs = performance.now() - started;
    const status = await domainFeedCacheStatus(directory, feedId);
    const databaseFile = path.join(directory, `${feedId}.sqlite`);
    const database = new DatabaseSync(databaseFile, {
      readOnly: true,
      allowExtension: false,
      defensive: true,
    });
    let uniqueRows: number, oneHost: string;
    try {
      database.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
      uniqueRows = Number(database.prepare('SELECT count(*) AS count FROM domains').get()?.count);
      oneHost = String(
        database.prepare('SELECT domain FROM domains ORDER BY domain LIMIT 1').get()?.domain,
      );
    } finally {
      database.close();
    }
    const queries = [];
    for (const [kind, input] of [
      ['exact', { hosts: [oneHost] }],
      ['literal', { terms: ['account', 'login', 'support'] }],
    ] as const) {
      const elapsed = performance.now();
      const result = await queryDomainFeedCache(
        directory,
        feedId,
        normalizeDomainFeedSelection(input),
      );
      if (!result.review) throw new Error('The replayed snapshot is unavailable.');
      queries.push({
        kind,
        durationMs: performance.now() - elapsed,
        retained: result.review.matches.length,
        truncated: result.review.truncated,
      });
    }
    sample();
    return {
      feedId,
      source: status.metadata,
      uniqueRows,
      duplicateRows: status.metadata!.rows - uniqueRows,
      databaseBytes: (await lstat(databaseFile)).size,
      ingestionMs,
      queries,
      sampledRssBytes,
      sampledHeapBytes,
      memoryQualification:
        'Sampled process maxima are lower bounds, not true peak memory or deployment capacity.',
      networkRequests: 0,
    };
  } finally {
    clearInterval(sampling);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [feedId, filename, directory, ...extra] = process.argv.slice(2);
  if (!feedId || !filename || !directory || extra.length) {
    process.stderr.write(
      'Usage: node tools/domain-feed-qualification.mts <feed-id> <local-source-file> <private-cache-directory>\n',
    );
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(
        `${JSON.stringify(await qualifyDomainFeedFile(feedId, filename, directory), null, 2)}\n`,
      );
    } catch {
      process.stderr.write(
        'Feed qualification failed. The source may be unsupported or outside the retained resource bounds.\n',
      );
      process.exitCode = 1;
    }
  }
}
