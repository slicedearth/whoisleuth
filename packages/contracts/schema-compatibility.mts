type ContractKind = 'browser_store' | 'tab_store' | 'hosted_store' | 'export' | 'cli_document' | 'derived';
type CompatibilityTier = 'durable_interchange' | 'published_output' | 'internal';
type FutureVersionBehavior = 'reject' | 'preserve_without_write' | 'discard' | 'not_applicable';
type MigrationBehavior = 'normalize_to_current' | 'exact_current_only' | 'read_only' | 'none';
type WriteSemantics = 'normalized_rewrite' | 'ephemeral_replace' | 'optimistic_replace' | 'non_destructive_merge' | 'read_only' | 'none';

type SchemaCompatibilityEntry = {
  id: string;
  tier: CompatibilityTier;
  kind: ContractKind;
  schema: string | null;
  currentVersion: number;
  supportedVersions: number[];
  acceptsUnversionedLegacy: boolean;
  futureVersionBehavior: FutureVersionBehavior;
  migration: MigrationBehavior;
  writeSemantics: WriteSemantics;
  byteBudget: number | null;
  owner: string;
  note: string;
};

type SchemaCompatibilityDescriptor = Readonly<{
  [Key in keyof SchemaCompatibilityEntry]: Key extends 'supportedVersions'
    ? readonly number[]
    : SchemaCompatibilityEntry[Key];
}>;

type SchemaCompatibilityDefinition = Omit<SchemaCompatibilityDescriptor, 'tier'> & {
  tier?: CompatibilityTier;
};

const LOCAL_SCHEMA_IDENTIFIER_SOURCE = String.raw`whoisleuth\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*`;
const LOCAL_SCHEMA_IDENTIFIER_PATTERN = new RegExp(`^${LOCAL_SCHEMA_IDENTIFIER_SOURCE}$`, 'u');
const COMPATIBILITY_SCHEMA_IDENTIFIER_PATTERN = /^[-a-z0-9.]+$/u;

const CONTRACT_KINDS = new Set<ContractKind>(['browser_store', 'tab_store', 'hosted_store', 'export', 'cli_document', 'derived']);
const COMPATIBILITY_TIERS = new Set<CompatibilityTier>(['durable_interchange', 'published_output', 'internal']);
const FUTURE_VERSION_BEHAVIORS = new Set<FutureVersionBehavior>(['reject', 'preserve_without_write', 'discard', 'not_applicable']);
const MIGRATION_BEHAVIORS = new Set<MigrationBehavior>(['normalize_to_current', 'exact_current_only', 'read_only', 'none']);
const WRITE_SEMANTICS = new Set<WriteSemantics>(['normalized_rewrite', 'ephemeral_replace', 'optimistic_replace', 'non_destructive_merge', 'read_only', 'none']);

function validateSchemaCompatibilityDescriptor(value: SchemaCompatibilityDescriptor): void {
  if (!/^[a-z0-9][a-z0-9.-]{2,79}$/u.test(value.id)) {
    throw new Error(`Schema compatibility entry id is invalid: ${value.id}`);
  }
  if (!COMPATIBILITY_TIERS.has(value.tier)
    || !CONTRACT_KINDS.has(value.kind)
    || !FUTURE_VERSION_BEHAVIORS.has(value.futureVersionBehavior)
    || !MIGRATION_BEHAVIORS.has(value.migration)
    || !WRITE_SEMANTICS.has(value.writeSemantics)
    || typeof value.acceptsUnversionedLegacy !== 'boolean') {
    throw new Error(`Schema compatibility entry ${value.id} has invalid compatibility metadata.`);
  }
  if (!Number.isSafeInteger(value.currentVersion) || value.currentVersion <= 0) {
    throw new Error(`Schema compatibility entry ${value.id} has an invalid current version.`);
  }
  const versions = [...value.supportedVersions];
  if (!versions.length
    || versions.some((version) => !Number.isSafeInteger(version) || version <= 0)
    || new Set(versions).size !== versions.length
    || versions.some((version, index) => index > 0 && version <= versions[index - 1]!)
    || versions.at(-1) !== value.currentVersion) {
    throw new Error(`Schema compatibility entry ${value.id} must explicitly end its supported-version list at current version ${value.currentVersion}.`);
  }
  if (value.schema !== null && (value.schema.length > 120
    || !COMPATIBILITY_SCHEMA_IDENTIFIER_PATTERN.test(value.schema)
    || (value.schema.startsWith('whoisleuth.') && !isCanonicalLocalSchemaIdentifier(value.schema)))) {
    throw new Error(`Schema compatibility entry ${value.id} has an invalid schema identifier.`);
  }
  if (value.byteBudget !== null && (!Number.isSafeInteger(value.byteBudget) || value.byteBudget <= 0)) {
    throw new Error(`Schema compatibility entry ${value.id} has an invalid byte budget.`);
  }
  if (value.owner.length > 200 || !/^[a-z0-9_./-]+$/iu.test(value.owner) || value.owner.startsWith('/') || value.owner.includes('..')) {
    throw new Error(`Schema compatibility entry ${value.id} has an invalid owner path.`);
  }
  if (!value.note || value.note.length > 300 || /[\x00-\x1f\x7f]/u.test(value.note)) {
    throw new Error(`Schema compatibility entry ${value.id} has an invalid note.`);
  }
}

function compatibilityTier(value: SchemaCompatibilityDefinition): CompatibilityTier {
  if (value.tier) return value.tier;
  if (value.kind === 'derived' || value.kind === 'tab_store' || value.id.startsWith('maintainer.')) return 'internal';
  if (value.futureVersionBehavior === 'not_applicable') return 'published_output';
  return 'durable_interchange';
}

function defineSchemaCompatibility(value: SchemaCompatibilityDefinition): SchemaCompatibilityDescriptor {
  const descriptor = { ...value, tier: compatibilityTier(value) } as SchemaCompatibilityDescriptor;
  validateSchemaCompatibilityDescriptor(descriptor);
  return Object.freeze({
    ...descriptor,
    supportedVersions: Object.freeze([...descriptor.supportedVersions]),
  });
}

function mutableSchemaCompatibilityEntry(value: SchemaCompatibilityDescriptor): SchemaCompatibilityEntry {
  validateSchemaCompatibilityDescriptor(value);
  return { ...value, supportedVersions: [...value.supportedVersions] };
}

function isCanonicalLocalSchemaIdentifier(value: string): boolean {
  return LOCAL_SCHEMA_IDENTIFIER_PATTERN.test(value);
}

export {
  LOCAL_SCHEMA_IDENTIFIER_SOURCE,
  defineSchemaCompatibility,
  isCanonicalLocalSchemaIdentifier,
  mutableSchemaCompatibilityEntry,
  validateSchemaCompatibilityDescriptor,
};
export type {
  CompatibilityTier,
  ContractKind,
  FutureVersionBehavior,
  MigrationBehavior,
  SchemaCompatibilityDefinition,
  SchemaCompatibilityDescriptor,
  SchemaCompatibilityEntry,
  WriteSemantics,
};
