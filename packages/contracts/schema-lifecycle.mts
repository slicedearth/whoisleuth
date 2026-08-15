import {
  defineSchemaCompatibility,
  isCanonicalLocalSchemaIdentifier,
  type SchemaCompatibilityDescriptor,
} from './schema-compatibility.mts';

type SchemaLifecycleRole = 'input' | 'document';
type SchemaLifecycleState = 'current' | 'legacy';
type SchemaLifecyclePrivacy = 'analyst_authored_sensitive';
type SchemaLifecycleFixtureRole = 'input' | 'historical' | 'current';
type SchemaLifecycleFixtureExpectation = 'accepted_exact' | 'normalises_to_current_output';

type SchemaLifecycleTarget = Readonly<{
  schema: string;
  version: number;
}>;

type SchemaLifecycleContract = Readonly<{
  compatibilityId: string;
  schema: string;
  version: number;
  role: SchemaLifecycleRole;
  lifecycle: SchemaLifecycleState;
  readable: boolean;
  emitted: boolean;
  exactKeys: true;
  extensionPolicy: 'reject';
  futureVersionBehaviour: 'reject';
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
}>;

type SchemaLifecycleFamily = Readonly<{
  id: string;
  owner: string;
  privacy: SchemaLifecyclePrivacy;
  compatibility: readonly SchemaCompatibilityDescriptor[];
  contracts: readonly SchemaLifecycleContract[];
  fixtures: readonly SchemaLifecycleFixture[];
}>;

const FAMILY_KEYS = new Set(['id', 'owner', 'privacy', 'compatibility', 'contracts', 'fixtures']);
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
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,79}$/u;
const OWNER_PATTERN = /^[a-z0-9_./-]+$/iu;
const CANONICALISATION_PATTERN = /^[-a-z0-9.]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_CONTRACTS = 32;
const MAX_FIXTURES = 128;

function ordinaryRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size
    || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
    throw new TypeError(`${label} must use its exact registered fields.`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary enumerable data fields.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Object.prototype.hasOwnProperty.call(value, Symbol.iterator)) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > maximum) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== Number(length) + 1
    || ownKeys.at(-1) !== 'length'
    || ownKeys.slice(0, -1).some((key, index) => key !== String(index))) {
    throw new TypeError(`${label} must be a dense ordinary array without extra fields.`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < Number(length); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain ordinary enumerable data entries.`);
    }
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
  if (typeof value !== 'string' || value.length > 120 || !isCanonicalLocalSchemaIdentifier(value)) {
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

function copyTarget(value: unknown, label: string): SchemaLifecycleTarget | null {
  if (value === null) return null;
  const source = ordinaryRecord(value, TARGET_KEYS, label);
  return Object.freeze({
    schema: boundedSchema(source.schema, `${label} schema`),
    version: positiveInteger(source.version, `${label} version`),
  });
}

function copyStringArray(value: unknown, label: string): readonly string[] {
  const source = denseArray(value, label, MAX_FIXTURES);
  const result = source.map((item) => boundedId(item, `${label} id`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates.`);
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
  if (lifecycle !== 'current' && lifecycle !== 'legacy') throw new TypeError(`${label} has an invalid lifecycle state.`);
  if (typeof source.readable !== 'boolean' || typeof source.emitted !== 'boolean') {
    throw new TypeError(`${label} has invalid read or emission metadata.`);
  }
  if (source.exactKeys !== true
    || source.extensionPolicy !== 'reject'
    || source.futureVersionBehaviour !== 'reject') {
    throw new TypeError(`${label} must reject unknown keys, extensions, and future versions.`);
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
    exactKeys: true,
    extensionPolicy: 'reject',
    futureVersionBehaviour: 'reject',
    migrationTarget: copyTarget(source.migrationTarget, `${label} migration target`),
    canonicalisation,
    byteBudget: byteBudget === null ? null : Number(byteBudget),
    fixtureIds: copyStringArray(source.fixtureIds, `${label} fixtures`),
  });
}

function copyFixture(value: unknown, index: number): SchemaLifecycleFixture {
  const label = `Schema lifecycle fixture ${index + 1}`;
  const source = ordinaryRecord(value, FIXTURE_KEYS, label);
  const role = source.role;
  const expectation = source.expectation;
  if (role !== 'input' && role !== 'historical' && role !== 'current') {
    throw new TypeError(`${label} has an invalid role.`);
  }
  if (expectation !== 'accepted_exact' && expectation !== 'normalises_to_current_output') {
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
    if (contract.lifecycle === 'legacy' && (!contract.readable || contract.emitted)) {
      throw new TypeError('Legacy schema lifecycle contracts must remain readable and must not be emitted.');
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
      if (!target || target.schema !== contract.schema || target.version <= contract.version) {
        throw new TypeError('Schema lifecycle migration targets must name a greater registered version of the same schema.');
      }
    }
  }

  for (const descriptor of family.compatibility) {
    const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
    const versions = contracts.map((contract) => contract.version);
    const current = contracts.find((contract) => contract.lifecycle === 'current');
    if (!contracts.length
      || descriptor.schema === null
      || descriptor.owner !== family.owner
      || contracts.some((contract) => contract.schema !== descriptor.schema
        || contract.futureVersionBehaviour !== descriptor.futureVersionBehavior
        || contract.byteBudget !== descriptor.byteBudget)
      || versions.length !== descriptor.supportedVersions.length
      || versions.some((version, index) => version !== descriptor.supportedVersions[index])
      || current?.version !== descriptor.currentVersion) {
      throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} does not match its contracts.`);
    }
    if (descriptor.migration === 'normalize_to_current') {
      if (!contracts.some((contract) => contract.lifecycle === 'legacy')) {
        throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} must name a registered legacy version before it can normalise to current.`);
      }
      if (contracts.some((contract) => contract.lifecycle === 'current'
        ? contract.migrationTarget !== null
        : contract.migrationTarget?.schema !== descriptor.schema
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
        : contract.lifecycle === 'legacy' ? 'historical' : 'current';
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
  }
  for (const descriptor of family.compatibility) {
    if (descriptor.migration !== 'normalize_to_current') continue;
    const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
    const current = contracts.find((contract) => contract.lifecycle === 'current');
    for (const contract of contracts.filter((candidate) => candidate.lifecycle === 'legacy')) {
      const hasMigrationFixture = contract.fixtureIds.some((fixtureId) => {
        const fixture = fixtureById.get(fixtureId);
        const output = fixture?.expectedOutputFixtureId
          ? fixtureById.get(fixture.expectedOutputFixtureId)
          : null;
        return fixture?.expectation === 'normalises_to_current_output'
          && output?.schema === current?.schema
          && output?.version === current?.version;
      });
      if (!hasMigrationFixture) {
        throw new TypeError(`Schema lifecycle compatibility descriptor ${descriptor.id} must prove every legacy migration with a fixture.`);
      }
    }
  }
}

export function defineSchemaLifecycleFamily(value: SchemaLifecycleFamily): SchemaLifecycleFamily {
  const source = ordinaryRecord(value, FAMILY_KEYS, 'Schema lifecycle family');
  const contracts = Object.freeze(denseArray(source.contracts, 'Schema lifecycle contracts', MAX_CONTRACTS)
    .map(copyContract));
  const fixtures = Object.freeze(denseArray(source.fixtures, 'Schema lifecycle fixtures', MAX_FIXTURES)
    .map(copyFixture));
  const compatibility = Object.freeze(denseArray(source.compatibility, 'Schema lifecycle compatibility descriptors', MAX_CONTRACTS)
    .map(copyCompatibility));
  const family = Object.freeze({
    id: boundedId(source.id, 'Schema lifecycle family id'),
    owner: boundedPath(source.owner, 'Schema lifecycle family owner'),
    privacy: source.privacy === 'analyst_authored_sensitive'
      ? source.privacy
      : (() => { throw new TypeError('Schema lifecycle family privacy is invalid.'); })(),
    compatibility,
    contracts,
    fixtures,
  });
  validateFamilyRelations(family);
  return family;
}

export type {
  SchemaLifecycleContract,
  SchemaLifecycleFamily,
  SchemaLifecycleFixture,
  SchemaLifecycleFixtureExpectation,
  SchemaLifecycleFixtureRole,
  SchemaLifecyclePrivacy,
  SchemaLifecycleRole,
  SchemaLifecycleState,
  SchemaLifecycleTarget,
};
