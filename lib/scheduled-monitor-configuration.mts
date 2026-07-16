// Pure fail-closed configuration for optional hosted monitoring. Keep this
// boundary lightweight so capability reporting can describe deployment state
// without importing the lookup engine or constructing a storage client.

import { parseScheduledMonitorKey } from './scheduled-monitor-crypto.mts';
import { isScheduledMonitorNamespace } from './scheduled-monitor-repository.mts';

type EnvironmentInput = Record<string, unknown>;
type RuntimeStatus = 'disabled' | 'unavailable' | 'ready';
type RuntimeConfiguration = {
  status: RuntimeStatus;
  enabled: boolean;
  configured: boolean;
  reason: string | null;
};

const ENABLE_ENV = 'WHOISLEUTH_SCHEDULED_MONITORING';
const KEY_ENV = 'WHOISLEUTH_SCHEDULED_MONITOR_KEY';
const NAMESPACE_ENV = 'WHOISLEUTH_SCHEDULED_MONITOR_NAMESPACE';
const SCHEDULED_MONITOR_STORE_NAME = 'whoisleuth-scheduled-monitor';
const SCHEDULED_MONITOR_TRIGGER_INTERVAL_MINUTES = 5;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off']);

function switchState(value: unknown): true | false | null {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function scheduledMonitorRuntimeConfiguration(
  env: EnvironmentInput | null | undefined = process.env,
): RuntimeConfiguration {
  const source = env && typeof env === 'object' && !Array.isArray(env) ? env : {};
  const enabled = switchState(source[ENABLE_ENV]);
  if (enabled === false) {
    return {
      status: 'disabled',
      enabled: false,
      configured: false,
      reason: 'Scheduled monitoring is not enabled in this deployment.',
    };
  }
  if (enabled === null) {
    return {
      status: 'unavailable',
      enabled: true,
      configured: false,
      reason: `Scheduled monitoring has an invalid ${ENABLE_ENV} value.`,
    };
  }

  try {
    parseScheduledMonitorKey(source[KEY_ENV]);
  } catch {
    return {
      status: 'unavailable',
      enabled: true,
      configured: false,
      reason: `Scheduled monitoring requires a valid ${KEY_ENV}.`,
    };
  }
  if (!isScheduledMonitorNamespace(source[NAMESPACE_ENV])) {
    return {
      status: 'unavailable',
      enabled: true,
      configured: false,
      reason: `Scheduled monitoring requires a valid ${NAMESPACE_ENV}.`,
    };
  }
  return { status: 'ready', enabled: true, configured: true, reason: null };
}

export {
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  SCHEDULED_MONITOR_STORE_NAME,
  SCHEDULED_MONITOR_TRIGGER_INTERVAL_MINUTES,
  scheduledMonitorRuntimeConfiguration,
};
export type { EnvironmentInput, RuntimeConfiguration, RuntimeStatus };
