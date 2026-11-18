export const MONITORING_PLAN_INPUT_SCHEMA = 'whoisleuth.monitoring-plan.input';
export const MONITORING_PLAN_SCHEMA = 'whoisleuth.monitoring-plan';
export const MONITORING_PLAN_VERSION = 2;
export const MONITORING_PLAN_SUPPORTED_VERSIONS: readonly number[] = Object.freeze([1, MONITORING_PLAN_VERSION]);
export const LOCAL_MONITOR_STATE_SCHEMA = 'whoisleuth.local-monitor-state';
export const LOCAL_MONITOR_STATE_VERSION = 1;
export const MAX_LOCAL_MONITOR_STATE_BYTES = 2 * 1024 * 1024;
export const LOCAL_MONITOR_STALE_RUN_MS = 48 * 60 * 60 * 1000;
export const MONITORING_PURPOSES = Object.freeze([
  { value: 'registration', label: 'Registration status', mode: 'fast' },
  { value: 'configuration', label: 'Website and mail', mode: 'deep' },
] as const);
export type MonitoringPurpose = typeof MONITORING_PURPOSES[number]['value'];
