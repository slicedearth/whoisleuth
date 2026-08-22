import {
  defineSchemaCompatibility,
  isCanonicalLocalSchemaIdentifier,
  type SchemaCompatibilityDescriptor,
} from './schema-compatibility.mts';

type SchemaLifecycleRole = 'input' | 'document';
type SchemaLifecycleState = 'current' | 'legacy' | 'retired';
type SchemaLifecyclePrivacy = 'analyst_authored_sensitive' | 'metadata_only';
type SchemaLifecycleFixtureRole = 'input' | 'historical' | 'current';
type SchemaLifecycleFixtureExpectation = 'accepted_exact' | 'historical_output_exact' | 'normalises_to_current_output';

type SchemaLifecycleTarget = Readonly<{
  schema: string;
  version: number;
}>;

type SchemaLifecycleObjectShape = Readonly<{
  path: string;
  requiredKeys: readonly string[];
  optionalKeys: readonly string[];
  alternativeRequiredKeys?: readonly SchemaLifecycleAlternativeRequiredKeys[];
  unknownKeys: 'discard_bounded' | 'preserve_bounded' | 'reject';
}>;

type SchemaLifecycleAlternativeRequiredKeys = Readonly<{
  keys: readonly string[];
  resolution: 'first_present';
}>;

type SchemaLifecycleVariantDiscriminator = Readonly<{
  path: string;
  value: string;
}>;

type SchemaLifecycleFixedArrayShape = Readonly<{
  path: string;
  values: readonly string[];
}>;

type SchemaLifecycleShape = Readonly<{
  id: string;
  schema: string;
  versions: readonly number[];
  objects: readonly SchemaLifecycleObjectShape[];
  fixedArrays: readonly SchemaLifecycleFixedArrayShape[];
  normalisation: 'input_to_current' | 'preserve_bounded_document' | 'preserve_document' | 'preserve_signed_document' | 'project_known_fields';
  target: SchemaLifecycleTarget | null;
  discriminator?: SchemaLifecycleVariantDiscriminator | null;
}>;

type SchemaLifecycleObjectShapeV4 = Omit<SchemaLifecycleObjectShape, 'alternativeRequiredKeys'> & Readonly<{
  alternativeRequiredKeys: readonly SchemaLifecycleAlternativeRequiredKeys[];
}>;

type SchemaLifecycleShapeV4 = Omit<SchemaLifecycleShape, 'objects' | 'discriminator'> & Readonly<{
  objects: readonly SchemaLifecycleObjectShapeV4[];
  discriminator: SchemaLifecycleVariantDiscriminator | null;
}>;

type SchemaLifecycleBoundPhase = 'action' | 'normalised' | 'pre_accumulation' | 'raw_intake' | 'serialised';
type SchemaLifecycleBoundUnit = 'bytes' | 'characters' | 'concurrency' | 'depth' | 'entries' | 'finite_number' | 'integer' | 'items' | 'keys' | 'values';

type SchemaLifecycleBound = Readonly<{
  id: string;
  path: string;
  phase: SchemaLifecycleBoundPhase;
  unit: SchemaLifecycleBoundUnit;
  minimum: number | null;
  maximum: number;
  handling: 'cap_operation' | 'drop_value' | 'reject' | 'truncate';
}>;

type SchemaLifecycleBoundProfile = Readonly<{
  id: string;
  bounds: readonly SchemaLifecycleBound[];
}>;

type SchemaLifecycleHookRole =
  | 'budget_guard'
  | 'builder'
  | 'integrity_verifier'
  | 'interchange_reporter'
  | 'merger'
  | 'normaliser'
  | 'private_file_writer'
  | 'reviewer'
  | 'serialised_byte_counter'
  | 'serialiser'
  | 'sharing_reviewer'
  | 'signature_verifier'
  | 'signer'
  | 'structure_validator'
  | 'monitor';
type SchemaLifecycleRuntime = 'browser' | 'cli' | 'node' | 'shared';

type SchemaLifecycleHook = Readonly<{
  id: string;
  role: SchemaLifecycleHookRole;
  runtime: SchemaLifecycleRuntime;
  module: string;
  exportName: string;
}>;

type SchemaLifecycleSerialisationProfile = Readonly<{
  id: string;
  schema: string;
  versions: readonly number[];
  mediaType: 'application/json';
  encoding: 'utf-8';
  bom: false;
  indentSpaces: 0 | 2;
  terminalLf: boolean;
  propertyOrder: 'normalised_fixed' | 'source_insertion';
  canonicalisation: null;
  integrity: 'none' | 'structural_only_requires_separate_verification';
  serializerHookId: string;
  verifierHookIds: readonly string[];
}>;

type SchemaLifecyclePrivacyProjection =
  | 'bounded_passive_monitor'
  | 'browser_export'
  | 'browser_import'
  | 'full_manifest'
  | 'metadata_only'
  | 'review_output'
  | 'signed_wrapper';
type SchemaLifecycleNotePolicy = 'allowed_bounded' | 'discarded' | 'forced_null' | 'not_applicable';
type SchemaLifecycleRetention = 'browser_indexeddb' | 'deliberate_local_file' | 'none' | 'operator_controlled_output' | 'transient_report';
type SchemaLifecycleNetwork = 'explicit_bounded_passive_deep' | 'explicit_bounded_passive_fast_or_deep' | 'none';

type SchemaLifecyclePrivacyProfile = Readonly<{
  id: string;
  classification: 'analyst_authored_sensitive' | 'metadata_only';
  projection: SchemaLifecyclePrivacyProjection;
  includedCategories: readonly string[];
  excludedCategories: readonly string[];
  notePolicy: SchemaLifecycleNotePolicy;
  retention: SchemaLifecycleRetention;
  network: SchemaLifecycleNetwork;
  sharingReview: 'not_applicable' | 'required';
}>;

type SchemaLifecycleExpiryPolicy = Readonly<{
  id: string;
  field: 'expiresAt' | null;
  anchor: 'checkedAt' | 'generatedAt' | null;
  handling: 'integrity_only' | 'not_applicable' | 'reject_expired' | 'report_expired' | 'require_after_anchor';
  phase: 'build' | 'not_applicable' | 'pre_action' | 'review' | 'verification';
  maximumLifetimeDays: number | null;
}>;

type SchemaLifecycleContractReference = Readonly<{
  schema: string;
  versions: readonly number[];
  mode: 'direct' | 'embedded';
  discriminator?: SchemaLifecycleConsumerDiscriminator | null;
}>;

type SchemaLifecycleConsumerDiscriminator = Readonly<{
  path: string;
  values: readonly string[];
}>;

type SchemaLifecycleConsumerEdge = Readonly<{
  id: string;
  plane: SchemaLifecycleRuntime;
  operation: string;
  acceptedContracts: readonly SchemaLifecycleContractReference[];
  emittedContract: SchemaLifecycleEmittedTarget | null;
  shapeIds: readonly string[];
  boundProfileIds: readonly string[];
  hookIds: readonly string[];
  serialisationProfileId: string | null;
  privacyProfileId: string;
  expiryPolicyId: string;
  requestMode: SchemaLifecycleNetwork;
  retentionEffect: SchemaLifecycleRetention;
  bindingState: 'declared_unenforced';
  policyState: 'current' | 'target';
}>;

type SchemaLifecycleEmittedTarget = SchemaLifecycleTarget & Readonly<{
  discriminator?: SchemaLifecycleVariantDiscriminator | null;
}>;

type SchemaLifecycleContractReferenceV4 = Omit<SchemaLifecycleContractReference, 'discriminator'> & Readonly<{
  discriminator: SchemaLifecycleConsumerDiscriminator | null;
}>;

type SchemaLifecycleEmittedTargetV4 = SchemaLifecycleTarget & Readonly<{
  discriminator: SchemaLifecycleVariantDiscriminator | null;
}>;

type SchemaLifecycleConsumerEdgeV4 = Omit<SchemaLifecycleConsumerEdge, 'acceptedContracts' | 'emittedContract'> & Readonly<{
  acceptedContracts: readonly SchemaLifecycleContractReferenceV4[];
  emittedContract: SchemaLifecycleEmittedTargetV4 | null;
}>;

type SchemaLifecycleConsumerRelationship = Readonly<{
  id: string;
  sourceConsumerId: string;
  targetConsumerId: string;
  relationship: 'composes';
}>;

type SchemaLifecycleContract = Readonly<{
  compatibilityId: string;
  schema: string;
  version: number;
  role: SchemaLifecycleRole;
  lifecycle: SchemaLifecycleState;
  readable: boolean;
  emitted: boolean;
  exactKeys: boolean;
  extensionPolicy: 'discard_bounded' | 'preserve_bounded' | 'reject';
  futureVersionBehaviour: 'discard' | 'not_applicable' | 'preserve_without_write' | 'reject';
  migrationTarget: SchemaLifecycleTarget | null;
  canonicalisation: string | null;
  byteBudget: number | null;
  fixtureIds: readonly string[];
}>;

type SchemaLifecycleFixture = Readonly<{
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  contentDigestSha256: string | null;
  schema: string;
  version: number;
  role: SchemaLifecycleFixtureRole;
  expectation: SchemaLifecycleFixtureExpectation;
  expectedOutputFixtureId: string | null;
  scope: 'repository';
  shapeId?: string | null;
}>;

type SchemaLifecycleFixtureV4 = Omit<SchemaLifecycleFixture, 'shapeId'> & Readonly<{
  shapeId: string;
}>;

type SchemaLifecycleFamily = Readonly<{
  id: string;
  owner: string;
  privacy: SchemaLifecyclePrivacy;
  compatibility: readonly SchemaCompatibilityDescriptor[];
  contracts: readonly SchemaLifecycleContract[];
  fixtures: readonly SchemaLifecycleFixture[];
}>;

type SchemaLifecycleMetadataBase = Readonly<{
  enforcement: 'declarative_only';
  shapes: readonly SchemaLifecycleShape[];
  boundProfiles: readonly SchemaLifecycleBoundProfile[];
  hooks: readonly SchemaLifecycleHook[];
  serialisationProfiles: readonly SchemaLifecycleSerialisationProfile[];
  privacyProfiles: readonly SchemaLifecyclePrivacyProfile[];
  expiryProfiles: readonly SchemaLifecycleExpiryPolicy[];
  consumerEdges: readonly SchemaLifecycleConsumerEdge[];
}>;

type SchemaLifecycleMetadataV1 = SchemaLifecycleMetadataBase & Readonly<{
  metadataVersion: 1;
}>;

type SchemaLifecycleMetadataV2 = SchemaLifecycleMetadataBase & Readonly<{
  metadataVersion: 2;
  consumerRelationships: readonly SchemaLifecycleConsumerRelationship[];
}>;

type SchemaLifecycleMetadataV3 = SchemaLifecycleMetadataBase & Readonly<{
  metadataVersion: 3;
  consumerRelationships: readonly SchemaLifecycleConsumerRelationship[];
}>;

type SchemaLifecycleMetadataV4 = Omit<SchemaLifecycleMetadataBase, 'consumerEdges' | 'shapes'> & Readonly<{
  metadataVersion: 4;
  shapes: readonly SchemaLifecycleShapeV4[];
  consumerEdges: readonly SchemaLifecycleConsumerEdgeV4[];
  consumerRelationships: readonly SchemaLifecycleConsumerRelationship[];
}>;

type SchemaLifecycleMetadata = SchemaLifecycleMetadataV1 | SchemaLifecycleMetadataV2 | SchemaLifecycleMetadataV3 | SchemaLifecycleMetadataV4;

type SchemaLifecycleFamilyWithMetadataV1 = SchemaLifecycleFamily & Readonly<{
  metadata: SchemaLifecycleMetadataV1;
}>;

export type SchemaLifecycleFamilyWithMetadataV2 = SchemaLifecycleFamily & Readonly<{
  metadata: SchemaLifecycleMetadataV2;
}>;

export type SchemaLifecycleFamilyWithMetadataV3 = SchemaLifecycleFamily & Readonly<{
  metadata: SchemaLifecycleMetadataV3;
}>;

export type SchemaLifecycleFamilyWithMetadataV4 = Omit<SchemaLifecycleFamily, 'fixtures'> & Readonly<{
  fixtures: readonly SchemaLifecycleFixtureV4[];
  metadata: SchemaLifecycleMetadataV4;
}>;

type SchemaLifecycleFamilyWithMetadata =
  | SchemaLifecycleFamilyWithMetadataV1
  | SchemaLifecycleFamilyWithMetadataV2
  | SchemaLifecycleFamilyWithMetadataV3
  | SchemaLifecycleFamilyWithMetadataV4;

type SchemaLifecycleRegistry = readonly (SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata)[];

const FAMILY_KEYS = new Set(['id', 'owner', 'privacy', 'compatibility', 'contracts', 'fixtures']);
const EXTENDED_FAMILY_KEYS = new Set([...FAMILY_KEYS, 'metadata']);
const METADATA_V1_KEYS = new Set([
  'metadataVersion',
  'enforcement',
  'shapes',
  'boundProfiles',
  'hooks',
  'serialisationProfiles',
  'privacyProfiles',
  'expiryProfiles',
  'consumerEdges',
]);
const METADATA_V2_KEYS = new Set([
  ...METADATA_V1_KEYS,
  'consumerRelationships',
]);
const METADATA_V3_KEYS = METADATA_V2_KEYS;
const METADATA_V4_KEYS = new Set([
  ...METADATA_V2_KEYS,
]);
const COMPATIBILITY_KEYS = new Set([
  'id',
  'kind',
  'schema',
  'currentVersion',
  'supportedVersions',
  'acceptsUnversionedLegacy',
  'futureVersionBehavior',
  'migration',
  'writeSemantics',
  'byteBudget',
  'owner',
  'note',
]);
const CONTRACT_KEYS = new Set([
  'compatibilityId',
  'schema',
  'version',
  'role',
  'lifecycle',
  'readable',
  'emitted',
  'exactKeys',
  'extensionPolicy',
  'futureVersionBehaviour',
  'migrationTarget',
  'canonicalisation',
  'byteBudget',
  'fixtureIds',
]);
const TARGET_KEYS = new Set(['schema', 'version']);
const EMITTED_TARGET_V4_KEYS = new Set([...TARGET_KEYS, 'discriminator']);
const FIXTURE_KEYS = new Set([
  'id',
  'path',
  'bytes',
  'sha256',
  'contentDigestSha256',
  'schema',
  'version',
  'role',
  'expectation',
  'expectedOutputFixtureId',
  'scope',
]);
const FIXTURE_V4_KEYS = new Set([...FIXTURE_KEYS, 'shapeId']);
const SHAPE_KEYS = new Set(['id', 'schema', 'versions', 'objects', 'fixedArrays', 'normalisation', 'target']);
const SHAPE_V4_KEYS = new Set([...SHAPE_KEYS, 'discriminator']);
const OBJECT_SHAPE_KEYS = new Set(['path', 'requiredKeys', 'optionalKeys', 'unknownKeys']);
const OBJECT_SHAPE_V4_KEYS = new Set([...OBJECT_SHAPE_KEYS, 'alternativeRequiredKeys']);
const ALTERNATIVE_REQUIRED_KEYS = new Set(['keys', 'resolution']);
const FIXED_ARRAY_SHAPE_KEYS = new Set(['path', 'values']);
const BOUND_PROFILE_KEYS = new Set(['id', 'bounds']);
const BOUND_KEYS = new Set(['id', 'path', 'phase', 'unit', 'minimum', 'maximum', 'handling']);
const HOOK_KEYS = new Set(['id', 'role', 'runtime', 'module', 'exportName']);
const SERIALISATION_PROFILE_KEYS = new Set([
  'id', 'schema', 'versions', 'mediaType', 'encoding', 'bom', 'indentSpaces', 'terminalLf',
  'propertyOrder', 'canonicalisation', 'integrity', 'serializerHookId', 'verifierHookIds',
]);
const PRIVACY_PROFILE_KEYS = new Set([
  'id', 'classification', 'projection', 'includedCategories', 'excludedCategories', 'notePolicy',
  'retention', 'network', 'sharingReview',
]);
const EXPIRY_POLICY_KEYS = new Set(['id', 'field', 'anchor', 'handling', 'phase', 'maximumLifetimeDays']);
const CONTRACT_REFERENCE_KEYS = new Set(['schema', 'versions', 'mode']);
const CONTRACT_REFERENCE_V3_KEYS = new Set([...CONTRACT_REFERENCE_KEYS, 'discriminator']);
const CONSUMER_DISCRIMINATOR_KEYS = new Set(['path', 'values']);
const CONTRACT_VARIANT_DISCRIMINATOR_KEYS = new Set(['path', 'value']);
const CONSUMER_KEYS = new Set([
  'id', 'plane', 'operation', 'acceptedContracts', 'emittedContract', 'shapeIds', 'boundProfileIds',
  'hookIds', 'serialisationProfileId', 'privacyProfileId', 'expiryPolicyId', 'requestMode',
  'retentionEffect', 'bindingState', 'policyState',
]);
const CONSUMER_RELATIONSHIP_KEYS = new Set([
  'id', 'sourceConsumerId', 'targetConsumerId', 'relationship',
]);
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,79}$/u;
const OWNER_PATTERN = /^[a-z0-9_./-]+$/iu;
const CANONICALISATION_PATTERN = /^[-a-z0-9.]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FIELD_SEGMENT_PATTERN = '[A-Za-z0-9][A-Za-z0-9_]{0,79}';
const FIELD_PATTERN = new RegExp(`^${FIELD_SEGMENT_PATTERN}$`, 'u');
const METADATA_PATH_PATTERN = new RegExp(
  `^(?:\\$|${FIELD_SEGMENT_PATTERN}(?:\\[\\])?)(?:\\.(?:${FIELD_SEGMENT_PATTERN}(?:\\[\\])?))*$`,
  'u',
);
const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/u;
const MAX_CONTRACTS = 64;
const MAX_FIXTURES = 128;
const MAX_METADATA_COLLECTION = 128;
const MAX_NESTED_METADATA_COLLECTION = 64;
const MAX_METADATA_NODES = 8_192;
const MAX_METADATA_TEXT_CODE_UNITS = 262_144;
const MAX_METADATA_SERIALISED_BYTES = 1_048_576;
export const MAX_SCHEMA_LIFECYCLE_FAMILIES = 32;
const MAX_SCHEMA_LIFECYCLE_REGISTRY_BYTES = 4 * 1_048_576;

type MetadataCopyBudget = {
  slots: number;
  textCodeUnits: number;
  serialisedBytes: number;
};

function consumeMetadataSlots(budget: MetadataCopyBudget | undefined, count: number): void {
  if (!budget) return;
  budget.slots += count;
  if (budget.slots > MAX_METADATA_NODES) {
    throw new TypeError('Schema lifecycle metadata exceeds its aggregate node budget.');
  }
}

function consumeMetadataSerialisedBytes(
  budget: MetadataCopyBudget | undefined,
  bytes: number,
): void {
  if (!budget) return;
  budget.serialisedBytes += bytes;
  if (budget.serialisedBytes > MAX_METADATA_SERIALISED_BYTES) {
    throw new TypeError('Schema lifecycle metadata exceeds its serialised byte budget.');
  }
}

function consumeMetadataValue(budget: MetadataCopyBudget | undefined, value: unknown): void {
  if (!budget) return;
  if (typeof value === 'string') {
    budget.textCodeUnits += value.length;
    if (budget.textCodeUnits > MAX_METADATA_TEXT_CODE_UNITS) {
      throw new TypeError('Schema lifecycle metadata exceeds its aggregate text budget.');
    }
  }
  if (value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean') {
    const serialised = JSON.stringify(value);
    if (typeof serialised === 'string') {
      consumeMetadataSerialisedBytes(budget, utf8Length(serialised));
    }
  }
}

function ordinaryRecord(
  value: unknown,
  keys: ReadonlySet<string> | readonly ReadonlySet<string>[],
  label: string,
  budget?: MetadataCopyBudget,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object.`);
  }
  const keySets: readonly ReadonlySet<string>[] = Array.isArray(keys)
    ? keys
    : [keys as ReadonlySet<string>];
  const ownKeys = Reflect.ownKeys(value);
  const selectedKeys = keySets.find((candidate) => ownKeys.length === candidate.size
    && ownKeys.every((key) => typeof key === 'string' && candidate.has(key)));
  if (!selectedKeys) {
    throw new TypeError(`${label} must use its exact registered fields.`);
  }
  consumeMetadataSlots(budget, selectedKeys.size + 1);
  consumeMetadataSerialisedBytes(
    budget,
    2 + Math.max(0, ownKeys.length - 1) + (ownKeys as string[])
      .reduce((bytes, key) => bytes + utf8Length(JSON.stringify(key)) + 1, 0),
  );
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary enumerable data fields.`);
    }
    consumeMetadataValue(budget, descriptor.value);
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(
  value: unknown,
  label: string,
  maximum: number,
  minimum = 1,
  budget?: MetadataCopyBudget,
): readonly unknown[] {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Object.prototype.hasOwnProperty.call(value, Symbol.iterator)) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || Number(length) < minimum || Number(length) > maximum) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  consumeMetadataSlots(budget, Number(length) + 1);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== Number(length) + 1
    || ownKeys.at(-1) !== 'length'
    || ownKeys.slice(0, -1).some((key, index) => key !== String(index))) {
    throw new TypeError(`${label} must be a dense ordinary array without extra fields.`);
  }
  consumeMetadataSerialisedBytes(budget, 2 + Math.max(0, Number(length) - 1));
  const result: unknown[] = [];
  for (let index = 0; index < Number(length); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain ordinary enumerable data entries.`);
    }
    consumeMetadataValue(budget, descriptor.value);
    result.push(descriptor.value);
  }
  return result;
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function boundedSchema(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length > 120
    || !/^[-a-z0-9.]+$/u.test(value)
    || (value.startsWith('whoisleuth.') && !isCanonicalLocalSchemaIdentifier(value))) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function boundedField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FIELD_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function boundedMetadataPath(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length > 160
    || !METADATA_PATH_PATTERN.test(value)
    || value.split('.').length > 16) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function parentMetadataPath(value: string): string | null {
  const separator = value.lastIndexOf('.');
  return separator < 0 ? null : value.slice(0, separator);
}

function metadataPathField(value: string): string | null {
  const separator = value.lastIndexOf('.');
  return separator < 0 ? null : value.slice(separator + 1).replace(/\[\]$/u, '');
}

function metadataPathIsTransitivelyRequired(
  path: string,
  objectsByPath: ReadonlyMap<string, SchemaLifecycleObjectShape>,
): boolean {
  let current = path;
  while (current !== '$') {
    const parentPath = parentMetadataPath(current);
    const field = metadataPathField(current);
    if (!parentPath) return false;
    const parent = objectsByPath.get(parentPath);
    if (!parent || !field || !parent.requiredKeys.includes(field)) return false;
    current = parentPath;
  }
  return true;
}

function boundedText(value: unknown, label: string, maximum = 1_000): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as Values[number];
}

function boundedPath(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length < 3
    || value.length > 200
    || !OWNER_PATTERN.test(value)
    || value.startsWith('/')
    || value.includes('..')) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function copyTarget(
  value: unknown,
  label: string,
  budget?: MetadataCopyBudget,
): SchemaLifecycleTarget | null {
  if (value === null) return null;
  const source = ordinaryRecord(value, TARGET_KEYS, label, budget);
  return Object.freeze({
    schema: boundedSchema(source.schema, `${label} schema`),
    version: positiveInteger(source.version, `${label} version`),
  });
}

function copyConsumerDiscriminator(
  value: unknown,
  label: string,
  budget: MetadataCopyBudget,
): SchemaLifecycleConsumerDiscriminator {
  const source = ordinaryRecord(value, CONSUMER_DISCRIMINATOR_KEYS, label, budget);
  return Object.freeze({
    path: boundedMetadataPath(source.path, `${label} path`),
    values: copyTextArray(source.values, `${label} values`, false, budget),
  });
}

function copyVariantDiscriminator(
  value: unknown,
  label: string,
  budget: MetadataCopyBudget,
): SchemaLifecycleVariantDiscriminator {
  const source = ordinaryRecord(value, CONTRACT_VARIANT_DISCRIMINATOR_KEYS, label, budget);
  return Object.freeze({
    path: boundedMetadataPath(source.path, `${label} path`),
    value: boundedText(source.value, `${label} value`),
  });
}

function copyEmittedTarget(
  value: unknown,
  label: string,
  budget: MetadataCopyBudget,
  metadataVersion: 1 | 2 | 3 | 4,
): SchemaLifecycleEmittedTarget | null {
  if (value === null) return null;
  const source = ordinaryRecord(
    value,
    metadataVersion === 4 ? EMITTED_TARGET_V4_KEYS : TARGET_KEYS,
    label,
    budget,
  );
  const discriminator = metadataVersion === 4 && Object.hasOwn(source, 'discriminator')
    && source.discriminator !== null
    ? copyVariantDiscriminator(source.discriminator, `${label} discriminator`, budget)
    : null;
  return Object.freeze({
    schema: boundedSchema(source.schema, `${label} schema`),
    version: positiveInteger(source.version, `${label} version`),
    ...(metadataVersion === 4 ? { discriminator } : {}),
  });
}

function copyStringArray(value: unknown, label: string): readonly string[] {
  const source = denseArray(value, label, MAX_FIXTURES);
  const result = source.map((item) => boundedId(item, `${label} id`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}

function copyIdArray(
  value: unknown,
  label: string,
  allowEmpty = false,
  budget?: MetadataCopyBudget,
): readonly string[] {
  const source = denseArray(value, label, MAX_NESTED_METADATA_COLLECTION, allowEmpty ? 0 : 1, budget);
  const result = source.map((item) => boundedId(item, `${label} id`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}

function copyFieldArray(
  value: unknown,
  label: string,
  allowEmpty = false,
  budget?: MetadataCopyBudget,
): readonly string[] {
  const source = denseArray(value, label, MAX_NESTED_METADATA_COLLECTION, allowEmpty ? 0 : 1, budget);
  const result = source.map((item) => boundedField(item, `${label} field`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}

function copyAlternativeRequiredKeys(
  value: unknown,
  label: string,
  budget: MetadataCopyBudget,
): readonly SchemaLifecycleAlternativeRequiredKeys[] {
  const groups = denseArray(
    value,
    label,
    MAX_NESTED_METADATA_COLLECTION,
    0,
    budget,
  ).map((group, index) => {
    const groupLabel = `${label} group ${index + 1}`;
    const source = ordinaryRecord(group, ALTERNATIVE_REQUIRED_KEYS, groupLabel, budget);
    return Object.freeze({
      keys: copyFieldArray(source.keys, `${groupLabel} keys`, false, budget),
      resolution: oneOf(source.resolution, ['first_present'] as const, `${groupLabel} resolution`),
    });
  });
  if (groups.some((group) => group.keys.length < 2)) {
    throw new TypeError(`${label} groups must each contain at least two alternative fields.`);
  }
  const flattened = groups.flatMap((group) => group.keys);
  if (new Set(flattened).size !== flattened.length) {
    throw new TypeError(`${label} fields must belong to only one alternative group.`);
  }
  return Object.freeze(groups);
}

function copyTextArray(
  value: unknown,
  label: string,
  allowEmpty = false,
  budget?: MetadataCopyBudget,
): readonly string[] {
  const source = denseArray(value, label, MAX_NESTED_METADATA_COLLECTION, allowEmpty ? 0 : 1, budget);
  const result = source.map((item) => boundedText(item, `${label} value`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}

function copyVersionArray(
  value: unknown,
  label: string,
  budget?: MetadataCopyBudget,
): readonly number[] {
  const result = denseArray(value, label, MAX_CONTRACTS, 1, budget)
    .map((version) => positiveInteger(version, `${label} version`));
  if (new Set(result).size !== result.length
    || result.some((version, index) => index > 0 && version <= (result[index - 1] ?? 0))) {
    throw new TypeError(`${label} must contain unique ascending versions.`);
  }
  return Object.freeze(result);
}

function copyCompatibility(value: unknown, index: number): SchemaCompatibilityDescriptor {
  const label = `Schema lifecycle compatibility descriptor ${index + 1}`;
  const source = ordinaryRecord(value, COMPATIBILITY_KEYS, label);
  const supportedVersions = denseArray(source.supportedVersions, `${label} supported versions`, MAX_CONTRACTS)
    .map((version) => positiveInteger(version, `${label} supported version`));
  return defineSchemaCompatibility({
    id: source.id as SchemaCompatibilityDescriptor['id'],
    kind: source.kind as SchemaCompatibilityDescriptor['kind'],
    schema: source.schema as SchemaCompatibilityDescriptor['schema'],
    currentVersion: source.currentVersion as SchemaCompatibilityDescriptor['currentVersion'],
    supportedVersions,
    acceptsUnversionedLegacy: source.acceptsUnversionedLegacy as SchemaCompatibilityDescriptor['acceptsUnversionedLegacy'],
    futureVersionBehavior: source.futureVersionBehavior as SchemaCompatibilityDescriptor['futureVersionBehavior'],
    migration: source.migration as SchemaCompatibilityDescriptor['migration'],
    writeSemantics: source.writeSemantics as SchemaCompatibilityDescriptor['writeSemantics'],
    byteBudget: source.byteBudget as SchemaCompatibilityDescriptor['byteBudget'],
    owner: source.owner as SchemaCompatibilityDescriptor['owner'],
    note: source.note as SchemaCompatibilityDescriptor['note'],
  });
}

function copyContract(value: unknown, index: number): SchemaLifecycleContract {
  const label = `Schema lifecycle contract ${index + 1}`;
  const source = ordinaryRecord(value, CONTRACT_KEYS, label);
  const schema = boundedSchema(source.schema, `${label} schema`);
  const version = positiveInteger(source.version, `${label} version`);
  const role = source.role;
  const lifecycle = source.lifecycle;
  if (role !== 'input' && role !== 'document') throw new TypeError(`${label} has an invalid role.`);
  if (lifecycle !== 'current' && lifecycle !== 'legacy' && lifecycle !== 'retired') {
    throw new TypeError(`${label} has an invalid lifecycle state.`);
  }
  if (typeof source.readable !== 'boolean' || typeof source.emitted !== 'boolean') {
    throw new TypeError(`${label} has invalid read or emission metadata.`);
  }
  const exactKeys = source.exactKeys;
  const extensionPolicy = source.extensionPolicy;
  if ((exactKeys !== true && exactKeys !== false)
    || (extensionPolicy !== 'reject'
      && extensionPolicy !== 'preserve_bounded'
      && extensionPolicy !== 'discard_bounded')
    || (exactKeys === true) !== (extensionPolicy === 'reject')
    || (source.futureVersionBehaviour !== 'discard'
      && source.futureVersionBehaviour !== 'reject'
      && source.futureVersionBehaviour !== 'preserve_without_write'
      && source.futureVersionBehaviour !== 'not_applicable')) {
    throw new TypeError(`${label} must reconcile exact keys with its bounded extension policy and declare future-version handling.`);
  }
  const canonicalisation = source.canonicalisation;
  if (canonicalisation !== null
    && (typeof canonicalisation !== 'string'
      || canonicalisation.length > 80
      || !CANONICALISATION_PATTERN.test(canonicalisation))) {
    throw new TypeError(`${label} has an invalid canonicalisation identifier.`);
  }
  const byteBudget = source.byteBudget;
  if (byteBudget !== null && (!Number.isSafeInteger(byteBudget) || Number(byteBudget) <= 0)) {
    throw new TypeError(`${label} has an invalid byte budget.`);
  }
  return Object.freeze({
    compatibilityId: boundedId(source.compatibilityId, `${label} compatibility id`),
    schema,
    version,
    role,
    lifecycle,
    readable: source.readable,
    emitted: source.emitted,
    exactKeys,
    extensionPolicy,
    futureVersionBehaviour: source.futureVersionBehaviour,
    migrationTarget: copyTarget(source.migrationTarget, `${label} migration target`),
    canonicalisation,
    byteBudget: byteBudget === null ? null : Number(byteBudget),
    fixtureIds: copyStringArray(source.fixtureIds, `${label} fixtures`),
  });
}

function copyFixture(value: unknown, index: number): SchemaLifecycleFixture {
  const label = `Schema lifecycle fixture ${index + 1}`;
  const source = ordinaryRecord(value, [FIXTURE_KEYS, FIXTURE_V4_KEYS], label);
  const role = source.role;
  const expectation = source.expectation;
  if (role !== 'input' && role !== 'historical' && role !== 'current') {
    throw new TypeError(`${label} has an invalid role.`);
  }
  if (expectation !== 'accepted_exact'
    && expectation !== 'historical_output_exact'
    && expectation !== 'normalises_to_current_output') {
    throw new TypeError(`${label} has an invalid expectation.`);
  }
  const contentDigest = source.contentDigestSha256;
  if (contentDigest !== null
    && (typeof contentDigest !== 'string' || !CONTENT_DIGEST_PATTERN.test(contentDigest))) {
    throw new TypeError(`${label} has an invalid content digest.`);
  }
  const expectedOutputFixtureId = source.expectedOutputFixtureId;
  if (expectedOutputFixtureId !== null && typeof expectedOutputFixtureId !== 'string') {
    throw new TypeError(`${label} has an invalid output fixture reference.`);
  }
  if (typeof source.sha256 !== 'string' || !SHA256_PATTERN.test(source.sha256)) {
    throw new TypeError(`${label} has an invalid file digest.`);
  }
  if (source.scope !== 'repository') throw new TypeError(`${label} must declare repository fixture scope.`);
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    path: boundedPath(source.path, `${label} path`),
    bytes: positiveInteger(source.bytes, `${label} bytes`),
    sha256: source.sha256,
    contentDigestSha256: contentDigest,
    schema: boundedSchema(source.schema, `${label} schema`),
    version: positiveInteger(source.version, `${label} version`),
    role,
    expectation,
    expectedOutputFixtureId: expectedOutputFixtureId === null
      ? null
      : boundedId(expectedOutputFixtureId, `${label} output fixture`),
    scope: 'repository',
    ...(Object.hasOwn(source, 'shapeId')
      ? {
        shapeId: source.shapeId === null
          ? null
          : boundedId(source.shapeId, `${label} shape`),
      }
      : {}),
  });
}

function copyObjectShape(
  value: unknown,
  index: number,
  shapeLabel: string,
  budget: MetadataCopyBudget,
  metadataVersion: 1 | 2 | 3 | 4,
): SchemaLifecycleObjectShape {
  const label = `${shapeLabel} object ${index + 1}`;
  const source = ordinaryRecord(
    value,
    metadataVersion === 4 ? OBJECT_SHAPE_V4_KEYS : OBJECT_SHAPE_KEYS,
    label,
    budget,
  );
  const requiredKeys = copyFieldArray(source.requiredKeys, `${label} required keys`, true, budget);
  const optionalKeys = copyFieldArray(source.optionalKeys, `${label} optional keys`, true, budget);
  if (requiredKeys.some((key) => optionalKeys.includes(key))) {
    throw new TypeError(`${label} required and optional keys must not overlap.`);
  }
  const alternativeRequiredKeys = metadataVersion === 4
    ? copyAlternativeRequiredKeys(source.alternativeRequiredKeys, `${label} alternative required keys`, budget)
    : Object.freeze([]);
  if (alternativeRequiredKeys.flatMap((group) => group.keys)
    .some((key) => requiredKeys.includes(key) || optionalKeys.includes(key))) {
    throw new TypeError(`${label} alternative fields must not overlap required or optional keys.`);
  }
  const unknownKeys = oneOf(
    source.unknownKeys,
    metadataVersion === 4
      ? ['discard_bounded', 'preserve_bounded', 'reject'] as const
      : ['preserve_bounded', 'reject'] as const,
    `${label} unknown-key handling`,
  );
  return Object.freeze({
    path: boundedMetadataPath(source.path, `${label} path`),
    requiredKeys,
    optionalKeys,
    ...(metadataVersion === 4 ? { alternativeRequiredKeys } : {}),
    unknownKeys,
  });
}

function copyFixedArrayShape(
  value: unknown,
  index: number,
  shapeLabel: string,
  budget: MetadataCopyBudget,
): SchemaLifecycleFixedArrayShape {
  const label = `${shapeLabel} fixed array ${index + 1}`;
  const source = ordinaryRecord(value, FIXED_ARRAY_SHAPE_KEYS, label, budget);
  return Object.freeze({
    path: boundedMetadataPath(source.path, `${label} path`),
    values: copyTextArray(source.values, `${label} values`, false, budget),
  });
}

function copyShape(
  value: unknown,
  index: number,
  budget: MetadataCopyBudget,
  metadataVersion: 1 | 2 | 3 | 4,
): SchemaLifecycleShape {
  const label = `Schema lifecycle shape ${index + 1}`;
  const source = ordinaryRecord(
    value,
    metadataVersion === 4 ? SHAPE_V4_KEYS : SHAPE_KEYS,
    label,
    budget,
  );
  const objects = Object.freeze(denseArray(
    source.objects,
    `${label} objects`,
    MAX_NESTED_METADATA_COLLECTION,
    1,
    budget,
  ).map((item, objectIndex) => copyObjectShape(item, objectIndex, label, budget, metadataVersion)));
  const fixedArrays = Object.freeze(denseArray(
    source.fixedArrays,
    `${label} fixed arrays`,
    MAX_NESTED_METADATA_COLLECTION,
    0,
    budget,
  ).map((item, arrayIndex) => copyFixedArrayShape(item, arrayIndex, label, budget)));
  if (new Set(objects.map((item) => item.path)).size !== objects.length
    || new Set(fixedArrays.map((item) => item.path)).size !== fixedArrays.length) {
    throw new TypeError(`${label} paths must be unique within their shape kind.`);
  }
  const normalisation = oneOf(
    source.normalisation,
    metadataVersion === 4
      ? ['input_to_current', 'preserve_bounded_document', 'preserve_document', 'preserve_signed_document', 'project_known_fields'] as const
      : ['input_to_current', 'preserve_bounded_document', 'preserve_document', 'preserve_signed_document'] as const,
    `${label} normalisation`,
  );
  const target = copyTarget(source.target, `${label} target`, budget);
  if ((normalisation === 'input_to_current') !== (target !== null)) {
    throw new TypeError(`${label} input normalisation must name one target and document preservation must not.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    schema: boundedSchema(source.schema, `${label} schema`),
    versions: copyVersionArray(source.versions, `${label} versions`, budget),
    objects,
    fixedArrays,
    normalisation,
    target,
    ...(metadataVersion === 4
      ? {
        discriminator: source.discriminator === null
          ? null
          : copyVariantDiscriminator(source.discriminator, `${label} discriminator`, budget),
      }
      : {}),
  });
}

function copyBound(
  value: unknown,
  index: number,
  profileLabel: string,
  budget: MetadataCopyBudget,
): SchemaLifecycleBound {
  const label = `${profileLabel} bound ${index + 1}`;
  const source = ordinaryRecord(value, BOUND_KEYS, label, budget);
  const minimum = source.minimum === null
    ? null
    : nonNegativeInteger(source.minimum, `${label} minimum`);
  const maximum = positiveInteger(source.maximum, `${label} maximum`);
  if (minimum !== null && minimum > maximum) throw new TypeError(`${label} minimum exceeds its maximum.`);
  const phase = oneOf(
    source.phase,
    ['action', 'normalised', 'pre_accumulation', 'raw_intake', 'serialised'] as const,
    `${label} phase`,
  );
  const handling = oneOf(
    source.handling,
    ['cap_operation', 'drop_value', 'reject', 'truncate'] as const,
    `${label} handling`,
  );
  if ((handling === 'cap_operation' && phase !== 'action')
    || (handling === 'truncate' && phase !== 'normalised')
    || (handling === 'drop_value' && phase !== 'pre_accumulation' && phase !== 'normalised')) {
    throw new TypeError(`${label} has inconsistent phase and handling metadata.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    path: boundedMetadataPath(source.path, `${label} path`),
    phase,
    unit: oneOf(
      source.unit,
      ['bytes', 'characters', 'concurrency', 'depth', 'entries', 'finite_number', 'integer', 'items', 'keys', 'values'] as const,
      `${label} unit`,
    ),
    minimum,
    maximum,
    handling,
  });
}

function copyBoundProfile(value: unknown, index: number, budget: MetadataCopyBudget): SchemaLifecycleBoundProfile {
  const label = `Schema lifecycle bound profile ${index + 1}`;
  const source = ordinaryRecord(value, BOUND_PROFILE_KEYS, label, budget);
  const bounds = Object.freeze(denseArray(
    source.bounds,
    `${label} bounds`,
    MAX_NESTED_METADATA_COLLECTION,
    1,
    budget,
  ).map((item, boundIndex) => copyBound(item, boundIndex, label, budget)));
  if (new Set(bounds.map((bound) => bound.id)).size !== bounds.length) {
    throw new TypeError(`${label} bound ids must be unique.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    bounds,
  });
}

function copyHook(value: unknown, index: number, budget: MetadataCopyBudget): SchemaLifecycleHook {
  const label = `Schema lifecycle hook ${index + 1}`;
  const source = ordinaryRecord(value, HOOK_KEYS, label, budget);
  const exportName = source.exportName;
  if (typeof exportName !== 'string' || !EXPORT_NAME_PATTERN.test(exportName)) {
    throw new TypeError(`${label} export name is invalid.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    role: oneOf(source.role, [
      'budget_guard',
      'builder',
      'integrity_verifier',
      'interchange_reporter',
      'merger',
      'monitor',
      'normaliser',
      'private_file_writer',
      'reviewer',
      'serialised_byte_counter',
      'serialiser',
      'sharing_reviewer',
      'signature_verifier',
      'signer',
      'structure_validator',
    ] as const, `${label} role`),
    runtime: oneOf(source.runtime, ['browser', 'cli', 'node', 'shared'] as const, `${label} runtime`),
    module: boundedPath(source.module, `${label} module`),
    exportName,
  });
}

function copySerialisationProfile(
  value: unknown,
  index: number,
  budget: MetadataCopyBudget,
): SchemaLifecycleSerialisationProfile {
  const label = `Schema lifecycle serialisation profile ${index + 1}`;
  const source = ordinaryRecord(value, SERIALISATION_PROFILE_KEYS, label, budget);
  if (source.mediaType !== 'application/json'
    || source.encoding !== 'utf-8'
    || source.bom !== false
    || (source.indentSpaces !== 0 && source.indentSpaces !== 2)
    || typeof source.terminalLf !== 'boolean'
    || (source.propertyOrder !== 'normalised_fixed' && source.propertyOrder !== 'source_insertion')
    || (source.integrity !== 'none'
      && source.integrity !== 'structural_only_requires_separate_verification')) {
    throw new TypeError(`${label} must use the registered portable JSON contract.`);
  }
  const integrity = source.integrity;
  const verifierHookIds = copyIdArray(
    source.verifierHookIds,
    `${label} verifier hooks`,
    integrity === 'none',
    budget,
  );
  if ((integrity === 'none') !== (verifierHookIds.length === 0)) {
    throw new TypeError(`${label} must declare verifier hooks only when separate integrity verification is required.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    schema: boundedSchema(source.schema, `${label} schema`),
    versions: copyVersionArray(source.versions, `${label} versions`, budget),
    mediaType: 'application/json' as const,
    encoding: 'utf-8' as const,
    bom: false as const,
    indentSpaces: source.indentSpaces,
    terminalLf: source.terminalLf,
    propertyOrder: source.propertyOrder,
    canonicalisation: source.canonicalisation === null
      ? null
      : (() => { throw new TypeError(`${label} portable serialisation must remain separate from digest canonicalisation.`); })(),
    integrity,
    serializerHookId: boundedId(source.serializerHookId, `${label} serialiser hook`),
    verifierHookIds,
  });
}

function copyPrivacyProfile(value: unknown, index: number, budget: MetadataCopyBudget): SchemaLifecyclePrivacyProfile {
  const label = `Schema lifecycle privacy profile ${index + 1}`;
  const source = ordinaryRecord(value, PRIVACY_PROFILE_KEYS, label, budget);
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    classification: oneOf(source.classification, ['analyst_authored_sensitive', 'metadata_only'] as const, `${label} classification`),
    projection: oneOf(source.projection, [
      'bounded_passive_monitor',
      'browser_export',
      'browser_import',
      'full_manifest',
      'metadata_only',
      'review_output',
      'signed_wrapper',
    ] as const, `${label} projection`),
    includedCategories: copyIdArray(source.includedCategories, `${label} included categories`, false, budget),
    excludedCategories: copyIdArray(source.excludedCategories, `${label} excluded categories`, true, budget),
    notePolicy: oneOf(source.notePolicy, ['allowed_bounded', 'discarded', 'forced_null', 'not_applicable'] as const, `${label} note policy`),
    retention: oneOf(source.retention, ['browser_indexeddb', 'deliberate_local_file', 'none', 'operator_controlled_output', 'transient_report'] as const, `${label} retention`),
    network: oneOf(source.network, [
      'explicit_bounded_passive_deep',
      'explicit_bounded_passive_fast_or_deep',
      'none',
    ] as const, `${label} network`),
    sharingReview: oneOf(source.sharingReview, ['not_applicable', 'required'] as const, `${label} sharing review`),
  });
}

function copyExpiryPolicy(value: unknown, index: number, budget: MetadataCopyBudget): SchemaLifecycleExpiryPolicy {
  const label = `Schema lifecycle expiry policy ${index + 1}`;
  const source = ordinaryRecord(value, EXPIRY_POLICY_KEYS, label, budget);
  const handling = oneOf(
    source.handling,
    ['integrity_only', 'not_applicable', 'reject_expired', 'report_expired', 'require_after_anchor'] as const,
    `${label} handling`,
  );
  const anchor = source.anchor === null
    ? null
    : oneOf(source.anchor, ['checkedAt', 'generatedAt'] as const, `${label} anchor`);
  const field = source.field === null
    ? null
    : oneOf(source.field, ['expiresAt'] as const, `${label} field`);
  if ((handling === 'not_applicable'
    && (field !== null || anchor !== null || source.maximumLifetimeDays !== null))
    || (handling !== 'not_applicable' && field !== 'expiresAt')
    || (handling === 'integrity_only' && anchor !== null)
    || (handling === 'require_after_anchor' && anchor !== 'generatedAt')
    || ((handling === 'reject_expired' || handling === 'report_expired') && anchor !== 'checkedAt')) {
    throw new TypeError(`${label} has inconsistent expiry handling.`);
  }
  const phase = oneOf(source.phase, ['build', 'not_applicable', 'pre_action', 'review', 'verification'] as const, `${label} phase`);
  if ((handling === 'require_after_anchor' && phase !== 'build')
    || (handling === 'reject_expired' && phase !== 'pre_action')
    || (handling === 'report_expired' && phase !== 'review')
    || (handling === 'integrity_only' && phase !== 'verification')
    || (handling === 'not_applicable' && phase !== 'not_applicable')) {
    throw new TypeError(`${label} has an inconsistent phase.`);
  }
  const maximumLifetimeDays = source.maximumLifetimeDays === null
    ? null
    : positiveInteger(source.maximumLifetimeDays, `${label} maximum lifetime days`);
  if (maximumLifetimeDays !== null && maximumLifetimeDays > 36_500) {
    throw new TypeError(`${label} maximum lifetime is invalid.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    field,
    anchor,
    handling,
    phase,
    maximumLifetimeDays,
  });
}

function copyContractReference(
  value: unknown,
  index: number,
  consumerLabel: string,
  budget: MetadataCopyBudget,
  metadataVersion: 1 | 2 | 3 | 4,
): SchemaLifecycleContractReference {
  const label = `${consumerLabel} accepted contract ${index + 1}`;
  const source = ordinaryRecord(
    value,
    metadataVersion === 4
      ? CONTRACT_REFERENCE_V3_KEYS
      : metadataVersion === 3
      ? [CONTRACT_REFERENCE_KEYS, CONTRACT_REFERENCE_V3_KEYS]
      : CONTRACT_REFERENCE_KEYS,
    label,
    budget,
  );
  let discriminator: SchemaLifecycleConsumerDiscriminator | null | undefined;
  if (metadataVersion >= 3) {
    if (!Object.hasOwn(source, 'discriminator') || source.discriminator === null) {
      discriminator = null;
    } else {
      discriminator = copyConsumerDiscriminator(
        source.discriminator,
        `${label} discriminator`,
        budget,
      );
    }
  }
  return Object.freeze({
    schema: boundedSchema(source.schema, `${label} schema`),
    versions: copyVersionArray(source.versions, `${label} versions`, budget),
    mode: oneOf(source.mode, ['direct', 'embedded'] as const, `${label} mode`),
    ...(metadataVersion >= 3 ? { discriminator: discriminator ?? null } : {}),
  });
}

function copyConsumerEdge(
  value: unknown,
  index: number,
  budget: MetadataCopyBudget,
  metadataVersion: 1 | 2 | 3 | 4,
): SchemaLifecycleConsumerEdge {
  const label = `Schema lifecycle consumer ${index + 1}`;
  const source = ordinaryRecord(value, CONSUMER_KEYS, label, budget);
  const serialisationProfileId = source.serialisationProfileId;
  if (serialisationProfileId !== null && typeof serialisationProfileId !== 'string') {
    throw new TypeError(`${label} serialisation profile is invalid.`);
  }
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    plane: oneOf(source.plane, ['browser', 'cli', 'node', 'shared'] as const, `${label} plane`),
    operation: boundedId(source.operation, `${label} operation`),
    acceptedContracts: Object.freeze(denseArray(
      source.acceptedContracts,
      `${label} accepted contracts`,
      MAX_NESTED_METADATA_COLLECTION,
      0,
      budget,
    ).map((item, referenceIndex) => copyContractReference(
      item,
      referenceIndex,
      label,
      budget,
      metadataVersion,
    ))),
    emittedContract: copyEmittedTarget(
      source.emittedContract,
      `${label} emitted contract`,
      budget,
      metadataVersion,
    ),
    shapeIds: copyIdArray(source.shapeIds, `${label} shapes`, false, budget),
    boundProfileIds: copyIdArray(source.boundProfileIds, `${label} bound profiles`, false, budget),
    hookIds: copyIdArray(source.hookIds, `${label} hooks`, false, budget),
    serialisationProfileId: serialisationProfileId === null
      ? null
      : boundedId(serialisationProfileId, `${label} serialisation profile`),
    privacyProfileId: boundedId(source.privacyProfileId, `${label} privacy profile`),
    expiryPolicyId: boundedId(source.expiryPolicyId, `${label} expiry policy`),
    requestMode: oneOf(source.requestMode, [
      'explicit_bounded_passive_deep',
      'explicit_bounded_passive_fast_or_deep',
      'none',
    ] as const, `${label} request mode`),
    retentionEffect: oneOf(source.retentionEffect, ['browser_indexeddb', 'deliberate_local_file', 'none', 'operator_controlled_output', 'transient_report'] as const, `${label} retention effect`),
    bindingState: oneOf(source.bindingState, ['declared_unenforced'] as const, `${label} binding state`),
    policyState: oneOf(source.policyState, ['current', 'target'] as const, `${label} policy state`),
  });
}

function copyConsumerRelationship(
  value: unknown,
  index: number,
  budget: MetadataCopyBudget,
): SchemaLifecycleConsumerRelationship {
  const label = `Schema lifecycle consumer relationship ${index + 1}`;
  const source = ordinaryRecord(value, CONSUMER_RELATIONSHIP_KEYS, label, budget);
  return Object.freeze({
    id: boundedId(source.id, `${label} id`),
    sourceConsumerId: boundedId(source.sourceConsumerId, `${label} source consumer`),
    targetConsumerId: boundedId(source.targetConsumerId, `${label} target consumer`),
    relationship: oneOf(source.relationship, ['composes'] as const, `${label} relationship`),
  });
}

function validateFamilyRelations(family: SchemaLifecycleFamily): void {
  const contractPairs = new Map(family.contracts.map((contract) => [`${contract.schema}\u0000${contract.version}`, contract]));
  if (contractPairs.size !== family.contracts.length) {
    throw new TypeError('Schema lifecycle contracts must use unique schema and version pairs.');
  }
  const compatibilityById = new Map(family.compatibility.map((descriptor) => [descriptor.id, descriptor]));
  if (compatibilityById.size !== family.compatibility.length) {
    throw new TypeError('Schema lifecycle compatibility descriptor ids must be unique.');
  }
  const compatibilityOwners = new Map<string, Readonly<{ schema: string; role: SchemaLifecycleRole }>>();
  for (const schema of new Set(family.contracts.map((contract) => contract.schema))) {
    const contracts = family.contracts.filter((contract) => contract.schema === schema);
    const current = contracts.filter((contract) => contract.lifecycle === 'current');
    const maximumVersion = Math.max(...contracts.map((contract) => contract.version));
    if (current.length !== 1 || current[0]?.version !== maximumVersion) {
      throw new TypeError(`Schema lifecycle ${schema} must have one current greatest version.`);
    }
    if (new Set(contracts.map((contract) => contract.compatibilityId)).size !== 1
      || new Set(contracts.map((contract) => contract.role)).size !== 1) {
      throw new TypeError(`Schema lifecycle ${schema} must use one compatibility id and role.`);
    }
  }
  for (const contract of family.contracts) {
    if (contract.futureVersionBehaviour === 'not_applicable'
      && (contract.role !== 'document'
        || (contract.lifecycle !== 'retired'
          && (contract.lifecycle !== 'current' || contract.readable || !contract.emitted)))) {
      throw new TypeError('Not-applicable future-version handling is limited to current emitted-only documents or retired documents.');
    }
    if (contract.lifecycle === 'legacy' && (!contract.readable || contract.emitted)) {
      throw new TypeError('Legacy schema lifecycle contracts must remain readable and must not be emitted.');
    }
    if (contract.lifecycle === 'retired'
      && (contract.role !== 'document'
        || contract.readable
        || contract.emitted
        || !contract.exactKeys
        || contract.extensionPolicy !== 'reject'
        || contract.futureVersionBehaviour !== 'not_applicable'
        || contract.migrationTarget !== null
        || contract.fixtureIds.length === 0)) {
      throw new TypeError('Retired schema lifecycle contracts must be fixture-backed output-only history.');
    }
    if (contract.lifecycle === 'current' && !contract.readable && !contract.emitted) {
      throw new TypeError('Current schema lifecycle contracts must be readable or emitted.');
    }
    const compatibilityOwner = compatibilityOwners.get(contract.compatibilityId);
    if (compatibilityOwner
      && (compatibilityOwner.schema !== contract.schema || compatibilityOwner.role !== contract.role)) {
      throw new TypeError('Schema lifecycle compatibility ids must identify one schema and role.');
    }
    compatibilityOwners.set(contract.compatibilityId, { schema: contract.schema, role: contract.role });
    if (contract.migrationTarget) {
      const target = contractPairs.get(`${contract.migrationTarget.schema}\u0000${contract.migrationTarget.version}`);
      const inputProjection = contract.role === 'input'
        && contract.lifecycle === 'current'
        && target?.role === 'document'
        && target.lifecycle === 'current'
        && target.emitted
        && target.schema !== contract.schema;
      const versionMigration = target?.schema === contract.schema && target.version > contract.version;
      if (!target || (!inputProjection && !versionMigration)) {
        throw new TypeError('Schema lifecycle migration targets must name a greater version of the same schema or a current emitted document projected from a current input contract.');
      }
    }
  }

  for (const descriptor of family.compatibility) {
    const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
    const versions = contracts.map((contract) => contract.version);
    const current = contracts.find((contract) => contract.lifecycle === 'current');
    const logicalSchema = contracts[0]?.schema ?? null;
    if (!contracts.length
      || descriptor.owner !== family.owner
      || contracts.some((contract) => (descriptor.schema !== null && contract.schema !== descriptor.schema)
        || (contract.lifecycle === 'retired'
          ? contract.futureVersionBehaviour !== 'not_applicable'
          : contract.futureVersionBehaviour !== descriptor.futureVersionBehavior)
        || contract.byteBudget !== descriptor.byteBudget)
      || versions.length !== descriptor.supportedVersions.length
      || versions.some((version, index) => version !== descriptor.supportedVersions[index])
      || current?.version !== descriptor.currentVersion) {
      throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} does not match its contracts.`);
    }
    if (descriptor.migration === 'normalize_to_current') {
      const currentInputProjection = contracts.length === 1
        && current?.role === 'input'
        && current.migrationTarget !== null
        && contractPairs.get(`${current.migrationTarget.schema}\u0000${current.migrationTarget.version}`)?.role === 'document';
      if ((!currentInputProjection
          && !contracts.some((contract) => contract.lifecycle === 'legacy')
          && !descriptor.acceptsUnversionedLegacy)
        || contracts.some((contract) => contract.lifecycle === 'retired')) {
        throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} must name a registered legacy version or an accepted unversioned legacy root before it can normalise to current.`);
      }
      if (!currentInputProjection && contracts.some((contract) => contract.lifecycle === 'current'
        ? contract.migrationTarget !== null
        : contract.migrationTarget?.schema !== logicalSchema
          || contract.migrationTarget.version !== descriptor.currentVersion)) {
        throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} requires every legacy version to normalise to its current version.`);
      }
    } else if (descriptor.migration === 'exact_current_only'
      && (contracts.length !== 1 || contracts[0]?.lifecycle !== 'current' || descriptor.acceptsUnversionedLegacy)) {
      throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} must contain only its exact current version.`);
    } else if (contracts.some((contract) => contract.migrationTarget !== null)) {
      throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} does not permit migration targets.`);
    }
  }
  if (compatibilityOwners.size !== family.compatibility.length
    || [...compatibilityOwners.keys()].some((id) => !compatibilityById.has(id))) {
    throw new TypeError('Every schema lifecycle compatibility descriptor must be used exactly once per schema family.');
  }

  const fixtureById = new Map(family.fixtures.map((fixture) => [fixture.id, fixture]));
  if (fixtureById.size !== family.fixtures.length) throw new TypeError('Schema lifecycle fixture ids must be unique.');
  const referenced = new Set<string>();
  for (const contract of family.contracts) {
    for (const fixtureId of contract.fixtureIds) {
      const fixture = fixtureById.get(fixtureId);
      if (!fixture || fixture.schema !== contract.schema || fixture.version !== contract.version) {
        throw new TypeError('Schema lifecycle fixture references must match their registered contract.');
      }
      if (contract.byteBudget !== null && fixture.bytes > contract.byteBudget) {
        throw new TypeError('Schema lifecycle fixtures must fit within their contract byte budget.');
      }
      if (referenced.has(fixtureId)) throw new TypeError('Schema lifecycle fixtures must belong to exactly one contract.');
      referenced.add(fixtureId);
      const expectedRole = contract.role === 'input'
        ? 'input'
        : contract.lifecycle === 'legacy' || contract.lifecycle === 'retired' ? 'historical' : 'current';
      if (fixture.role !== expectedRole) throw new TypeError('Schema lifecycle fixture roles must match their contract.');
    }
  }
  if (referenced.size !== family.fixtures.length) throw new TypeError('Every schema lifecycle fixture must be referenced.');
  for (const fixture of family.fixtures) {
    if (fixture.expectation === 'normalises_to_current_output') {
      const output = fixture.expectedOutputFixtureId ? fixtureById.get(fixture.expectedOutputFixtureId) : null;
      const outputContract = output
        ? contractPairs.get(`${output.schema}\u0000${output.version}`)
        : null;
      const validInputProjection = fixture.role === 'input' && output?.schema !== fixture.schema;
      const validHistoricalMigration = fixture.role === 'historical'
        && output?.schema === fixture.schema
        && output.version > fixture.version;
      if ((!validInputProjection && !validHistoricalMigration)
        || !output
        || output.role !== 'current'
        || !outputContract
        || outputContract.lifecycle !== 'current'
        || outputContract.role !== 'document'
        || !outputContract.emitted) {
        throw new TypeError('Normalising fixture expectations must target a current document fixture.');
      }
    } else if (fixture.expectedOutputFixtureId !== null) {
      throw new TypeError('Exact fixture expectations must not name an output fixture.');
    }
    const contract = contractPairs.get(`${fixture.schema}\u0000${fixture.version}`);
    if ((fixture.expectation === 'historical_output_exact') !== (contract?.lifecycle === 'retired')) {
      throw new TypeError('Historical output fixtures must belong exactly to retired contracts.');
    }
  }
  for (const descriptor of family.compatibility) {
    if (descriptor.migration !== 'normalize_to_current') continue;
    const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
    const current = contracts.find((contract) => contract.lifecycle === 'current');
    const migrationContracts = contracts.filter((candidate) => candidate.lifecycle === 'legacy'
      || (candidate.lifecycle === 'current' && candidate.role === 'input' && candidate.migrationTarget !== null));
    for (const contract of migrationContracts) {
      const expectedTarget = contract.migrationTarget
        ? contractPairs.get(`${contract.migrationTarget.schema}\u0000${contract.migrationTarget.version}`)
        : current;
      const hasMigrationFixture = contract.fixtureIds.some((fixtureId) => {
        const fixture = fixtureById.get(fixtureId);
        const output = fixture?.expectedOutputFixtureId
          ? fixtureById.get(fixture.expectedOutputFixtureId)
          : null;
        return fixture?.expectation === 'normalises_to_current_output'
          && output?.schema === expectedTarget?.schema
          && output?.version === expectedTarget?.version;
      });
      if (!hasMigrationFixture) {
        throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} must prove every declared normalisation with a fixture.`);
      }
    }
  }

}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function metadataConsumerRelationships(
  metadata: SchemaLifecycleMetadata,
): readonly SchemaLifecycleConsumerRelationship[] {
  return metadata.metadataVersion === 1 ? [] : metadata.consumerRelationships;
}

function validateMetadataSerialisedBudget(metadata: SchemaLifecycleMetadata): void {
  const serialised = JSON.stringify(metadata);
  if (utf8Length(serialised) > MAX_METADATA_SERIALISED_BYTES) {
    throw new TypeError('Schema lifecycle metadata exceeds its serialised byte budget.');
  }
}

function validateMetadataRelations(
  family: SchemaLifecycleFamily,
  metadata: SchemaLifecycleMetadata,
): void {
  if (metadata.metadataVersion < 3 && (
    metadata.serialisationProfiles.some((profile) => profile.propertyOrder === 'source_insertion')
    || metadata.privacyProfiles.some((profile) => profile.network === 'explicit_bounded_passive_fast_or_deep')
    || metadata.consumerEdges.some((edge) => edge.requestMode === 'explicit_bounded_passive_fast_or_deep')
  )) {
    throw new TypeError('Schema lifecycle metadata version 3 is required for extensible serialisation and Fast-or-Deep request policy.');
  }
  const contractPairs = new Map(family.contracts.map((contract) => [`${contract.schema}\u0000${contract.version}`, contract]));
  const shapesById = new Map(metadata.shapes.map((shape) => [shape.id, shape]));
  const boundProfilesById = new Map(metadata.boundProfiles.map((profile) => [profile.id, profile]));
  const hooksById = new Map(metadata.hooks.map((hook) => [hook.id, hook]));
  const serialisationProfilesById = new Map(metadata.serialisationProfiles.map((profile) => [profile.id, profile]));
  const privacyProfilesById = new Map(metadata.privacyProfiles.map((profile) => [profile.id, profile]));
  const expiryProfilesById = new Map(metadata.expiryProfiles.map((profile) => [profile.id, profile]));
  const consumerEdgesById = new Map(metadata.consumerEdges.map((edge) => [edge.id, edge]));
  const consumerRelationships = metadataConsumerRelationships(metadata);
  const consumerRelationshipsById = new Map(
    consumerRelationships.map((relationship) => [relationship.id, relationship]),
  );
  const registries: ReadonlyArray<readonly [ReadonlyMap<string, unknown>, number, string]> = [
    [shapesById, metadata.shapes.length, 'shape'],
    [boundProfilesById, metadata.boundProfiles.length, 'bound profile'],
    [hooksById, metadata.hooks.length, 'hook'],
    [serialisationProfilesById, metadata.serialisationProfiles.length, 'serialisation profile'],
    [privacyProfilesById, metadata.privacyProfiles.length, 'privacy profile'],
    [expiryProfilesById, metadata.expiryProfiles.length, 'expiry profile'],
    [consumerEdgesById, metadata.consumerEdges.length, 'consumer edge'],
    [consumerRelationshipsById, consumerRelationships.length, 'consumer relationship'],
  ];
  for (const [registry, size, label] of registries) {
    if (registry.size !== size) throw new TypeError(`Schema lifecycle ${label} ids must be unique.`);
  }
  const allMetadataIds = registries.flatMap(([registry]) => [...registry.keys()]);
  if (new Set(allMetadataIds).size !== allMetadataIds.length) {
    throw new TypeError('Schema lifecycle metadata ids must be globally unique.');
  }

  const shapeIdsByContract = new Map<string, Set<string>>();
  const shapeByVariant = new Map<string, SchemaLifecycleShape>();
  for (const shape of metadata.shapes) {
    const contracts = shape.versions.map((version) => contractPairs.get(`${shape.schema}\u0000${version}`));
    const paths = [...shape.objects.map((item) => item.path), ...shape.fixedArrays.map((item) => item.path)];
    const objectsByPath = new Map(shape.objects.map((item) => [item.path, item]));
    if (contracts.some((contract) => !contract)
      || contracts.some((contract) => shape.normalisation === 'input_to_current'
        ? contract?.role !== 'input'
        : contract?.role !== 'document')
      || shape.objects.filter((object) => object.path === '$').length !== 1
      || new Set(paths).size !== paths.length
      || paths.some((path) => {
        if (path === '$') return false;
        const parent = objectsByPath.get(parentMetadataPath(path) ?? '');
        const field = metadataPathField(path);
        const allowedFields = parent
          ? [
            ...parent.requiredKeys,
            ...parent.optionalKeys,
            ...(parent.alternativeRequiredKeys ?? []).flatMap((group) => group.keys),
          ]
          : [];
        return !parent || !field || !allowedFields.includes(field);
      })) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} does not exactly cover its contracts and paths.`);
    }
    const preservesExtensions = shape.objects.some((object) => object.unknownKeys === 'preserve_bounded');
    const discardsExtensions = shape.objects.some((object) => object.unknownKeys === 'discard_bounded');
    if (metadata.metadataVersion < 3 && preservesExtensions) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} requires metadata version 3 for bounded extensions.`);
    }
    if (metadata.metadataVersion !== 4 && discardsExtensions) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} requires metadata version 4 for bounded projection.`);
    }
    if (preservesExtensions && discardsExtensions) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} must use one bounded extension policy.`);
    }
    const expectedExtensionPolicy = preservesExtensions
      ? 'preserve_bounded'
      : discardsExtensions ? 'discard_bounded' : 'reject';
    if ((shape.normalisation === 'preserve_bounded_document') !== preservesExtensions
      || (shape.normalisation === 'project_known_fields') !== discardsExtensions
      || contracts.some((contract) => contract?.exactKeys !== (expectedExtensionPolicy === 'reject')
        || contract?.extensionPolicy !== expectedExtensionPolicy)) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} has inconsistent bounded-extension metadata.`);
    }
    if ((shape.normalisation === 'preserve_signed_document'
      && contracts.some((contract) => contract?.canonicalisation === null))
      || (shape.normalisation === 'preserve_document'
        && contracts.some((contract) => contract?.canonicalisation !== null))
      || (shape.normalisation === 'preserve_bounded_document'
        && contracts.some((contract) => contract?.canonicalisation !== null))
      || (shape.normalisation === 'project_known_fields'
        && contracts.some((contract) => contract?.canonicalisation !== null))) {
      throw new TypeError(`Schema lifecycle shape ${shape.id} has inconsistent document integrity metadata.`);
    }
    const discriminator = metadata.metadataVersion === 4 ? shape.discriminator ?? null : null;
    if (discriminator) {
      if (shape.versions.length !== 1) {
        throw new TypeError(`Schema lifecycle shape ${shape.id} must qualify exactly one contract version.`);
      }
      if (!metadataPathIsTransitivelyRequired(discriminator.path, objectsByPath)) {
        throw new TypeError(`Schema lifecycle shape ${shape.id} has an unresolved required discriminator.`);
      }
    }
    for (const version of shape.versions) {
      const key = `${shape.schema}\u0000${version}`;
      const existingShapeIds = shapeIdsByContract.get(key) ?? new Set<string>();
      const existingShapes = [...existingShapeIds].map((id) => shapesById.get(id)!);
      if ((discriminator === null && existingShapeIds.size > 0)
        || (discriminator !== null && existingShapes.some((existing) => existing.discriminator === null))
        || (discriminator !== null && existingShapes.some((existing) => (
          existing.discriminator?.path !== discriminator.path
        )))) {
        throw new TypeError('A schema lifecycle contract must use one unqualified shape or disjoint qualified shapes.');
      }
      if (discriminator) {
        const variantKey = `${key}\u0000${discriminator.path}\u0000${discriminator.value}`;
        if (shapeByVariant.has(variantKey)) {
          throw new TypeError('Schema lifecycle shape discriminators must be unique.');
        }
        shapeByVariant.set(variantKey, shape);
      }
      existingShapeIds.add(shape.id);
      shapeIdsByContract.set(key, existingShapeIds);
    }
    if (shape.target) {
      const target = contractPairs.get(`${shape.target.schema}\u0000${shape.target.version}`);
      if (!target || target.lifecycle !== 'current' || target.role !== 'document' || !target.emitted) {
        throw new TypeError(`Schema lifecycle shape ${shape.id} must target an emitted current document.`);
      }
    }
  }
  if (shapeIdsByContract.size !== family.contracts.length) {
    throw new TypeError('Every schema lifecycle contract must have at least one shape.');
  }
  const fixtureShapeIds = new Set<string>();
  if (metadata.metadataVersion === 4) {
    for (const fixture of family.fixtures) {
      const shape = fixture.shapeId ? shapesById.get(fixture.shapeId) : null;
      if (!shape
        || shape.schema !== fixture.schema
        || !shape.versions.includes(fixture.version)) {
        throw new TypeError(`Schema lifecycle fixture ${fixture.id} must name a matching contract shape.`);
      }
      fixtureShapeIds.add(shape.id);
    }
    for (const shape of metadata.shapes) {
      const contracts = shape.versions.map((version) => contractPairs.get(`${shape.schema}\u0000${version}`));
      if ((shape.discriminator !== null || contracts.some((contract) => contract?.lifecycle === 'retired'))
        && !fixtureShapeIds.has(shape.id)) {
        throw new TypeError(`Schema lifecycle shape ${shape.id} must have an exact repository fixture.`);
      }
    }
  }

  for (const profile of metadata.boundProfiles) {
    const tuples = profile.bounds.map((bound) => `${bound.path}\u0000${bound.phase}\u0000${bound.unit}`);
    if (new Set(tuples).size !== tuples.length) {
      throw new TypeError(`Schema lifecycle bound profile ${profile.id} must use unique path, phase, and unit tuples.`);
    }
  }
  for (const contract of family.contracts.filter((candidate) => candidate.byteBudget !== null)) {
    const matching = metadata.boundProfiles.flatMap((profile) => profile.bounds).filter((bound) => bound.path === '$'
      && bound.phase === 'serialised'
      && bound.unit === 'bytes'
      && bound.handling === 'reject'
      && bound.maximum === contract.byteBudget);
    if (matching.length !== 1) {
      throw new TypeError('Every schema lifecycle byte budget must have one exact serialised-byte bound.');
    }
  }

  if (new Set(metadata.hooks.map((hook) => `${hook.module}\u0000${hook.exportName}`)).size !== metadata.hooks.length) {
    throw new TypeError('Schema lifecycle hooks must use unique module and export pairs.');
  }
  for (const profile of metadata.privacyProfiles) {
    if (profile.includedCategories.some((category) => profile.excludedCategories.includes(category))
      || (profile.classification === 'metadata_only') !== (profile.projection === 'metadata_only')
      || (profile.classification === 'analyst_authored_sensitive'
        && (profile.retention === 'deliberate_local_file' || profile.retention === 'operator_controlled_output')
        && profile.sharingReview !== 'required')) {
      throw new TypeError(`Schema lifecycle privacy profile ${profile.id} has inconsistent categories or classification.`);
    }
  }

  const referencedHookIds = new Set<string>();
  const referencedBoundProfileIds = new Set<string>();
  const referencedSerialisationProfileIds = new Set<string>();
  const referencedPrivacyProfileIds = new Set<string>();
  const referencedExpiryProfileIds = new Set<string>();
  const serialisationProfileByContract = new Map<string, string>();
  for (const profile of metadata.serialisationProfiles) {
    const contracts = profile.versions.map((version) => contractPairs.get(`${profile.schema}\u0000${version}`));
    const serializer = hooksById.get(profile.serializerHookId);
    const verifiers = profile.verifierHookIds.map((id) => hooksById.get(id));
    if (contracts.some((contract) => !contract || contract.role !== 'document')
      || !contracts.some((contract) => contract?.lifecycle === 'current' && contract.emitted)
      || serializer?.role !== 'serialiser'
      || verifiers.some((hook) => hook?.role !== 'integrity_verifier')) {
      throw new TypeError(`Schema lifecycle serialisation profile ${profile.id} has invalid contract or hook references.`);
    }
    const signedContracts = contracts.every((contract) => contract?.canonicalisation !== null);
    const unsignedContracts = contracts.every((contract) => contract?.canonicalisation === null);
    const boundedExtensionContracts = contracts.every((contract) => contract?.extensionPolicy === 'preserve_bounded');
    if ((!signedContracts && !unsignedContracts)
      || (profile.integrity === 'structural_only_requires_separate_verification') !== signedContracts
      || (profile.propertyOrder === 'source_insertion') !== boundedExtensionContracts) {
      throw new TypeError(`Schema lifecycle serialisation profile ${profile.id} has inconsistent document integrity metadata.`);
    }
    for (const version of profile.versions) {
      const key = `${profile.schema}\u0000${version}`;
      if (serialisationProfileByContract.has(key)) {
        throw new TypeError('Every schema lifecycle document contract must have at most one serialisation profile.');
      }
      serialisationProfileByContract.set(key, profile.id);
    }
    referencedHookIds.add(profile.serializerHookId);
    for (const id of profile.verifierHookIds) referencedHookIds.add(id);
  }

  const relationshipTuples = new Set<string>();
  for (const relationship of consumerRelationships) {
    const tuple = `${relationship.sourceConsumerId}\u0000${relationship.targetConsumerId}\u0000${relationship.relationship}`;
    if (!consumerEdgesById.has(relationship.sourceConsumerId)
      || relationship.sourceConsumerId === relationship.targetConsumerId
      || consumerEdgesById.has(relationship.targetConsumerId)
      || relationshipTuples.has(tuple)) {
      throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} has invalid local endpoints.`);
    }
    relationshipTuples.add(tuple);
  }

  const acceptedShapeIds = new Set<string>();
  const emittedShapeIds = new Set<string>();
  const coveredContractPairs = new Set<string>();
  for (const edge of metadata.consumerEdges) {
    if (edge.acceptedContracts.length === 0 && edge.emittedContract === null) {
      throw new TypeError(`Schema lifecycle consumer ${edge.id} must accept or emit a contract.`);
    }
    const shapeIds = new Set<string>();
    const acceptedSelections = new Set<string>();
    const acceptedContractShapes = new Set<string>();
    const projectedContractBudgets = new Set<number>();
    let projectedContractWithoutByteBudget = false;
    const relevantContractPairs = new Set<string>();
    for (const reference of edge.acceptedContracts) {
      for (const version of reference.versions) {
        const key = `${reference.schema}\u0000${version}`;
        const contract = contractPairs.get(key);
        const contractShapeIds = shapeIdsByContract.get(key) ?? new Set<string>();
        const contractShapes = [...contractShapeIds].map((id) => shapesById.get(id)!);
        const qualified = contractShapes.some((shape) => shape.discriminator !== null && shape.discriminator !== undefined);
        const selectedShapes = qualified
          ? contractShapes.filter((shape) => reference.discriminator
            && shape.discriminator?.path === reference.discriminator.path
            && reference.discriminator.values.includes(shape.discriminator.value))
          : contractShapes;
        const selectionKey = `${key}\u0000${reference.discriminator?.path ?? ''}\u0000${reference.discriminator?.values.join('\u0001') ?? ''}`;
        if (!contract
          || !contract.readable
          || acceptedSelections.has(selectionKey)
          || selectedShapes.some((shape) => acceptedContractShapes.has(`${key}\u0000${shape.id}`))
          || (metadata.metadataVersion === 4
            && ((qualified && (!reference.discriminator
              || selectedShapes.length !== reference.discriminator.values.length))
              || (!qualified && reference.discriminator !== null && reference.discriminator !== undefined)))) {
          throw new TypeError(`Schema lifecycle consumer ${edge.id} references an unreadable or duplicate contract.`);
        }
        if (metadata.metadataVersion < 4 && reference.discriminator) {
          const parentPath = parentMetadataPath(reference.discriminator.path);
          const field = metadataPathField(reference.discriminator.path);
          if (contractShapes.some((shape) => {
            const parent = shape.objects.find((object) => object.path === parentPath);
            return !parent || !field || ![
              ...parent.requiredKeys,
              ...parent.optionalKeys,
            ].includes(field);
          })) {
            throw new TypeError(`Schema lifecycle consumer ${edge.id} has an unresolved contract discriminator.`);
          }
        }
        acceptedSelections.add(selectionKey);
        relevantContractPairs.add(key);
        coveredContractPairs.add(key);
        if (selectedShapes.some((shape) => shape.normalisation === 'project_known_fields')) {
          if (contract.byteBudget === null) projectedContractWithoutByteBudget = true;
          else projectedContractBudgets.add(contract.byteBudget);
        }
        for (const shape of selectedShapes) {
          shapeIds.add(shape.id);
          acceptedContractShapes.add(`${key}\u0000${shape.id}`);
          acceptedShapeIds.add(shape.id);
        }
      }
    }
    if (edge.emittedContract) {
      const key = `${edge.emittedContract.schema}\u0000${edge.emittedContract.version}`;
      const emitted = contractPairs.get(key);
      const contractShapeIds = shapeIdsByContract.get(key) ?? new Set<string>();
      const contractShapes = [...contractShapeIds].map((id) => shapesById.get(id)!);
      const qualified = contractShapes.some((shape) => shape.discriminator !== null && shape.discriminator !== undefined);
      const selectedShapes = qualified
        ? contractShapes.filter((shape) => edge.emittedContract?.discriminator
          && shape.discriminator?.path === edge.emittedContract.discriminator.path
          && shape.discriminator.value === edge.emittedContract.discriminator.value)
        : contractShapes;
      if (!emitted
        || !emitted.emitted
        || (metadata.metadataVersion === 4
          && ((qualified && selectedShapes.length !== 1)
            || (!qualified && edge.emittedContract.discriminator !== null
              && edge.emittedContract.discriminator !== undefined)))) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} must emit a registered writable contract.`);
      }
      relevantContractPairs.add(key);
      coveredContractPairs.add(key);
      for (const shape of selectedShapes) {
        shapeIds.add(shape.id);
        emittedShapeIds.add(shape.id);
      }
    }
    if (shapeIds.size !== edge.shapeIds.length || edge.shapeIds.some((id) => !shapeIds.has(id))) {
      throw new TypeError(`Schema lifecycle consumer ${edge.id} must exactly cover its contract shapes.`);
    }
    for (const id of edge.boundProfileIds) {
      if (!boundProfilesById.has(id)) throw new TypeError(`Schema lifecycle consumer ${edge.id} references an unknown bound profile.`);
      referencedBoundProfileIds.add(id);
    }
    const relevantByteBudgets = new Set([...relevantContractPairs]
      .map((key) => contractPairs.get(key)?.byteBudget)
      .filter((budget): budget is number => budget !== null && budget !== undefined));
    for (const byteBudget of relevantByteBudgets) {
      const matching = edge.boundProfileIds.flatMap((id) => boundProfilesById.get(id)?.bounds ?? [])
        .filter((bound) => bound.path === '$'
          && bound.phase === 'serialised'
          && bound.unit === 'bytes'
          && bound.handling === 'reject'
          && bound.maximum === byteBudget);
      if (matching.length !== 1) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} must reference one exact contract byte budget.`);
      }
    }
    const allowedHookRuntimes = edge.plane === 'browser'
      ? new Set<SchemaLifecycleRuntime>(['browser', 'shared'])
      : edge.plane === 'node'
        ? new Set<SchemaLifecycleRuntime>(['node', 'shared'])
        : edge.plane === 'cli'
          ? new Set<SchemaLifecycleRuntime>(['cli', 'node', 'shared'])
          : new Set<SchemaLifecycleRuntime>(['shared']);
    for (const id of edge.hookIds) {
      const hook = hooksById.get(id);
      if (!hook || !allowedHookRuntimes.has(hook.runtime)) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} references an unknown or incompatible hook.`);
      }
      referencedHookIds.add(id);
    }
    if (projectedContractWithoutByteBudget || projectedContractBudgets.size > 0) {
      const hasNormaliser = edge.hookIds.some((id) => hooksById.get(id)?.role === 'normaliser');
      const rawIntakeBounds = edge.boundProfileIds.flatMap((id) => (
        boundProfilesById.get(id)?.bounds ?? []
      )).filter((bound) => bound.path === '$'
        && bound.phase === 'raw_intake'
        && bound.unit === 'bytes'
        && bound.handling === 'reject');
      if (projectedContractWithoutByteBudget
        || !hasNormaliser
        || rawIntakeBounds.length !== projectedContractBudgets.size
        || [...projectedContractBudgets].some((byteBudget) => (
          rawIntakeBounds.filter((bound) => bound.maximum === byteBudget).length !== 1
        ))) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} must bind bounded projection to raw intake and a normaliser.`);
      }
    }
    if (edge.serialisationProfileId) {
      const profile = serialisationProfilesById.get(edge.serialisationProfileId);
      const relevantContracts = edge.emittedContract
        ? [edge.emittedContract]
        : edge.acceptedContracts.flatMap((reference) => reference.versions.map((version) => ({
          schema: reference.schema,
          version,
        })));
      if (!profile
        || !edge.hookIds.includes(profile.serializerHookId)
        || relevantContracts.some((contract) => contract.schema !== profile.schema
          || !profile.versions.includes(contract.version))) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} references an unknown serialisation profile.`);
      }
      referencedSerialisationProfileIds.add(edge.serialisationProfileId);
    }
    const privacyProfile = privacyProfilesById.get(edge.privacyProfileId);
    if (!privacyProfile
      || privacyProfile.network !== edge.requestMode
      || privacyProfile.retention !== edge.retentionEffect) {
      throw new TypeError(`Schema lifecycle consumer ${edge.id} has inconsistent privacy, request, or retention metadata.`);
    }
    referencedPrivacyProfileIds.add(edge.privacyProfileId);
    const expiryProfile = expiryProfilesById.get(edge.expiryPolicyId);
    if (!expiryProfile) {
      throw new TypeError(`Schema lifecycle consumer ${edge.id} references an unknown expiry profile.`);
    }
    if (expiryProfile.handling !== 'not_applicable') {
      const expiryFieldIsPresent = expiryProfile.field !== null && edge.shapeIds.some((shapeId) => (
        shapesById.get(shapeId)?.objects.some((object) => (
          object.requiredKeys.includes(expiryProfile.field as string)
          || object.optionalKeys.includes(expiryProfile.field as string)
        )) === true
      ));
      if (!expiryFieldIsPresent) {
        throw new TypeError(`Schema lifecycle consumer ${edge.id} must reference an expiry field declared by its contract shapes.`);
      }
    }
    referencedExpiryProfileIds.add(edge.expiryPolicyId);
  }
  for (const contract of family.contracts) {
    const key = `${contract.schema}\u0000${contract.version}`;
    if (metadata.metadataVersion < 4) {
      if ((contract.readable || contract.emitted) && !coveredContractPairs.has(key)) {
        throw new TypeError('Every readable or emitted schema lifecycle contract must have a consumer edge.');
      }
      continue;
    }
    const contractShapeIds = shapeIdsByContract.get(key) ?? new Set<string>();
    if ([...contractShapeIds].some((id) => {
      const shape = shapesById.get(id);
      return shape?.discriminator !== null
        && shape?.discriminator !== undefined
        && !(contractPairs.get(key)?.lifecycle === 'retired' && fixtureShapeIds.has(id))
        && !acceptedShapeIds.has(id)
        && !emittedShapeIds.has(id);
    })) {
      throw new TypeError(`Schema lifecycle contract ${contract.schema} v${contract.version} has an uncovered shape variant.`);
    }
    const hasReader = [...contractShapeIds].some((id) => acceptedShapeIds.has(id));
    const hasWriter = [...contractShapeIds].some((id) => emittedShapeIds.has(id));
    if (contract.readable !== hasReader || contract.emitted !== hasWriter) {
      throw new TypeError(`Schema lifecycle contract ${contract.schema} v${contract.version} must exactly aggregate its readable and emitted shape variants.`);
    }
  }
  if (referencedBoundProfileIds.size !== metadata.boundProfiles.length
    || referencedHookIds.size !== metadata.hooks.length
    || referencedSerialisationProfileIds.size !== metadata.serialisationProfiles.length
    || referencedPrivacyProfileIds.size !== metadata.privacyProfiles.length
    || referencedExpiryProfileIds.size !== metadata.expiryProfiles.length) {
    throw new TypeError('Every schema lifecycle metadata record must be referenced by a consumer edge or serialisation profile.');
  }
  validateMetadataSerialisedBudget(metadata);
}

export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamilyWithMetadataV1): SchemaLifecycleFamilyWithMetadataV1;
export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamilyWithMetadataV2): SchemaLifecycleFamilyWithMetadataV2;
export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamilyWithMetadataV3): SchemaLifecycleFamilyWithMetadataV3;
export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamilyWithMetadataV4): SchemaLifecycleFamilyWithMetadataV4;
export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamilyWithMetadata): SchemaLifecycleFamilyWithMetadata;
export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamily): SchemaLifecycleFamily;
export function defineSchemaLifecycleFamily(
  value: SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata,
): SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata {
  const metadataDescriptor = value && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, 'metadata')
    : undefined;
  const source = ordinaryRecord(
    value,
    metadataDescriptor ? EXTENDED_FAMILY_KEYS : FAMILY_KEYS,
    'Schema lifecycle family',
  );
  const contracts = Object.freeze(denseArray(source.contracts, 'Schema lifecycle contracts', MAX_CONTRACTS)
    .map(copyContract));
  const fixtures = Object.freeze(denseArray(source.fixtures, 'Schema lifecycle fixtures', MAX_FIXTURES)
    .map(copyFixture));
  const compatibility = Object.freeze(denseArray(source.compatibility, 'Schema lifecycle compatibility descriptors', MAX_CONTRACTS)
    .map(copyCompatibility));
  const family = Object.freeze({
    id: boundedId(source.id, 'Schema lifecycle family id'),
    owner: boundedPath(source.owner, 'Schema lifecycle family owner'),
    privacy: oneOf(
      source.privacy,
      ['analyst_authored_sensitive', 'metadata_only'] as const,
      'Schema lifecycle family privacy',
    ),
    compatibility,
    contracts,
    fixtures,
  });
  validateFamilyRelations(family);
  if (!metadataDescriptor) {
    if (contracts.some((contract) => contract.extensionPolicy === 'preserve_bounded')) {
      throw new TypeError('Schema lifecycle metadata version 3 is required for bounded extensions.');
    }
    if (contracts.some((contract) => contract.extensionPolicy === 'discard_bounded'
      || contract.lifecycle === 'retired')
      || fixtures.some((fixture) => Object.hasOwn(fixture, 'shapeId')
        || fixture.expectation === 'historical_output_exact')) {
      throw new TypeError('Schema lifecycle metadata version 4 is required for retired or projected contracts.');
    }
    return family;
  }

  const metadataBudget: MetadataCopyBudget = {
    slots: 0,
    textCodeUnits: 0,
    serialisedBytes: 0,
  };
  const metadataSource = ordinaryRecord(
    source.metadata,
    [METADATA_V1_KEYS, METADATA_V2_KEYS, METADATA_V3_KEYS, METADATA_V4_KEYS],
    'Schema lifecycle metadata',
    metadataBudget,
  );
  const metadataVersion = metadataSource.metadataVersion;
  const hasConsumerRelationships = Object.hasOwn(metadataSource, 'consumerRelationships');
  if ((metadataVersion !== 1 && metadataVersion !== 2 && metadataVersion !== 3 && metadataVersion !== 4)
    || metadataSource.enforcement !== 'declarative_only'
    || (metadataVersion === 1 && hasConsumerRelationships)
    || ((metadataVersion === 2 || metadataVersion === 3 || metadataVersion === 4) && !hasConsumerRelationships)) {
    throw new TypeError('Schema lifecycle metadata must use an exact registered declarative-only version.');
  }
  const usesVersion4Vocabulary = contracts.some((contract) => contract.extensionPolicy === 'discard_bounded'
    || contract.lifecycle === 'retired')
    || fixtures.some((fixture) => Object.hasOwn(fixture, 'shapeId')
      || fixture.expectation === 'historical_output_exact');
  if ((metadataVersion === 4) !== usesVersion4Vocabulary
    || (metadataVersion === 4 && fixtures.some((fixture) => !Object.hasOwn(fixture, 'shapeId')))) {
    throw new TypeError('Schema lifecycle metadata version 4 must exclusively and completely own its retired or projected vocabulary.');
  }
  const metadataCommon = {
    enforcement: 'declarative_only' as const,
    shapes: Object.freeze(denseArray(
      metadataSource.shapes,
      'Schema lifecycle shapes',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyShape(
      item,
      index,
      metadataBudget,
      metadataVersion as 1 | 2 | 3 | 4,
    ))),
    boundProfiles: Object.freeze(denseArray(
      metadataSource.boundProfiles,
      'Schema lifecycle bound profiles',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyBoundProfile(item, index, metadataBudget))),
    hooks: Object.freeze(denseArray(
      metadataSource.hooks,
      'Schema lifecycle hooks',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyHook(item, index, metadataBudget))),
    serialisationProfiles: Object.freeze(denseArray(
      metadataSource.serialisationProfiles,
      'Schema lifecycle serialisation profiles',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copySerialisationProfile(item, index, metadataBudget))),
    privacyProfiles: Object.freeze(denseArray(
      metadataSource.privacyProfiles,
      'Schema lifecycle privacy profiles',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyPrivacyProfile(item, index, metadataBudget))),
    expiryProfiles: Object.freeze(denseArray(
      metadataSource.expiryProfiles,
      'Schema lifecycle expiry profiles',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyExpiryPolicy(item, index, metadataBudget))),
    consumerEdges: Object.freeze(denseArray(
      metadataSource.consumerEdges,
      'Schema lifecycle consumer edges',
      MAX_METADATA_COLLECTION,
      1,
      metadataBudget,
    ).map((item, index) => copyConsumerEdge(
      item,
      index,
      metadataBudget,
      metadataVersion as 1 | 2 | 3 | 4,
    ))),
  };
  const consumerRelationships = metadataVersion === 1
    ? Object.freeze([])
    : Object.freeze(denseArray(
      metadataSource.consumerRelationships,
      'Schema lifecycle consumer relationships',
      MAX_METADATA_COLLECTION,
      0,
      metadataBudget,
    ).map((item, index) => copyConsumerRelationship(item, index, metadataBudget)));
  const metadata: SchemaLifecycleMetadata = metadataVersion === 1
    ? Object.freeze({ metadataVersion: 1 as const, ...metadataCommon })
    : metadataVersion === 2
      ? Object.freeze({ metadataVersion: 2 as const, ...metadataCommon, consumerRelationships })
      : metadataVersion === 3
        ? Object.freeze({ metadataVersion: 3 as const, ...metadataCommon, consumerRelationships })
        : Object.freeze({
          metadataVersion: 4 as const,
          ...metadataCommon,
          shapes: metadataCommon.shapes as readonly SchemaLifecycleShapeV4[],
          consumerEdges: metadataCommon.consumerEdges as readonly SchemaLifecycleConsumerEdgeV4[],
          consumerRelationships,
        });
  validateMetadataRelations(family, metadata);
  return Object.freeze({ ...family, metadata }) as SchemaLifecycleFamilyWithMetadata;
}

function validateRegistryConsumerRelationships(
  families: readonly (SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata)[],
): void {
  type RegisteredConsumer = Readonly<{
    familyId: string;
    edge: SchemaLifecycleConsumerEdge;
    hookTargets: ReadonlySet<string>;
  }>;
  const consumers = new Map<string, RegisteredConsumer>();
  for (const family of families) {
    if (!Object.hasOwn(family, 'metadata')) continue;
    const metadata = (family as SchemaLifecycleFamilyWithMetadata).metadata;
    const hooksById = new Map(metadata.hooks.map((hook) => [hook.id, hook]));
    for (const edge of metadata.consumerEdges) {
      const hookTargets = new Set(edge.hookIds.map((id) => {
        const hook = hooksById.get(id)!;
        return `${hook.module}\u0000${hook.exportName}\u0000${hook.role}\u0000${hook.runtime}`;
      }));
      consumers.set(edge.id, Object.freeze({
        familyId: family.id,
        edge,
        hookTargets,
      }));
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const family of families) {
    if (!Object.hasOwn(family, 'metadata')) continue;
    const metadata = (family as SchemaLifecycleFamilyWithMetadata).metadata;
    for (const relationship of metadataConsumerRelationships(metadata)) {
      const source = consumers.get(relationship.sourceConsumerId);
      const target = consumers.get(relationship.targetConsumerId);
      if (!source || source.familyId !== family.id) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} source consumer is not registered by its family.`);
      }
      if (!target) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} target consumer is not registered.`);
      }
      if (target.familyId === family.id) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} must target another family.`);
      }
      if (source.edge.plane !== target.edge.plane
        || source.edge.requestMode !== target.edge.requestMode
        || source.edge.retentionEffect !== target.edge.retentionEffect
        || source.edge.bindingState !== target.edge.bindingState
        || source.edge.policyState !== target.edge.policyState) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} has incompatible consumer policies.`);
      }
      if (![...source.hookTargets].some((hook) => target.hookTargets.has(hook))) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} must share one exact hook target.`);
      }
      const targets = adjacency.get(relationship.sourceConsumerId) ?? new Set<string>();
      if (targets.has(relationship.targetConsumerId)) {
        throw new TypeError(`Schema lifecycle consumer relationship ${relationship.id} is duplicated.`);
      }
      targets.add(relationship.targetConsumerId);
      adjacency.set(relationship.sourceConsumerId, targets);
      indegree.set(relationship.sourceConsumerId, indegree.get(relationship.sourceConsumerId) ?? 0);
      indegree.set(relationship.targetConsumerId, (indegree.get(relationship.targetConsumerId) ?? 0) + 1);
    }
  }

  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let cursor = 0;
  let visited = 0;
  while (cursor < ready.length) {
    const source = ready[cursor++]!;
    visited += 1;
    for (const target of adjacency.get(source) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }
  if (visited !== indegree.size) {
    throw new TypeError('Schema lifecycle consumer relationships must not form a composition cycle.');
  }
}

export function defineSchemaLifecycleRegistry(value: SchemaLifecycleRegistry): SchemaLifecycleRegistry {
  const sources = denseArray(
    value,
    'Schema lifecycle registry families',
    MAX_SCHEMA_LIFECYCLE_FAMILIES,
  );
  const familyIds = new Set<string>();
  const compatibilityIds = new Set<string>();
  const schemaOwners = new Map<string, string>();
  const fixtureIds = new Set<string>();
  const fixturePaths = new Set<string>();
  const metadataIds = new Set<string>();
  const families: Array<SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata> = [];
  let serialisedBytes = 2 + Math.max(0, sources.length - 1);
  for (const source of sources) {
    const family = defineSchemaLifecycleFamily(
      source as SchemaLifecycleFamily | SchemaLifecycleFamilyWithMetadata,
    );
    const serialised = JSON.stringify(family);
    serialisedBytes += utf8Length(serialised);
    if (serialisedBytes > MAX_SCHEMA_LIFECYCLE_REGISTRY_BYTES) {
      throw new TypeError('Schema lifecycle registry exceeds its aggregate serialised byte budget.');
    }
    if (familyIds.has(family.id)) {
      throw new TypeError(`Schema lifecycle registry family id is duplicated: ${family.id}.`);
    }
    familyIds.add(family.id);
    for (const compatibility of family.compatibility) {
      if (compatibilityIds.has(compatibility.id)) {
        throw new TypeError(`Schema lifecycle registry compatibility id is duplicated: ${compatibility.id}.`);
      }
      compatibilityIds.add(compatibility.id);
    }
    for (const contract of family.contracts) {
      const owner = schemaOwners.get(contract.schema);
      if (owner && owner !== family.id) {
        throw new TypeError(`Schema lifecycle registry schema has multiple family owners: ${contract.schema}.`);
      }
      schemaOwners.set(contract.schema, family.id);
    }
    for (const fixture of family.fixtures) {
      if (fixtureIds.has(fixture.id) || fixturePaths.has(fixture.path)) {
        throw new TypeError(`Schema lifecycle registry fixture id or path is duplicated: ${fixture.id}.`);
      }
      fixtureIds.add(fixture.id);
      fixturePaths.add(fixture.path);
    }
    if (Object.hasOwn(family, 'metadata')) {
      const metadata = (family as SchemaLifecycleFamilyWithMetadata).metadata;
      const familyMetadataIds = [
        ...metadata.shapes.map((item) => item.id),
        ...metadata.boundProfiles.map((item) => item.id),
        ...metadata.hooks.map((item) => item.id),
        ...metadata.serialisationProfiles.map((item) => item.id),
        ...metadata.privacyProfiles.map((item) => item.id),
        ...metadata.expiryProfiles.map((item) => item.id),
        ...metadata.consumerEdges.map((item) => item.id),
        ...metadataConsumerRelationships(metadata).map((item) => item.id),
      ];
      for (const id of familyMetadataIds) {
        if (metadataIds.has(id)) {
          throw new TypeError(`Schema lifecycle registry metadata id is duplicated: ${id}.`);
        }
        metadataIds.add(id);
      }
    }
    families.push(family);
  }
  validateRegistryConsumerRelationships(families);
  return Object.freeze(families);
}

export type {
  SchemaLifecycleContract,
  SchemaLifecycleContractReference,
  SchemaLifecycleContractReferenceV4,
  SchemaLifecycleAlternativeRequiredKeys,
  SchemaLifecycleConsumerDiscriminator,
  SchemaLifecycleConsumerEdge,
  SchemaLifecycleConsumerEdgeV4,
  SchemaLifecycleEmittedTarget,
  SchemaLifecycleEmittedTargetV4,
  SchemaLifecycleConsumerRelationship,
  SchemaLifecycleBound,
  SchemaLifecycleBoundPhase,
  SchemaLifecycleBoundProfile,
  SchemaLifecycleBoundUnit,
  SchemaLifecycleExpiryPolicy,
  SchemaLifecycleFamily,
  SchemaLifecycleFamilyWithMetadata,
  SchemaLifecycleRegistry,
  SchemaLifecycleFixture,
  SchemaLifecycleFixtureV4,
  SchemaLifecycleFixtureExpectation,
  SchemaLifecycleFixtureRole,
  SchemaLifecyclePrivacy,
  SchemaLifecyclePrivacyProfile,
  SchemaLifecyclePrivacyProjection,
  SchemaLifecycleNotePolicy,
  SchemaLifecycleNetwork,
  SchemaLifecycleMetadata,
  SchemaLifecycleMetadataV1,
  SchemaLifecycleMetadataV2,
  SchemaLifecycleMetadataV3,
  SchemaLifecycleMetadataV4,
  SchemaLifecycleRetention,
  SchemaLifecycleRole,
  SchemaLifecycleRuntime,
  SchemaLifecycleHook,
  SchemaLifecycleHookRole,
  SchemaLifecycleObjectShape,
  SchemaLifecycleObjectShapeV4,
  SchemaLifecycleFixedArrayShape,
  SchemaLifecycleShape,
  SchemaLifecycleShapeV4,
  SchemaLifecycleVariantDiscriminator,
  SchemaLifecycleSerialisationProfile,
  SchemaLifecycleState,
  SchemaLifecycleTarget,
};
