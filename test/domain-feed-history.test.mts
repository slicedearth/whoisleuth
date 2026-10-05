import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {
  refreshDomainFeedCache,
  queryDomainFeedHistory,
  domainFeedCacheStatus,
} from '../lib/server/domain-feed-cache.mts';
import {
  recordDomainFeedRefresh,
  readDomainFeedRefreshes,
} from '../lib/server/domain-feed-refresh-history.mts';
import { normalizeDomainFeedSelection } from '../packages/monitoring/domain-feed.mts';
import {
  normalizeDomainFeedHistoryPage,
  DOMAIN_FEED_HISTORY_EDITIONS,
  DOMAIN_FEED_HISTORY_ATTEMPTS,
} from '../packages/monitoring/domain-feed-history.mts';
import {
  parseDomainFeedOperation,
  validateDomainFeedReply,
  executeDomainFeedOperation,
} from '../lib/server/domain-feed-client.mts';
import { startDomainFeedService } from '../lib/server/domain-feed-service.mts';
import { readFeedHistory, retainFeedHistory } from '../lib/server/domain-feed-history.mts';
import { qualifyDomainFeedFile } from '../tools/domain-feed-qualification.mts';
import { writeFile } from 'node:fs/promises';
import { runDomainFeedWorker } from '../lib/server/domain-feed-worker.mts';

const FEED = 'tif-mini',
  NOW = Date.parse('2026-10-04T00:00:00.000Z');
const selection = normalizeDomainFeedSelection({ terms: ['candidate'] });
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'domain-feed-history-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function retain(directory: string, text: string, offset = 0) {
  return refreshDomainFeedCache({
    directory,
    feedId: FEED,
    stagingFilename: path.join(directory, `${FEED}.${randomUUID()}.pending.sqlite`),
    now: () => NOW + offset,
    fetch: async () => new Response(text),
  });
}

test('retained editions replay exact membership and keep unchanged acquisitions stable', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate-a.example\n');
    const first = await queryDomainFeedHistory(directory, FEED, selection, null);
    assert.equal(first.state, 'review');
    assert.equal(first.sequence, 1);
    assert.equal(first.review?.matches[0]?.domain, 'candidate-a.example');
    assert.deepEqual(normalizeDomainFeedHistoryPage(first, FEED, selection), first);
    assert.deepEqual(await retain(directory, 'candidate-a.example\n', 1000), { changed: false });
    assert.deepEqual(
      (await domainFeedCacheStatus(directory, FEED, NOW)).metadata,
      first.editions[0]?.metadata,
    );
    await retain(directory, 'candidate-b.example\n', 2000);
    await retain(directory, 'candidate-a.example\n', 3000);
    const replay = await queryDomainFeedHistory(directory, FEED, selection, null);
    assert.equal(replay.editions.length, 3);
    assert.equal(replay.review?.matches[0]?.domain, 'candidate-a.example');
    const second = await queryDomainFeedHistory(directory, FEED, selection, replay.nextCursor);
    assert.equal(second.review?.matches[0]?.domain, 'candidate-b.example');
    const third = await queryDomainFeedHistory(directory, FEED, selection, second.nextCursor);
    assert.equal(third.review?.matches[0]?.domain, 'candidate-a.example');
    const done = await queryDomainFeedHistory(directory, FEED, selection, third.nextCursor);
    assert.equal(done.state, 'complete');
    assert.equal(done.sequence, 4);
    await retain(directory, 'candidate-c.example\n', 4000);
    const resumed = await queryDomainFeedHistory(directory, FEED, selection, done.nextCursor);
    assert.equal(resumed.sequence, 4);
    assert.equal(resumed.review?.matches[0]?.domain, 'candidate-c.example');
  }));

test('pagination never silently drops matches and fixes a reviewed upper edition across refreshes', async () =>
  temporary(async (directory) => {
    await retain(
      directory,
      Array.from({ length: 251 }, (_, i) => `candidate-${String(i).padStart(3, '0')}.example`).join(
        '\n',
      ),
    );
    const first = await queryDomainFeedHistory(directory, FEED, selection, null);
    assert.equal(first.review?.matches.length, 200);
    assert.equal(first.review?.truncated, true);
    assert.equal(first.nextCursor.sequence, 1);
    await retain(directory, 'candidate-new.example\n', 1000);
    const rest = await queryDomainFeedHistory(directory, FEED, selection, first.nextCursor);
    assert.equal(rest.review?.matches.length, 51);
    assert.equal(rest.through, 1);
    assert.equal(
      new Set([...first.review!.matches, ...rest.review!.matches].map((item) => item.domain)).size,
      251,
    );
    assert.ok(normalizeDomainFeedHistoryPage(rest, FEED, selection));
  }));

test('pruned editions produce one explicit gap instead of a fabricated empty review', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate-0.example\n');
    const first = await queryDomainFeedHistory(directory, FEED, selection, null);
    for (let i = 1; i <= DOMAIN_FEED_HISTORY_EDITIONS + 2; i++)
      await retain(directory, `candidate-${i}.example\n`, i * 1000);
    const page = await queryDomainFeedHistory(directory, FEED, selection, first.nextCursor);
    assert.equal(page.state, 'gap');
    assert.equal(page.review, null);
    assert.equal(page.earlierEditionsUnavailable, true);
    assert.equal(page.editions.length, DOMAIN_FEED_HISTORY_EDITIONS);
    assert.equal(page.nextCursor.sequence, page.editions[0]!.sequence);
    const next = await queryDomainFeedHistory(directory, FEED, selection, page.nextCursor);
    assert.equal(next.state, 'review');
    assert.ok(next.nextCursor.sequence > next.sequence);
  }));

test('cursors reject changed selectors, changed history and tampered reply attribution', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate.example\n');
    const page = await queryDomainFeedHistory(directory, FEED, selection, null);
    await assert.rejects(
      queryDomainFeedHistory(
        directory,
        FEED,
        normalizeDomainFeedSelection({ terms: ['different'] }),
        page.nextCursor,
      ),
      /rules/u,
    );
    await assert.rejects(
      queryDomainFeedHistory(directory, FEED, selection, {
        ...page.nextCursor,
        epoch: randomUUID(),
      }),
      /replaced/u,
    );
    for (const patch of [{ acquiredAt: null }, { importedAt: '2020-01-01T00:00:00.000Z' }]) {
      assert.throws(() =>
        normalizeDomainFeedHistoryPage(
          { ...page, review: { ...page.review, ...patch } },
          FEED,
          selection,
        ),
      );
    }
    assert.throws(() =>
      normalizeDomainFeedHistoryPage(
        { ...page, nextCursor: { ...page.nextCursor, sequence: 8 } },
        FEED,
        selection,
      ),
    );
  }));

test('historical cache upgrades only on successful refresh and future cache versions fail closed', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate-old.example\n');
    const filename = path.join(directory, `${FEED}.sqlite`),
      database = new DatabaseSync(filename);
    database.exec(
      'DROP TABLE history_state; DROP TABLE editions; DROP TABLE past_domains; PRAGMA user_version=1',
    );
    database.close();
    await assert.rejects(queryDomainFeedHistory(directory, FEED, selection, null), /predates/u);
    await retain(directory, 'candidate-new.example\n', 1000);
    const migrated = await queryDomainFeedHistory(directory, FEED, selection, null);
    assert.equal(migrated.editions.length, 2);
    assert.equal(migrated.review?.matches[0]?.domain, 'candidate-old.example');
    const future = new DatabaseSync(filename);
    future.exec('PRAGMA user_version=999');
    future.close();
    await assert.rejects(queryDomainFeedHistory(directory, FEED, selection, null), /Unsupported/u);
  }));

test('refresh outcomes survive restart, remain bounded and contain no targets or error messages', async () =>
  temporary(async (directory) => {
    for (let i = 0; i < DOMAIN_FEED_HISTORY_ATTEMPTS + 3; i++)
      await recordDomainFeedRefresh(
        directory,
        FEED,
        i % 2 ? 'failed' : 'updated',
        new Date(NOW + i * 1000).toISOString(),
      );
    const attempts = await readDomainFeedRefreshes(directory, FEED);
    assert.equal(attempts.length, DOMAIN_FEED_HISTORY_ATTEMPTS);
    assert.deepEqual(Object.keys(attempts[0]!).sort(), ['at', 'outcome']);
    assert.equal((await stat(path.join(directory, 'feed-history.sqlite'))).mode & 0o077, 0);
    await assert.rejects(recordDomainFeedRefresh(directory, FEED, 'private error' as 'failed'));
    assert.equal((await readDomainFeedRefreshes(directory, 'nrd7')).length, 0);
  }));

test('legacy validators cannot keep a successful refresh outside edition history', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate.example\n');
    const filename = path.join(directory, `${FEED}.sqlite`),
      database = new DatabaseSync(filename);
    const before = (await domainFeedCacheStatus(directory, FEED, NOW)).metadata;
    const metadata = JSON.parse(
      String(database.prepare('SELECT value FROM metadata WHERE id=1').get()?.value),
    );
    metadata.etag = '"legacy-edition"';
    metadata.modified = 'Sun, 04 Oct 2026 00:00:00 GMT';
    database.prepare('UPDATE metadata SET value=? WHERE id=1').run(JSON.stringify(metadata));
    database.exec(
      'DROP TABLE history_state; DROP TABLE editions; DROP TABLE past_domains; PRAGMA user_version=1',
    );
    database.close();
    let requests = 0;
    const result = await refreshDomainFeedCache({
      directory,
      feedId: FEED,
      stagingFilename: path.join(directory, `${FEED}.${randomUUID()}.pending.sqlite`),
      now: () => NOW + 1000,
      fetch: async (_url, init) => {
        requests++;
        const headers = new Headers(init.headers);
        assert.equal(headers.has('if-none-match'), false);
        assert.equal(headers.has('if-modified-since'), false);
        return new Response('candidate.example\n', { headers: { etag: '"legacy-edition"' } });
      },
    });
    assert.deepEqual(result, { changed: false });
    assert.equal(requests, 1);
    const history = await queryDomainFeedHistory(directory, FEED, selection, null);
    assert.equal(history.editions.length, 1);
    assert.deepEqual(history.editions[0]?.metadata, before);
    assert.equal(history.review?.matches[0]?.domain, 'candidate.example');
  }));

test('unreadable or future refresh logs never hide independently valid feed editions', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate.example\n');
    const filename = path.join(directory, 'feed-history.sqlite');
    for (const mode of ['corrupt', 'future'] as const) {
      await rm(filename, { force: true });
      if (mode === 'corrupt') await writeFile(filename, 'not a database', { mode: 0o600 });
      else {
        await recordDomainFeedRefresh(directory, FEED, 'updated', new Date(NOW).toISOString());
        const database = new DatabaseSync(filename);
        database.exec('PRAGMA user_version=999');
        database.close();
      }
      for (const operation of ['status', 'query', 'history'] as const) {
        const request = {
          operation,
          feedIds: [FEED],
          ...(operation === 'status' ? {} : { selection }),
          ...(operation === 'history' ? { cursor: null } : {}),
        };
        const response = await runDomainFeedWorker({ directory, ...request });
        const wireRequest =
          operation === 'status'
            ? { operation }
            : { ...request, selection: { terms: ['candidate'] } };
        const checked = validateDomainFeedReply(
          response,
          parseDomainFeedOperation(wireRequest),
        ) as {
          history: ReturnType<typeof normalizeDomainFeedHistoryPage>;
          feeds: {
            error: string;
            cached?: boolean;
            review?: { matches: readonly { domain: string }[] };
          }[];
        };
        if (operation === 'history') {
          assert.equal(checked.history.attempts, null);
          assert.equal(checked.history.review?.matches[0]?.domain, 'candidate.example');
        } else {
          assert.match(checked.feeds[0]!.error, /could not be confirmed/u);
          if (operation === 'status') assert.equal(checked.feeds[0]!.cached, true);
          else assert.equal(checked.feeds[0]!.review?.matches[0]?.domain, 'candidate.example');
        }
      }
    }
  }));

test('declared publication rollback preserves the complete last-good edition range', async () =>
  temporary(async (directory) => {
    await retain(directory, '# Last modified: 04 Oct 2026 00:00 UTC\ncandidate-current.example\n');
    const before = await queryDomainFeedHistory(directory, FEED, selection, null);
    await assert.rejects(
      retain(directory, '# Last modified: 03 Oct 2026 00:00 UTC\ncandidate-rollback.example\n'),
      /backwards/u,
    );
    assert.deepEqual(await queryDomainFeedHistory(directory, FEED, selection, null), before);
  }));

test('history transport remains explicit, authenticated and source/selector-bound', async () =>
  temporary(async (directory) => {
    await retain(directory, 'candidate.example\n');
    const token = 'fixture'.repeat(8),
      service = await startDomainFeedService({
        directory,
        token,
        feedIds: [FEED],
        automaticRefresh: false,
      });
    try {
      const operation = parseDomainFeedOperation({
        operation: 'history',
        feedIds: [FEED],
        selection: { terms: ['candidate'] },
        cursor: null,
      });
      const result = await executeDomainFeedOperation(operation, {
        env: {
          WHOISLEUTH_DOMAIN_FEED_ENABLED: '1',
          WHOISLEUTH_DOMAIN_FEED_URL: service.origin,
          WHOISLEUTH_DOMAIN_FEED_TOKEN: token,
        },
      });
      assert.equal(result.status, 200);
      assert.ok(validateDomainFeedReply(result.body, operation));
      assert.throws(() =>
        parseDomainFeedOperation({
          operation: 'history',
          feedIds: [FEED, 'nrd7'],
          selection: { terms: ['candidate'] },
          cursor: null,
        }),
      );
      assert.throws(() =>
        parseDomainFeedOperation({
          operation: 'history',
          feedIds: [FEED],
          selection: { terms: ['candidate'], brandProfileId: 'private-brand' },
          cursor: null,
        }),
      );
    } finally {
      await service.close();
    }
  }));

test('history capacity pruning retains metadata and never presents a partial membership as complete', async () =>
  temporary(async (directory) => {
    await retain(
      directory,
      Array.from({ length: 300 }, (_, i) => `candidate-${i}.example`).join('\n'),
    );
    const old = new DatabaseSync(path.join(directory, `${FEED}.sqlite`), { readOnly: true });
    const saved = (await domainFeedCacheStatus(directory, FEED, NOW)).metadata!;
    const staged = new DatabaseSync(':memory:');
    try {
      staged.exec('CREATE TABLE domains(domain TEXT PRIMARY KEY) WITHOUT ROWID');
      const next = { ...saved, revision: `sha256:${'a'.repeat(64)}`, rows: 1 };
      retainFeedHistory(staged, next, old, saved, 32, new AbortController().signal);
      const history = readFeedHistory(staged, next);
      assert.equal(history.editions[0]?.membershipRetained, false);
      assert.equal(history.editions[1]?.membershipRetained, true);
      assert.equal(staged.prepare('SELECT count(*) AS count FROM past_domains').get()?.count, 0);
    } finally {
      old.close();
      staged.close();
    }
  }));

test('offline qualification measures complete source bytes and distinct storage without reporting hostnames', async () =>
  temporary(async (directory) => {
    const source = path.join(directory, 'source.txt'),
      cache = path.join(directory, 'cache');
    const text = 'candidate.example\ncandidate.example\nother.example\n';
    await writeFile(source, text);
    const result = await qualifyDomainFeedFile(FEED, source, cache);
    assert.equal(result.source?.bytes, Buffer.byteLength(text));
    assert.equal(result.source?.rows, 3);
    assert.equal(result.uniqueRows, 2);
    assert.equal(result.duplicateRows, 1);
    assert.equal(result.networkRequests, 0);
    assert.doesNotMatch(JSON.stringify(result), /candidate\.example|other\.example/u);
    assert.equal(result.queries[0]?.retained, 1);
    assert.ok(result.databaseBytes > 0);
  }));
