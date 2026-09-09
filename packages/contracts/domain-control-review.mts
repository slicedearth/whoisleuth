import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import {
  PUBLIC_DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS,
  PUBLIC_DOMAIN_CONTROL_MANIFEST_LIMITATIONS,
  type DomainControlRecordMode,
  DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS,
  DOMAIN_CONTROL_MANIFEST_ROOT_KEYS,
  DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH,
  DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR,
  MAX_CURRENT_DOMAIN_CONTROL_RECORDS,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES,
  MAX_DOMAIN_CONTROL_DOMAIN_LENGTH,
  MAX_DOMAIN_CONTROL_INPUT_RECORDS,
  MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
} from './domain-control-manifest.mts';
import {
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from './domain-control-monitor.mts';
import { MAX_CLI_LOOKUP_BYTES } from './cli-lookup.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS,
  PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS,
  PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS,
} from './domain-control-flight-recorder.mts';

export const DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA = 'whoisleuth.domain-control-review-input';
export const DOMAIN_CONTROL_REVIEW_SCHEMA = 'whoisleuth.domain-control-review';
export const CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA = 'whoisleuth.cli.domain-control-review-input';
export const CLI_DOMAIN_CONTROL_REVIEW_SCHEMA = 'whoisleuth.cli.domain-control-review';
export const PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION = 1;
export const PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION = 1;
export const DOMAIN_CONTROL_REVIEW_VERSION = 2;
export const CLI_DOMAIN_CONTROL_REVIEW_VERSION = 2;
export const SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS = [PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION, DOMAIN_CONTROL_REVIEW_VERSION] as const;
export const SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS = [PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION, CLI_DOMAIN_CONTROL_REVIEW_VERSION] as const;

export const DOMAIN_CONTROL_REVIEW_OBSERVATION_FACTOR = 2;
export const MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES
  * DOMAIN_CONTROL_REVIEW_OBSERVATION_FACTOR;
export const MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH = 120;
export const MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH = 500;
export const MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES = MAX_DOMAIN_CONTROL_MANIFEST_BYTES;
export const MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS = 1;
export const MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS = MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES;
export const MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH = MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH;
export const MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS = MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS;
export const MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES = MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES;

export const DOMAIN_CONTROL_REVIEW_INPUT_KEYS = Object.freeze([
  'schema',
  'version',
  'manifest',
  'observations',
] as const);
export const DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS = Object.freeze([
  'domain',
  'fields',
] as const);
export const DOMAIN_CONTROL_REVIEW_FIELDS = Object.freeze([
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tlsIssuer',
  'tlsSpkiSha256',
  'registrarLock',
] as const);
export const MAX_DOMAIN_CONTROL_REVIEW_FIELDS = DOMAIN_CONTROL_REVIEW_FIELDS.length;
export const MAX_DOMAIN_CONTROL_REVIEW_FIELD_INPUT_VALUES = MAX_DOMAIN_CONTROL_INPUT_RECORDS;
export const MAX_DOMAIN_CONTROL_REVIEW_SOURCE_INPUT_LENGTH = MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH
  * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR;
export const MAX_DOMAIN_CONTROL_REVIEW_TEXT_INPUT_LENGTH = MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH
  * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR;
export const MAX_DOMAIN_CONTROL_REVIEW_DOMAIN_INPUT_LENGTH = MAX_DOMAIN_CONTROL_DOMAIN_LENGTH
  * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR;
export const MAX_DOMAIN_CONTROL_REVIEW_SPKI_INPUT_LENGTH = DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH
  * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR;
export const DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS = Object.freeze([
  'state',
  'values',
  'source',
  'observedAt',
] as const);
export const DOMAIN_CONTROL_REVIEW_ROOT_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'state',
  'manifest',
  'counts',
  'domains',
  'ignoredObservationCount',
  'limitations',
] as const);
export const DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS = Object.freeze([
  'generatedAt',
  'expiresAt',
  'digestSha256',
  'expired',
] as const);
export const PUBLIC_DOMAIN_CONTROL_REVIEW_COUNT_KEYS = Object.freeze([
  'aligned',
  'drift',
  'partial',
  'unavailable',
  'unsupported',
  'not_configured',
  'due',
] as const);
export const DOMAIN_CONTROL_REVIEW_COUNT_KEYS = Object.freeze([...PUBLIC_DOMAIN_CONTROL_REVIEW_COUNT_KEYS, 'observed'] as const);
export const DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS = Object.freeze([
  'domain',
  'state',
  'comparisons',
] as const);
export const PUBLIC_DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS = Object.freeze([
  'field',
  'state',
  'desired',
  'observed',
  'source',
  'observedAt',
  'explanation',
] as const);
export const DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS = Object.freeze([...PUBLIC_DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS, 'expectation'] as const);
export const PUBLIC_DOMAIN_CONTROL_REVIEW_LIMITATIONS = Object.freeze([
  'This local review compares analyst-authored desired state with separately supplied observations and performs no collection or configuration change.',
  'Only complete observations can produce drift. Partial, unavailable, unsupported, or missing evidence remains inconclusive.',
  'A valid manifest digest or signature establishes file integrity, not the correctness of the desired state or supplied observations.',
] as const);

export const DOMAIN_CONTROL_REVIEW_LIMITATIONS = Object.freeze([
  PUBLIC_DOMAIN_CONTROL_REVIEW_LIMITATIONS[0],
  'Only complete observations with valid source times within the current review-age window can establish alignment, drift or expected absence. Observation-only fields do not establish alignment.',
  PUBLIC_DOMAIN_CONTROL_REVIEW_LIMITATIONS[2],
] as const);

export const CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS = Object.freeze([
  'schema',
  'version',
  'manifest',
  'lookups',
] as const);
export const CLI_DOMAIN_CONTROL_REVIEW_ROOT_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'review',
  'observations',
  'input',
  'limitations',
] as const);
export const PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS = PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS;
export const CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS = DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS;
export const PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS = PUBLIC_DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS;
export const CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS = DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS;
export const CLI_DOMAIN_CONTROL_REVIEW_INPUT_SUMMARY_KEYS = Object.freeze([
  'lookupsReceived',
  'latestDomainObservations',
  'ignoredHistoricalLookups',
] as const);
export const PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS = Object.freeze([
  'The review uses only supplied saved Lookup documents and performs no request.',
  'The newest supplied observation per domain is used for desired-state comparison; all supplied observations remain available to a separate flight-recorder review.',
  'Raw RDAP, WHOIS, HTTP, TLS, and page payloads are not copied into this output.',
] as const);
export const CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS = Object.freeze([
  PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS[0],
  'The newest supplied capture per domain is reviewed using each field’s retained source time. Missing or conflicting source times remain inconclusive.',
  PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS[2],
] as const);

export type DomainControlReviewField = typeof DOMAIN_CONTROL_REVIEW_FIELDS[number] | 'renewalReviewAt';
export type DomainControlReviewObservationState = 'observed' | 'partial' | 'unavailable' | 'unsupported';
export type DomainControlReviewComparisonState =
  | 'aligned'
  | 'drift'
  | 'partial'
  | 'unavailable'
  | 'unsupported'
  | 'not_configured'
  | 'observed'
  | 'due';

export type DomainControlReviewObservationField = Readonly<{
  state: DomainControlReviewObservationState;
  values: readonly unknown[];
  source: string;
  observedAt: string | null;
}>;

export type DomainControlReviewInput = Readonly<{
  schema: typeof DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA;
  version: typeof SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS[number];
  manifest: unknown;
  observations: readonly Readonly<{
    domain: string;
    fields: Readonly<Partial<Record<Exclude<DomainControlReviewField, 'renewalReviewAt'>, DomainControlReviewObservationField>>>;
  }>[];
}>;

export type DomainControlReviewComparison = Readonly<{
  field: DomainControlReviewField;
  state: DomainControlReviewComparisonState;
  desired: readonly string[];
  observed: readonly string[];
  source: string | null;
  observedAt: string | null;
  explanation: string;
  expectation?: DomainControlRecordMode;
}>;

export type CliDomainControlReviewInput = Readonly<{
  schema: typeof CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA;
  version: typeof SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS[number];
  manifest: unknown;
  lookups: readonly unknown[];
}>;

export const DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-review-core-input',
  kind: 'cli_document',
  schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  currentVersion: DOMAIN_CONTROL_REVIEW_VERSION,
  supportedVersions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/domain-control-review.mts',
  note: 'Exact-current bounded desired-state manifest and separately attributed observation input for the offline core comparison.',
});

export const DOMAIN_CONTROL_REVIEW_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-review',
  kind: 'cli_document',
  schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
  currentVersion: DOMAIN_CONTROL_REVIEW_VERSION,
  supportedVersions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/domain-control-review.mts',
  note: 'Offline desired-state comparison. Only complete separately attributed observations can produce drift.',
});

export const CLI_DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-review-input',
  kind: 'cli_document',
  schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  currentVersion: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  supportedVersions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
  owner: 'packages/contracts/domain-control-review.mts',
  note: 'Bounded desired-state manifest plus saved Lookups converted without new collection.',
});

export const CLI_DOMAIN_CONTROL_REVIEW_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-observation-review',
  kind: 'cli_document',
  schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  currentVersion: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  supportedVersions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'not_applicable',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/domain-control-review.mts',
  note: 'Compact source-qualified control observations and desired-state comparison.',
});

const CORE_REVIEW_SHAPES = SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS.flatMap((version) => [
  {
    id: `domain-control-review.input.v${version}`,
    schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
    versions: [version],
    objects: [
      { path: '$', requiredKeys: DOMAIN_CONTROL_REVIEW_INPUT_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.manifest', requiredKeys: DOMAIN_CONTROL_MANIFEST_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.manifest.entries[]', requiredKeys: PUBLIC_DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS, optionalKeys: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? [] : ['recordModes'], unknownKeys: 'reject' as const },
      { path: '$.manifest.integrity', requiredKeys: DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.observations[]', requiredKeys: DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.observations[].fields', requiredKeys: [], optionalKeys: DOMAIN_CONTROL_REVIEW_FIELDS, unknownKeys: 'reject' as const },
      ...DOMAIN_CONTROL_REVIEW_FIELDS.map((field) => ({
        path: `$.observations[].fields.${field}`,
        requiredKeys: DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS,
        optionalKeys: [],
        unknownKeys: 'reject' as const,
      })),
    ],
    fixedArrays: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? [{ path: '$.manifest.limitations', values: PUBLIC_DOMAIN_CONTROL_MANIFEST_LIMITATIONS }] : [],
    normalisation: 'input_to_current' as const,
    target: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
  },
  {
    id: `domain-control-review.document.v${version}`,
    schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
    versions: [version],
    objects: [
      { path: '$', requiredKeys: DOMAIN_CONTROL_REVIEW_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.manifest', requiredKeys: DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.counts', requiredKeys: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_COUNT_KEYS : DOMAIN_CONTROL_REVIEW_COUNT_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.domains[]', requiredKeys: DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
      { path: '$.domains[].comparisons[]', requiredKeys: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS : DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS, optionalKeys: [], unknownKeys: 'reject' as const },
    ],
    fixedArrays: [{ path: '$.limitations', values: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_LIMITATIONS : DOMAIN_CONTROL_REVIEW_LIMITATIONS }],
    normalisation: 'preserve_document' as const,
    target: null,
  },
] as const);

const CORE_BOUND_PROFILE_IDS = SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS.map((version) => `domain-control-review.core.v${version}`);
const CORE_INPUT_SHAPE_IDS = SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS.map((version) => `domain-control-review.input.v${version}`);
const CORE_DOCUMENT_SHAPE_IDS = SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS.map((version) => `domain-control-review.document.v${version}`);
const CURRENT_CORE_DOCUMENT_SHAPE_ID = `domain-control-review.document.v${DOMAIN_CONTROL_REVIEW_VERSION}`;
const CLI_INPUT_SHAPE_IDS = SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS.map((version) => `domain-control-review.cli-input.v${version}`);
const CURRENT_CLI_DOCUMENT_SHAPE_ID = `domain-control-review.cli-document.v${CLI_DOMAIN_CONTROL_REVIEW_VERSION}`;

function reviewFixtureShapeId(schema: string, version: number): string {
  const cli = schema.startsWith('whoisleuth.cli.');
  return `domain-control-review.${cli ? 'cli-' : ''}${schema.endsWith('-input') ? 'input' : 'document'}.v${version}`;
}

const CURRENT_REVIEW_FIXTURE_CONTENT: Readonly<Record<string, { bytes: number; sha256: string }>> = {
  "domain-control-review-input-v2": {
    "bytes": 1879,
    "sha256": "ac3b5913a44c47bd179cd69e4a8bf4268f10e9f01dd7f59c7d722a8c0d241ad1"
  },
  "domain-control-review-v2": {
    "bytes": 4386,
    "sha256": "e85870d7c978f484a47c807104cab038af2aa30265d05cae1b129ce663e7b9b8"
  },
  "cli-domain-control-review-input-v2": {
    "bytes": 4123,
    "sha256": "ae360c4bcc2f6c3b48b5e9cef524b51ac25f958a88184d6f7efdf26eadfd815f"
  },
  "cli-domain-control-review-v2": {
    "bytes": 9084,
    "sha256": "4befd3e6e81873497a0d56b8337a6540516f36cfdb81d35a26c807875488e309"
  }
};

export const DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE = defineSchemaLifecycleFamily({
  id: 'domain-control-review',
  owner: 'packages/contracts/domain-control-review.mts',
  privacy: 'analyst_authored_sensitive',
  compatibility: [
    DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY,
    DOMAIN_CONTROL_REVIEW_COMPATIBILITY,
    CLI_DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY,
    CLI_DOMAIN_CONTROL_REVIEW_COMPATIBILITY,
  ],
  contracts: ([
    {
      compatibilityId: DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'input',
      lifecycle: 'current',
      readable: true,
      emitted: false,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: null,
      fixtureIds: ['domain-control-review-input-v1'],
    },
    {
      compatibilityId: DOMAIN_CONTROL_REVIEW_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: null,
      fixtureIds: ['domain-control-review-v1'],
    },
    {
      compatibilityId: CLI_DOMAIN_CONTROL_REVIEW_INPUT_COMPATIBILITY.id,
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'input',
      lifecycle: 'current',
      readable: true,
      emitted: false,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
      fixtureIds: ['cli-domain-control-review-input-v1'],
    },
    {
      compatibilityId: CLI_DOMAIN_CONTROL_REVIEW_COMPATIBILITY.id,
      schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: false,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'not_applicable',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: null,
      fixtureIds: ['cli-domain-control-review-v1'],
    },
  ] as const).flatMap((contract) => {
    const versions = contract.schema.startsWith('whoisleuth.cli.') ? SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS : SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS;
    return versions.map((version) => ({
      ...contract, version,
      lifecycle: version === contract.version ? 'current' as const : contract.readable ? 'legacy' as const : 'retired' as const,
      emitted: contract.emitted && version === contract.version,
      fixtureIds: contract.fixtureIds.map((id) => id.replace(/v\d+$/u, `v${version}`)),
    }));
  }),
  fixtures: ([
    {
      id: 'domain-control-review-input-v1',
      path: 'test/fixtures/domain-control-review-input-v1.json',
      bytes: 1_879,
      sha256: 'ca6e894a67715fa93a872d189fe22a21dc516200f672546de7cc8ffe2df12329',
      contentDigestSha256: null,
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'input',
      expectation: 'normalises_to_current_output',
      expectedOutputFixtureId: 'domain-control-review-v1',
      scope: 'repository',
    },
    {
      id: 'domain-control-review-v1',
      path: 'test/fixtures/domain-control-review-v1.json',
      bytes: 3_954,
      sha256: '1ac47d146aee742dd9e1c2b9755bfd8d59d1104b005bedd21d63f42c68d255ec',
      contentDigestSha256: null,
      schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
      version: PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
    },
    {
      id: 'cli-domain-control-review-input-v1',
      path: 'test/fixtures/cli-domain-control-review-input-v1.json',
      bytes: 3_757,
      sha256: 'b4f2005738bf6d8f12433304f20b503eb3ee47778bef9daa1cf1d4fdddae8621',
      contentDigestSha256: null,
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'input',
      expectation: 'normalises_to_current_output',
      expectedOutputFixtureId: 'cli-domain-control-review-v1',
      scope: 'repository',
    },
    {
      id: 'cli-domain-control-review-v1',
      path: 'test/fixtures/cli-domain-control-review-v1.json',
      bytes: 7_952,
      sha256: 'd6e24209da9d4e41d2065bab493c035adf117faa5bacc8c8ce30c56c8aef0b93',
      contentDigestSha256: null,
      schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
      version: PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
    },
  ] as const).flatMap((fixture) => {
    const version = fixture.schema.startsWith('whoisleuth.cli.') ? CLI_DOMAIN_CONTROL_REVIEW_VERSION : DOMAIN_CONTROL_REVIEW_VERSION;
    const id = fixture.id.replace(/v\d+$/u, `v${version}`);
    const content = CURRENT_REVIEW_FIXTURE_CONTENT[id]!;
    return [
      { ...fixture, shapeId: reviewFixtureShapeId(fixture.schema, fixture.version), role: fixture.role === 'input' ? 'input' as const : 'historical' as const, expectation: fixture.schema === CLI_DOMAIN_CONTROL_REVIEW_SCHEMA ? 'historical_output_exact' as const : 'accepted_exact' as const, expectedOutputFixtureId: null },
      { ...fixture, ...content, id, path: `test/fixtures/${id}.json`, version, shapeId: reviewFixtureShapeId(fixture.schema, version), role: fixture.role as 'input' | 'current', expectation: fixture.expectation as 'normalises_to_current_output' | 'accepted_exact', expectedOutputFixtureId: fixture.expectedOutputFixtureId?.replace(/v\d+$/u, `v${version}`) ?? null },
    ];
  }),
  metadata: {
    metadataVersion: 4,
    enforcement: 'declarative_only',
    shapes: [
      ...CORE_REVIEW_SHAPES,
      ...SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS.flatMap((version) => [
      {
        id: `domain-control-review.cli-input.v${version}`,
        schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
        versions: [version],
        objects: [
          { path: '$', requiredKeys: CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.manifest', requiredKeys: DOMAIN_CONTROL_MANIFEST_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.manifest.entries[]', requiredKeys: PUBLIC_DOMAIN_CONTROL_MANIFEST_ENTRY_KEYS, optionalKeys: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? [] : ['recordModes'], unknownKeys: 'reject' },
          { path: '$.manifest.integrity', requiredKeys: DOMAIN_CONTROL_MANIFEST_INTEGRITY_KEYS, optionalKeys: [], unknownKeys: 'reject' },
        ],
        fixedArrays: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? [{ path: '$.manifest.limitations', values: PUBLIC_DOMAIN_CONTROL_MANIFEST_LIMITATIONS }] : [],
        normalisation: 'input_to_current',
        target: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
      },
      {
        id: `domain-control-review.cli-document.v${version}`,
        schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
        versions: [version],
        objects: [
          { path: '$', requiredKeys: CLI_DOMAIN_CONTROL_REVIEW_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.review', requiredKeys: DOMAIN_CONTROL_REVIEW_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.review.manifest', requiredKeys: DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.review.counts', requiredKeys: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_COUNT_KEYS : DOMAIN_CONTROL_REVIEW_COUNT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.review.domains[]', requiredKeys: DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.review.domains[].comparisons[]', requiredKeys: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS : DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.observations[]', requiredKeys: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS : CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.observations[].fields[]', requiredKeys: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS : CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.input', requiredKeys: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SUMMARY_KEYS, optionalKeys: [], unknownKeys: 'reject' },
        ],
        fixedArrays: [
          { path: '$.review.limitations', values: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_DOMAIN_CONTROL_REVIEW_LIMITATIONS : DOMAIN_CONTROL_REVIEW_LIMITATIONS },
          { path: '$.limitations', values: version === PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_VERSION ? PUBLIC_CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS : CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS },
        ],
        normalisation: 'preserve_document',
        target: null,
      },
      ] as const),
    ].map((shape) => ({ ...shape, discriminator: null, objects: shape.objects.map((object) => ({ ...object, alternativeRequiredKeys: [] })) })),
    boundProfiles: [
      ...SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS.map((version) => ({
        id: `domain-control-review.core.v${version}`,
        bounds: [
          { id: 'observations', path: '$.observations', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS, handling: 'reject' },
          { id: 'observation-fields', path: '$.observations[].fields', phase: 'pre_accumulation', unit: 'keys', minimum: 0, maximum: MAX_DOMAIN_CONTROL_REVIEW_FIELDS, handling: 'reject' },
          ...DOMAIN_CONTROL_REVIEW_FIELDS.flatMap((field) => {
            const boundId = field.replace(/([A-Z])/gu, '-$1').toLowerCase();
            return [
              { id: `${boundId}-input-values`, path: `$.observations[].fields.${field}.values`, phase: 'pre_accumulation' as const, unit: 'items' as const, minimum: 0, maximum: MAX_DOMAIN_CONTROL_REVIEW_FIELD_INPUT_VALUES, handling: 'reject' as const },
              { id: `${boundId}-values`, path: `$.observations[].fields.${field}.values`, phase: 'normalised' as const, unit: 'items' as const, minimum: 0, maximum: version === PUBLIC_DOMAIN_CONTROL_REVIEW_VERSION ? MAX_CANONICAL_DOMAIN_CONTROL_RECORDS : MAX_CURRENT_DOMAIN_CONTROL_RECORDS, handling: 'reject' as const },
              { id: `${boundId}-source-input`, path: `$.observations[].fields.${field}.source`, phase: 'pre_accumulation' as const, unit: 'characters' as const, minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_SOURCE_INPUT_LENGTH, handling: 'reject' as const },
              { id: `${boundId}-source`, path: `$.observations[].fields.${field}.source`, phase: 'normalised' as const, unit: 'characters' as const, minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH, handling: 'truncate' as const },
              { id: `${boundId}-observed-at-input`, path: `$.observations[].fields.${field}.observedAt`, phase: 'pre_accumulation' as const, unit: 'characters' as const, minimum: 0, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * DOMAIN_CONTROL_TEXT_INPUT_BOUND_FACTOR, handling: 'reject' as const },
              { id: `${boundId}-observed-at`, path: `$.observations[].fields.${field}.observedAt`, phase: 'normalised' as const, unit: 'characters' as const, minimum: 0, maximum: MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH, handling: 'reject' as const },
            ];
          }),
          { id: 'nameserver-input-text', path: '$.observations[].fields.nameservers.values[]', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_DOMAIN_INPUT_LENGTH, handling: 'reject' },
          { id: 'nameserver-text', path: '$.observations[].fields.nameservers.values[]', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_DOMAIN_LENGTH, handling: 'truncate' },
          { id: 'tls-issuer-input-text', path: '$.observations[].fields.tlsIssuer.values[]', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_TEXT_INPUT_LENGTH, handling: 'reject' },
          { id: 'tls-issuer-text', path: '$.observations[].fields.tlsIssuer.values[]', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH, handling: 'truncate' },
          { id: 'tls-spki-input-text', path: '$.observations[].fields.tlsSpkiSha256.values[]', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_SPKI_INPUT_LENGTH, handling: 'reject' },
          { id: 'tls-spki-text', path: '$.observations[].fields.tlsSpkiSha256.values[]', phase: 'normalised', unit: 'characters', minimum: DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH, maximum: DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH, handling: 'reject' },
          { id: 'output-domains', path: '$.domains', phase: 'normalised', unit: 'entries', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES, handling: 'reject' },
        ],
      } as const)),
      {
        id: 'domain-control-review.cli-library.v1',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES, handling: 'reject' },
          { id: 'lookups', path: '$.lookups', phase: 'pre_accumulation', unit: 'items', minimum: MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS, maximum: MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES, handling: 'reject' },
          { id: 'json-container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, handling: 'reject' },
          { id: 'saved-lookup-canonical-bytes', path: '$.lookups[]', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_CLI_LOOKUP_BYTES, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-review.cli-command.v1',
        bounds: [
          { id: 'raw-input-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-review.monitor-action.v1',
        bounds: [
          { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, maximum: MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY, handling: 'reject' },
        ],
      },
    ],
    hooks: [
      { id: 'domain-control-review.node.verify-manifest', role: 'integrity_verifier', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'verifyDomainControlManifest' },
      { id: 'domain-control-review.node.build-core', role: 'reviewer', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'reviewDomainControlManifest' },
      { id: 'domain-control-review.node.validate-core', role: 'structure_validator', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'validateDomainControlReviewDocument' },
      { id: 'domain-control-review.node.format-core-terminal', role: 'serialiser', runtime: 'node', module: 'lib/domain-control-manifest.mts', exportName: 'formatDomainControlResult' },
      { id: 'domain-control-review.cli.build-saved-lookup', role: 'reviewer', runtime: 'cli', module: 'cli/domain-control-observations.mts', exportName: 'buildCliDomainControlReview' },
      { id: 'domain-control-review.cli.format-saved-terminal', role: 'serialiser', runtime: 'cli', module: 'cli/domain-control-observations.mts', exportName: 'formatCliDomainControlReview' },
      { id: 'domain-control-review.cli.serialise-json', role: 'serialiser', runtime: 'cli', module: 'cli/formatters/json.mts', exportName: 'formatJsonDocument' },
      { id: 'domain-control-review.cli.monitor', role: 'monitor', runtime: 'cli', module: 'cli/domain-control-monitor.mts', exportName: 'runDomainControlMonitor' },
    ],
    serialisationProfiles: [
      {
        id: 'domain-control-review.core-json.v1',
        schema: DOMAIN_CONTROL_REVIEW_SCHEMA,
        versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS,
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'domain-control-review.cli.serialise-json',
        verifierHookIds: [],
      },
      {
        id: 'domain-control-review.cli-json.v1',
        schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
        versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS,
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'domain-control-review.cli.serialise-json',
        verifierHookIds: [],
      },
    ],
    privacyProfiles: [
      {
        id: 'domain-control-review.sensitive.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: [
          'domain-identifiers',
          'desired-control-values',
          'observed-control-values',
          'observation-provenance',
          'observation-times',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: ['analyst-notes', 'raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control-review.sensitive-output.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: [
          'domain-identifiers',
          'desired-control-values',
          'observed-control-values',
          'observation-provenance',
          'observation-times',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: ['analyst-notes', 'raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control-review.monitor-output.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'bounded_passive_monitor',
        includedCategories: [
          'domain-identifiers',
          'desired-control-values',
          'observed-control-values',
          'observation-provenance',
          'observation-times',
          'request-metadata',
          'bounded-errors',
          'document-times',
          'integrity-linkage',
        ],
        excludedCategories: ['analyst-notes', 'raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'discarded',
        retention: 'operator_controlled_output',
        network: 'explicit_bounded_passive_deep',
        sharingReview: 'required',
      },
    ],
    expiryProfiles: [
      {
        id: 'domain-control-review.expiry-report.v1',
        field: 'expiresAt',
        anchor: 'checkedAt',
        handling: 'report_expired',
        phase: 'review',
        maximumLifetimeDays: null,
      },
      {
        id: 'domain-control-review.expiry-require-current.v1',
        field: 'expiresAt',
        anchor: 'checkedAt',
        handling: 'reject_expired',
        phase: 'pre_action',
        maximumLifetimeDays: null,
      },
    ],
    consumerEdges: ([
      {
        id: 'domain-control-review.node-core',
        plane: 'node',
        operation: 'review',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CORE_INPUT_SHAPE_IDS, CURRENT_CORE_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS],
        hookIds: ['domain-control-review.node.verify-manifest', 'domain-control-review.node.build-core'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-core-json-stdout',
        plane: 'cli',
        operation: 'review-json-stdout',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CORE_INPUT_SHAPE_IDS, CURRENT_CORE_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS, 'domain-control-review.cli-command.v1'],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.serialise-json',
        ],
        serialisationProfileId: 'domain-control-review.core-json.v1',
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-core-terminal-stdout',
        plane: 'cli',
        operation: 'review-terminal-stdout',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CORE_INPUT_SHAPE_IDS, CURRENT_CORE_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS, 'domain-control-review.cli-command.v1'],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.node.format-core-terminal',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-core-json-file',
        plane: 'cli',
        operation: 'review-json-file',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CORE_INPUT_SHAPE_IDS, CURRENT_CORE_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS, 'domain-control-review.cli-command.v1'],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.serialise-json',
        ],
        serialisationProfileId: 'domain-control-review.core-json.v1',
        privacyProfileId: 'domain-control-review.sensitive-output.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-core-terminal-file',
        plane: 'cli',
        operation: 'review-terminal-file',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, version: DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CORE_INPUT_SHAPE_IDS, CURRENT_CORE_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS, 'domain-control-review.cli-command.v1'],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.node.format-core-terminal',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive-output.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-saved-lookup-library',
        plane: 'cli',
        operation: 'review',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CLI_INPUT_SHAPE_IDS, CURRENT_CLI_DOCUMENT_SHAPE_ID],
        boundProfileIds: [...CORE_BOUND_PROFILE_IDS, 'domain-control-review.cli-library.v1'],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.build-saved-lookup',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-saved-json-stdout',
        plane: 'cli',
        operation: 'review-json-stdout',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CLI_INPUT_SHAPE_IDS, CURRENT_CLI_DOCUMENT_SHAPE_ID],
        boundProfileIds: [
          ...CORE_BOUND_PROFILE_IDS,
          'domain-control-review.cli-library.v1',
          'domain-control-review.cli-command.v1',
        ],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.build-saved-lookup',
          'domain-control-review.cli.serialise-json',
        ],
        serialisationProfileId: 'domain-control-review.cli-json.v1',
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-saved-terminal-stdout',
        plane: 'cli',
        operation: 'review-terminal-stdout',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CLI_INPUT_SHAPE_IDS, CURRENT_CLI_DOCUMENT_SHAPE_ID],
        boundProfileIds: [
          ...CORE_BOUND_PROFILE_IDS,
          'domain-control-review.cli-library.v1',
          'domain-control-review.cli-command.v1',
        ],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.build-saved-lookup',
          'domain-control-review.cli.format-saved-terminal',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-saved-json-file',
        plane: 'cli',
        operation: 'review-json-file',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CLI_INPUT_SHAPE_IDS, CURRENT_CLI_DOCUMENT_SHAPE_ID],
        boundProfileIds: [
          ...CORE_BOUND_PROFILE_IDS,
          'domain-control-review.cli-library.v1',
          'domain-control-review.cli-command.v1',
        ],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.build-saved-lookup',
          'domain-control-review.cli.serialise-json',
        ],
        serialisationProfileId: 'domain-control-review.cli-json.v1',
        privacyProfileId: 'domain-control-review.sensitive-output.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-saved-terminal-file',
        plane: 'cli',
        operation: 'review-terminal-file',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, versions: SUPPORTED_CLI_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION },
        shapeIds: [...CLI_INPUT_SHAPE_IDS, CURRENT_CLI_DOCUMENT_SHAPE_ID],
        boundProfileIds: [
          ...CORE_BOUND_PROFILE_IDS,
          'domain-control-review.cli-library.v1',
          'domain-control-review.cli-command.v1',
        ],
        hookIds: [
          'domain-control-review.node.verify-manifest',
          'domain-control-review.node.build-core',
          'domain-control-review.cli.build-saved-lookup',
          'domain-control-review.cli.format-saved-terminal',
        ],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.sensitive-output.v1',
        expiryPolicyId: 'domain-control-review.expiry-report.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-review.cli-monitor-embedding',
        plane: 'cli',
        operation: 'embed-review-after-bounded-passive-collection',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_REVIEW_SCHEMA, versions: SUPPORTED_DOMAIN_CONTROL_REVIEW_VERSIONS, mode: 'embedded' }],
        emittedContract: null,
        shapeIds: CORE_DOCUMENT_SHAPE_IDS,
        boundProfileIds: ['domain-control-review.monitor-action.v1'],
        hookIds: ['domain-control-review.node.validate-core', 'domain-control-review.cli.monitor'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-review.monitor-output.v1',
        expiryPolicyId: 'domain-control-review.expiry-require-current.v1',
        requestMode: 'explicit_bounded_passive_deep',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
    ] as const).map((edge) => ({
      ...edge,
      acceptedContracts: edge.acceptedContracts.map((contract) => ({ ...contract, discriminator: null })),
      emittedContract: edge.emittedContract ? { ...edge.emittedContract, discriminator: null } : null,
    })),
    consumerRelationships: [],
  },
});
