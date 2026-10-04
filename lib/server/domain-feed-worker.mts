import { parentPort, workerData } from 'node:worker_threads';
import { domainFeedCacheStatus, queryDomainFeedCache, queryDomainFeedHistory, refreshDomainFeedCache } from './domain-feed-cache.mts';
import type { FeedFileIdentity } from './domain-feed-cache.mts';
import type { DomainFeedSelection } from '../../packages/monitoring/domain-feed.mts';
import { DOMAIN_FEED_SERVICE_LIMITATIONS, domainFeedResultAllocation } from './domain-feed-config.mts';
import { readDomainFeedRefreshes } from './domain-feed-refresh-history.mts';
import type { DomainFeedCursor } from '../../packages/monitoring/domain-feed-history.mts';

type DomainFeedWorkerTask = Readonly<{ directory: string; feedIds: string[]; operation: 'status' | 'query' | 'history' | 'refresh';
  selection?: DomainFeedSelection; cursor?: DomainFeedCursor | null; stagingFilename?: string; stagingIdentity?: FeedFileIdentity }>;

async function runDomainFeedWorker(task: DomainFeedWorkerTask) {
  if (task.operation === 'refresh') return refreshDomainFeedCache({ directory: task.directory, feedId: task.feedIds[0]!, stagingFilename: task.stagingFilename!, ...(task.stagingIdentity ? { stagingIdentity: task.stagingIdentity } : {}) });
  if (task.operation === 'history') {
    const feedId = task.feedIds[0]!;
    const history = await queryDomainFeedHistory(task.directory, feedId, task.selection!, task.cursor ?? null);
    return { enabled: true, history: { ...history, attempts: await readDomainFeedRefreshes(task.directory, feedId).catch(() => null) } };
  }
  const feeds = [];
  for (const feedId of task.feedIds) {
    try {
      const attempts = await readDomainFeedRefreshes(task.directory, feedId).catch(() => null);
      const failed = attempts?.[0] && !['updated', 'unchanged'].includes(attempts[0].outcome);
      const error = attempts === null ? 'Refresh history is unavailable; the retained snapshot is checked separately.'
        : failed ? 'Latest refresh did not complete cleanly; review retained source history.' : null;
      if (task.operation === 'status') { const status = await domainFeedCacheStatus(task.directory, feedId); feeds.push({ ...status, error: error ?? status.error }); }
      else { const result = await queryDomainFeedCache(task.directory, feedId, task.selection!, Date.now(), domainFeedResultAllocation(task.feedIds.length)); feeds.push({ feedId, ...result, error: error ?? result.error }); }
    } catch {
      feeds.push(task.operation === 'status'
        ? { feedId, cached: false, metadata: null, checkedAt: null, stale: true, error: 'Retained snapshot could not be read.' }
        : { feedId, stale: true, review: null, error: 'Retained snapshot could not be read.' });
    }
  }
  return { enabled: true, feeds, ...(task.operation === 'query' ? { limitations: DOMAIN_FEED_SERVICE_LIMITATIONS } : {}) };
}

if (parentPort) {
  void runDomainFeedWorker(workerData as DomainFeedWorkerTask).then(
    value => parentPort!.postMessage({ ok: true, value }),
    () => parentPort!.postMessage({ ok: false }),
  );
}

export { runDomainFeedWorker };
export type { DomainFeedWorkerTask };
