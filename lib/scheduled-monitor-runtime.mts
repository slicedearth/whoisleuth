// Fail-closed runtime composition for optional hosted monitoring. This module
// wires the already-bounded configuration, storage, state, cycle, policy and
// lookup contracts together without constructing a provider client itself.

import { randomUUID } from 'node:crypto';
import { classifyQuery } from './classify.mts';
import { networkFeaturePolicy, featureDecision } from './feature-policy.mts';
import { runUnifiedLookup } from './lookup.mts';
import { createNetlifyBlobVersionedTextStore } from './scheduled-monitor-netlify-store.mts';
import { ScheduledMonitorRepository } from './scheduled-monitor-repository.mts';
import {
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  scheduledMonitorRuntimeConfiguration,
} from './scheduled-monitor-configuration.mts';
import { runScheduledMonitorCycle } from './scheduled-monitor-cycle.mts';
import {
  emptyScheduledMonitorState,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';
import type { NetlifyBlobStore } from './scheduled-monitor-netlify-store.mts';
import type {
  EnvironmentInput,
  RuntimeConfiguration,
  RuntimeStatus,
} from './scheduled-monitor-configuration.mts';

type RuntimeOptions = {
  env?: EnvironmentInput | null;
  blobStore?: NetlifyBlobStore;
  lookup?: (domain: string, options: { fast: true; compact: true }) => Promise<unknown>;
  now?: () => number;
  randomUUID?: () => string;
};
type RepositoryRuntimeOptions = Pick<RuntimeOptions, 'env' | 'blobStore'>;

const SCHEDULED_MONITOR_UNAVAILABLE_CODE = 'SCHEDULED_MONITOR_UNAVAILABLE';

class ScheduledMonitorUnavailableError extends Error {
  code = SCHEDULED_MONITOR_UNAVAILABLE_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'ScheduledMonitorUnavailableError';
  }
}

function unavailableRun(reason: string) {
  return async () => {
    throw new ScheduledMonitorUnavailableError(reason);
  };
}

function createScheduledMonitorRepository(options: RepositoryRuntimeOptions = {}) {
  const env = options.env === undefined ? process.env : options.env;
  const configuration = scheduledMonitorRuntimeConfiguration(env);
  if (configuration.status !== 'ready') {
    throw new ScheduledMonitorUnavailableError(
      configuration.reason || 'Scheduled monitoring is unavailable.',
    );
  }
  if (!options.blobStore) {
    throw new ScheduledMonitorUnavailableError('Scheduled monitoring Blob storage is unavailable.');
  }
  const source = env as EnvironmentInput;
  return new ScheduledMonitorRepository({
    rawStore: createNetlifyBlobVersionedTextStore(options.blobStore),
    encryptionKey: String(source[KEY_ENV]),
    namespace: String(source[NAMESPACE_ENV]),
    emptyState: emptyScheduledMonitorState,
    normalizeState: normalizeScheduledMonitorState,
  });
}

function createScheduledMonitorRuntime(options: RuntimeOptions = {}) {
  const env = options.env === undefined ? process.env : options.env;
  const configuration = scheduledMonitorRuntimeConfiguration(env);
  if (configuration.status === 'disabled') {
    return {
      ...configuration,
      run: async () => ({
        status: 'disabled',
        stopReason: 'disabled',
        processedDeliveries: 0,
        lookupDeliveries: 0,
        deferredDeliveries: 0,
      }),
    };
  }
  if (configuration.status === 'unavailable') {
    return { ...configuration, run: unavailableRun(configuration.reason || 'Scheduled monitoring is unavailable.') };
  }
  if (!options.blobStore) {
    const reason = 'Scheduled monitoring Blob storage is unavailable.';
    return {
      status: 'unavailable' as const,
      enabled: true,
      configured: false,
      reason,
      run: unavailableRun(reason),
    };
  }

  const source = env as EnvironmentInput;
  const featurePolicy = networkFeaturePolicy(source);
  const lookup = options.lookup || (async (domain, requestOptions) => {
    if (requestOptions.fast !== true || requestOptions.compact !== true) {
      throw new Error('Scheduled monitoring requires the fast compact lookup contract.');
    }
    const decision = featureDecision('lookup', featurePolicy);
    if (!decision.enabled) throw new Error(decision.reason);
    const classified = classifyQuery(domain);
    if (classified.type !== 'domain' || classified.value !== domain) {
      throw new Error('Scheduled monitoring received an invalid canonical domain.');
    }
    return runUnifiedLookup(classified, {
      fast: true,
      compact: true,
      featurePolicy,
    });
  });
  const repository = createScheduledMonitorRepository({ env, blobStore: options.blobStore });
  return {
    ...configuration,
    run: () => runScheduledMonitorCycle({
      repository,
      lookup,
      ...(options.now ? { now: options.now } : {}),
      randomUUID: options.randomUUID || randomUUID,
    }),
  };
}

export {
  createScheduledMonitorRuntime,
  createScheduledMonitorRepository,
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  scheduledMonitorRuntimeConfiguration,
  SCHEDULED_MONITOR_UNAVAILABLE_CODE,
  ScheduledMonitorUnavailableError,
};
export type { RepositoryRuntimeOptions, RuntimeConfiguration, RuntimeOptions, RuntimeStatus };
