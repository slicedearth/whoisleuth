import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV4 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const TAB_PORTABILITY_CONTRACT_OWNER = 'packages/contracts/tab-portability.mts';
export const CANDIDATE_HANDOFF_LIFECYCLE_SCHEMA = 'whoisleuth.internal.candidate-handoff';
export const HANDOFF_VERSION = 2;
export const MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES = 4 * 1024 * 1024;
export const SYNTHETIC_DEMO_TAB_LIFECYCLE_SCHEMA = 'whoisleuth.internal.synthetic-demo-tab';
export const SYNTHETIC_DEMO_VERSION = 1;
export const SYNTHETIC_DEMO_EXPORT_VERSION = 5;
export const SYNTHETIC_DEMO_STORAGE_KEY = 'whoisleuth:synthetic-demo:v1';
export const SYNTHETIC_DEMO_EXPORT_SCHEMA = 'whoisleuth.synthetic-demo-case';
export const MAX_SYNTHETIC_DEMO_NOTE_LENGTH = 800;
export const MAX_SYNTHETIC_DEMO_SERIALIZED_BYTES = 4_096;

const CANDIDATE_HANDOFF_COMPATIBILITY = defineSchemaCompatibility({
  id: 'tab.candidate-handoff', kind: 'tab_store', schema: null, currentVersion: HANDOFF_VERSION,
  supportedVersions: [HANDOFF_VERSION], acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace',
  byteBudget: MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES, owner: TAB_PORTABILITY_CONTRACT_OWNER,
  note: 'Bounded one-use session handoff; unsupported and legacy envelopes are ignored rather than applied.',
});
const SYNTHETIC_DEMO_TAB_COMPATIBILITY = defineSchemaCompatibility({
  id: 'tab.synthetic-demo', kind: 'tab_store', schema: null, currentVersion: SYNTHETIC_DEMO_VERSION,
  supportedVersions: [SYNTHETIC_DEMO_VERSION], acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace',
  byteBudget: MAX_SYNTHETIC_DEMO_SERIALIZED_BYTES, owner: TAB_PORTABILITY_CONTRACT_OWNER,
  note: 'Fixed synthetic fixtures remain separate from investigation stores.',
});
const SYNTHETIC_DEMO_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.synthetic-demo', kind: 'export', schema: SYNTHETIC_DEMO_EXPORT_SCHEMA,
  currentVersion: SYNTHETIC_DEMO_EXPORT_VERSION, supportedVersions: [SYNTHETIC_DEMO_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: TAB_PORTABILITY_CONTRACT_OWNER,
  note: 'Explicitly synthetic fixed-fixture package, never live evidence.',
});

function exactDataRecord(value: unknown, keys: readonly string[], version: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
  }
  return (value as Readonly<Record<string, unknown>>).version === version;
}

export function validateSyntheticDemoTabContract(value: unknown): boolean {
  return exactDataRecord(value, [
    'version', 'started', 'profileReady', 'candidatesReady', 'selectedCandidateId',
    'caseReady', 'caseStatus', 'note', 'followUpReady',
  ], SYNTHETIC_DEMO_VERSION);
}

export function validateSyntheticDemoExportContract(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.schema === SYNTHETIC_DEMO_EXPORT_SCHEMA
    && record.version === SYNTHETIC_DEMO_EXPORT_VERSION
    && record.synthetic === true;
}

export function serialiseTabPortableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const TAB_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV4({
  id: 'tab-portability',
  owner: TAB_PORTABILITY_CONTRACT_OWNER,
  serializerExportName: 'serialiseTabPortableJson',
  plane: 'browser',
  projection: 'browser_import',
  retention: 'none',
  includedCategories: ['selected-candidates', 'synthetic-fixture-state', 'synthetic-output'],
  excludedCategories: ['credentials', 'cookies', 'sessions', 'raw-upstream-responses', 'expanded-contacts'],
  formats: [
    {
      descriptor: CANDIDATE_HANDOFF_COMPATIBILITY,
      lifecycleSchema: CANDIDATE_HANDOFF_LIFECYCLE_SCHEMA,
      requiredKeys: ['version', 'token', 'createdAt', 'source', 'candidates'],
      optionalKeys: ['generatedCandidates', 'generatedCandidateTotal', 'generatedCandidatesTruncated'],
      hook: { module: 'packages/investigation/candidate-handoff.mts', exportName: 'parseSerializedHandoff', role: 'normaliser', runtime: 'shared' },
      fixtures: [{ id: 'candidate-handoff-v2', path: 'test/fixtures/extracted-domain-lifecycle/candidate-handoff-v2.json', bytes: 130, sha256: '74dd54f624d6070a35f9208a5322e7037622b74f3f4cc6ea7a50e5636ad222b5', version: HANDOFF_VERSION }],
    },
    {
      descriptor: SYNTHETIC_DEMO_TAB_COMPATIBILITY,
      lifecycleSchema: SYNTHETIC_DEMO_TAB_LIFECYCLE_SCHEMA,
      requiredKeys: ['version', 'started', 'profileReady', 'candidatesReady', 'selectedCandidateId', 'caseReady', 'caseStatus', 'note', 'followUpReady'],
      optionalKeys: [],
      hook: { module: TAB_PORTABILITY_CONTRACT_OWNER, exportName: 'validateSyntheticDemoTabContract', role: 'structure_validator', runtime: 'shared' },
      fixtures: [{ id: 'synthetic-demo-tab-v1', path: 'test/fixtures/extracted-domain-lifecycle/synthetic-demo-tab-v1.json', bytes: 169, sha256: 'de42d146240b56336c30f9ceb2aa3bdc49a5003f4050180f31ae4543b077f2cf', version: SYNTHETIC_DEMO_VERSION }],
    },
    {
      descriptor: SYNTHETIC_DEMO_EXPORT_COMPATIBILITY,
      lifecycleSchema: SYNTHETIC_DEMO_EXPORT_SCHEMA,
      requiredKeys: ['schema', 'version', 'synthetic'],
      optionalKeys: ['generatedAt', 'exportedAt', 'warning', 'profile', 'case', 'assessment', 'provenance', 'relationship', 'evidence', 'timeline', 'limitations', 'state'],
      hook: { module: TAB_PORTABILITY_CONTRACT_OWNER, exportName: 'validateSyntheticDemoExportContract', role: 'structure_validator', runtime: 'shared' },
      fixtures: [
        { id: 'synthetic-demo-export-v5', path: 'test/fixtures/extracted-domain-lifecycle/synthetic-demo-export-v5.json', bytes: 124, sha256: '5dc04d6a6a3289e704fdc344a86df786e4fb2b77658d54e2b90369d08447377f', version: SYNTHETIC_DEMO_EXPORT_VERSION },
      ],
    },
  ],
}));
