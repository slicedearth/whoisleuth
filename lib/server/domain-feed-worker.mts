import { parentPort, workerData } from 'node:worker_threads';
import { domainFeedCacheStatus, queryDomainFeedCache, refreshDomainFeedCache } from './domain-feed-cache.mts';
import type { FeedFileIdentity } from './domain-feed-cache.mts';
import type { DomainFeedSelection } from '../../packages/monitoring/domain-feed.mts';
import { DOMAIN_FEED_SERVICE_LIMITATIONS } from './domain-feed-config.mts';

type DomainFeedWorkerTask = Readonly<{ directory: string; feedIds: string[]; operation: 'status' | 'query' | 'refresh';
  selection?: DomainFeedSelection; stagingFilename?: string; stagingIdentity?: FeedFileIdentity }>;

async function runDomainFeedWorker(task: DomainFeedWorkerTask) {
  if (task.operation === 'refresh') return refreshDomainFeedCache({ directory: task.directory, feedId: task.feedIds[0]!, stagingFilename: task.stagingFilename!, ...(task.stagingIdentity ? { stagingIdentity: task.stagingIdentity } : {}) });
  const feeds = [];
  for (const feedId of task.feedIds) {
    try {
      if (task.operation === 'status') feeds.push(await domainFeedCacheStatus(task.directory, feedId));
      else feeds.push({ feedId, ...await queryDomainFeedCache(task.directory, feedId, task.selection!, Date.now(), Math.floor(200 / task.feedIds.length)) });
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
