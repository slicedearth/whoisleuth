// Private scheduled entry point for the optional hosted-monitoring worker.
// Netlify scheduled functions have no production URL and this boundary does
// not construct a Blob client unless the complete opt-in configuration is
// valid.

import { getStore } from '@netlify/blobs';
import {
  createScheduledMonitorRuntime,
  scheduledMonitorRuntimeConfiguration,
} from '../../lib/scheduled-monitor-runtime.mts';
import {
  SCHEDULED_MONITOR_STORE_NAME,
} from '../../lib/scheduled-monitor-configuration.mts';
import type { NetlifyBlobStore } from '../../lib/scheduled-monitor-netlify-store.mts';
import type { RuntimeOptions } from '../../lib/scheduled-monitor-runtime.mts';

type BlobStoreFactory = (name: string) => NetlifyBlobStore;
type ScheduledDeployContext = {
  context?: unknown;
  published?: unknown;
};
type ScheduledMonitorCycleResult = {
  status: unknown;
  stopReason: unknown;
  processedDeliveries: unknown;
  lookupDeliveries: unknown;
  deferredDeliveries: unknown;
};
type ScheduledFunctionOptions = Omit<RuntimeOptions, 'blobStore'> & {
  blobStoreFactory?: BlobStoreFactory;
  deploy?: ScheduledDeployContext | null;
};

const SCHEDULED_MONITOR_CRON = '*/5 * * * *';
const SCHEDULED_MONITOR_LOG_SCHEMA = 'whoisleuth.scheduled-monitor-cycle';
const SCHEDULED_MONITOR_LOG_VERSION = 1;
const MAX_LOG_STATUS_LENGTH = 40;
const MAX_LOG_COUNT = 100;
const LOG_CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function boundedLogString(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_LOG_STATUS_LENGTH
    && !LOG_CONTROL_RE.test(value)
    ? value
    : null;
}

function boundedLogCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_LOG_COUNT
    ? Number(value)
    : null;
}

function scheduledMonitorLogRecord(
  result: ScheduledMonitorCycleResult,
  deploy: ScheduledDeployContext | null | undefined,
) {
  return {
    schema: SCHEDULED_MONITOR_LOG_SCHEMA,
    version: SCHEDULED_MONITOR_LOG_VERSION,
    status: boundedLogString(result.status),
    stopReason: boundedLogString(result.stopReason),
    processedDeliveries: boundedLogCount(result.processedDeliveries),
    lookupDeliveries: boundedLogCount(result.lookupDeliveries),
    deferredDeliveries: boundedLogCount(result.deferredDeliveries),
    deployContext: boundedLogString(deploy?.context),
    published: typeof deploy?.published === 'boolean' ? deploy.published : null,
  };
}

async function runScheduledMonitorFunction(options: ScheduledFunctionOptions = {}) {
  // Scheduled invocations can report `published: false` even when the provider
  // runs the current production function. The provider-controlled deploy
  // context is the stable boundary: previews and branch deploys use distinct
  // context values, while direct unit/runtime composition omits `deploy`.
  if (Object.hasOwn(options, 'deploy') && options.deploy?.context !== 'production') {
    return {
      status: 'skipped',
      stopReason: 'non_production_deploy',
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
  const result = await runScheduledMonitorFunction({ deploy: context.deploy });
  console.info(JSON.stringify(scheduledMonitorLogRecord(result, context.deploy)));
}

export {
  runScheduledMonitorFunction,
  scheduledMonitorLogRecord,
  SCHEDULED_MONITOR_CRON,
  SCHEDULED_MONITOR_LOG_SCHEMA,
  SCHEDULED_MONITOR_LOG_VERSION,
  SCHEDULED_MONITOR_STORE_NAME,
};
export type { BlobStoreFactory, ScheduledDeployContext, ScheduledFunctionOptions };
