import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER = 'packages/contracts/external-observation-interchange.mts';

export const EXTERNAL_FINDINGS_SCHEMA = 'whoisleuth.external-findings';
export const EXTERNAL_FINDINGS_VERSION = 5;
export const SUPPORTED_EXTERNAL_FINDINGS_VERSIONS = Object.freeze([4, 5] as const);
export const MAX_EXTERNAL_FINDINGS_IMPORT_BYTES = 384 * 1024;
export const MAX_EXTERNAL_FINDINGS = 100;
export const MAX_EXTERNAL_FINDINGS_PER_DOMAIN = 20;
export const MAX_EXTERNAL_FINDING_DOMAINS = 25;
export const MAX_EXTERNAL_FINDING_LIMITATIONS = 8;
export const MAX_EXTERNAL_FINDING_LIMITATION_LENGTH = 240;

export const EXTERNAL_FINDING_ROWS_SCHEMA = 'whoisleuth.external-finding-rows';
export const EXTERNAL_FINDING_ROWS_VERSION = 1;
export const DOMAIN_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.domain-observation-rows';
export const DNS_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.dns-observation-rows';
export const CERTIFICATE_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.certificate-observation-rows';
export const SUPPORTED_OBSERVATION_ROWS_VERSION = 1;
export const MAX_CONVERSION_INPUT_ROWS = MAX_EXTERNAL_FINDINGS * 4;
export const INFRASTRUCTURE_OBSERVATION_SCHEMA = 'whoisleuth.infrastructure-observation';
export const INFRASTRUCTURE_OBSERVATION_VERSION = 1;
export const MAX_INFRASTRUCTURE_OBSERVATION_BYTES = 128 * 1024;
export const MAX_INFRASTRUCTURE_HOSTS = 128;
export const MAX_INFRASTRUCTURE_DNS_ROWS = 512;
export const MAX_INFRASTRUCTURE_CERTIFICATES = 32;
export const MAX_INFRASTRUCTURE_ROLES = 128;
export const MAX_INFRASTRUCTURE_SOURCES = 16;
export const MAX_INFRASTRUCTURE_LIMITATIONS = 12;
export const INFRASTRUCTURE_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR'] as const;
export const INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA = 'whoisleuth.infrastructure-comparison.input';
export const INFRASTRUCTURE_COMPARISON_INPUT_VERSION = 1;
export const MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES = 2 * MAX_INFRASTRUCTURE_OBSERVATION_BYTES + 1_024;

export const EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/external-findings-import.ts', 'packages/interchange/external-findings-import.mts'],
  ['frontend/src/lib/analysis/external-findings-converters.ts', 'packages/interchange/external-findings-converters.mts'],
] as const);

export const EXTERNAL_FINDINGS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.external-findings', kind: 'export', schema: EXTERNAL_FINDINGS_SCHEMA,
  currentVersion: EXTERNAL_FINDINGS_VERSION, supportedVersions: SUPPORTED_EXTERNAL_FINDINGS_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'none', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Strict local findings import. Historical version 4 is preserved exactly; version 5 adds an optional exact source-qualified infrastructure snapshot. No collection is initiated.',
});

export const EXTERNAL_FINDING_ROWS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'import.external-finding-rows', kind: 'export', schema: EXTERNAL_FINDING_ROWS_SCHEMA,
  currentVersion: EXTERNAL_FINDING_ROWS_VERSION, supportedVersions: [EXTERNAL_FINDING_ROWS_VERSION],
  acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Bounded fixed-column JSON rows converted through the strict findings parser.',
});

export const DOMAIN_OBSERVATION_ROWS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'import.domain-observation-rows', kind: 'export', schema: DOMAIN_OBSERVATION_ROWS_SCHEMA,
  currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [SUPPORTED_OBSERVATION_ROWS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Typed external domain-state observations retained with source-qualified provenance.',
});

export const DNS_OBSERVATION_ROWS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'import.dns-observation-rows', kind: 'export', schema: DNS_OBSERVATION_ROWS_SCHEMA,
  currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [SUPPORTED_OBSERVATION_ROWS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Typed external DNS observations; only valid relational values project graph edges.',
});

export const CERTIFICATE_OBSERVATION_ROWS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'import.certificate-observation-rows', kind: 'export', schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
  currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [SUPPORTED_OBSERVATION_ROWS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Typed external certificate observations requiring an exact SHA-256 fingerprint.',
});

export const EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY = Object.freeze([
  EXTERNAL_FINDINGS_COMPATIBILITY,
  EXTERNAL_FINDING_ROWS_COMPATIBILITY,
  DOMAIN_OBSERVATION_ROWS_COMPATIBILITY,
  DNS_OBSERVATION_ROWS_COMPATIBILITY,
  CERTIFICATE_OBSERVATION_ROWS_COMPATIBILITY,
  defineSchemaCompatibility({ id: 'export.infrastructure-observation', kind: 'export', schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, currentVersion: 1, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_INFRASTRUCTURE_OBSERVATION_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER, note: 'Exact source-qualified selected infrastructure evidence retained through existing Case pins. Wildcards, DNS outcomes and independent provider roles remain distinct.' }),
  defineSchemaCompatibility({ id: 'cli.infrastructure-comparison-input', kind: 'cli_document', schema: INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, currentVersion: 1, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER, note: 'An explicit earlier/later snapshot pair reviewed offline without collection, persistence or current absence claims.' }),
]);

const EXTERNAL_INTERCHANGE_FIXTURES = Object.freeze([
  { id: 'external-findings-v4', path: 'test/fixtures/external-observation-interchange/external-findings-v4.json', bytes: 634, sha256: 'ceab916e1dcf99704c94e1b0cd82f5a061f138ae6a07ce8335273080c73b7624', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'historical' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'external-finding-rows-v1', path: 'test/fixtures/external-observation-interchange/external-finding-rows-v1.json', bytes: 435, sha256: '09048325d801fdc837134580fd887cacde28744c9f87a43afc388c96117a4659', schema: EXTERNAL_FINDING_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'external-finding-rows-v1-output-v5' },
  { id: 'external-finding-rows-v1-output', path: 'test/fixtures/external-observation-interchange/external-finding-rows-v1-output.json', bytes: 581, sha256: '7f84a9f6177d3245acd6fc21275276694fbe9e8cd94922b1e6997a73afa3149a', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'historical' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'domain-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/domain-observation-rows-v1.json', bytes: 390, sha256: '2f95ab21e57e1a6aaab03cea75a4d58fd9e1234ba87f5268a899b23103359474', schema: DOMAIN_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'domain-observation-rows-v1-output-v5' },
  { id: 'domain-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/domain-observation-rows-v1-output.json', bytes: 1_027, sha256: 'bba949308e9bb5b58bf5611d6dec23f074979522627631948cffc2f0056ac817', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'historical' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'dns-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/dns-observation-rows-v1.json', bytes: 369, sha256: 'afb1808a8a81339a1801d337259c19c77ed957583b4ae06579b38ea6a8f68ed1', schema: DNS_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'dns-observation-rows-v1-output-v5' },
  { id: 'dns-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/dns-observation-rows-v1-output.json', bytes: 988, sha256: '4c9a49b96181d2907eb95319d15975758823994fe029c051486f1cb6869221a0', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'historical' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'certificate-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/certificate-observation-rows-v1.json', bytes: 515, sha256: '68363a5fe074b08a386dbc95a0993a2933ebcf05ba2f96148df632842d1c5869', schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'certificate-observation-rows-v1-output-v5' },
  { id: 'certificate-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/certificate-observation-rows-v1-output.json', bytes: 1_244, sha256: '6c484601b872f10bfdb7d9519d4b216f14ef277e7a429e4cc131154ad0e07652', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'historical' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'external-finding-rows-v1-output-v5', path: 'test/fixtures/external-observation-interchange/external-finding-rows-v1-output-v5.json', bytes: 442, sha256: '9996be2b9d832fca9aa523a1a424148ef762483ab3923d35ca73e83cd16a8195', schema: EXTERNAL_FINDINGS_SCHEMA, version: 5, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'domain-observation-rows-v1-output-v5', path: 'test/fixtures/external-observation-interchange/domain-observation-rows-v1-output-v5.json', bytes: 771, sha256: 'd375353576b5990e835d53c14bf7fa5adb5205191d3969478a69ec68b5e1291b', schema: EXTERNAL_FINDINGS_SCHEMA, version: 5, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'dns-observation-rows-v1-output-v5', path: 'test/fixtures/external-observation-interchange/dns-observation-rows-v1-output-v5.json', bytes: 732, sha256: '532ff6ac9e9255f14105eb0a0286434fadb94f6d7397f0fb96007ebb6b7d1522', schema: EXTERNAL_FINDINGS_SCHEMA, version: 5, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'certificate-observation-rows-v1-output-v5', path: 'test/fixtures/external-observation-interchange/certificate-observation-rows-v1-output-v5.json', bytes: 988, sha256: '09904df103f83f64616556e653fa14c6f2f1dc392b1f75a85fd3099680840e37', schema: EXTERNAL_FINDINGS_SCHEMA, version: 5, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'external-findings-v5', path: 'test/fixtures/external-observation-interchange/external-findings-v5.json', bytes: 3871, sha256: 'debd062c2d951d22c06c29bb076529fa69a2769b8bae7269ce3884550fb55ba3', schema: EXTERNAL_FINDINGS_SCHEMA, version: 5, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'infrastructure-comparison-input-v1', path: 'test/fixtures/infrastructure-observations/infrastructure-comparison-input-v1.json', bytes: 6284, sha256: 'ef0022faf29586774bd1b2de1f95eb3839d382e424c7b3d446e4dc1058437104', schema: INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, version: 1, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'infrastructure-observation-v1', path: 'test/fixtures/infrastructure-observations/infrastructure-observation-v1.json', bytes: 3430, sha256: '1b76e43e5d5c889654faf12114217994c5cbd3a378685e7f9b9d18ebdde801f7', schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, version: 1, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
].map((fixture) => Object.freeze({
  ...fixture,
  contentDigestSha256: null,
  scope: 'repository' as const,
})));

function externalFixtureIds(schema: string, version: number): readonly string[] {
  return Object.freeze(EXTERNAL_INTERCHANGE_FIXTURES
    .filter((fixture) => fixture.schema === schema && fixture.version === version)
    .map((fixture) => fixture.id));
}

const EXTERNAL_INTERCHANGE_CONTRACTS = Object.freeze([
  ...([['export.infrastructure-observation', INFRASTRUCTURE_OBSERVATION_SCHEMA, true, MAX_INFRASTRUCTURE_OBSERVATION_BYTES], ['cli.infrastructure-comparison-input', INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, false, MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES]] as const).map(([compatibilityId, schema, emitted, byteBudget]) => Object.freeze({ compatibilityId, schema, version: 1, role: 'document' as const, lifecycle: 'current' as const, readable: true, emitted, exactKeys: true, extensionPolicy: 'reject' as const, futureVersionBehaviour: 'reject' as const, migrationTarget: null, canonicalisation: null, byteBudget, fixtureIds: externalFixtureIds(schema, 1) })),
  ...SUPPORTED_EXTERNAL_FINDINGS_VERSIONS.map((version) => Object.freeze({
    compatibilityId: EXTERNAL_FINDINGS_COMPATIBILITY.id,
    schema: EXTERNAL_FINDINGS_SCHEMA,
    version,
    role: 'document' as const,
    lifecycle: version === EXTERNAL_FINDINGS_VERSION ? 'current' as const : 'legacy' as const,
    readable: true,
    emitted: version === EXTERNAL_FINDINGS_VERSION,
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    futureVersionBehaviour: 'reject' as const,
    migrationTarget: null,
    canonicalisation: null,
    byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    fixtureIds: externalFixtureIds(EXTERNAL_FINDINGS_SCHEMA, version),
  })),
  ...([
    [EXTERNAL_FINDING_ROWS_COMPATIBILITY.id, EXTERNAL_FINDING_ROWS_SCHEMA],
    [DOMAIN_OBSERVATION_ROWS_COMPATIBILITY.id, DOMAIN_OBSERVATION_ROWS_SCHEMA],
    [DNS_OBSERVATION_ROWS_COMPATIBILITY.id, DNS_OBSERVATION_ROWS_SCHEMA],
    [CERTIFICATE_OBSERVATION_ROWS_COMPATIBILITY.id, CERTIFICATE_OBSERVATION_ROWS_SCHEMA],
  ] as const).map(([compatibilityId, schema]) => Object.freeze({
    compatibilityId,
    schema,
    version: 1,
    role: 'input' as const,
    lifecycle: 'current' as const,
    readable: true,
    emitted: false,
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    futureVersionBehaviour: 'reject' as const,
    migrationTarget: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
    canonicalisation: null,
    byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
    fixtureIds: externalFixtureIds(schema, 1),
  })),
]);

function externalShape(
  id: string,
  schema: string,
  versions: readonly number[],
  requiredKeys: readonly string[],
  normalisation: 'input_to_current' | 'preserve_document',
) {
  return Object.freeze({
    id,
    schema,
    versions,
    objects: [{ path: '$', requiredKeys, optionalKeys: [], unknownKeys: 'reject' as const }],
    fixedArrays: [],
    normalisation,
    target: normalisation === 'input_to_current'
      ? { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION }
      : null,
  });
}

const externalConsumerCommon = Object.freeze({
  expiryPolicyId: 'external-interchange.expiry.not-applicable',
  requestMode: 'none' as const,
  bindingState: 'declared_unenforced' as const,
  policyState: 'current' as const,
});

export const EXTERNAL_OBSERVATION_INTERCHANGE_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'external-observation-interchange',
  owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  privacy: 'analyst_authored_sensitive',
  compatibility: EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY,
  contracts: EXTERNAL_INTERCHANGE_CONTRACTS,
  fixtures: EXTERNAL_INTERCHANGE_FIXTURES,
  metadata: {
    enforcement: 'declarative_only',
    shapes: [
      externalShape('external-interchange.findings.v4', EXTERNAL_FINDINGS_SCHEMA, [4], ['schema', 'schemaVersion', 'source', 'findings'], 'preserve_document'),
      externalShape('external-interchange.findings.v5', EXTERNAL_FINDINGS_SCHEMA, [5], ['schema', 'schemaVersion', 'source', 'findings'], 'preserve_document'),
      externalShape('external-interchange.infrastructure.v1', INFRASTRUCTURE_OBSERVATION_SCHEMA, [1], ['schema', 'version', 'id', 'target', 'observedAt', 'mode', 'scope', 'coverage', 'sources', 'dns', 'certificates', 'roles', 'limitations'], 'preserve_document'),
      externalShape('external-interchange.infrastructure-comparison.v1', INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, [1], ['schema', 'version', 'earlier', 'later'], 'preserve_document'),
      externalShape('external-interchange.finding-rows.v1', EXTERNAL_FINDING_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'rows'], 'input_to_current'),
      externalShape('external-interchange.domain-rows.v1', DOMAIN_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
      externalShape('external-interchange.dns-rows.v1', DNS_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
      externalShape('external-interchange.certificate-rows.v1', CERTIFICATE_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
    ],
    boundProfiles: [{ id: 'external-interchange.infrastructure.bounds', bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_INFRASTRUCTURE_OBSERVATION_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_INFRASTRUCTURE_OBSERVATION_BYTES, handling: 'reject' },
      { id: 'hostnames', path: 'scope.hostnames', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_INFRASTRUCTURE_HOSTS, handling: 'reject' },
      { id: 'dns-rows', path: 'dns', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_INFRASTRUCTURE_DNS_ROWS, handling: 'reject' },
      { id: 'certificate-rows', path: 'certificates', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_INFRASTRUCTURE_CERTIFICATES, handling: 'reject' },
      { id: 'role-rows', path: 'roles', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_INFRASTRUCTURE_ROLES, handling: 'reject' },
      { id: 'sources', path: 'sources', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_INFRASTRUCTURE_SOURCES, handling: 'reject' },
      { id: 'dns-types', path: 'scope.dnsTypes', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: INFRASTRUCTURE_DNS_TYPES.length, handling: 'reject' },
      { id: 'limitations', path: 'limitations', phase: 'pre_accumulation', unit: 'items', minimum: 0, maximum: MAX_INFRASTRUCTURE_LIMITATIONS, handling: 'reject' },
    ] }, { id: 'external-interchange.infrastructure-comparison.bounds', bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES, handling: 'reject' },
    ] }, { id: 'external-interchange.document.bounds', bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, handling: 'reject' },
      { id: 'rows', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_CONVERSION_INPUT_ROWS, handling: 'reject' },
    ] }],
    hooks: [
      { id: 'external-interchange.infrastructure.read', role: 'normaliser', runtime: 'shared', module: 'packages/investigation/infrastructure-observation.mts', exportName: 'readInfrastructureObservation' },
      { id: 'external-interchange.infrastructure.serialise', role: 'serialiser', runtime: 'shared', module: 'packages/investigation/infrastructure-observation.mts', exportName: 'serialiseInfrastructureObservation' },
      { id: 'external-interchange.infrastructure.convert', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-converters.mts', exportName: 'convertInfrastructureObservation' },
      { id: 'external-interchange.infrastructure.compare', role: 'normaliser', runtime: 'cli', module: 'cli/offline-evidence-review.mts', exportName: 'buildOfflineEvidenceReview' },
      { id: 'external-interchange.findings.normalise', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'parseExternalFindingsDocument' },
      { id: 'external-interchange.findings.serialise', role: 'serialiser', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'serializeExternalFindingsDocument' },
      { id: 'external-interchange.finding-rows.convert', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-converters.mts', exportName: 'convertExternalFindingRows' },
      { id: 'external-interchange.observation-rows.convert', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-converters.mts', exportName: 'convertSupportedExternalFindings' },
      { id: 'external-interchange.findings.merge', role: 'merger', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'mergeExternalFindingsIntoCases' },
    ],
    serialisationProfiles: [{
      id: 'external-interchange.findings.json.v5', schema: EXTERNAL_FINDINGS_SCHEMA,
      versions: [5], mediaType: 'application/json', encoding: 'utf-8', bom: false,
      indentSpaces: 0, terminalLf: true, propertyOrder: 'normalised_fixed', canonicalisation: null, integrity: 'none',
      serializerHookId: 'external-interchange.findings.serialise', verifierHookIds: [],
    }, {
      id: 'external-interchange.infrastructure.json.v1', schema: INFRASTRUCTURE_OBSERVATION_SCHEMA,
      versions: [1], mediaType: 'application/json', encoding: 'utf-8', bom: false,
      indentSpaces: 0, terminalLf: true, propertyOrder: 'normalised_fixed', canonicalisation: null, integrity: 'none',
      serializerHookId: 'external-interchange.infrastructure.serialise', verifierHookIds: [],
    }],
    privacyProfiles: [
      { id: 'external-interchange.privacy.transient', classification: 'analyst_authored_sensitive', projection: 'browser_import', includedCategories: ['source-attribution', 'bounded-observations', 'completeness', 'limitations'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'discarded', retention: 'transient_report', network: 'none', sharingReview: 'required' },
      { id: 'external-interchange.privacy.case-merge', classification: 'analyst_authored_sensitive', projection: 'browser_import', includedCategories: ['source-attribution', 'bounded-observations', 'completeness', 'limitations'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'discarded', retention: 'browser_indexeddb', network: 'none', sharingReview: 'not_applicable' },
    ],
    expiryProfiles: [{ id: 'external-interchange.expiry.not-applicable', field: null, anchor: null, handling: 'not_applicable', phase: 'not_applicable', maximumLifetimeDays: null }],
    consumerEdges: [
      {
        id: 'external-interchange.consumer.infrastructure-read', plane: 'shared', operation: 'read-and-export-exact-infrastructure-snapshot',
        acceptedContracts: [{ schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, versions: [1], mode: 'direct' }], emittedContract: { schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, version: 1 },
        shapeIds: ['external-interchange.infrastructure.v1'], boundProfileIds: ['external-interchange.infrastructure.bounds'], hookIds: ['external-interchange.infrastructure.read', 'external-interchange.infrastructure.serialise'], serialisationProfileId: 'external-interchange.infrastructure.json.v1', privacyProfileId: 'external-interchange.privacy.transient', retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.infrastructure-convert', plane: 'shared', operation: 'convert-exact-snapshot-to-one-finding',
        acceptedContracts: [{ schema: INFRASTRUCTURE_OBSERVATION_SCHEMA, versions: [1], mode: 'direct' }], emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: 5 },
        shapeIds: ['external-interchange.infrastructure.v1', 'external-interchange.findings.v5'], boundProfileIds: ['external-interchange.infrastructure.bounds', 'external-interchange.document.bounds'], hookIds: ['external-interchange.infrastructure.convert', 'external-interchange.findings.serialise'], serialisationProfileId: 'external-interchange.findings.json.v5', privacyProfileId: 'external-interchange.privacy.transient', retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.infrastructure-compare', plane: 'cli', operation: 'offline-infrastructure-comparison',
        acceptedContracts: [{ schema: INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, versions: [1], mode: 'direct' }], emittedContract: null,
        shapeIds: ['external-interchange.infrastructure-comparison.v1'], boundProfileIds: ['external-interchange.infrastructure-comparison.bounds'], hookIds: ['external-interchange.infrastructure.compare'], serialisationProfileId: null, privacyProfileId: 'external-interchange.privacy.transient', retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.findings-v4-read', plane: 'shared', operation: 'preserve-historical-findings',
        acceptedContracts: [{ schema: EXTERNAL_FINDINGS_SCHEMA, versions: [4], mode: 'direct' }], emittedContract: null,
        shapeIds: ['external-interchange.findings.v4'], boundProfileIds: ['external-interchange.document.bounds'], hookIds: ['external-interchange.findings.normalise'], serialisationProfileId: null, privacyProfileId: 'external-interchange.privacy.transient', retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.findings-normalise', plane: 'shared', operation: 'normalise-strict-findings',
        acceptedContracts: [{ schema: EXTERNAL_FINDINGS_SCHEMA, versions: [5], mode: 'direct' }],
        emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
        shapeIds: ['external-interchange.findings.v5'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.findings.normalise', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v5', privacyProfileId: 'external-interchange.privacy.transient',
        retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.finding-rows', plane: 'shared', operation: 'convert-finding-rows',
        acceptedContracts: [{ schema: EXTERNAL_FINDING_ROWS_SCHEMA, versions: [1], mode: 'direct' }],
        emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
        shapeIds: ['external-interchange.finding-rows.v1', 'external-interchange.findings.v5'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.finding-rows.convert', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v5', privacyProfileId: 'external-interchange.privacy.transient',
        retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.observation-rows', plane: 'shared', operation: 'convert-observation-rows',
        acceptedContracts: [
          { schema: DOMAIN_OBSERVATION_ROWS_SCHEMA, versions: [1], mode: 'direct' },
          { schema: DNS_OBSERVATION_ROWS_SCHEMA, versions: [1], mode: 'direct' },
          { schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA, versions: [1], mode: 'direct' },
        ],
        emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
        shapeIds: ['external-interchange.domain-rows.v1', 'external-interchange.dns-rows.v1', 'external-interchange.certificate-rows.v1', 'external-interchange.findings.v5'],
        boundProfileIds: ['external-interchange.document.bounds'], hookIds: ['external-interchange.observation-rows.convert', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v5', privacyProfileId: 'external-interchange.privacy.transient',
        retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.case-merge', plane: 'shared', operation: 'non-destructive-case-merge',
        acceptedContracts: [{ schema: EXTERNAL_FINDINGS_SCHEMA, versions: [...SUPPORTED_EXTERNAL_FINDINGS_VERSIONS], mode: 'direct' }], emittedContract: null,
        shapeIds: ['external-interchange.findings.v4', 'external-interchange.findings.v5'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.findings.merge'], serialisationProfileId: null,
        privacyProfileId: 'external-interchange.privacy.case-merge', retentionEffect: 'browser_indexeddb', ...externalConsumerCommon,
      },
    ],
    consumerRelationships: [],
  },
});
