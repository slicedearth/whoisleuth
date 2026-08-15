import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import { MAX_DOMAIN_NAME_LENGTH } from './domain-name.mts';

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
});
