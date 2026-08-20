import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import {
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
} from './domain-control-manifest.mts';
import {
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from './domain-control-monitor.mts';

export const DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA = 'whoisleuth.domain-control-flight-recorder.input';
export const DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA = 'whoisleuth.domain-control-flight-recorder';
export const DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION = 1;

export const MIN_FLIGHT_RECORDER_OBSERVATIONS = 1;
export const MAX_FLIGHT_RECORDER_OBSERVATIONS = 200;
export const MAX_FLIGHT_RECORDER_WINDOWS = 40;
export const MAX_FLIGHT_RECORDER_FIELDS = 24;
export const MAX_FLIGHT_RECORDER_VALUES = 32;
export const DOMAIN_CONTROL_FLIGHT_RECORDER_VALUE_INPUT_FACTOR = 2;
export const MAX_FLIGHT_RECORDER_INPUT_VALUES = MAX_FLIGHT_RECORDER_VALUES
  * DOMAIN_CONTROL_FLIGHT_RECORDER_VALUE_INPUT_FACTOR;
export const MAX_FLIGHT_RECORDER_SOURCE_LENGTH = 120;
export const MAX_FLIGHT_RECORDER_VALUE_LENGTH = 500;
export const MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH = 64;
export const MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH = 400;
export const MAX_FLIGHT_RECORDER_JSON_DEPTH = 8;
export const MAX_FLIGHT_RECORDER_JSON_VALUES = 400_000;
export const MAX_FLIGHT_RECORDER_EVENTS = MAX_FLIGHT_RECORDER_OBSERVATIONS
  * MAX_FLIGHT_RECORDER_FIELDS;
export const MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES = MAX_DOMAIN_CONTROL_MANIFEST_BYTES;
export const MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES = 32 * 1024 * 1024;

export const DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS = Object.freeze([
  'registrar',
  'registrar_lock',
  'registry_dnssec',
  'registry_nameservers',
  'whois_nameservers',
  'delegated_nameservers',
  'delegation_ds',
  'mail_exchangers',
  'caa_policy',
  'tls_certificate',
  'tls_public_key',
  'http_origin',
  'page_identity',
] as const);
export const MAX_FLIGHT_RECORDER_UNIQUE_FIELDS = DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS.length;

export const DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS = Object.freeze([
  'schema',
  'version',
  'observations',
  'approvedWindows',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS = Object.freeze([
  'domain',
  'observedAt',
  'collectionDepth',
  'fields',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS = Object.freeze([
  'id',
  'source',
  'state',
  'values',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS = Object.freeze([
  'id',
  'domain',
  'startsAt',
  'endsAt',
  'fields',
  'reason',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'domains',
  'observationCount',
  'events',
  'summary',
  'limitations',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS = Object.freeze([
  'id',
  'domain',
  'field',
  'observedAt',
  'kind',
  'state',
  'before',
  'after',
  'source',
  'approvedWindow',
  'explanation',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS = Object.freeze([
  'id',
  'reason',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS = Object.freeze([
  'firstObservations',
  'observedChanges',
  'approvedChanges',
  'unexpectedChanges',
  'collectionChanges',
  'recoveredSources',
] as const);
export const DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS = Object.freeze([
  'The flight recorder compares only supplied bounded observations and performs no collection or configuration change.',
  'Source fields remain separate. A collection failure, partial result, unsupported source, or missing field never becomes evidence that a prior value disappeared.',
  'Approved windows label expected timing but do not delete evidence or establish that a change was authorised, successful, safe, or complete.',
  'Observed changes can reflect publication lag or different collection conditions and require analyst review.',
] as const);

export type DomainControlFlightRecorderField = typeof DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS[number];
export type DomainControlObservationState = 'observed' | 'partial' | 'unavailable' | 'unsupported';

export type DomainControlFlightRecorderObservation = Readonly<{
  domain: string;
  observedAt: string;
  collectionDepth: 'deep' | 'fast' | 'unknown';
  fields: readonly Readonly<{
    id: DomainControlFlightRecorderField;
    source: string;
    state: DomainControlObservationState;
    values: readonly string[];
  }>[];
}>;

export const DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-flight-recorder-input',
  kind: 'cli_document',
  schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  currentVersion: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  supportedVersions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES,
  owner: 'packages/contracts/domain-control-flight-recorder.mts',
  note: 'Bounded source-qualified control observations and approved change windows.',
});

export const DOMAIN_CONTROL_FLIGHT_RECORDER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-flight-recorder',
  kind: 'cli_document',
  schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  currentVersion: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  supportedVersions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
  owner: 'packages/contracts/domain-control-flight-recorder.mts',
  note: 'Offline first and last observed control history that preserves expected and unexpected changes.',
});

export const DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE = defineSchemaLifecycleFamily({
  id: 'domain-control-flight-recorder',
  owner: 'packages/contracts/domain-control-flight-recorder.mts',
  privacy: 'analyst_authored_sensitive',
  compatibility: [
    DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_COMPATIBILITY,
    DOMAIN_CONTROL_FLIGHT_RECORDER_COMPATIBILITY,
  ],
  contracts: [
    {
      compatibilityId: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
      role: 'input',
      lifecycle: 'current',
      readable: true,
      emitted: false,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES,
      fixtureIds: ['domain-control-flight-recorder-input-v1'],
    },
    {
      compatibilityId: DOMAIN_CONTROL_FLIGHT_RECORDER_COMPATIBILITY.id,
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
      version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
      role: 'document',
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
      fixtureIds: ['domain-control-flight-recorder-v1'],
    },
  ],
  fixtures: [
    {
      id: 'domain-control-flight-recorder-input-v1',
      path: 'test/fixtures/domain-control-flight-recorder-input-v1.json',
      bytes: 1_796,
      sha256: '1fc4127a5885409d2ba76d40c1835a496767c6fe6d87f0545d8367d5f394a628',
      contentDigestSha256: null,
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
      role: 'input',
      expectation: 'normalises_to_current_output',
      expectedOutputFixtureId: 'domain-control-flight-recorder-v1',
      scope: 'repository',
    },
    {
      id: 'domain-control-flight-recorder-v1',
      path: 'test/fixtures/domain-control-flight-recorder-v1.json',
      bytes: 3_691,
      sha256: 'c35d43907bba7a7912f3151bc1a2ba37bb8f774c56a3bd5f690be262e842cf4c',
      contentDigestSha256: null,
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
      version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
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
        id: 'domain-control-flight-recorder.input.v1',
        schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
        versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION],
        objects: [
          { path: '$', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.observations[]', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.observations[].fields[]', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.approvedWindows[]', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS, optionalKeys: [], unknownKeys: 'reject' },
        ],
        fixedArrays: [],
        normalisation: 'input_to_current',
        target: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
      },
      {
        id: 'domain-control-flight-recorder.document.v1',
        schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
        versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION],
        objects: [
          { path: '$', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.events[]', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.events[].approvedWindow', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.summary', requiredKeys: DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS, optionalKeys: [], unknownKeys: 'reject' },
        ],
        fixedArrays: [{ path: '$.limitations', values: DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS }],
        normalisation: 'preserve_document',
        target: null,
      },
    ],
    boundProfiles: [
      {
        id: 'domain-control-flight-recorder.input-wire.v1',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_FLIGHT_RECORDER_JSON_DEPTH, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_FLIGHT_RECORDER_JSON_VALUES, handling: 'reject' },
          { id: 'observations', path: '$.observations', phase: 'pre_accumulation', unit: 'items', minimum: MIN_FLIGHT_RECORDER_OBSERVATIONS, maximum: MAX_FLIGHT_RECORDER_OBSERVATIONS, handling: 'reject' },
          { id: 'observation-fields', path: '$.observations[].fields', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_FIELDS, handling: 'reject' },
          { id: 'observation-unique-fields', path: '$.observations[].fields', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_UNIQUE_FIELDS, handling: 'reject' },
          { id: 'field-input-values', path: '$.observations[].fields[].values', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_INPUT_VALUES, handling: 'reject' },
          { id: 'field-values', path: '$.observations[].fields[].values', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_VALUES, handling: 'truncate' },
          { id: 'field-source', path: '$.observations[].fields[].source', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_FLIGHT_RECORDER_SOURCE_LENGTH, handling: 'reject' },
          { id: 'field-value-text', path: '$.observations[].fields[].values[]', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_FLIGHT_RECORDER_VALUE_LENGTH, handling: 'reject' },
          { id: 'approved-windows', path: '$.approvedWindows', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_WINDOWS, handling: 'reject' },
          { id: 'window-fields', path: '$.approvedWindows[].fields', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_FLIGHT_RECORDER_FIELDS, handling: 'reject' },
          { id: 'window-id', path: '$.approvedWindows[].id', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH, handling: 'reject' },
          { id: 'window-reason', path: '$.approvedWindows[].reason', phase: 'pre_accumulation', unit: 'characters', minimum: 1, maximum: MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-flight-recorder.output-wire.v1',
        bounds: [
          { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_FLIGHT_RECORDER_JSON_DEPTH, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_FLIGHT_RECORDER_JSON_VALUES, handling: 'reject' },
          { id: 'domains', path: '$.domains', phase: 'normalised', unit: 'items', minimum: 1, maximum: MAX_FLIGHT_RECORDER_OBSERVATIONS, handling: 'reject' },
          { id: 'events', path: '$.events', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_EVENTS, handling: 'reject' },
          { id: 'event-before-values', path: '$.events[].before', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_VALUES, handling: 'reject' },
          { id: 'event-after-values', path: '$.events[].after', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_FLIGHT_RECORDER_VALUES, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-flight-recorder.cli-command.v1',
        bounds: [
          { id: 'raw-input-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-flight-recorder.monitor-action.v1',
        bounds: [
          { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, maximum: MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY, handling: 'reject' },
        ],
      },
    ],
    hooks: [
      { id: 'domain-control-flight-recorder.node.build', role: 'reviewer', runtime: 'node', module: 'lib/domain-control-flight-recorder.mts', exportName: 'buildDomainControlFlightRecorder' },
      { id: 'domain-control-flight-recorder.node.validate-document', role: 'structure_validator', runtime: 'node', module: 'lib/domain-control-flight-recorder.mts', exportName: 'validateDomainControlFlightRecorderDocument' },
      { id: 'domain-control-flight-recorder.node.format-terminal', role: 'serialiser', runtime: 'node', module: 'lib/domain-control-flight-recorder.mts', exportName: 'formatDomainControlFlightRecorder' },
      { id: 'domain-control-flight-recorder.node.serialise-json', role: 'serialiser', runtime: 'node', module: 'lib/domain-control-flight-recorder.mts', exportName: 'serializeDomainControlFlightRecorder' },
      { id: 'domain-control-flight-recorder.cli.monitor', role: 'monitor', runtime: 'cli', module: 'cli/domain-control-monitor.mts', exportName: 'runDomainControlMonitor' },
    ],
    serialisationProfiles: [
      {
        id: 'domain-control-flight-recorder.json.v1',
        schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
        versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION],
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'domain-control-flight-recorder.node.serialise-json',
        verifierHookIds: [],
      },
    ],
    privacyProfiles: [
      {
        id: 'domain-control-flight-recorder.sensitive.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: ['domain-identifiers', 'observed-control-values', 'observation-provenance', 'observation-times', 'approved-change-windows', 'analyst-authored-window-reasons', 'change-history'],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'allowed_bounded',
        retention: 'transient_report',
        network: 'none',
        sharingReview: 'not_applicable',
      },
      {
        id: 'domain-control-flight-recorder.sensitive-output.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'review_output',
        includedCategories: ['domain-identifiers', 'observed-control-values', 'observation-provenance', 'observation-times', 'approved-change-windows', 'analyst-authored-window-reasons', 'change-history'],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'allowed_bounded',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control-flight-recorder.monitor-output.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'bounded_passive_monitor',
        includedCategories: ['domain-identifiers', 'observed-control-values', 'observation-provenance', 'observation-times', 'approved-change-windows', 'analyst-authored-window-reasons', 'change-history', 'request-metadata', 'bounded-errors'],
        excludedCategories: ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'allowed_bounded',
        retention: 'operator_controlled_output',
        network: 'explicit_bounded_passive_deep',
        sharingReview: 'required',
      },
    ],
    expiryProfiles: [
      {
        id: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        field: null,
        anchor: null,
        handling: 'not_applicable',
        phase: 'not_applicable',
        maximumLifetimeDays: null,
      },
    ],
    consumerEdges: [
      {
        id: 'domain-control-flight-recorder.node-build',
        plane: 'node',
        operation: 'review',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION], mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.input.v1', 'domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.input-wire.v1', 'domain-control-flight-recorder.output-wire.v1'],
        hookIds: ['domain-control-flight-recorder.node.build'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-flight-recorder.sensitive.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-flight-recorder.cli-json-stdout',
        plane: 'cli',
        operation: 'review-json-stdout',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION], mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.input.v1', 'domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.input-wire.v1', 'domain-control-flight-recorder.output-wire.v1', 'domain-control-flight-recorder.cli-command.v1'],
        hookIds: ['domain-control-flight-recorder.node.build', 'domain-control-flight-recorder.node.serialise-json'],
        serialisationProfileId: 'domain-control-flight-recorder.json.v1',
        privacyProfileId: 'domain-control-flight-recorder.sensitive.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-flight-recorder.cli-terminal-stdout',
        plane: 'cli',
        operation: 'review-terminal-stdout',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION], mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.input.v1', 'domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.input-wire.v1', 'domain-control-flight-recorder.output-wire.v1', 'domain-control-flight-recorder.cli-command.v1'],
        hookIds: ['domain-control-flight-recorder.node.build', 'domain-control-flight-recorder.node.format-terminal'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-flight-recorder.sensitive.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'transient_report',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-flight-recorder.cli-json-file',
        plane: 'cli',
        operation: 'review-json-file',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION], mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.input.v1', 'domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.input-wire.v1', 'domain-control-flight-recorder.output-wire.v1', 'domain-control-flight-recorder.cli-command.v1'],
        hookIds: ['domain-control-flight-recorder.node.build', 'domain-control-flight-recorder.node.serialise-json'],
        serialisationProfileId: 'domain-control-flight-recorder.json.v1',
        privacyProfileId: 'domain-control-flight-recorder.sensitive-output.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-flight-recorder.cli-terminal-file',
        plane: 'cli',
        operation: 'review-terminal-file',
        acceptedContracts: [{ schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, versions: [DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION], mode: 'direct' }],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.input.v1', 'domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.input-wire.v1', 'domain-control-flight-recorder.output-wire.v1', 'domain-control-flight-recorder.cli-command.v1'],
        hookIds: ['domain-control-flight-recorder.node.build', 'domain-control-flight-recorder.node.format-terminal'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-flight-recorder.sensitive-output.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-flight-recorder.cli-monitor-embedding',
        plane: 'cli',
        operation: 'embed-after-current-manifest-bounded-passive-monitor',
        acceptedContracts: [],
        emittedContract: { schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, version: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION },
        shapeIds: ['domain-control-flight-recorder.document.v1'],
        boundProfileIds: ['domain-control-flight-recorder.output-wire.v1', 'domain-control-flight-recorder.monitor-action.v1'],
        hookIds: ['domain-control-flight-recorder.node.validate-document', 'domain-control-flight-recorder.cli.monitor'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-flight-recorder.monitor-output.v1',
        expiryPolicyId: 'domain-control-flight-recorder.expiry-not-applicable.v1',
        requestMode: 'explicit_bounded_passive_deep',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
    ],
    consumerRelationships: [],
  },
});
