import { defaultOperationBudget, operationBudgetReport } from './operation-budget.js';
import {
  NETWORK_FEATURE_DEFINITIONS,
  featureDecision,
  networkFeaturePolicy,
} from './feature-policy.mts';

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

const DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze([
  { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'rdap', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'whois', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'availability', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'dns_intelligence', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'website_probe', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'tls_intelligence', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'certificate_transparency', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'domain_posture', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'idn_confusables', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  { id: 'analyst_cases', status: 'local_only', execution: 'browser', scanModes: [] },
  { id: 'watchlists', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  { id: 'scheduled_monitoring', status: 'unavailable', execution: 'worker', scanModes: [], reason: 'No scheduled worker is configured in this deployment.' },
  { id: 'distributed_budgets', status: 'unavailable', execution: 'hosted', scanModes: [], reason: 'Distributed counters are not configured.' },
]);

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
