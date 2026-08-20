import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import { MAX_DOMAIN_NAME_LENGTH } from './domain-name.mts';
import {
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from './domain-control-monitor.mts';

export {
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from './domain-control-monitor.mts';

export const DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA = 'whoisleuth.domain-control-manifest-input';
export const DOMAIN_CONTROL_MANIFEST_SCHEMA = 'whoisleuth.domain-control-manifest';
export const DOMAIN_CONTROL_MANIFEST_INPUT_VERSION = 1;
export const LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION = 1;
export const DOMAIN_CONTROL_MANIFEST_VERSION = 2;
export const MAX_DOMAIN_CONTROL_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MIN_DOMAIN_CONTROL_MANIFEST_ENTRIES = 1;
export const MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES = 100;
export const MIN_DOMAIN_CONTROL_RECORDS = 0;
export const MAX_CANONICAL_DOMAIN_CONTROL_RECORDS = 32;
export const DOMAIN_CONTROL_RECORD_INPUT_BOUND_FACTOR = 4;
export const MAX_DOMAIN_CONTROL_INPUT_RECORDS = MAX_CANONICAL_DOMAIN_CONTROL_RECORDS
  * DOMAIN_CONTROL_RECORD_INPUT_BOUND_FACTOR;
export const MAX_DOMAIN_CONTROL_JSON_DEPTH = 16;
export const MAX_DOMAIN_CONTROL_JSON_VALUES = 400_000;
export const MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH = 1_024;
export const MAX_DOMAIN_CONTROL_DOMAIN_LENGTH = MAX_DOMAIN_NAME_LENGTH;
export const MAX_DOMAIN_CONTROL_TEXT_LENGTH = 300;
export const MAX_DOMAIN_CONTROL_NOTE_LENGTH = 500;
export const MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH = 64;
export const MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH = 32;
export const MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH = 500;
export const MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH = 32;
export const MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH = 500;
export const MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH = 600;
export const MIN_DOMAIN_CONTROL_DS_DIGEST_LENGTH = 2;
export const MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH = 1_024;
export const MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH = 1_200;
export const DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR = 4;
export const MAX_DOMAIN_CONTROL_MX_PRIORITY = 65_535;
export const MAX_DOMAIN_CONTROL_CAA_FLAGS = 255;
export const MAX_DOMAIN_CONTROL_DS_KEY_TAG = 65_535;
export const MAX_DOMAIN_CONTROL_DS_ALGORITHM = 255;
export const MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE = 255;
export const DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH = 64;
export const DOMAIN_CONTROL_DIGEST_SHA256_HEX_LENGTH = 64;
export const DOMAIN_CONTROL_DIGEST_SHA256_LENGTH = 'sha256:'.length
  + DOMAIN_CONTROL_DIGEST_SHA256_HEX_LENGTH;
export const MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH = 48;
export const MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS = 50_000;
export const MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES = 100_000;
export const MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS = 10_000;
export const MAX_DOMAIN_CONTROL_BROWSER_PROFILE_ENTRIES = 20;
export const MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH = 50;
export const MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS = 5_050_000;
export const MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES = 10_100_000;
export const MAX_DOMAIN_CONTROL_PORTABLE_BYTES = 15 * 1024 * 1024;
export const DOMAIN_CONTROL_MANIFEST_INPUT_KEYS = Object.freeze([
  'schema',
  'version',
  'expiresAt',
  'entries',
] as const);
export const DOMAIN_CONTROL_MANIFEST_ROOT_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'expiresAt',
  'entries',
  'limitations',
  'integrity',
] as const);
export const DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS = Object.freeze([
  'domain',
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tlsIssuer',
  'tlsSpkiSha256',
  'registrarLock',
  'renewalReviewAt',
  'note',
] as const);
export const DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS = Object.freeze([
  'algorithm',
  'canonicalization',
  'digestSha256',
] as const);
export const DOMAIN_CONTROL_RECORD_LIST_FIELDS = Object.freeze([
  'nameservers',
  'ds',
  'mx',
  'caa',
] as const);
export const DOMAIN_CONTROL_MX_RECORD_KEYS = Object.freeze([
  'exchange',
  'host',
  'value',
  'priority',
  'preference',
] as const);
export const DOMAIN_CONTROL_CAA_RECORD_KEYS = Object.freeze([
  'critical',
  'flags',
  'tag',
  'value',
] as const);
export const DOMAIN_CONTROL_DS_RECORD_KEYS = Object.freeze([
  'keyTag',
  'key_tag',
  'algorithm',
  'digestType',
  'digest_type',
  'digest',
] as const);
export const DOMAIN_CONTROL_MANIFEST_LIMITATIONS = Object.freeze([
  'This analyst-authored manifest records intended domain-control state. It does not collect evidence or change registrar, DNS, mail, or certificate configuration.',
  'Empty desired fields are unconfigured rather than claims that a record should be absent.',
] as const);

type DomainControlIntegerInput = number | string;

export type DomainControlMxRecordInput = Readonly<{
  exchange?: string | null;
  host?: string | null;
  value?: string | null;
  priority?: DomainControlIntegerInput | null;
  preference?: DomainControlIntegerInput | null;
}>;

export type DomainControlCaaRecordInput = Readonly<{
  critical?: DomainControlIntegerInput | null;
  flags?: DomainControlIntegerInput | null;
  tag: string;
  value: string;
}>;

export type DomainControlDsRecordInput = Readonly<{
  keyTag?: DomainControlIntegerInput | null;
  key_tag?: DomainControlIntegerInput | null;
  algorithm: DomainControlIntegerInput;
  digestType?: DomainControlIntegerInput | null;
  digest_type?: DomainControlIntegerInput | null;
  digest: string;
}>;

export type DomainControlManifestInputEntry = Readonly<{
  domain: string;
  nameservers?: readonly string[];
  ds?: readonly (string | DomainControlDsRecordInput)[];
  mx?: readonly (string | DomainControlMxRecordInput)[];
  caa?: readonly (string | DomainControlCaaRecordInput)[];
  tlsIssuer?: string | null;
  tlsSpkiSha256?: string | null;
  registrarLock?: 'required' | 'not_required' | null;
  renewalReviewAt?: string | null;
  note?: string | null;
}>;

export type DomainControlManifestInput = Readonly<{
  schema: typeof DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA;
  version: typeof DOMAIN_CONTROL_MANIFEST_INPUT_VERSION;
  expiresAt: string;
  entries: readonly DomainControlManifestInputEntry[];
}>;
export const SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS = Object.freeze([
  LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_MANIFEST_VERSION,
] as const);

export const DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.domain-control-manifest-input',
  kind: 'export',
  schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  currentVersion: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  supportedVersions: [DOMAIN_CONTROL_MANIFEST_INPUT_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  owner: 'packages/contracts/domain-control-manifest.mts',
  note: 'Exact-current bounded ordinary JSON desired-state input. Malformed list shapes, ambiguous structured aliases, unknown structured fields, and over-limit collections fail closed outside the supported envelope.',
});

export const DOMAIN_CONTROL_MANIFEST_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.domain-control-manifest',
  kind: 'export',
  schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
  currentVersion: DOMAIN_CONTROL_MANIFEST_VERSION,
  supportedVersions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  owner: 'packages/contracts/domain-control-manifest.mts',
  note: 'Version 2 uses deterministic sorted-json-v2 integrity for bounded analyst-authored desired state; version 1 remains readable and browser import is an explicit non-destructive field selection.',
});

export const DOMAIN_CONTROL_SCHEMA_LIFECYCLE = defineSchemaLifecycleFamily({
  id: 'domain-control-manifest',
  owner: 'packages/contracts/domain-control-manifest.mts',
  privacy: 'analyst_authored_sensitive',
  compatibility: [
    DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY,
    DOMAIN_CONTROL_MANIFEST_COMPATIBILITY,
  ],
  contracts: [
    {
      compatibilityId: DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      role: 'input',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
      fixtureIds: ['domain-control-manifest-input-v1'],
    },
    {
      compatibilityId: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
      role: 'document',
      lifecycle: 'legacy',
      readable: true,
      emitted: false,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v1',
      byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
      fixtureIds: ['domain-control-manifest-v1'],
    },
    {
      compatibilityId: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
      fixtureIds: ['domain-control-manifest-v2'],
    },
  ],
  fixtures: [
    {
      id: 'domain-control-manifest-input-v1',
      path: 'test/fixtures/domain-control-manifest-input-v1.json',
      bytes: 658,
      sha256: '2b8a10dec2d78ae0804a469d99b3dfbacbf380c8af0a01ec903106861cd73b09',
      contentDigestSha256: null,
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      role: 'input',
      expectation: 'normalises_to_current_output',
      expectedOutputFixtureId: 'domain-control-manifest-v2',
      scope: 'repository',
    },
    {
      id: 'domain-control-manifest-v1',
      path: 'test/fixtures/domain-control-manifest-v1.json',
      bytes: 955,
      sha256: '14679c94d38bc0f480aec079185c20f9301c99ae0202cb9d7a34bd41fa1b123f',
      contentDigestSha256: 'sha256:d986bb3d4467ca4607e5b10289005d47ec712e2bc6ae6885fcfec1f41f0d1ec5',
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
      role: 'historical',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
    },
    {
      id: 'domain-control-manifest-v2',
      path: 'test/fixtures/domain-control-manifest-v2.json',
      bytes: 1189,
      sha256: '799211e5eba37e733c7f22aac92e073950ffb69c2da64cc11af7ade303deb17a',
      contentDigestSha256: 'sha256:6d2015c111fe05e44babfd42f9adefbfb3bee3caf9fad33c60b9ca640b0f0c8a',
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
    },
  ],
  metadata: {
    metadataVersion: 2,
    enforcement: 'declarative_only',
    shapes: [
      {
        id: 'domain-control.input.v1',
        schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
        versions: [DOMAIN_CONTROL_MANIFEST_INPUT_VERSION],
        objects: [
          {
            path: '$',
            requiredKeys: DOMAIN_CONTROL_MANIFEST_INPUT_KEYS,
            optionalKeys: [],
            unknownKeys: 'reject',
          },
          {
            path: '$.entries[]',
            requiredKeys: ['domain'],
            optionalKeys: DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS.filter((key) => key !== 'domain'),
            unknownKeys: 'reject',
          },
          {
            path: '$.entries[].mx[]',
            requiredKeys: [],
            optionalKeys: DOMAIN_CONTROL_MX_RECORD_KEYS,
            unknownKeys: 'reject',
          },
          {
            path: '$.entries[].caa[]',
            requiredKeys: [],
            optionalKeys: DOMAIN_CONTROL_CAA_RECORD_KEYS,
            unknownKeys: 'reject',
          },
          {
            path: '$.entries[].ds[]',
            requiredKeys: [],
            optionalKeys: DOMAIN_CONTROL_DS_RECORD_KEYS,
            unknownKeys: 'reject',
          },
        ],
        fixedArrays: [],
        normalisation: 'input_to_current',
        target: {
          schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
          version: DOMAIN_CONTROL_MANIFEST_VERSION,
        },
      },
      {
        id: 'domain-control.manifest.v1-v2',
        schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
        versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS,
        objects: [
          {
            path: '$',
            requiredKeys: DOMAIN_CONTROL_MANIFEST_ROOT_KEYS,
            optionalKeys: [],
            unknownKeys: 'reject',
          },
          {
            path: '$.entries[]',
            requiredKeys: DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS,
            optionalKeys: [],
            unknownKeys: 'reject',
          },
          {
            path: '$.integrity',
            requiredKeys: DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS,
            optionalKeys: [],
            unknownKeys: 'reject',
          },
        ],
        fixedArrays: [
          {
            path: '$.limitations',
            values: DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
          },
        ],
        normalisation: 'preserve_signed_document',
        target: null,
      },
    ],
    boundProfiles: [
      {
        id: 'domain-control.core-wire.v1',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_BYTES, handling: 'reject' },
          { id: 'manifest-entries', path: '$.entries', phase: 'pre_accumulation', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MANIFEST_ENTRIES, maximum: MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES, handling: 'reject' },
          { id: 'input-nameservers', path: '$.entries[].nameservers', phase: 'pre_accumulation', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_DOMAIN_CONTROL_INPUT_RECORDS, handling: 'reject' },
          { id: 'input-ds', path: '$.entries[].ds', phase: 'pre_accumulation', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_DOMAIN_CONTROL_INPUT_RECORDS, handling: 'reject' },
          { id: 'input-mx', path: '$.entries[].mx', phase: 'pre_accumulation', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_DOMAIN_CONTROL_INPUT_RECORDS, handling: 'reject' },
          { id: 'input-caa', path: '$.entries[].caa', phase: 'pre_accumulation', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_DOMAIN_CONTROL_INPUT_RECORDS, handling: 'reject' },
          { id: 'canonical-nameservers', path: '$.entries[].nameservers', phase: 'normalised', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_CANONICAL_DOMAIN_CONTROL_RECORDS, handling: 'truncate' },
          { id: 'canonical-ds', path: '$.entries[].ds', phase: 'normalised', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_CANONICAL_DOMAIN_CONTROL_RECORDS, handling: 'truncate' },
          { id: 'canonical-mx', path: '$.entries[].mx', phase: 'normalised', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_CANONICAL_DOMAIN_CONTROL_RECORDS, handling: 'truncate' },
          { id: 'canonical-caa', path: '$.entries[].caa', phase: 'normalised', unit: 'items', minimum: MIN_DOMAIN_CONTROL_RECORDS, maximum: MAX_CANONICAL_DOMAIN_CONTROL_RECORDS, handling: 'truncate' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_JSON_DEPTH, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_JSON_VALUES, handling: 'reject' },
          { id: 'raw-domain', path: '$.entries[].domain', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH, handling: 'reject' },
          { id: 'canonical-domain', path: '$.entries[].domain', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_DOMAIN_LENGTH, handling: 'reject' },
          { id: 'raw-nameserver', path: '$.entries[].nameservers[]', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_NAME_INPUT_LENGTH, handling: 'drop_value' },
          { id: 'raw-tls-issuer', path: '$.entries[].tlsIssuer', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_TEXT_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'tls-issuer', path: '$.entries[].tlsIssuer', phase: 'normalised', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_TEXT_LENGTH, handling: 'truncate' },
          { id: 'raw-note', path: '$.entries[].note', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_NOTE_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'note', path: '$.entries[].note', phase: 'normalised', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_NOTE_LENGTH, handling: 'truncate' },
          { id: 'raw-generated-at', path: '$.generatedAt', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'reject' },
          { id: 'generated-at', path: '$.generatedAt', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH, handling: 'reject' },
          { id: 'raw-expires-at', path: '$.expiresAt', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'reject' },
          { id: 'expires-at', path: '$.expiresAt', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH, handling: 'reject' },
          { id: 'raw-renewal-review-at', path: '$.entries[].renewalReviewAt', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'renewal-review-at', path: '$.entries[].renewalReviewAt', phase: 'normalised', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH, handling: 'drop_value' },
          { id: 'mx-priority-text', path: '$.entries[].mx[].priority', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'mx-preference-text', path: '$.entries[].mx[].preference', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'caa-critical-text', path: '$.entries[].caa[].critical', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'caa-flags-text', path: '$.entries[].caa[].flags', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'ds-key-tag-text', path: '$.entries[].ds[].keyTag', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'ds-key-tag-snake-text', path: '$.entries[].ds[].key_tag', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'ds-algorithm-text', path: '$.entries[].ds[].algorithm', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'ds-digest-type-text', path: '$.entries[].ds[].digestType', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'ds-digest-type-snake-text', path: '$.entries[].ds[].digest_type', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_RECORD_INTEGER_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'raw-mx-text', path: '$.entries[].mx[]', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'mx-text', path: '$.entries[].mx[]', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MX_TEXT_LENGTH, handling: 'drop_value' },
          { id: 'mx-priority', path: '$.entries[].mx[].priority', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MX_PRIORITY, handling: 'drop_value' },
          { id: 'mx-preference', path: '$.entries[].mx[].preference', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MX_PRIORITY, handling: 'drop_value' },
          { id: 'raw-caa-tag', path: '$.entries[].caa[].tag', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'caa-tag', path: '$.entries[].caa[].tag', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_CAA_TAG_LENGTH, handling: 'drop_value' },
          { id: 'raw-caa-value', path: '$.entries[].caa[].value', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'caa-value', path: '$.entries[].caa[].value', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_CAA_VALUE_LENGTH, handling: 'drop_value' },
          { id: 'raw-caa-presentation', path: '$.entries[].caa[]', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'caa-presentation', path: '$.entries[].caa[]', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH, handling: 'drop_value' },
          { id: 'caa-critical', path: '$.entries[].caa[].critical', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CAA_FLAGS, handling: 'drop_value' },
          { id: 'caa-flags', path: '$.entries[].caa[].flags', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CAA_FLAGS, handling: 'drop_value' },
          { id: 'raw-ds-digest', path: '$.entries[].ds[].digest', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'ds-digest', path: '$.entries[].ds[].digest', phase: 'normalised', unit: 'characters', minimum: MIN_DOMAIN_CONTROL_DS_DIGEST_LENGTH, maximum: MAX_DOMAIN_CONTROL_DS_DIGEST_LENGTH, handling: 'drop_value' },
          { id: 'raw-ds-presentation', path: '$.entries[].ds[]', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'ds-presentation', path: '$.entries[].ds[]', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH, handling: 'drop_value' },
          { id: 'ds-key-tag', path: '$.entries[].ds[].keyTag', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_KEY_TAG, handling: 'drop_value' },
          { id: 'ds-key-tag-snake', path: '$.entries[].ds[].key_tag', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_KEY_TAG, handling: 'drop_value' },
          { id: 'ds-algorithm', path: '$.entries[].ds[].algorithm', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_ALGORITHM, handling: 'drop_value' },
          { id: 'ds-digest-type', path: '$.entries[].ds[].digestType', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE, handling: 'drop_value' },
          { id: 'ds-digest-type-snake', path: '$.entries[].ds[].digest_type', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_DS_DIGEST_TYPE, handling: 'drop_value' },
          { id: 'raw-spki-digest', path: '$.entries[].tlsSpkiSha256', phase: 'pre_accumulation', unit: 'characters', minimum: 0, maximum: DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'drop_value' },
          { id: 'spki-digest', path: '$.entries[].tlsSpkiSha256', phase: 'normalised', unit: 'characters', minimum: DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH, maximum: DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH, handling: 'drop_value' },
          { id: 'manifest-digest', path: '$.integrity.digestSha256', phase: 'normalised', unit: 'characters', minimum: DOMAIN_CONTROL_DIGEST_SHA256_LENGTH, maximum: DOMAIN_CONTROL_DIGEST_SHA256_LENGTH, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control.browser-file.v1',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES, handling: 'reject' },
          { id: 'container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control.browser-profile.v1',
        bounds: [
          { id: 'exported-entries', path: '$.selectedDomains', phase: 'action', unit: 'entries', minimum: 1, maximum: MAX_DOMAIN_CONTROL_BROWSER_PROFILE_ENTRIES, handling: 'cap_operation' },
          { id: 'previewed-entries', path: '$.verifiedManifest.entries', phase: 'action', unit: 'entries', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES, handling: 'reject' },
          { id: 'applied-baselines', path: '$.choices', phase: 'action', unit: 'entries', minimum: 0, maximum: MAX_DOMAIN_CONTROL_BROWSER_PROFILE_ENTRIES, handling: 'cap_operation' },
        ],
      },
      {
        id: 'domain-control.cli-domain-control-file.v1',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 0, maximum: MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES, handling: 'reject' },
          { id: 'container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control.cli-monitor-file.v1',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES, handling: 'reject' },
          { id: 'container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control.cli-portable-file.v1',
        bounds: [
          { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_PORTABLE_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 0, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES, handling: 'reject' },
          { id: 'container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control.cli-monitor-action.v1',
        bounds: [
          { id: 'selected-domains', path: '$.manifest.entries', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'cap_operation' },
          { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, maximum: MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY, handling: 'reject' },
        ],
      },
    ],
    hooks: [
      { id: 'domain-control.shared.build-unsigned', role: 'builder', runtime: 'shared', module: 'packages/evidence/domain-control-runtime.mts', exportName: 'buildUnsignedDomainControlManifest' },
      { id: 'domain-control.shared.normalise-document', role: 'normaliser', runtime: 'shared', module: 'packages/evidence/domain-control-runtime.mts', exportName: 'normalizeDomainControlManifestDocument' },
      { id: 'domain-control.shared.measure-serialised-bytes', role: 'serialised_byte_counter', runtime: 'shared', module: 'packages/evidence/domain-control-runtime.mts', exportName: 'domainControlManifestSerialisedBytes' },
      { id: 'domain-control.shared.assert-byte-budget', role: 'budget_guard', runtime: 'shared', module: 'packages/evidence/domain-control-runtime.mts', exportName: 'assertDomainControlManifestByteBudget' },
      { id: 'domain-control.shared.serialise-document', role: 'serialiser', runtime: 'shared', module: 'packages/evidence/domain-control-runtime.mts', exportName: 'serializeDomainControlManifest' },
      { id: 'domain-control.browser.build-input', role: 'builder', runtime: 'browser', module: 'frontend/src/lib/analysis/domain-control-passport.ts', exportName: 'buildBrandProfilePassportInput' },
      { id: 'domain-control.browser.build-document', role: 'builder', runtime: 'browser', module: 'frontend/src/lib/analysis/domain-control-passport.ts', exportName: 'buildDomainControlPassport' },
      { id: 'domain-control.browser.verify-unexpired', role: 'integrity_verifier', runtime: 'browser', module: 'frontend/src/lib/analysis/domain-control-passport.ts', exportName: 'verifyDomainControlPassport' },
      { id: 'domain-control.browser.apply', role: 'merger', runtime: 'browser', module: 'frontend/src/lib/analysis/domain-control-passport.ts', exportName: 'applyVerifiedDomainControlPassport' },
      { id: 'domain-control.node.build-document', role: 'builder', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'buildDomainControlManifest' },
      { id: 'domain-control.node.verify-integrity', role: 'integrity_verifier', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'verifyDomainControlManifest' },
      { id: 'domain-control.node.review', role: 'reviewer', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'reviewDomainControlManifest' },
      { id: 'domain-control.cli.offline-structure', role: 'structure_validator', runtime: 'cli', module: 'cli/artifact-structure.mts', exportName: 'validateSignedDigestArtifactStructure' },
      { id: 'domain-control.cli.offline-verify', role: 'integrity_verifier', runtime: 'cli', module: 'cli/artifact-verify.mts', exportName: 'verifyOfflineArtifact' },
      { id: 'domain-control.cli.interchange-report', role: 'interchange_reporter', runtime: 'cli', module: 'cli/interchange-report.mts', exportName: 'buildInterchangeFidelityReport' },
      { id: 'domain-control.cli.sign-package', role: 'signer', runtime: 'cli', module: 'cli/evidence-signing.mts', exportName: 'signEvidencePackage' },
      { id: 'domain-control.cli.verify-signature', role: 'signature_verifier', runtime: 'cli', module: 'cli/evidence-signing.mts', exportName: 'verifyEvidencePackageSignature' },
      { id: 'domain-control.cli.sharing-review', role: 'sharing_reviewer', runtime: 'cli', module: 'cli/sharing-review.mts', exportName: 'buildSharingReview' },
      { id: 'domain-control.cli.saved-lookup-review', role: 'reviewer', runtime: 'cli', module: 'cli/domain-control-observations.mts', exportName: 'buildCliDomainControlReview' },
      { id: 'domain-control.cli.monitor-once', role: 'monitor', runtime: 'cli', module: 'cli/domain-control-monitor.mts', exportName: 'runDomainControlMonitor' },
    ],
    serialisationProfiles: [
      {
        id: 'domain-control.manifest-json.v1',
        schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
        versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS,
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'structural_only_requires_separate_verification',
        serializerHookId: 'domain-control.shared.serialise-document',
        verifierHookIds: [
          'domain-control.node.verify-integrity',
          'domain-control.browser.verify-unexpired',
        ],
      },
    ],
    privacyProfiles: [
      {
        id: 'domain-control.manifest-sensitive.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'full_manifest',
        includedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
          'analyst-notes',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'allowed_bounded',
        retention: 'none',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control.cli-manifest.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'full_manifest',
        includedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
          'analyst-notes',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'allowed_bounded',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control.browser-export.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'browser_export',
        includedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: [
          'analyst-notes',
          'profile-identity',
          'brand-context',
          'contacts',
          'observations',
          'change-windows',
          'planning',
          'suppressions',
        ],
        notePolicy: 'forced_null',
        retention: 'deliberate_local_file',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control.browser-import.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'browser_import',
        includedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
        ],
        excludedCategories: [
          'analyst-notes',
          'profile-identity',
          'brand-context',
          'contacts',
          'observations',
          'change-windows',
          'planning',
          'suppressions',
        ],
        notePolicy: 'discarded',
        retention: 'browser_indexeddb',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control.review-sensitive.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
          'observed-control-values',
          'observation-provenance',
          'observation-times',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: [
          'analyst-notes',
          'raw-upstream-payloads',
          'contacts',
          'credentials',
          'cookies',
          'sessions',
        ],
        notePolicy: 'discarded',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control.metadata-only.v1',
        classification: 'metadata_only',
        projection: 'metadata_only',
        includedCategories: ['schema-version', 'counts', 'integrity-digest', 'currentness'],
        excludedCategories: [
          'domain-identifiers',
          'desired-dns',
          'desired-mail-routing',
          'desired-certificate',
          'desired-registrar',
          'renewal-timing',
          'analyst-notes',
          'raw-upstream-payloads',
        ],
        notePolicy: 'not_applicable',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control.signed-wrapper.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'signed_wrapper',
        includedCategories: [
          'complete-manifest',
          'signing-time',
          'public-key',
          'key-identifier',
        ],
        excludedCategories: ['private-key', 'credentials', 'raw-upstream-payloads'],
        notePolicy: 'allowed_bounded',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control.bounded-passive-monitor.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'bounded_passive_monitor',
        includedCategories: [
          'domain-identifiers',
          'request-metadata',
          'normalised-observations',
          'bounded-errors',
        ],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'not_applicable',
        retention: 'operator_controlled_output',
        network: 'explicit_bounded_passive_deep',
        sharingReview: 'required',
      },
    ],
    expiryProfiles: [
      {
        id: 'domain-control.expiry.build-future.v1',
        field: 'expiresAt',
        anchor: 'generatedAt',
        handling: 'require_after_anchor',
        phase: 'build',
        maximumLifetimeDays: null,
      },
      {
        id: 'domain-control.expiry.require-current.v1',
        field: 'expiresAt',
        anchor: 'checkedAt',
        handling: 'reject_expired',
        phase: 'pre_action',
        maximumLifetimeDays: null,
      },
      {
        id: 'domain-control.expiry.report-currentness.v1',
        field: 'expiresAt',
        anchor: 'checkedAt',
        handling: 'report_expired',
        phase: 'review',
        maximumLifetimeDays: null,
      },
      {
        id: 'domain-control.expiry.integrity-only.v1',
        field: 'expiresAt',
        anchor: null,
        handling: 'integrity_only',
        phase: 'verification',
        maximumLifetimeDays: null,
      },
    ],
    consumerEdges: [
      {
        id: 'domain-control.browser-export',
        plane: 'browser',
        operation: 'export',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_MANIFEST_INPUT_VERSION], mode: 'direct' },
        ],
        emittedContract: { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_VERSION },
        shapeIds: ['domain-control.input.v1', 'domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.browser-profile.v1'],
        hookIds: [
          'domain-control.shared.build-unsigned',
          'domain-control.shared.measure-serialised-bytes',
          'domain-control.shared.assert-byte-budget',
          'domain-control.shared.serialise-document',
          'domain-control.browser.build-input',
          'domain-control.browser.build-document',
        ],
        serialisationProfileId: 'domain-control.manifest-json.v1',
        privacyProfileId: 'domain-control.browser-export.v1',
        expiryPolicyId: 'domain-control.expiry.build-future.v1',
        requestMode: 'none',
        retentionEffect: 'deliberate_local_file',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.browser-import',
        plane: 'browser',
        operation: 'import',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: [
          'domain-control.core-wire.v1',
          'domain-control.browser-file.v1',
          'domain-control.browser-profile.v1',
        ],
        hookIds: [
          'domain-control.shared.normalise-document',
          'domain-control.browser.verify-unexpired',
          'domain-control.browser.apply',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.browser-import.v1',
        expiryPolicyId: 'domain-control.expiry.require-current.v1',
        requestMode: 'none',
        retentionEffect: 'browser_indexeddb',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.node-build',
        plane: 'node',
        operation: 'build',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_MANIFEST_INPUT_VERSION], mode: 'direct' },
        ],
        emittedContract: { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_VERSION },
        shapeIds: ['domain-control.input.v1', 'domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1'],
        hookIds: [
          'domain-control.shared.build-unsigned',
          'domain-control.shared.assert-byte-budget',
          'domain-control.node.build-document',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.manifest-sensitive.v1',
        expiryPolicyId: 'domain-control.expiry.build-future.v1',
        requestMode: 'none',
        retentionEffect: 'none',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.node-verify',
        plane: 'node',
        operation: 'verify',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1'],
        hookIds: [
          'domain-control.shared.normalise-document',
          'domain-control.node.verify-integrity',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.manifest-sensitive.v1',
        expiryPolicyId: 'domain-control.expiry.integrity-only.v1',
        requestMode: 'none',
        retentionEffect: 'none',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.node-review',
        plane: 'node',
        operation: 'review',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'embedded' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1'],
        hookIds: ['domain-control.node.verify-integrity', 'domain-control.node.review'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.review-sensitive.v1',
        expiryPolicyId: 'domain-control.expiry.report-currentness.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-core-review',
        plane: 'cli',
        operation: 'core-review',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'embedded' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-domain-control-file.v1'],
        hookIds: ['domain-control.node.verify-integrity', 'domain-control.node.review'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.review-sensitive.v1',
        expiryPolicyId: 'domain-control.expiry.report-currentness.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-saved-lookup-review',
        plane: 'cli',
        operation: 'saved-lookup-review',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'embedded' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-domain-control-file.v1'],
        hookIds: [
          'domain-control.node.verify-integrity',
          'domain-control.node.review',
          'domain-control.cli.saved-lookup-review',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.review-sensitive.v1',
        expiryPolicyId: 'domain-control.expiry.report-currentness.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-build',
        plane: 'cli',
        operation: 'build',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_MANIFEST_INPUT_VERSION], mode: 'direct' },
        ],
        emittedContract: { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_VERSION },
        shapeIds: ['domain-control.input.v1', 'domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-domain-control-file.v1'],
        hookIds: [
          'domain-control.shared.measure-serialised-bytes',
          'domain-control.shared.assert-byte-budget',
          'domain-control.shared.serialise-document',
          'domain-control.node.build-document',
        ],
        serialisationProfileId: 'domain-control.manifest-json.v1',
        privacyProfileId: 'domain-control.cli-manifest.v1',
        expiryPolicyId: 'domain-control.expiry.build-future.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-offline-verify',
        plane: 'cli',
        operation: 'offline-verify',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-portable-file.v1'],
        hookIds: [
          'domain-control.cli.offline-structure',
          'domain-control.cli.offline-verify',
          'domain-control.node.verify-integrity',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.metadata-only.v1',
        expiryPolicyId: 'domain-control.expiry.integrity-only.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-interchange',
        plane: 'cli',
        operation: 'interchange',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-portable-file.v1'],
        hookIds: ['domain-control.cli.interchange-report', 'domain-control.cli.offline-verify'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.metadata-only.v1',
        expiryPolicyId: 'domain-control.expiry.integrity-only.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-sign',
        plane: 'cli',
        operation: 'sign',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-portable-file.v1'],
        hookIds: ['domain-control.cli.offline-verify', 'domain-control.cli.sign-package'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.signed-wrapper.v1',
        expiryPolicyId: 'domain-control.expiry.integrity-only.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-verify-signature',
        plane: 'cli',
        operation: 'verify-signature',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'embedded' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-portable-file.v1'],
        hookIds: ['domain-control.cli.verify-signature', 'domain-control.cli.offline-verify'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.metadata-only.v1',
        expiryPolicyId: 'domain-control.expiry.integrity-only.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control.cli-sharing-review',
        plane: 'cli',
        operation: 'sharing-review',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: ['domain-control.core-wire.v1', 'domain-control.cli-portable-file.v1'],
        hookIds: ['domain-control.cli.sharing-review', 'domain-control.cli.offline-verify'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.metadata-only.v1',
        expiryPolicyId: 'domain-control.expiry.report-currentness.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'target',
      },
      {
        id: 'domain-control.cli-monitor',
        plane: 'cli',
        operation: 'monitor',
        acceptedContracts: [
          { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS, mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['domain-control.manifest.v1-v2'],
        boundProfileIds: [
          'domain-control.core-wire.v1',
          'domain-control.cli-monitor-file.v1',
          'domain-control.cli-monitor-action.v1',
        ],
        hookIds: ['domain-control.node.verify-integrity', 'domain-control.cli.monitor-once'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control.bounded-passive-monitor.v1',
        expiryPolicyId: 'domain-control.expiry.require-current.v1',
        requestMode: 'explicit_bounded_passive_deep',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
    ],
    consumerRelationships: [],
  },
});

export type DomainControlManifestCanonicalization = 'sorted-json-v1' | 'sorted-json-v2';
export type DomainControlManifestCanonicalizationRoute = Readonly<{
  version: number;
  canonicalization: DomainControlManifestCanonicalization;
  explicit: true;
}>;

function projectDomainControlManifestOperation(): Readonly<{
  schema: typeof DOMAIN_CONTROL_MANIFEST_SCHEMA;
  readableVersions: readonly number[];
  canonicalizationRoutes: readonly DomainControlManifestCanonicalizationRoute[];
  currentVersion: typeof DOMAIN_CONTROL_MANIFEST_VERSION;
  currentCanonicalization: 'sorted-json-v2';
}> {
  const routes: DomainControlManifestCanonicalizationRoute[] = [];
  let currentRoute: DomainControlManifestCanonicalizationRoute | null = null;
  for (const contract of DOMAIN_CONTROL_SCHEMA_LIFECYCLE.contracts) {
    if (contract.schema !== DOMAIN_CONTROL_MANIFEST_SCHEMA) continue;
    if (contract.role !== 'document'
      || !contract.readable
      || (contract.canonicalisation !== 'sorted-json-v1'
        && contract.canonicalisation !== 'sorted-json-v2')) {
      throw new TypeError('Domain-control manifest lifecycle routes must be readable canonical documents.');
    }
    const route = Object.freeze({
      version: contract.version,
      canonicalization: contract.canonicalisation,
      explicit: true as const,
    });
    routes.push(route);
    if (contract.lifecycle === 'current' || contract.emitted) {
      if (currentRoute || contract.lifecycle !== 'current' || !contract.emitted) {
        throw new TypeError('Domain-control manifest lifecycle must have exactly one current emitted route.');
      }
      currentRoute = route;
    }
  }
  if (routes.length !== SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS.length
    || routes.some((route, index) => route.version !== SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS[index])
    || currentRoute?.version !== DOMAIN_CONTROL_MANIFEST_VERSION
    || currentRoute.canonicalization !== 'sorted-json-v2') {
    throw new TypeError('Domain-control manifest lifecycle routes do not match the supported contract history.');
  }
  return Object.freeze({
    schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
    readableVersions: Object.freeze(routes.map((route) => route.version)),
    canonicalizationRoutes: Object.freeze(routes),
    currentVersion: DOMAIN_CONTROL_MANIFEST_VERSION,
    currentCanonicalization: currentRoute.canonicalization,
  });
}

export const DOMAIN_CONTROL_MANIFEST_OPERATION = projectDomainControlManifestOperation();
export const DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS = DOMAIN_CONTROL_MANIFEST_OPERATION.readableVersions;
export const DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES = DOMAIN_CONTROL_MANIFEST_OPERATION.canonicalizationRoutes;
export const DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION = DOMAIN_CONTROL_MANIFEST_OPERATION.currentCanonicalization;
