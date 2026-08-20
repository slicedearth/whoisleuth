import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const CLI_DOMAIN_CONTROL_MONITOR_SCHEMA = 'whoisleuth.cli.domain-control-monitor';
export const CLI_DOMAIN_CONTROL_MONITOR_VERSION = 1;

export const MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH = 48;
export const MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS = 50_000;
export const MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES = 100_000;
export const MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS = 10_000;
export const MIN_DOMAIN_CONTROL_MONITOR_DOMAINS = 1;
export const MAX_DOMAIN_CONTROL_MONITOR_DOMAINS = 20;
export const MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY = 1;
export const MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY = 3;
export const MAX_DOMAIN_CONTROL_MONITOR_FAILURES = MAX_DOMAIN_CONTROL_MONITOR_DOMAINS;
export const MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH = 300;

export const DOMAIN_CONTROL_MONITOR_ROOT_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'manifest',
  'collection',
  'observations',
  'review',
  'flightRecorder',
  'limitations',
] as const);
export const DOMAIN_CONTROL_MONITOR_MANIFEST_KEYS = Object.freeze([
  'digestSha256',
  'expiresAt',
] as const);
export const DOMAIN_CONTROL_MONITOR_COLLECTION_KEYS = Object.freeze([
  'requested',
  'succeeded',
  'failed',
  'failures',
] as const);
export const DOMAIN_CONTROL_MONITOR_FAILURE_KEYS = Object.freeze([
  'domain',
  'error',
] as const);
export const DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES = Object.freeze([
  'Lookup failed',
] as const);
export const DOMAIN_CONTROL_MONITOR_LIMITATIONS = Object.freeze([
  'This is one bounded run, not a daemon. Scheduling and secure checkpoint retention remain operator-controlled.',
  'The output retains compact normalised observations and errors, not raw RDAP, WHOIS, DNS, HTTP, TLS or page payloads.',
  'A failed source or lookup remains incomplete and does not establish that a previously observed value disappeared.',
] as const);

export const DOMAIN_CONTROL_MONITOR_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.domain-control-monitor',
  kind: 'cli_document',
  schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
  currentVersion: CLI_DOMAIN_CONTROL_MONITOR_VERSION,
  supportedVersions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: null,
  owner: 'packages/contracts/domain-control-monitor.mts',
  note: 'One-shot bounded control review and optional exact monitor checkpoint whose validated observation projection is reused; not a daemon or scheduler.',
});

export const DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE = defineSchemaLifecycleFamily({
  id: 'domain-control-monitor',
  owner: 'packages/contracts/domain-control-monitor.mts',
  privacy: 'analyst_authored_sensitive',
  compatibility: [DOMAIN_CONTROL_MONITOR_COMPATIBILITY],
  contracts: [
    {
      compatibilityId: DOMAIN_CONTROL_MONITOR_COMPATIBILITY.id,
      schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
      version: CLI_DOMAIN_CONTROL_MONITOR_VERSION,
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
      fixtureIds: ['domain-control-monitor-v1'],
    },
  ],
  fixtures: [
    {
      id: 'domain-control-monitor-v1',
      path: 'test/fixtures/domain-control-monitor-v1.json',
      bytes: 7_332,
      sha256: '1b505015fbc4cb6fc10b8d1c4552762fc78a21bea2f6614761e34d03f290ffb4',
      contentDigestSha256: null,
      schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
      version: CLI_DOMAIN_CONTROL_MONITOR_VERSION,
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
        id: 'domain-control-monitor.document.v1',
        schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
        versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION],
        objects: [
          { path: '$', requiredKeys: DOMAIN_CONTROL_MONITOR_ROOT_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.manifest', requiredKeys: DOMAIN_CONTROL_MONITOR_MANIFEST_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.collection', requiredKeys: DOMAIN_CONTROL_MONITOR_COLLECTION_KEYS, optionalKeys: [], unknownKeys: 'reject' },
          { path: '$.collection.failures[]', requiredKeys: DOMAIN_CONTROL_MONITOR_FAILURE_KEYS, optionalKeys: [], unknownKeys: 'reject' },
        ],
        fixedArrays: [{ path: '$.limitations', values: DOMAIN_CONTROL_MONITOR_LIMITATIONS }],
        normalisation: 'preserve_document',
        target: null,
      },
    ],
    boundProfiles: [
      {
        id: 'domain-control-monitor.document-bounds.v1',
        bounds: [
          { id: 'observations', path: '$.observations', phase: 'normalised', unit: 'items', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'requested', path: '$.collection.requested', phase: 'normalised', unit: 'integer', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'succeeded', path: '$.collection.succeeded', phase: 'normalised', unit: 'integer', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'failed', path: '$.collection.failed', phase: 'normalised', unit: 'integer', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MONITOR_FAILURES, handling: 'reject' },
          { id: 'failures', path: '$.collection.failures', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MONITOR_FAILURES, handling: 'reject' },
          { id: 'failure-error', path: '$.collection.failures[].error', phase: 'normalised', unit: 'characters', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-monitor.cli-intake.v1',
        bounds: [
          { id: 'manifest-raw-bytes', path: '$.manifestInput', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES, handling: 'reject' },
          { id: 'previous-raw-bytes', path: '$.previousInput', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES, handling: 'reject' },
          { id: 'json-container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-monitor.action.v1',
        bounds: [
          { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
          { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, maximum: MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY, handling: 'reject' },
        ],
      },
    ],
    hooks: [
      { id: 'domain-control-monitor.cli.run', role: 'monitor', runtime: 'cli', module: 'cli/domain-control-monitor.mts', exportName: 'runDomainControlMonitor' },
      { id: 'domain-control-monitor.cli.serialise-json', role: 'serialiser', runtime: 'cli', module: 'cli/formatters/json.mts', exportName: 'formatJsonDocument' },
      { id: 'domain-control-monitor.cli.format-terminal', role: 'serialiser', runtime: 'cli', module: 'cli/domain-control-monitor.mts', exportName: 'formatDomainControlMonitor' },
      { id: 'domain-control-monitor.cli.format-junit', role: 'serialiser', runtime: 'cli', module: 'cli/ci-report.mts', exportName: 'formatCliJunit' },
    ],
    serialisationProfiles: [
      {
        id: 'domain-control-monitor.json.v1',
        schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
        versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION],
        mediaType: 'application/json',
        encoding: 'utf-8',
        bom: false,
        indentSpaces: 2,
        terminalLf: true,
        propertyOrder: 'normalised_fixed',
        canonicalisation: null,
        integrity: 'none',
        serializerHookId: 'domain-control-monitor.cli.serialise-json',
        verifierHookIds: [],
      },
    ],
    privacyProfiles: [
      {
        id: 'domain-control-monitor.sensitive-run.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'bounded_passive_monitor',
        includedCategories: ['domain-identifiers', 'desired-control-values', 'observed-control-values', 'observation-provenance', 'observation-times', 'manifest-digest-and-expiry', 'review-results', 'change-history', 'request-metadata', 'bounded-errors'],
        excludedCategories: ['raw-upstream-payloads', 'analyst-notes', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'not_applicable',
        retention: 'operator_controlled_output',
        network: 'explicit_bounded_passive_deep',
        sharingReview: 'required',
      },
      {
        id: 'domain-control-monitor.sensitive-document.v1',
        classification: 'analyst_authored_sensitive',
        projection: 'bounded_passive_monitor',
        includedCategories: ['domain-identifiers', 'desired-control-values', 'observed-control-values', 'observation-provenance', 'observation-times', 'manifest-digest-and-expiry', 'review-results', 'change-history', 'request-metadata', 'bounded-errors'],
        excludedCategories: ['raw-upstream-payloads', 'analyst-notes', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'not_applicable',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'required',
      },
      {
        id: 'domain-control-monitor.metadata-output.v1',
        classification: 'metadata_only',
        projection: 'metadata_only',
        includedCategories: ['collection-counts', 'review-state', 'change-counts'],
        excludedCategories: ['domain-identifiers', 'desired-control-values', 'observed-control-values', 'observation-provenance', 'observation-times', 'raw-upstream-payloads', 'analyst-notes', 'contacts', 'credentials', 'cookies', 'sessions'],
        notePolicy: 'not_applicable',
        retention: 'operator_controlled_output',
        network: 'none',
        sharingReview: 'not_applicable',
      },
    ],
    expiryProfiles: [
      {
        id: 'domain-control-monitor.expiry.not-applicable.v1',
        field: null,
        anchor: null,
        handling: 'not_applicable',
        phase: 'not_applicable',
        maximumLifetimeDays: null,
      },
    ],
    consumerEdges: [
      {
        id: 'domain-control-monitor.cli-run',
        plane: 'cli',
        operation: 'bounded-passive-deep-monitor',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION], mode: 'direct' }],
        emittedContract: { schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, version: CLI_DOMAIN_CONTROL_MONITOR_VERSION },
        shapeIds: ['domain-control-monitor.document.v1'],
        boundProfileIds: ['domain-control-monitor.document-bounds.v1', 'domain-control-monitor.cli-intake.v1', 'domain-control-monitor.action.v1'],
        hookIds: ['domain-control-monitor.cli.run'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-monitor.sensitive-run.v1',
        expiryPolicyId: 'domain-control-monitor.expiry.not-applicable.v1',
        requestMode: 'explicit_bounded_passive_deep',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-monitor.cli-json',
        plane: 'cli',
        operation: 'serialise-json',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION], mode: 'direct' }],
        emittedContract: null,
        shapeIds: ['domain-control-monitor.document.v1'],
        boundProfileIds: ['domain-control-monitor.document-bounds.v1'],
        hookIds: ['domain-control-monitor.cli.serialise-json'],
        serialisationProfileId: 'domain-control-monitor.json.v1',
        privacyProfileId: 'domain-control-monitor.sensitive-document.v1',
        expiryPolicyId: 'domain-control-monitor.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-monitor.cli-terminal',
        plane: 'cli',
        operation: 'format-terminal',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION], mode: 'direct' }],
        emittedContract: null,
        shapeIds: ['domain-control-monitor.document.v1'],
        boundProfileIds: ['domain-control-monitor.document-bounds.v1'],
        hookIds: ['domain-control-monitor.cli.format-terminal'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-monitor.metadata-output.v1',
        expiryPolicyId: 'domain-control-monitor.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
      {
        id: 'domain-control-monitor.cli-junit',
        plane: 'cli',
        operation: 'format-junit',
        acceptedContracts: [{ schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, versions: [CLI_DOMAIN_CONTROL_MONITOR_VERSION], mode: 'direct' }],
        emittedContract: null,
        shapeIds: ['domain-control-monitor.document.v1'],
        boundProfileIds: ['domain-control-monitor.document-bounds.v1'],
        hookIds: ['domain-control-monitor.cli.format-junit'],
        serialisationProfileId: null,
        privacyProfileId: 'domain-control-monitor.metadata-output.v1',
        expiryPolicyId: 'domain-control-monitor.expiry.not-applicable.v1',
        requestMode: 'none',
        retentionEffect: 'operator_controlled_output',
        bindingState: 'declared_unenforced',
        policyState: 'current',
      },
    ],
    consumerRelationships: [
      {
        id: 'domain-control-monitor.composes-manifest-monitor',
        sourceConsumerId: 'domain-control-monitor.cli-run',
        targetConsumerId: 'domain-control.cli-monitor',
        relationship: 'composes',
      },
      {
        id: 'domain-control-monitor.composes-review-monitor',
        sourceConsumerId: 'domain-control-monitor.cli-run',
        targetConsumerId: 'domain-control-review.cli-monitor-embedding',
        relationship: 'composes',
      },
      {
        id: 'domain-control-monitor.composes-flight-recorder-monitor',
        sourceConsumerId: 'domain-control-monitor.cli-run',
        targetConsumerId: 'domain-control-flight-recorder.cli-monitor-embedding',
        relationship: 'composes',
      },
    ],
  },
});
