// Private scheduled entry point for the optional hosted-monitoring worker.
// Netlify scheduled functions have no production URL and this boundary does
// not construct a Blob client unless the complete opt-in configuration is
// valid.

import { getStore } from '@netlify/blobs';
import {
  createScheduledMonitorRuntime,
  scheduledMonitorRuntimeConfiguration,
} from '../../lib/scheduled-monitor-runtime.mts';
import type { NetlifyBlobStore } from '../../lib/scheduled-monitor-netlify-store.mts';
import type { RuntimeOptions } from '../../lib/scheduled-monitor-runtime.mts';

type BlobStoreFactory = (name: string) => NetlifyBlobStore;
type ScheduledDeployContext = {
  context?: unknown;
  published?: unknown;
};
type ScheduledFunctionOptions = Omit<RuntimeOptions, 'blobStore'> & {
  blobStoreFactory?: BlobStoreFactory;
  deploy?: ScheduledDeployContext | null;
};

const SCHEDULED_MONITOR_STORE_NAME = 'whoisleuth-scheduled-monitor';
const SCHEDULED_MONITOR_CRON = '*/5 * * * *';

async function runScheduledMonitorFunction(options: ScheduledFunctionOptions = {}) {
  if (options.deploy?.published === false) {
    return {
      status: 'skipped',
      stopReason: 'non_published_deploy',
      processedDeliveries: 0,
      lookupDeliveries: 0,
      deferredDeliveries: 0,
    };
  }
  const env = options.env === undefined ? process.env : options.env;
  const configuration = scheduledMonitorRuntimeConfiguration(env);
  const runtimeOptions: RuntimeOptions = {
    env,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomUUID ? { randomUUID: options.randomUUID } : {}),
  };
  if (configuration.status === 'ready') {
    const blobStoreFactory = options.blobStoreFactory || ((name) => getStore(name));
    runtimeOptions.blobStore = blobStoreFactory(SCHEDULED_MONITOR_STORE_NAME);
  }
  return createScheduledMonitorRuntime(runtimeOptions).run();
}

export default async function scheduledMonitorHandler(
  _request: Request,
  context: { deploy?: ScheduledDeployContext } = {},
): Promise<void> {
  await runScheduledMonitorFunction({ deploy: context.deploy });
}

export const config = {
  schedule: SCHEDULED_MONITOR_CRON,
};

export {
  runScheduledMonitorFunction,
  SCHEDULED_MONITOR_CRON,
  SCHEDULED_MONITOR_STORE_NAME,
};
export type { BlobStoreFactory, ScheduledDeployContext, ScheduledFunctionOptions };
