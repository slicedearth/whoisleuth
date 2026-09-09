import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import * as offlineArtifactValidationModule from '../cli/offline-artifact-validation.mts';
import * as artifactVerifyModule from '../cli/artifact-verify.mts';
import { commandOptionSpec } from '../cli/command-reference.mts';
import {
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH as IMPLEMENTED_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS as IMPLEMENTED_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES as IMPLEMENTED_REVIEW_JSON_VALUES,
} from '../cli/domain-control-observations.mts';
import * as domainControlObservationsModule from '../cli/domain-control-observations.mts';
import * as domainControlMonitorModule from '../cli/domain-control-monitor.mts';
import * as evidenceSigningModule from '../cli/evidence-signing.mts';
import * as interchangeReportModule from '../cli/interchange-report.mts';
import { MAX_OFFLINE_EVIDENCE_INPUT_BYTES } from '../cli/offline-evidence-review.mts';
import * as sharingReviewModule from '../cli/sharing-review.mts';
import { MAX_DESIRED_POSTURE_BASELINES } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import * as browserDomainControlModule from '../packages/workspace/domain-control-passport.mts';
import * as nodeDomainControlModule from '../lib/domain-control-manifest.mts';
import {
  MAX_BOUNDED_JSON_CONTAINER_ITEMS,
  MAX_BOUNDED_JSON_DEPTH,
  MAX_BOUNDED_JSON_KEYS,
  MAX_BOUNDED_JSON_VALUES,
} from '../lib/bounded-json.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
  MAX_DOMAIN_CONTROL_BROWSER_PROFILE_ENTRIES,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES,
  MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS,
  MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES,
  MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MAX_DOMAIN_CONTROL_PORTABLE_BYTES,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
  SUPPORTED_DOMAIN_CONTROL_MANIFEST_VERSIONS,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  defineSchemaLifecycleFamily,
  type SchemaLifecycleBound,
  type SchemaLifecycleFamily,
  type SchemaLifecycleFamilyWithMetadata,
} from '../packages/contracts/schema-lifecycle.mts';
import * as domainControlRuntimeModule from '../packages/evidence/domain-control-runtime.mts';

type MutableLifecycle = {
  id: string;
  owner: string;
  privacy: string;
  contracts: Array<Record<string, unknown>>;
  fixtures: Array<Record<string, unknown>>;
  compatibility: Array<Record<string, unknown>>;
  metadata: {
    metadataVersion: number;
    enforcement: string;
    shapes: Array<Record<string, unknown>>;
    boundProfiles: Array<Record<string, unknown>>;
    hooks: Array<Record<string, unknown>>;
    serialisationProfiles: Array<Record<string, unknown>>;
    privacyProfiles: Array<Record<string, unknown>>;
    expiryProfiles: Array<Record<string, unknown>>;
    consumerEdges: Array<Record<string, unknown>>;
    consumerRelationships: Array<Record<string, unknown>>;
  };
};

function mutableLifecycle(): MutableLifecycle {
  return structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as unknown as MutableLifecycle;
}

function baseLifecycle(value = mutableLifecycle()): SchemaLifecycleFamily {
  const { metadata: _metadata, ...base } = value;
  return base as unknown as SchemaLifecycleFamily;
}

function assertRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertRecursivelyFrozen(descriptor.value, seen);
  }
}

const HOOK_MODULES: Readonly<Record<string, object>> = Object.freeze({
  'packages/evidence/domain-control-runtime.mts': domainControlRuntimeModule,
  'packages/workspace/domain-control-passport.mts': browserDomainControlModule,
  'lib/domain-control-manifest.mts': nodeDomainControlModule,
  'cli/offline-artifact-validation.mts': offlineArtifactValidationModule,
  'cli/artifact-verify.mts': artifactVerifyModule,
  'cli/interchange-report.mts': interchangeReportModule,
  'cli/evidence-signing.mts': evidenceSigningModule,
  'cli/sharing-review.mts': sharingReviewModule,
  'cli/domain-control-monitor.mts': domainControlMonitorModule,
  'cli/domain-control-observations.mts': domainControlObservationsModule,
});

const EXPECTED_HOOKS = Object.freeze([
  ['domain-control.shared.build-unsigned', 'builder', 'shared', 'packages/evidence/domain-control-runtime.mts', 'buildUnsignedDomainControlManifest'],
  ['domain-control.shared.normalise-document', 'normaliser', 'shared', 'packages/evidence/domain-control-runtime.mts', 'normalizeDomainControlManifestDocument'],
  ['domain-control.shared.measure-serialised-bytes', 'serialised_byte_counter', 'shared', 'packages/evidence/domain-control-runtime.mts', 'domainControlManifestSerialisedBytes'],
  ['domain-control.shared.assert-byte-budget', 'budget_guard', 'shared', 'packages/evidence/domain-control-runtime.mts', 'assertDomainControlManifestByteBudget'],
  ['domain-control.shared.serialise-document', 'serialiser', 'shared', 'packages/evidence/domain-control-runtime.mts', 'serializeDomainControlManifest'],
  ['domain-control.browser.build-input', 'builder', 'browser', 'packages/workspace/domain-control-passport.mts', 'buildBrandProfilePassportInput'],
  ['domain-control.browser.build-document', 'builder', 'browser', 'packages/workspace/domain-control-passport.mts', 'buildDomainControlPassport'],
  ['domain-control.browser.verify-unexpired', 'integrity_verifier', 'browser', 'packages/workspace/domain-control-passport.mts', 'verifyDomainControlPassport'],
  ['domain-control.browser.apply', 'merger', 'browser', 'packages/workspace/domain-control-passport.mts', 'applyVerifiedDomainControlPassport'],
  ['domain-control.node.build-document', 'builder', 'node', 'lib/domain-control-manifest.mts', 'buildDomainControlManifest'],
  ['domain-control.node.verify-integrity', 'integrity_verifier', 'node', 'lib/domain-control-manifest.mts', 'verifyDomainControlManifest'],
  ['domain-control.node.review', 'reviewer', 'node', 'lib/domain-control-manifest.mts', 'reviewDomainControlManifest'],
  ['domain-control.cli.offline-structure', 'structure_validator', 'cli', 'cli/offline-artifact-validation.mts', 'validateSignedDigestArtifactStructure'],
  ['domain-control.cli.offline-verify', 'integrity_verifier', 'cli', 'cli/artifact-verify.mts', 'verifyOfflineArtifact'],
  ['domain-control.cli.interchange-report', 'interchange_reporter', 'cli', 'cli/interchange-report.mts', 'buildInterchangeFidelityReport'],
  ['domain-control.cli.sign-package', 'signer', 'cli', 'cli/evidence-signing.mts', 'signEvidencePackage'],
  ['domain-control.cli.verify-signature', 'signature_verifier', 'cli', 'cli/evidence-signing.mts', 'verifyEvidencePackageSignature'],
  ['domain-control.cli.sharing-review', 'sharing_reviewer', 'cli', 'cli/sharing-review.mts', 'buildSharingReview'],
  ['domain-control.cli.saved-lookup-review', 'reviewer', 'cli', 'cli/domain-control-observations.mts', 'buildCliDomainControlReview'],
  ['domain-control.cli.monitor-once', 'monitor', 'cli', 'cli/domain-control-monitor.mts', 'runDomainControlMonitor'],
] as const);

describe('domain-control lifecycle metadata', () => {
  it('preserves the six-field lifecycle API and adds one exact declarative metadata envelope', () => {
    const legacySource = baseLifecycle();
    const legacyCopy = defineSchemaLifecycleFamily(legacySource);
    assert.deepEqual(Object.keys(legacyCopy), [
      'id', 'owner', 'privacy', 'compatibility', 'contracts', 'fixtures',
    ]);
    assert.deepEqual(legacyCopy, baseLifecycle());

    assert.deepEqual(Object.keys(DOMAIN_CONTROL_SCHEMA_LIFECYCLE), [
      'id', 'owner', 'privacy', 'compatibility', 'contracts', 'fixtures', 'metadata',
    ]);
    assert.deepEqual(Object.keys(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata), [
      'metadataVersion', 'enforcement', 'shapes', 'boundProfiles', 'hooks',
      'serialisationProfiles', 'privacyProfiles', 'expiryProfiles', 'consumerEdges',
      'consumerRelationships',
    ]);
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.metadataVersion, 2);
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.enforcement, 'declarative_only');
    assertRecursivelyFrozen(DOMAIN_CONTROL_SCHEMA_LIFECYCLE);
    assert.deepEqual(
      JSON.parse(JSON.stringify(DOMAIN_CONTROL_SCHEMA_LIFECYCLE)),
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
    );

    const partial = mutableLifecycle();
    Reflect.deleteProperty(partial.metadata, 'enforcement');
    assert.throws(
      () => defineSchemaLifecycleFamily(partial as unknown as SchemaLifecycleFamilyWithMetadata),
      /exact registered fields/iu,
    );

    const metadataV1 = mutableLifecycle();
    metadataV1.metadata.metadataVersion = 1;
    Reflect.deleteProperty(metadataV1.metadata, 'consumerRelationships');
    const metadataV1Copy = defineSchemaLifecycleFamily(
      metadataV1 as unknown as SchemaLifecycleFamilyWithMetadata,
    );
    assert.equal(metadataV1Copy.metadata.metadataVersion, 1);
    assert.deepEqual(Object.keys(metadataV1Copy.metadata), [
      'metadataVersion', 'enforcement', 'shapes', 'boundProfiles', 'hooks',
      'serialisationProfiles', 'privacyProfiles', 'expiryProfiles', 'consumerEdges',
    ]);

    const mixedV1 = mutableLifecycle();
    mixedV1.metadata.metadataVersion = 1;
    assert.throws(
      () => defineSchemaLifecycleFamily(mixedV1 as unknown as SchemaLifecycleFamilyWithMetadata),
      /exact registered declarative-only version/iu,
    );

    const incompleteV2 = mutableLifecycle();
    Reflect.deleteProperty(incompleteV2.metadata, 'consumerRelationships');
    assert.throws(
      () => defineSchemaLifecycleFamily(incompleteV2 as unknown as SchemaLifecycleFamilyWithMetadata),
      /exact registered declarative-only version|exact registered fields/iu,
    );
  });

  it('describes the supported fixture shapes without duplicating internal shape identities', async () => {
    for (const fixture of DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures) {
      const document = JSON.parse(await readFile(new URL(`../${fixture.path}`, import.meta.url), 'utf8'));
      const shape = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.shapes.find((candidate) => (
        candidate.schema === document.schema && candidate.versions.includes(document.version)
      ));
      assert.ok(shape, fixture.id);
      const root = shape.objects.find((object) => object.path === '$');
      const entry = shape.objects.find((object) => object.path === '$.entries[]');
      assert.ok(root && entry, fixture.id);
      assert.deepEqual(root.requiredKeys, Object.keys(document));
      assert.equal(root.unknownKeys, 'reject');
      assert.equal(entry.unknownKeys, 'reject');
      const admitted = new Set([...entry.requiredKeys, ...entry.optionalKeys]);
      assert.ok(document.entries.every((item: Record<string, unknown>) => Object.keys(item).every((key) => admitted.has(key))));
      if (document.schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) {
        assert.deepEqual(new Set(entry.requiredKeys), new Set(Object.keys(document.entries[0])));
        assert.equal(shape.normalisation, 'preserve_signed_document');
        assert.deepEqual(shape.fixedArrays, [{ path: '$.limitations', values: document.limitations }]);
      } else {
        assert.equal(shape.normalisation, 'input_to_current');
        assert.deepEqual(shape.target, { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_VERSION });
      }
      assert.equal(admitted.has('recordModes'), document.schema === DOMAIN_CONTROL_MANIFEST_SCHEMA
        ? document.version === 3 : document.version === 2);
    }
  });

  it('keeps bounded adapters and distinguishes public from current record capacity', () => {
    assert.equal(MAX_DOMAIN_CONTROL_GENERIC_JSON_DEPTH, MAX_BOUNDED_JSON_DEPTH);
    assert.equal(MAX_DOMAIN_CONTROL_GENERIC_JSON_KEYS, MAX_BOUNDED_JSON_KEYS);
    assert.equal(MAX_DOMAIN_CONTROL_GENERIC_JSON_VALUES, MAX_BOUNDED_JSON_VALUES);
    assert.equal(MAX_DOMAIN_CONTROL_JSON_CONTAINER_ITEMS, MAX_BOUNDED_JSON_CONTAINER_ITEMS);
    assert.equal(MAX_DOMAIN_CONTROL_BROWSER_PROFILE_ENTRIES, MAX_DESIRED_POSTURE_BASELINES);
    assert.equal(MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_DEPTH, IMPLEMENTED_REVIEW_JSON_DEPTH);
    assert.equal(MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_KEYS, IMPLEMENTED_REVIEW_JSON_KEYS);
    assert.equal(MAX_DOMAIN_CONTROL_CLI_REVIEW_JSON_VALUES, IMPLEMENTED_REVIEW_JSON_VALUES);
    assert.equal(MAX_DOMAIN_CONTROL_MANIFEST_BYTES, MAX_OFFLINE_EVIDENCE_INPUT_BYTES);
    assert.equal(MAX_DOMAIN_CONTROL_PORTABLE_BYTES, artifactVerifyModule.MAX_OFFLINE_ARTIFACT_BYTES);
    assert.equal(MAX_DOMAIN_CONTROL_PORTABLE_BYTES, interchangeReportModule.MAX_INTERCHANGE_REPORT_BYTES);
    assert.equal(MAX_DOMAIN_CONTROL_PORTABLE_BYTES, sharingReviewModule.MAX_SHARING_REVIEW_BYTES);
    for (const [option, minimum, maximum] of [
      ['--limit', MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS],
      ['--concurrency', MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY],
    ] as const) assert.deepEqual(commandOptionSpec('monitor-once', option)?.integerRanges,
      [{ minimum, maximum, whenOptionPresent: null }]);

    const profiles = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.boundProfiles;
    const core = profiles.find((profile) => profile.id === 'domain-control.core-wire.v1');
    const historical = profiles.find((profile) => profile.id === 'domain-control.public-records.v2');
    assert.ok(core && historical);
    for (const field of ['nameservers', 'ds', 'mx', 'caa']) {
      const current: SchemaLifecycleBound | undefined = core.bounds.find((bound) => bound.path === `$.entries[].${field}` && bound.phase === 'normalised');
      const old: SchemaLifecycleBound | undefined = historical.bounds.find((bound) => bound.path === `$.entries[].${field}` && bound.phase === 'normalised');
      assert.ok(current && old);
      assert.equal(current.maximum, 64);
      assert.equal(current.handling, 'reject');
      assert.equal(old.maximum, 32);
      assert.equal(old.handling, 'truncate');
    }
    for (const profile of profiles) {
      assert.ok(profile.bounds.length > 0, profile.id);
      for (const bound of profile.bounds) {
        assert.ok(Number.isSafeInteger(bound.maximum) && bound.maximum > 0, bound.id);
        assert.ok(bound.minimum !== null && bound.minimum >= 0 && bound.minimum <= bound.maximum, bound.id);
      }
    }
    for (const id of ['domain-control.browser-file.v1', 'domain-control.cli-domain-control-file.v1',
      'domain-control.cli-monitor-file.v1', 'domain-control.cli-portable-file.v1']) {
      const profile = profiles.find((candidate) => candidate.id === id);
      assert.ok(profile, id);
      const bytes = profile.bounds.find((bound) => bound.unit === 'bytes' && bound.phase === 'raw_intake');
      assert.equal(bytes?.maximum, MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
      assert.equal(bytes?.handling, 'reject');
      assert.ok(profile.bounds.some((bound) => bound.unit === 'depth' && bound.handling === 'reject'));
      assert.ok(profile.bounds.some((bound) => bound.unit === 'values' && bound.handling === 'reject'));
    }
  });

  it('binds every declarative hook to one statically imported function without dispatching it', () => {
    const hooks = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.hooks;
    assert.deepEqual(
      hooks.map((hook) => [hook.id, hook.role, hook.runtime, hook.module, hook.exportName]),
      EXPECTED_HOOKS,
    );
    for (const hook of hooks) {
      const module = HOOK_MODULES[hook.module];
      assert.ok(module, `Hook module is statically allowlisted: ${hook.module}`);
      assert.equal(Object.hasOwn(module, hook.exportName), true, `${hook.module} exports ${hook.exportName}`);
      assert.equal(
        typeof (module as Readonly<Record<string, unknown>>)[hook.exportName],
        'function',
        `${hook.module}#${hook.exportName} is callable`,
      );
    }
  });

  it('states portable serialisation, privacy, expiry, and consumer policy without claiming dispatch', () => {
    assert.deepEqual(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.serialisationProfiles, [{
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
      verifierHookIds: ['domain-control.node.verify-integrity', 'domain-control.browser.verify-unexpired'],
    }]);
    assert.deepEqual(
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.privacyProfiles.map((profile) => [
        profile.id,
        profile.classification,
        profile.projection,
        profile.notePolicy,
        profile.retention,
        profile.network,
        profile.sharingReview,
      ]),
      [
        ['domain-control.manifest-sensitive.v1', 'analyst_authored_sensitive', 'full_manifest', 'allowed_bounded', 'none', 'none', 'not_applicable'],
        ['domain-control.cli-manifest.v1', 'analyst_authored_sensitive', 'full_manifest', 'allowed_bounded', 'operator_controlled_output', 'none', 'required'],
        ['domain-control.browser-export.v1', 'analyst_authored_sensitive', 'browser_export', 'forced_null', 'deliberate_local_file', 'none', 'required'],
        ['domain-control.browser-import.v1', 'analyst_authored_sensitive', 'browser_import', 'discarded', 'browser_indexeddb', 'none', 'not_applicable'],
        ['domain-control.review-sensitive.v1', 'analyst_authored_sensitive', 'review_output', 'discarded', 'transient_report', 'none', 'not_applicable'],
        ['domain-control.metadata-only.v1', 'metadata_only', 'metadata_only', 'not_applicable', 'transient_report', 'none', 'not_applicable'],
        ['domain-control.signed-wrapper.v1', 'analyst_authored_sensitive', 'signed_wrapper', 'allowed_bounded', 'operator_controlled_output', 'none', 'required'],
        ['domain-control.bounded-passive-monitor.v1', 'analyst_authored_sensitive', 'bounded_passive_monitor', 'not_applicable', 'operator_controlled_output', 'explicit_bounded_passive_deep', 'required'],
      ],
    );
    for (const profile of DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.privacyProfiles) {
      assert.equal(profile.includedCategories.some((category) => profile.excludedCategories.includes(category)), false);
    }
    const privacyById = new Map(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.privacyProfiles.map((profile) => [profile.id, profile]));
    assert.deepEqual(privacyById.get('domain-control.manifest-sensitive.v1')?.includedCategories, [
      'domain-identifiers', 'desired-dns', 'desired-mail-routing', 'desired-certificate',
      'desired-registrar', 'renewal-timing', 'analyst-notes', 'document-times', 'integrity-linkage',
    ]);
    assert.deepEqual(privacyById.get('domain-control.cli-manifest.v1')?.includedCategories,
      privacyById.get('domain-control.manifest-sensitive.v1')?.includedCategories);
    assert.deepEqual(privacyById.get('domain-control.browser-export.v1')?.includedCategories, [
      'domain-identifiers', 'desired-dns', 'desired-mail-routing', 'desired-certificate',
      'desired-registrar', 'renewal-timing', 'document-times', 'integrity-linkage',
    ]);
    assert.deepEqual(privacyById.get('domain-control.browser-import.v1')?.includedCategories, [
      'domain-identifiers', 'desired-dns', 'desired-mail-routing', 'desired-certificate',
      'desired-registrar', 'renewal-timing',
    ]);
    assert.deepEqual(privacyById.get('domain-control.review-sensitive.v1')?.includedCategories, [
      'domain-identifiers', 'desired-dns', 'desired-mail-routing', 'desired-certificate',
      'desired-registrar', 'renewal-timing', 'observed-control-values', 'observation-provenance',
      'observation-times', 'document-times', 'integrity-linkage',
    ]);
    assert.deepEqual(privacyById.get('domain-control.metadata-only.v1')?.includedCategories, [
      'schema-version', 'counts', 'integrity-digest', 'currentness',
    ]);
    assert.deepEqual(privacyById.get('domain-control.signed-wrapper.v1')?.includedCategories, [
      'complete-manifest', 'signing-time', 'public-key', 'key-identifier',
    ]);
    assert.deepEqual(privacyById.get('domain-control.bounded-passive-monitor.v1')?.includedCategories, [
      'domain-identifiers', 'request-metadata', 'normalised-observations', 'bounded-errors',
    ]);
    assert.deepEqual(
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.privacyProfiles.map((profile) => [
        profile.id,
        profile.excludedCategories,
      ]),
      [
        ['domain-control.manifest-sensitive.v1', ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions']],
        ['domain-control.cli-manifest.v1', ['raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions']],
        ['domain-control.browser-export.v1', [
          'analyst-notes', 'profile-identity', 'brand-context', 'contacts', 'observations',
          'change-windows', 'planning', 'suppressions',
        ]],
        ['domain-control.browser-import.v1', [
          'analyst-notes', 'profile-identity', 'brand-context', 'contacts', 'observations',
          'change-windows', 'planning', 'suppressions',
        ]],
        ['domain-control.review-sensitive.v1', [
          'analyst-notes', 'raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions',
        ]],
        ['domain-control.metadata-only.v1', [
          'domain-identifiers', 'desired-dns', 'desired-mail-routing', 'desired-certificate',
          'desired-registrar', 'renewal-timing', 'analyst-notes', 'raw-upstream-payloads',
        ]],
        ['domain-control.signed-wrapper.v1', ['private-key', 'credentials', 'raw-upstream-payloads']],
        ['domain-control.bounded-passive-monitor.v1', [
          'raw-upstream-payloads', 'contacts', 'credentials', 'cookies', 'sessions',
        ]],
      ],
    );
    assert.deepEqual(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.expiryProfiles, [
      { id: 'domain-control.expiry.build-future.v1', field: 'expiresAt', anchor: 'generatedAt', handling: 'require_after_anchor', phase: 'build', maximumLifetimeDays: null },
      { id: 'domain-control.expiry.require-current.v1', field: 'expiresAt', anchor: 'checkedAt', handling: 'reject_expired', phase: 'pre_action', maximumLifetimeDays: null },
      { id: 'domain-control.expiry.report-currentness.v1', field: 'expiresAt', anchor: 'checkedAt', handling: 'report_expired', phase: 'review', maximumLifetimeDays: null },
      { id: 'domain-control.expiry.integrity-only.v1', field: 'expiresAt', anchor: null, handling: 'integrity_only', phase: 'verification', maximumLifetimeDays: null },
    ]);
    assert.deepEqual(
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.consumerEdges.map((edge) => [
        edge.id,
        edge.plane,
        edge.operation,
        edge.privacyProfileId,
        edge.expiryPolicyId,
        edge.requestMode,
        edge.retentionEffect,
        edge.bindingState,
        edge.policyState,
      ]),
      [
        ['domain-control.browser-export', 'browser', 'export', 'domain-control.browser-export.v1', 'domain-control.expiry.build-future.v1', 'none', 'deliberate_local_file', 'declared_unenforced', 'current'],
        ['domain-control.browser-import', 'browser', 'import', 'domain-control.browser-import.v1', 'domain-control.expiry.require-current.v1', 'none', 'browser_indexeddb', 'declared_unenforced', 'current'],
        ['domain-control.node-build', 'node', 'build', 'domain-control.manifest-sensitive.v1', 'domain-control.expiry.build-future.v1', 'none', 'none', 'declared_unenforced', 'current'],
        ['domain-control.node-verify', 'node', 'verify', 'domain-control.manifest-sensitive.v1', 'domain-control.expiry.integrity-only.v1', 'none', 'none', 'declared_unenforced', 'current'],
        ['domain-control.node-review', 'node', 'review', 'domain-control.review-sensitive.v1', 'domain-control.expiry.report-currentness.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-core-review', 'cli', 'core-review', 'domain-control.review-sensitive.v1', 'domain-control.expiry.report-currentness.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-saved-lookup-review', 'cli', 'saved-lookup-review', 'domain-control.review-sensitive.v1', 'domain-control.expiry.report-currentness.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-build', 'cli', 'build', 'domain-control.cli-manifest.v1', 'domain-control.expiry.build-future.v1', 'none', 'operator_controlled_output', 'declared_unenforced', 'current'],
        ['domain-control.cli-offline-verify', 'cli', 'offline-verify', 'domain-control.metadata-only.v1', 'domain-control.expiry.integrity-only.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-interchange', 'cli', 'interchange', 'domain-control.metadata-only.v1', 'domain-control.expiry.integrity-only.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-sign', 'cli', 'sign', 'domain-control.signed-wrapper.v1', 'domain-control.expiry.integrity-only.v1', 'none', 'operator_controlled_output', 'declared_unenforced', 'current'],
        ['domain-control.cli-verify-signature', 'cli', 'verify-signature', 'domain-control.metadata-only.v1', 'domain-control.expiry.integrity-only.v1', 'none', 'transient_report', 'declared_unenforced', 'current'],
        ['domain-control.cli-sharing-review', 'cli', 'sharing-review', 'domain-control.metadata-only.v1', 'domain-control.expiry.report-currentness.v1', 'none', 'transient_report', 'declared_unenforced', 'target'],
        ['domain-control.cli-monitor', 'cli', 'monitor', 'domain-control.bounded-passive-monitor.v1', 'domain-control.expiry.require-current.v1', 'explicit_bounded_passive_deep', 'operator_controlled_output', 'declared_unenforced', 'current'],
      ],
    );
    for (const edge of DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.consumerEdges) {
      for (const accepted of edge.acceptedContracts) {
        const expectedVersions = accepted.schema === DOMAIN_CONTROL_MANIFEST_SCHEMA ? [2, 3] : [1, 2];
        assert.deepEqual(accepted.versions, expectedVersions, edge.id);
      }
      if (edge.emittedContract) assert.deepEqual(edge.emittedContract,
        { schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, version: DOMAIN_CONTROL_MANIFEST_VERSION });
    }
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.consumerEdges.every((edge) => edge.bindingState === 'declared_unenforced'), true);
  });

  it('classifies value-bearing review output as analyst-authored sensitive data', () => {
    const generatedAt = '2026-08-10T00:00:00.000Z';
    const manifest = nodeDomainControlModule.buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: '2026-09-10T00:00:00.000Z',
      entries: [{ domain: 'review.example.test', nameservers: ['ns1.review.example.test'] }],
    }, generatedAt);
    const review = nodeDomainControlModule.reviewDomainControlManifest({
      schema: nodeDomainControlModule.DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: nodeDomainControlModule.DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: [{
        domain: 'review.example.test',
        fields: {
          nameservers: {
            state: 'observed',
            values: ['ns2.review.example.test'],
            source: 'DNS',
            observedAt: generatedAt,
          },
        },
      }],
    }, generatedAt);
    assert.equal(review.domains[0]?.domain, 'review.example.test');
    assert.deepEqual(review.domains[0]?.comparisons[0]?.desired, ['ns1.review.example.test']);
    assert.deepEqual(review.domains[0]?.comparisons[0]?.observed, ['ns2.review.example.test']);
    const profile = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.privacyProfiles
      .find((candidate) => candidate.id === 'domain-control.review-sensitive.v1');
    assert.equal(profile?.classification, 'analyst_authored_sensitive');
    assert.equal(profile?.includedCategories.includes('domain-identifiers'), true);
    assert.equal(profile?.includedCategories.includes('observed-control-values'), true);
  });

  it('defensively copies metadata and rejects stale or contradictory relationships', () => {
    const source = mutableLifecycle();
    const copied = defineSchemaLifecycleFamily(source as unknown as SchemaLifecycleFamilyWithMetadata);
    source.metadata.hooks[0]!.id = 'changed-after-definition';
    source.metadata.consumerEdges[0]!.hookIds = ['changed-after-definition'];
    assert.equal(copied.metadata.hooks[0]?.id, 'domain-control.shared.build-unsigned');
    assert.equal(copied.metadata.consumerEdges[0]?.hookIds[0], 'domain-control.shared.build-unsigned');
    assertRecursivelyFrozen(copied.metadata);

    const cases: Array<Readonly<{ pattern: RegExp; mutate: (value: MutableLifecycle) => void }>> = [
      {
        pattern: /globally unique/iu,
        mutate(value) { value.metadata.boundProfiles[0]!.id = value.metadata.shapes[0]!.id; },
      },
      {
        pattern: /shape.*cover|exactly one shape/iu,
        mutate(value) { value.metadata.shapes[0]!.versions = [999]; },
      },
      {
        pattern: /shape.*paths/iu,
        mutate(value) {
          const objects = value.metadata.shapes[0]!.objects as Array<Record<string, unknown>>;
          objects[2]!.path = '$.missing.mx[]';
        },
      },
      {
        pattern: /contract shapes/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.shapeIds = (value.metadata.consumerEdges[0]!.shapeIds as string[]).slice(0, 1); },
      },
      {
        pattern: /unknown or incompatible hook/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.hookIds = ['domain-control.cli.monitor-once']; },
      },
      {
        pattern: /unique module and export pairs/iu,
        mutate(value) {
          value.metadata.hooks[1]!.module = value.metadata.hooks[0]!.module;
          value.metadata.hooks[1]!.exportName = value.metadata.hooks[0]!.exportName;
        },
      },
      {
        pattern: /unknown bound profile/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.boundProfileIds = ['domain-control.missing-bounds.v1']; },
      },
      {
        pattern: /unknown serialisation profile/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.serialisationProfileId = 'domain-control.missing-json.v1'; },
      },
      {
        pattern: /unknown serialisation profile/iu,
        mutate(value) {
          value.metadata.consumerEdges[0]!.hookIds = (
            value.metadata.consumerEdges[0]!.hookIds as string[]
          ).filter((id) => id !== 'domain-control.shared.serialise-document');
        },
      },
      {
        pattern: /at most one serialisation profile/iu,
        mutate(value) {
          const duplicate = structuredClone(value.metadata.serialisationProfiles[0]!);
          duplicate.id = 'domain-control.manifest-json.duplicate';
          value.metadata.serialisationProfiles.push(duplicate);
          value.metadata.consumerEdges[7]!.serialisationProfileId = duplicate.id;
        },
      },
      {
        pattern: /privacy, request, or retention/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.retentionEffect = 'none'; },
      },
      {
        pattern: /privacy, request, or retention/iu,
        mutate(value) { value.metadata.consumerEdges.at(-1)!.requestMode = 'none'; },
      },
      {
        pattern: /unknown expiry profile/iu,
        mutate(value) { value.metadata.consumerEdges[0]!.expiryPolicyId = 'domain-control.expiry.missing.v1'; },
      },
      {
        pattern: /unreadable or duplicate contract/iu,
        mutate(value) {
          const accepted = value.metadata.consumerEdges[0]!.acceptedContracts as Array<Record<string, unknown>>;
          accepted.push(structuredClone(accepted[0]!));
        },
      },
      {
        pattern: /unique path, phase, and unit tuples/iu,
        mutate(value) {
          const bounds = value.metadata.boundProfiles[0]!.bounds as Array<Record<string, unknown>>;
          const duplicate = structuredClone(bounds[0]!);
          duplicate.id = 'second-serialised-budget';
          bounds.push(duplicate);
        },
      },
      {
        pattern: /one exact serialised-byte bound/iu,
        mutate(value) {
          const bounds = value.metadata.boundProfiles[0]!.bounds as Array<Record<string, unknown>>;
          bounds[0]!.maximum = MAX_DOMAIN_CONTROL_MANIFEST_BYTES - 1;
        },
      },
      {
        pattern: /consumer.*contract byte budget/iu,
        mutate(value) {
          const coreBounds = value.metadata.boundProfiles[0]!.bounds as Array<Record<string, unknown>>;
          coreBounds[0]!.maximum = MAX_DOMAIN_CONTROL_MANIFEST_BYTES - 1;
          const browserBounds = value.metadata.boundProfiles.find((profile) => profile.id === 'domain-control.browser-file.v1')!.bounds as Array<Record<string, unknown>>;
          browserBounds.push({
            id: 'relocated-serialised-budget',
            path: '$',
            phase: 'serialised',
            unit: 'bytes',
            minimum: 1,
            maximum: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
            handling: 'reject',
          });
        },
      },
      {
        pattern: /categories or classification/iu,
        mutate(value) {
          const profile = value.metadata.privacyProfiles[0]!;
          profile.excludedCategories = [...profile.excludedCategories as string[], 'domain-identifiers'];
        },
      },
      {
        pattern: /categories or classification/iu,
        mutate(value) { value.metadata.privacyProfiles[1]!.sharingReview = 'not_applicable'; },
      },
      {
        pattern: /maximum lifetime/iu,
        mutate(value) { value.metadata.expiryProfiles[0]!.maximumLifetimeDays = 36_501; },
      },
      {
        pattern: /declarative-only/iu,
        mutate(value) { value.metadata.enforcement = 'runtime_dispatch'; },
      },
    ];
    for (const candidate of cases) {
      const value = mutableLifecycle();
      candidate.mutate(value);
      assert.throws(
        () => defineSchemaLifecycleFamily(value as unknown as SchemaLifecycleFamilyWithMetadata),
        candidate.pattern,
      );
    }

    const metadataAccessor = mutableLifecycle();
    let getterCalls = 0;
    Object.defineProperty(metadataAccessor.metadata.hooks, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return mutableLifecycle().metadata.hooks[0];
      },
    });
    assert.throws(
      () => defineSchemaLifecycleFamily(metadataAccessor as unknown as SchemaLifecycleFamilyWithMetadata),
      /ordinary enumerable data entries/iu,
    );
    assert.equal(getterCalls, 0);

    const statefulLength = mutableLifecycle();
    const hookTarget = statefulLength.metadata.hooks;
    let lengthDescriptorReads = 0;
    let lengthValueReads = 0;
    statefulLength.metadata.hooks = new Proxy(hookTarget, {
      get(target, key, receiver) {
        if (key === 'length') {
          lengthValueReads += 1;
          return 1_000;
        }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'length' || !descriptor || !('value' in descriptor)) return descriptor;
        lengthDescriptorReads += 1;
        return { ...descriptor, value: lengthDescriptorReads === 1 ? descriptor.value : 1_000 };
      },
    });
    const statefulCopy = defineSchemaLifecycleFamily(
      statefulLength as unknown as SchemaLifecycleFamilyWithMetadata,
    );
    assert.equal(statefulCopy.metadata.hooks.length, EXPECTED_HOOKS.length);
    assert.equal(lengthDescriptorReads, 1);
    assert.equal(lengthValueReads, 0);
  });

  it('enforces aggregate metadata budgets before reading untouched tail entries', () => {
    const textHeavy = mutableLifecycle();
    const textShape = textHeavy.metadata.shapes[0]!;
    const textEntry = (textShape.objects as Array<Record<string, unknown>>)[1]!;
    const textOptional = textEntry.optionalKeys as string[];
    const textArrays = textShape.fixedArrays as Array<Record<string, unknown>>;
    let textTailReads = 0;
    for (let arrayIndex = 0; arrayIndex < 16; arrayIndex += 1) {
      const field = `bulk_text_${arrayIndex}`;
      textOptional.push(field);
      const values = Array.from({ length: 64 }, (_, valueIndex) => (
        `${'x'.repeat(985)}-${arrayIndex}-${valueIndex}`
      ));
      textArrays.push({
        path: `$.entries[].${field}`,
        values: arrayIndex === 15
          ? new Proxy(values, {
              getOwnPropertyDescriptor(target, key) {
                if (typeof key === 'string' && /^\d+$/u.test(key)) textTailReads += 1;
                return Reflect.getOwnPropertyDescriptor(target, key);
              },
            })
          : values,
      });
    }
    assert.throws(
      () => defineSchemaLifecycleFamily(textHeavy as unknown as SchemaLifecycleFamilyWithMetadata),
      /aggregate text budget/iu,
    );
    assert.equal(textTailReads, 0);

    const byteHeavy = mutableLifecycle();
    const byteShape = byteHeavy.metadata.shapes[0]!;
    const byteEntry = (byteShape.objects as Array<Record<string, unknown>>)[1]!;
    const byteOptional = byteEntry.optionalKeys as string[];
    const byteArrays = byteShape.fixedArrays as Array<Record<string, unknown>>;
    let byteTailReads = 0;
    for (let arrayIndex = 0; arrayIndex < 16; arrayIndex += 1) {
      const field = `bulk_bytes_${arrayIndex}`;
      byteOptional.push(field);
      const values = Array.from({ length: 64 }, (_, valueIndex) => (
        `${'\ud800'.repeat(985)}-${arrayIndex}-${valueIndex}`
      ));
      byteArrays.push({
        path: `$.entries[].${field}`,
        values: arrayIndex === 15
          ? new Proxy(values, {
              getOwnPropertyDescriptor(target, key) {
                if (typeof key === 'string' && /^\d+$/u.test(key)) byteTailReads += 1;
                return Reflect.getOwnPropertyDescriptor(target, key);
              },
            })
          : values,
      });
    }
    assert.throws(
      () => defineSchemaLifecycleFamily(byteHeavy as unknown as SchemaLifecycleFamilyWithMetadata),
      /serialised byte budget/iu,
    );
    assert.equal(byteTailReads, 0);

    const structuralByteHeavy = mutableLifecycle();
    const structuralShape = structuralByteHeavy.metadata.shapes[0]!;
    const structuralRoot = (structuralShape.objects as Array<Record<string, unknown>>)[0]!;
    const structuralOptional = structuralRoot.optionalKeys as string[];
    const structuralArrays = structuralShape.fixedArrays as Array<Record<string, unknown>>;
    for (let arrayIndex = 0; arrayIndex < 16; arrayIndex += 1) {
      const field = `structural_${arrayIndex}`;
      structuralOptional.push(field);
      structuralArrays.push({
        path: `$.${field}`,
        values: Array.from({ length: 64 }, (_, valueIndex) => (
          `${'\ud800'.repeat(166)}-${arrayIndex}-${valueIndex}`
        )),
      });
    }
    const structuralMetadata = JSON.stringify(structuralByteHeavy.metadata);
    assert.ok(Buffer.byteLength(structuralMetadata, 'utf8') > 1_048_576);
    let structuralTailReads = 0;
    structuralByteHeavy.metadata.consumerEdges = new Proxy(
      structuralByteHeavy.metadata.consumerEdges,
      {
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === 'string' && /^\d+$/u.test(key)) structuralTailReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    assert.throws(
      () => defineSchemaLifecycleFamily(
        structuralByteHeavy as unknown as SchemaLifecycleFamilyWithMetadata,
      ),
      /serialised byte budget/iu,
    );
    assert.equal(structuralTailReads, 0);

    const nodeHeavy = mutableLifecycle();
    const nodeShape = nodeHeavy.metadata.shapes[0]!;
    const nodeRoot = (nodeShape.objects as Array<Record<string, unknown>>)[0]!;
    const rootOptional = nodeRoot.optionalKeys as string[];
    const nodeObjects = nodeShape.objects as Array<Record<string, unknown>>;
    let nodeTailReads = 0;
    for (let objectIndex = 0; objectIndex < 59; objectIndex += 1) {
      const field = `node_${objectIndex}`;
      rootOptional.push(field);
      nodeObjects.push({
        path: `$.${field}`,
        requiredKeys: Array.from({ length: 64 }, (_, keyIndex) => `required_${keyIndex}`),
        optionalKeys: Array.from({ length: 64 }, (_, keyIndex) => `optional_${keyIndex}`),
        unknownKeys: 'reject',
      });
    }
    nodeHeavy.metadata.boundProfiles = new Proxy(nodeHeavy.metadata.boundProfiles, {
      getOwnPropertyDescriptor(target, key) {
        if (typeof key === 'string' && /^\d+$/u.test(key)) nodeTailReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    assert.throws(
      () => defineSchemaLifecycleFamily(nodeHeavy as unknown as SchemaLifecycleFamilyWithMetadata),
      /aggregate node budget/iu,
    );
    assert.equal(nodeTailReads, 0);
  });

  it('uses the same field grammar for snake-case shape and bound paths', () => {
    const value = mutableLifecycle();
    const shape = value.metadata.shapes[0]!;
    const entry = (shape.objects as Array<Record<string, unknown>>)[1]!;
    (entry.optionalKeys as string[]).push('snake_case');
    (shape.objects as Array<Record<string, unknown>>).push({
      path: '$.entries[].snake_case',
      requiredKeys: [],
      optionalKeys: [],
      unknownKeys: 'reject',
    });
    const copied = defineSchemaLifecycleFamily(value as unknown as SchemaLifecycleFamilyWithMetadata);
    assert.equal(copied.metadata.shapes[0]?.objects.at(-1)?.path, '$.entries[].snake_case');
  });
});
