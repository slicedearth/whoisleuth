import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER = 'packages/contracts/external-observation-interchange.mts';

export const EXTERNAL_FINDINGS_SCHEMA = 'whoisleuth.external-findings';
export const EXTERNAL_FINDINGS_VERSION = 4;
export const SUPPORTED_EXTERNAL_FINDINGS_VERSIONS = Object.freeze([EXTERNAL_FINDINGS_VERSION] as const);
export const MAX_EXTERNAL_FINDINGS_IMPORT_BYTES = 384 * 1024;
export const MAX_EXTERNAL_FINDINGS = 100;
export const MAX_EXTERNAL_FINDINGS_PER_DOMAIN = 20;
export const MAX_EXTERNAL_FINDING_DOMAINS = 25;

export const EXTERNAL_FINDING_ROWS_SCHEMA = 'whoisleuth.external-finding-rows';
export const EXTERNAL_FINDING_ROWS_VERSION = 1;
export const DOMAIN_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.domain-observation-rows';
export const DNS_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.dns-observation-rows';
export const CERTIFICATE_OBSERVATION_ROWS_SCHEMA = 'whoisleuth.certificate-observation-rows';
export const SUPPORTED_OBSERVATION_ROWS_VERSION = 1;
export const MAX_CONVERSION_INPUT_ROWS = MAX_EXTERNAL_FINDINGS * 4;

export const EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/external-findings-import.ts', 'packages/interchange/external-findings-import.mts'],
  ['frontend/src/lib/analysis/external-findings-converters.ts', 'packages/interchange/external-findings-converters.mts'],
] as const);

export const EXTERNAL_FINDINGS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.external-findings', kind: 'export', schema: EXTERNAL_FINDINGS_SCHEMA,
  currentVersion: EXTERNAL_FINDINGS_VERSION, supportedVersions: SUPPORTED_EXTERNAL_FINDINGS_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: EXTERNAL_OBSERVATION_INTERCHANGE_CONTRACT_OWNER,
  note: 'Strict local findings import. Version 4 can retain bounded certificate event identity and name-completeness metadata while analyst assertions remain a separate case workflow.',
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
]);

const EXTERNAL_INTERCHANGE_FIXTURES = Object.freeze([
  { id: 'external-findings-v4', path: 'test/fixtures/external-observation-interchange/external-findings-v4.json', bytes: 634, sha256: 'ceab916e1dcf99704c94e1b0cd82f5a061f138ae6a07ce8335273080c73b7624', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'external-finding-rows-v1', path: 'test/fixtures/external-observation-interchange/external-finding-rows-v1.json', bytes: 435, sha256: '09048325d801fdc837134580fd887cacde28744c9f87a43afc388c96117a4659', schema: EXTERNAL_FINDING_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'external-finding-rows-v1-output' },
  { id: 'external-finding-rows-v1-output', path: 'test/fixtures/external-observation-interchange/external-finding-rows-v1-output.json', bytes: 581, sha256: '7f84a9f6177d3245acd6fc21275276694fbe9e8cd94922b1e6997a73afa3149a', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'domain-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/domain-observation-rows-v1.json', bytes: 390, sha256: '2f95ab21e57e1a6aaab03cea75a4d58fd9e1234ba87f5268a899b23103359474', schema: DOMAIN_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'domain-observation-rows-v1-output' },
  { id: 'domain-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/domain-observation-rows-v1-output.json', bytes: 1_027, sha256: 'bba949308e9bb5b58bf5611d6dec23f074979522627631948cffc2f0056ac817', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'dns-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/dns-observation-rows-v1.json', bytes: 369, sha256: 'afb1808a8a81339a1801d337259c19c77ed957583b4ae06579b38ea6a8f68ed1', schema: DNS_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'dns-observation-rows-v1-output' },
  { id: 'dns-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/dns-observation-rows-v1-output.json', bytes: 988, sha256: '4c9a49b96181d2907eb95319d15975758823994fe029c051486f1cb6869221a0', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
  { id: 'certificate-observation-rows-v1', path: 'test/fixtures/external-observation-interchange/certificate-observation-rows-v1.json', bytes: 515, sha256: '68363a5fe074b08a386dbc95a0993a2933ebcf05ba2f96148df632842d1c5869', schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA, version: 1, role: 'input' as const, expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'certificate-observation-rows-v1-output' },
  { id: 'certificate-observation-rows-v1-output', path: 'test/fixtures/external-observation-interchange/certificate-observation-rows-v1-output.json', bytes: 1_244, sha256: '6c484601b872f10bfdb7d9519d4b216f14ef277e7a429e4cc131154ad0e07652', schema: EXTERNAL_FINDINGS_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null },
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
    migrationTarget: version === EXTERNAL_FINDINGS_VERSION ? null : { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
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
    metadataVersion: 3,
    enforcement: 'declarative_only',
    shapes: [
      externalShape('external-interchange.findings.v4', EXTERNAL_FINDINGS_SCHEMA, [...SUPPORTED_EXTERNAL_FINDINGS_VERSIONS], ['schema', 'schemaVersion', 'source', 'findings'], 'preserve_document'),
      externalShape('external-interchange.finding-rows.v1', EXTERNAL_FINDING_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'rows'], 'input_to_current'),
      externalShape('external-interchange.domain-rows.v1', DOMAIN_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
      externalShape('external-interchange.dns-rows.v1', DNS_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
      externalShape('external-interchange.certificate-rows.v1', CERTIFICATE_OBSERVATION_ROWS_SCHEMA, [1], ['schema', 'schemaVersion', 'source', 'observations'], 'input_to_current'),
    ],
    boundProfiles: [{ id: 'external-interchange.document.bounds', bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, handling: 'reject' },
      { id: 'rows', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_CONVERSION_INPUT_ROWS, handling: 'reject' },
    ] }],
    hooks: [
      { id: 'external-interchange.findings.normalise', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'parseExternalFindingsDocument' },
      { id: 'external-interchange.findings.serialise', role: 'serialiser', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'serializeExternalFindingsDocument' },
      { id: 'external-interchange.finding-rows.convert', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-converters.mts', exportName: 'convertExternalFindingRows' },
      { id: 'external-interchange.observation-rows.convert', role: 'normaliser', runtime: 'shared', module: 'packages/interchange/external-findings-converters.mts', exportName: 'convertSupportedExternalFindings' },
      { id: 'external-interchange.findings.merge', role: 'merger', runtime: 'shared', module: 'packages/interchange/external-findings-import.mts', exportName: 'mergeExternalFindingsIntoCases' },
    ],
    serialisationProfiles: [{
      id: 'external-interchange.findings.json.v4', schema: EXTERNAL_FINDINGS_SCHEMA,
      versions: [...SUPPORTED_EXTERNAL_FINDINGS_VERSIONS], mediaType: 'application/json', encoding: 'utf-8', bom: false,
      indentSpaces: 2, terminalLf: true, propertyOrder: 'normalised_fixed', canonicalisation: null, integrity: 'none',
      serializerHookId: 'external-interchange.findings.serialise', verifierHookIds: [],
    }],
    privacyProfiles: [
      { id: 'external-interchange.privacy.transient', classification: 'analyst_authored_sensitive', projection: 'browser_import', includedCategories: ['source-attribution', 'bounded-observations', 'completeness', 'limitations'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'discarded', retention: 'transient_report', network: 'none', sharingReview: 'required' },
      { id: 'external-interchange.privacy.case-merge', classification: 'analyst_authored_sensitive', projection: 'browser_import', includedCategories: ['source-attribution', 'bounded-observations', 'completeness', 'limitations'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'discarded', retention: 'browser_indexeddb', network: 'none', sharingReview: 'not_applicable' },
    ],
    expiryProfiles: [{ id: 'external-interchange.expiry.not-applicable', field: null, anchor: null, handling: 'not_applicable', phase: 'not_applicable', maximumLifetimeDays: null }],
    consumerEdges: [
      {
        id: 'external-interchange.consumer.findings-normalise', plane: 'shared', operation: 'normalise-strict-findings',
        acceptedContracts: [{ schema: EXTERNAL_FINDINGS_SCHEMA, versions: [...SUPPORTED_EXTERNAL_FINDINGS_VERSIONS], mode: 'direct' }],
        emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
        shapeIds: ['external-interchange.findings.v4'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.findings.normalise', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v4', privacyProfileId: 'external-interchange.privacy.transient',
        retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.finding-rows', plane: 'shared', operation: 'convert-finding-rows',
        acceptedContracts: [{ schema: EXTERNAL_FINDING_ROWS_SCHEMA, versions: [1], mode: 'direct' }],
        emittedContract: { schema: EXTERNAL_FINDINGS_SCHEMA, version: EXTERNAL_FINDINGS_VERSION },
        shapeIds: ['external-interchange.finding-rows.v1', 'external-interchange.findings.v4'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.finding-rows.convert', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v4', privacyProfileId: 'external-interchange.privacy.transient',
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
        shapeIds: ['external-interchange.domain-rows.v1', 'external-interchange.dns-rows.v1', 'external-interchange.certificate-rows.v1', 'external-interchange.findings.v4'],
        boundProfileIds: ['external-interchange.document.bounds'], hookIds: ['external-interchange.observation-rows.convert', 'external-interchange.findings.serialise'],
        serialisationProfileId: 'external-interchange.findings.json.v4', privacyProfileId: 'external-interchange.privacy.transient',
        retentionEffect: 'transient_report', ...externalConsumerCommon,
      },
      {
        id: 'external-interchange.consumer.case-merge', plane: 'shared', operation: 'non-destructive-case-merge',
        acceptedContracts: [{ schema: EXTERNAL_FINDINGS_SCHEMA, versions: [EXTERNAL_FINDINGS_VERSION], mode: 'direct' }], emittedContract: null,
        shapeIds: ['external-interchange.findings.v4'], boundProfileIds: ['external-interchange.document.bounds'],
        hookIds: ['external-interchange.findings.merge'], serialisationProfileId: null,
        privacyProfileId: 'external-interchange.privacy.case-merge', retentionEffect: 'browser_indexeddb', ...externalConsumerCommon,
      },
    ],
    consumerRelationships: [],
  },
});
