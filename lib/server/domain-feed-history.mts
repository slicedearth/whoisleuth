import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildDomainFeedReview,
  normalizeDomainFeedSelection,
  type DomainFeedSnapshotMetadata,
} from '../../packages/monitoring/domain-feed.mts';
import {
  DOMAIN_FEED_HISTORY_EDITIONS,
  type DomainFeedEdition,
} from '../../packages/monitoring/domain-feed-history.mts';

type FeedHistory = { epoch: string; editions: DomainFeedEdition[] };
function checkedSnapshot(value: unknown): DomainFeedSnapshotMetadata {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      'acquiredAt,bytes,declaredPublishedAt,declaredVersion,feedId,importedAt,revision,rows'
  )
    throw new Error('Invalid retained edition.');
  buildDomainFeedReview(value as DomainFeedSnapshotMetadata, normalizeDomainFeedSelection({}), [], {
    matched: 0,
    omitted: 0,
    truncated: false,
  });
  return value as DomainFeedSnapshotMetadata;
}

function readFeedHistory(database: DatabaseSync, current: DomainFeedSnapshotMetadata): FeedHistory {
  const version = database.prepare('PRAGMA user_version').get()?.user_version;
  if (version === 1)
    return { epoch: '', editions: [{ sequence: 1, metadata: current, membershipRetained: true }] };
  if (version !== 2) throw new Error('Unsupported feed history.');
  const epoch = database.prepare('SELECT epoch FROM history_state WHERE id=1').get()?.epoch;
  if (typeof epoch !== 'string' || !/^[a-f0-9-]{36}$/u.test(epoch))
    throw new Error('Invalid feed history identity.');
  const rows = database
    .prepare(
      `SELECT sequence, metadata, membership FROM editions ORDER BY sequence LIMIT ${DOMAIN_FEED_HISTORY_EDITIONS + 1}`,
    )
    .all();
  if (!rows.length || rows.length > DOMAIN_FEED_HISTORY_EDITIONS)
    throw new Error('Invalid feed history size.');
  const editions = rows.map((row) => {
    if (
      typeof row.sequence !== 'number' ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence < 1 ||
      typeof row.metadata !== 'string' ||
      Buffer.byteLength(row.metadata) > 16_384 ||
      ![0, 1].includes(Number(row.membership))
    )
      throw new Error('Invalid feed history metadata.');
    const metadata = checkedSnapshot(JSON.parse(row.metadata));
    if (metadata.feedId !== current.feedId) throw new Error('Feed history identity mismatch.');
    return { sequence: row.sequence, metadata, membershipRetained: row.membership === 1 };
  });
  const latest = editions.at(-1)!;
  if (
    !latest.membershipRetained ||
    JSON.stringify(latest.metadata) !== JSON.stringify(current) ||
    editions.some(
      (edition, index) => index > 0 && edition.sequence !== editions[index - 1]!.sequence + 1,
    )
  )
    throw new Error('Feed history is not contiguous with the current snapshot.');
  return { epoch, editions };
}

/** Add bounded prior membership to a new staged snapshot; never mutate the last-good file. */
function retainFeedHistory(
  database: DatabaseSync,
  snapshot: DomainFeedSnapshotMetadata,
  previous: DatabaseSync | null,
  previousSnapshot: DomainFeedSnapshotMetadata | null,
  pageLimit: number,
  signal: AbortSignal,
): DomainFeedSnapshotMetadata {
  const old = previous && previousSnapshot ? readFeedHistory(previous, previousSnapshot) : null;
  const unchanged = previousSnapshot?.revision === snapshot.revision;
  const current = unchanged ? previousSnapshot! : snapshot;
  const last = old?.editions.at(-1)?.sequence ?? 0;
  const sequence = unchanged ? last : last + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= Number.MAX_SAFE_INTEGER)
    throw new Error('Feed edition sequence exhausted.');
  database.exec(
    'CREATE TABLE history_state(id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL); CREATE TABLE editions(sequence INTEGER PRIMARY KEY, metadata TEXT NOT NULL, membership INTEGER NOT NULL CHECK(membership IN (0,1))); CREATE TABLE past_domains(sequence INTEGER NOT NULL, domain TEXT NOT NULL, PRIMARY KEY(sequence,domain)) WITHOUT ROWID;',
  );
  database
    .prepare('INSERT INTO history_state(id,epoch) VALUES(1,?)')
    .run(old?.epoch || randomUUID());
  const insertEdition = database.prepare(
    'INSERT INTO editions(sequence,metadata,membership) VALUES(?,?,?)',
  );
  insertEdition.run(sequence, JSON.stringify(current), 1);
  const retained = (old?.editions ?? [])
    .filter((edition) => edition.sequence !== sequence)
    .slice(-(DOMAIN_FEED_HISTORY_EDITIONS - 1));
  const insert = database.prepare('INSERT INTO past_domains(sequence,domain) VALUES(?,?)');
  let capacity = true;
  // Prefer recent editions. Retain older metadata even when its membership will not fit.
  for (const edition of [...retained].reverse()) {
    signal.throwIfAborted();
    let complete = capacity && edition.membershipRetained;
    if (complete) {
      const currentOld = edition.sequence === last;
      const query = previous!.prepare(
        currentOld
          ? 'SELECT domain FROM domains WHERE domain > ? ORDER BY domain LIMIT 256'
          : 'SELECT domain FROM past_domains WHERE sequence = ? AND domain > ? ORDER BY domain LIMIT 256',
      );
      let after = '';
      while (true) {
        signal.throwIfAborted();
        const rows = currentOld ? query.all(after) : query.all(edition.sequence, after);
        if (!rows.length) break;
        // A conservative page allowance is checked before each bounded insert batch.
        // SQLite's max_page_count remains the independent hard disk backstop.
        const allocated = Number(database.prepare('PRAGMA page_count').get()?.page_count);
        const free = Number(database.prepare('PRAGMA freelist_count').get()?.freelist_count);
        if (allocated - free + Math.ceil(rows.length / 2) + 16 >= pageLimit) {
          complete = false;
          capacity = false;
          break;
        }
        for (const row of rows) {
          if (typeof row.domain !== 'string' || row.domain.length > 253)
            throw new Error('Invalid retained membership.');
          insert.run(edition.sequence, row.domain);
          after = row.domain;
        }
      }
      if (!complete)
        database.prepare('DELETE FROM past_domains WHERE sequence=?').run(edition.sequence);
    }
    insertEdition.run(edition.sequence, JSON.stringify(edition.metadata), complete ? 1 : 0);
  }
  database.exec('PRAGMA user_version=2');
  return current;
}

export { readFeedHistory, retainFeedHistory };
