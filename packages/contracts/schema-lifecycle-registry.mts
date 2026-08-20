import { CLI_LOOKUP_SCHEMA_LIFECYCLE } from './cli-lookup.mts';
import { DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE } from './domain-control-flight-recorder.mts';
import { DOMAIN_CONTROL_SCHEMA_LIFECYCLE } from './domain-control-manifest.mts';
import { DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE } from './domain-control-monitor.mts';
import { DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE } from './domain-control-review.mts';
import { RISK_CALIBRATION_SCHEMA_LIFECYCLE } from './risk-calibration.mts';
import { defineSchemaLifecycleRegistry } from './schema-lifecycle.mts';

export const SCHEMA_LIFECYCLE_REGISTRY = defineSchemaLifecycleRegistry([
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE,
  CLI_LOOKUP_SCHEMA_LIFECYCLE,
  RISK_CALIBRATION_SCHEMA_LIFECYCLE,
]);
