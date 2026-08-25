import { defaultOperationBudget, operationBudgetReport } from './operation-budget.mts';
import {
  NETWORK_FEATURE_DEFINITIONS,
  featureDecision,
  networkFeaturePolicy,
} from './feature-policy.mts';
import { urlscanConfiguration } from './urlscan-intelligence.mts';
import { urlhausConfiguration } from './urlhaus-intelligence.mts';
import { threatfoxConfiguration } from './threatfox-intelligence.mts';
import { scheduledMonitorRuntimeConfiguration } from './scheduled-monitor-configuration.mts';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';

type CapabilityStatus = 'supported' | 'disabled' | 'unavailable' | 'local_only';
type CapabilityExecution = 'hosted' | 'browser' | 'worker';
type CapabilityRuntime = 'express' | 'netlify' | 'unknown';
type CapabilityDefinition = {
  id: string;
  status: CapabilityStatus;
  execution: CapabilityExecution;
  scanModes: readonly string[];
  reason?: string;
};

type EnvironmentInput = Record<string, unknown>;
type OperationBudgetProvider = Parameters<typeof operationBudgetReport>[1];

const CAPABILITIES_VERSION = 1;
const CAPABILITY_STATUSES = new Set<CapabilityStatus>(['supported', 'disabled', 'unavailable', 'local_only']);

const DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze(
  CAPABILITY_MANIFEST.capabilities.flatMap((item) => item.legacyCapability
    ? [Object.freeze({
        id: item.id,
        status: item.legacyCapability.status,
        execution: item.legacyCapability.execution,
        scanModes: Object.freeze([...item.legacyCapability.scanModes]),
        ...(item.legacyCapability.reason ? { reason: item.legacyCapability.reason } : {}),
      })]
    : []),
);

function capabilityReport(
  runtime: unknown = 'unknown',
  env: EnvironmentInput | null | undefined = process.env,
  operationBudget: OperationBudgetProvider = defaultOperationBudget,
) {
  const normalizedRuntime: CapabilityRuntime = runtime === 'express' || runtime === 'netlify'
    ? runtime
    : 'unknown';
  const policy = networkFeaturePolicy(env);
  const concurrency = operationBudgetReport(normalizedRuntime, operationBudget);
  return {
    version: CAPABILITIES_VERSION,
    runtime: normalizedRuntime,
    authoritative: true,
    features: DEFINITIONS.map((item) => {
      if (item.id === 'urlscan_search') {
        const configuration = urlscanConfiguration(env);
        const { reason: _reason, ...definition } = item;
        return {
          ...definition,
          status: configuration.configured ? 'supported' : configuration.enabled ? 'unavailable' : 'disabled',
          scanModes: [...item.scanModes],
          ...(configuration.reason ? { reason: configuration.reason } : {}),
        };
      }
      if (item.id === 'urlhaus_host') {
        const configuration = urlhausConfiguration(env);
        const { reason: _reason, ...definition } = item;
        return {
          ...definition,
          status: configuration.configured ? 'supported' : configuration.enabled ? 'unavailable' : 'disabled',
          scanModes: [...item.scanModes],
          ...(configuration.reason ? { reason: configuration.reason } : {}),
        };
      }
      if (item.id === 'threatfox_domain_ioc') {
        const configuration = threatfoxConfiguration(env);
        const { reason: _reason, ...definition } = item;
        return {
          ...definition,
          status: configuration.configured ? 'supported' : configuration.enabled ? 'unavailable' : 'disabled',
          scanModes: [...item.scanModes],
          ...(configuration.reason ? { reason: configuration.reason } : {}),
        };
      }
      if (item.id === 'scheduled_monitoring') {
        const configuration = scheduledMonitorRuntimeConfiguration(env);
        const { reason: _reason, ...definition } = item;
        if (configuration.status === 'ready' && normalizedRuntime !== 'netlify') {
          return {
            ...definition,
            status: 'unavailable',
            scanModes: [...item.scanModes],
            reason: 'Scheduled monitoring requires the Netlify worker deployment.',
          };
        }
        return {
          ...definition,
          status: configuration.status === 'ready' ? 'supported' : configuration.status,
          scanModes: [...item.scanModes],
          ...(configuration.reason ? { reason: configuration.reason } : {}),
        };
      }
      if (item.id === 'distributed_budgets') {
        if (concurrency.distributed) {
          const { reason: _reason, ...supported } = item;
          return { ...supported, status: 'supported', scanModes: [...item.scanModes] };
        }
        return {
          ...item,
          scanModes: [...item.scanModes],
          reason: concurrency.mode === 'unavailable'
            ? 'Distributed counters are configured incorrectly or unavailable.'
            : item.reason,
        };
      }
      if (!Object.prototype.hasOwnProperty.call(NETWORK_FEATURE_DEFINITIONS, item.id)) {
        return { ...item, scanModes: [...item.scanModes] };
      }
      const decision = featureDecision(item.id, policy);
      return {
        ...item,
        status: decision.enabled ? item.status : 'disabled',
        scanModes: [...item.scanModes],
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
    }),
    controls: { concurrency },
    limitations: concurrency.distributed
      ? [concurrency.usage.mode === 'distributed_fixed_windows'
          ? 'Operation concurrency and configured 24-hour/30-day usage allowances are deployment-wide; fixed-window request rate limiting remains local to each runtime instance.'
          : 'Operation concurrency uses deployment-wide distributed leases; durable usage accounting is not configured and fixed-window request rate limiting remains local to each runtime instance.']
      : concurrency.mode === 'unavailable'
        ? ['Distributed operation budgeting is unavailable; network-heavy operations fail closed until configuration is repaired.']
        : normalizedRuntime === 'netlify'
          ? ['In-memory rate and concurrency state is per serverless instance and resets on cold starts.']
          : normalizedRuntime === 'express'
            ? ['In-memory controls are process-local and reset when the server restarts.']
            : ['In-memory controls are local to one runtime instance and are not distributed.'],
  };
}

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === 'string' && CAPABILITY_STATUSES.has(value as CapabilityStatus);
}

export { CAPABILITIES_VERSION, capabilityReport, isCapabilityStatus };
export type { CapabilityDefinition, CapabilityExecution, CapabilityRuntime, CapabilityStatus };
