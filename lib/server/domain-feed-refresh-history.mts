import { DatabaseSync } from 'node:sqlite';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { createOwnedFeedFile, prepareDomainFeedCache } from './domain-feed-cache.mts';
import { domainFeedDefinition } from '../../packages/monitoring/domain-feed.mts';
import {
  DOMAIN_FEED_HISTORY_ATTEMPTS,
  DOMAIN_FEED_REFRESH_OUTCOMES,
  type DomainFeedRefreshOutcome,
} from '../../packages/monitoring/domain-feed-history.mts';

async function openHistory(directory: string, writable: boolean): Promise<DatabaseSync | null> {
  const filename = path.join(directory, 'feed-history.sqlite');
  let created = false;
  if (writable) {
    await prepareDomainFeedCache(directory);
    try {
      await createOwnedFeedFile(filename);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  let info;
  try {
    info = await lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !writable) return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid()) ||
    info.size > 512 * 1024
  )
    throw new Error('Invalid refresh history file.');
  const database = new DatabaseSync(filename, {
    readOnly: !writable,
    allowExtension: false,
    defensive: true,
    timeout: 0,
  });
  try {
    database.exec('PRAGMA trusted_schema=OFF;');
    if (created)
      database.exec(
        'PRAGMA page_size=4096; PRAGMA user_version=1; CREATE TABLE attempts(id INTEGER PRIMARY KEY,feed TEXT NOT NULL,at TEXT NOT NULL,outcome TEXT NOT NULL); CREATE INDEX source_attempts ON attempts(feed,id);',
      );
    if (writable) database.exec('PRAGMA max_page_count=128; PRAGMA synchronous=FULL;');
    if (database.prepare('PRAGMA user_version').get()?.user_version !== 1)
      throw new Error('Unsupported refresh history.');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

async function recordDomainFeedRefresh(
  directory: string,
  feedId: string,
  outcome: DomainFeedRefreshOutcome,
  at = new Date().toISOString(),
) {
  domainFeedDefinition(feedId);
  if (
    !DOMAIN_FEED_REFRESH_OUTCOMES.includes(outcome) ||
    !Number.isFinite(Date.parse(at)) ||
    new Date(at).toISOString() !== at
  )
    throw new Error('Invalid refresh outcome.');
  const database = (await openHistory(directory, true))!;
  try {
    database.exec('BEGIN IMMEDIATE');
    database
      .prepare('INSERT INTO attempts(feed,at,outcome) VALUES(?,?,?)')
      .run(feedId, at, outcome);
    database
      .prepare(
        `DELETE FROM attempts WHERE feed=? AND id NOT IN (SELECT id FROM attempts WHERE feed=? ORDER BY id DESC LIMIT ${DOMAIN_FEED_HISTORY_ATTEMPTS})`,
      )
      .run(feedId, feedId);
    database.exec('COMMIT');
  } finally {
    database.close();
  }
}

async function readDomainFeedRefreshes(
  directory: string,
  feedId: string,
): Promise<Array<{ at: string; outcome: DomainFeedRefreshOutcome }>> {
  domainFeedDefinition(feedId);
  const database = await openHistory(directory, false);
  if (!database) return [];
  try {
    return database
      .prepare(
        `SELECT at,outcome FROM attempts WHERE feed=? ORDER BY id DESC LIMIT ${DOMAIN_FEED_HISTORY_ATTEMPTS}`,
      )
      .all(feedId)
      .map((row) => {
        if (
          typeof row.at !== 'string' ||
          !Number.isFinite(Date.parse(row.at)) ||
          new Date(row.at).toISOString() !== row.at ||
          !DOMAIN_FEED_REFRESH_OUTCOMES.includes(row.outcome as DomainFeedRefreshOutcome)
        )
          throw new Error('Invalid retained refresh outcome.');
        return { at: row.at, outcome: row.outcome as DomainFeedRefreshOutcome };
      });
  } finally {
    database.close();
  }
}

export { recordDomainFeedRefresh, readDomainFeedRefreshes };
