import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV2 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const MONITORING_CONTRACT_OWNER = 'packages/contracts/monitoring-portability.mts';
export const SCHEDULED_MONITOR_SCHEMA = 'whoisleuth.scheduled-monitor';
export const SCHEDULED_MONITOR_SCHEMA_VERSION = 1;
export const MAX_SCHEDULED_MONITOR_STORE_BYTES = 1536 * 1024;
export const SCHEDULED_MONITOR_DELIVERY_SCHEMA = 'whoisleuth.scheduled-monitor-delivery';
export const SCHEDULED_MONITOR_DELIVERY_VERSION = 1;

const SCHEDULED_MONITOR_COMPATIBILITY = defineSchemaCompatibility({
  id: 'hosted.scheduled-monitor', kind: 'hosted_store', schema: SCHEDULED_MONITOR_SCHEMA,
  currentVersion: SCHEDULED_MONITOR_SCHEMA_VERSION, supportedVersions: [SCHEDULED_MONITOR_SCHEMA_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'optimistic_replace', byteBudget: MAX_SCHEDULED_MONITOR_STORE_BYTES,
  owner: MONITORING_CONTRACT_OWNER,
  note: 'Compact authority-aware evidence only; raw responses and expanded contacts are excluded.',
});
const SCHEDULED_MONITOR_DELIVERY_COMPATIBILITY = defineSchemaCompatibility({
  id: 'hosted.scheduled-monitor-delivery', kind: 'hosted_store', schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  currentVersion: SCHEDULED_MONITOR_DELIVERY_VERSION, supportedVersions: [SCHEDULED_MONITOR_DELIVERY_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'ephemeral_replace', byteBudget: null, owner: MONITORING_CONTRACT_OWNER,
  note: 'Opaque bounded queue message with an allowlisted key set.',
});

export function serialiseMonitoringPortableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const MONITORING_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV2({
  id: 'monitoring-portability',
  owner: MONITORING_CONTRACT_OWNER,
  serializerExportName: 'serialiseMonitoringPortableJson',
  plane: 'node',
  projection: 'bounded_passive_monitor',
  retention: 'none',
  includedCategories: ['compact-authority-evidence', 'source-health', 'observation-times', 'delivery-cursor'],
  excludedCategories: ['raw-upstream-responses', 'expanded-contacts', 'credentials', 'cookies', 'message-content'],
  formats: [
    {
      descriptor: SCHEDULED_MONITOR_COMPATIBILITY,
      lifecycleSchema: SCHEDULED_MONITOR_SCHEMA,
      requiredKeys: ['schema', 'version', 'watchlists', 'activeRun'],
      optionalKeys: [],
      hook: { module: 'packages/monitoring/scheduled-monitor-model.mts', exportName: 'normalizeScheduledMonitorState', role: 'normaliser', runtime: 'shared' },
      fixtures: [{ id: 'scheduled-monitor-v1', path: 'test/fixtures/extracted-domain-lifecycle/scheduled-monitor-v1.json', bytes: 87, sha256: '1136a246c0483a3f352b7974ebc2f269050ffb1c86e259bf39040db5c762ba25', version: SCHEDULED_MONITOR_SCHEMA_VERSION }],
    },
    {
      descriptor: SCHEDULED_MONITOR_DELIVERY_COMPATIBILITY,
      lifecycleSchema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
      requiredKeys: ['schema', 'version', 'kind'],
      optionalKeys: ['runId', 'cursor'],
      hook: { module: 'packages/monitoring/scheduled-monitor-dispatcher.mts', exportName: 'normalizeScheduledMonitorDelivery', role: 'normaliser', runtime: 'shared' },
      fixtures: [{ id: 'scheduled-monitor-delivery-v1', path: 'test/fixtures/extracted-domain-lifecycle/scheduled-monitor-delivery-v1.json', bytes: 77, sha256: '0330d694f47f9c1941597402767e7db9a2170b4918da8b93b0c31c3bbda6da2c', version: SCHEDULED_MONITOR_DELIVERY_VERSION }],
    },
  ],
}));
