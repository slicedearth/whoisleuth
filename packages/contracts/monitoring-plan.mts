export const MONITORING_PLAN_INPUT_SCHEMA = 'whoisleuth.monitoring-plan.input';
export const MONITORING_PLAN_SCHEMA = 'whoisleuth.monitoring-plan';
export const MONITORING_PLAN_VERSION = 1;
export const MONITORING_PURPOSES = Object.freeze([
  { value: 'registration', label: 'Registration status', mode: 'fast' },
  { value: 'configuration', label: 'Website and mail', mode: 'deep' },
] as const);
export type MonitoringPurpose = typeof MONITORING_PURPOSES[number]['value'];
