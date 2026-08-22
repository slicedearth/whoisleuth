import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { buildCollectionPreflight } from '../cli/collection-preflight.mts';
import {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
} from '../cli/command-catalogue.mts';
import {
  CLI_COMMAND_REGISTRY,
  cliInvocationNetworkEffect,
  commandHelp,
} from '../cli/command-reference.mts';
import { buildCliLookupPlan } from '../cli/lookup-plan.mts';
import { capabilityReport } from '../lib/capabilities.mts';
import { classifyQuery } from '../lib/classify.mts';
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
} from '../packages/contracts/capability-manifest.mts';
import {
  MAX_PRIVACY_CLI_VARIANTS,
  MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES,
  PRIVACY_CATALOGUE_INVARIANTS,
  PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_SCHEMA,
  PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_VERSION,
  PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY,
  PRIVACY_DATA_FLOW_CATALOGUE_LIFECYCLE_FAMILY,
  PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
  PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
  PRIVACY_PROCESSING_CLASSES,
  buildPrivacyDataFlowCatalogue,
  definePrivacyDataFlowCatalogue,
  serialisePrivacyDataFlowCatalogue,
} from '../packages/contracts/privacy-data-flow-catalogue.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import {
  PRIVACY_DATA_FLOW_CATALOGUE,
  humanPrivacySummary,
  renderPrivacyDataFlowCatalogueJson,
  renderPrivacyDataFlowCatalogueMarkdown,
} from '../tools/privacy-data-flow-catalogue-renderer.mts';

const JSON_PATH = new URL('../docs/privacy-data-flow-catalogue.json', import.meta.url);
const MARKDOWN_PATH = new URL('../docs/privacy-data-flow-catalogue.md', import.meta.url);

const ROOT_KEYS = [
  'schema', 'version', 'coverage', 'processingClasses', 'invariants', 'capabilityFlows',
  'cliOperationFlows', 'schemaFamilies', 'schemaContracts', 'schemaPrivacyProfiles',
  'schemaConsumerFlows',
] as const;
const BOUNDARY_KEYS = [
  'executionPlanes', 'trigger', 'networkMode', 'authorisation', 'dataSent',
  'dataDeliberatelyNotSent', 'recipientClasses', 'returnedDataCategories',
  'processingClasses', 'requestBudget', 'responseBudget', 'concurrency', 'retention',
  'exports', 'credentialModel', 'credentialUse', 'cancellation', 'partialResults',
  'outcomes', 'normalisedOutcomes', 'documentStates', 'scoringEffect', 'nonInferences',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function assertExactKeys(value: object, keys: readonly string[]): void {
  assert.deepEqual(sortedKeys(value), sorted(keys));
}

function assertDeeplyFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    assertDeeplyFrozen(child, visited);
  }
}

function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function mutableCatalogue(): any {
  return structuredClone(PRIVACY_DATA_FLOW_CATALOGUE);
}

function canonicalBuildInput() {
  return {
    capabilityManifest: CAPABILITY_MANIFEST,
    cliCommandCatalogue: {
      schema: CLI_COMMAND_CATALOGUE_SCHEMA,
      version: CLI_COMMAND_CATALOGUE_VERSION,
      commands: CLI_COMMAND_REGISTRY.map((definition) => ({
        recordId: `command.cli.${definition.command}` as `command.cli.${string}`,
        command: definition.command,
        title: definition.completion.description,
        requestPurpose: definition.collection.scope,
        privacyBoundary: definition.reference.boundary,
        collectionMode: definition.collection.mode,
        networkEffect: definition.execution.networkEffect,
      })),
    },
    schemaLifecycleRegistry: SCHEMA_LIFECYCLE_REGISTRY,
  } as const;
}

describe('privacy data-flow catalogue', () => {
  test('projects the five practical privacy questions from canonical boundaries', () => {
    const summary = humanPrivacySummary();
    assert.deepEqual(summary.map((item) => item.question), [
      'What leaves the device?',
      'What stays in the browser?',
      'What does optional hosted monitoring store?',
      'How long does retained data remain?',
      'How do users export or delete it?',
    ]);
    assert.match(summary[0]!.answer, /documentation make no investigation request/u);
    assert.match(summary[1]!.answer, /current browser profile or tab/u);
    assert.match(summary[2]!.answer, /compact application-encrypted projection/u);
    assert.match(summary[3]!.answer, /until the user deletes it or clears site data/u);
    assert.match(summary[4]!.answer, /Exports require an explicit browser or CLI action/u);
    assert.equal(Object.isFrozen(summary), true);
    assert.equal(summary.every((item) => Object.isFrozen(item)), true);
  });

  test('joins every canonical capability, CLI variant, lifecycle contract, profile and consumer exactly once', () => {
    const catalogue = PRIVACY_DATA_FLOW_CATALOGUE;
    assert.equal(catalogue.schema, PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA);
    assert.equal(catalogue.version, PRIVACY_DATA_FLOW_CATALOGUE_VERSION);
    assert.deepEqual(
      catalogue.capabilityFlows.map((flow) => flow.id),
      sorted(CAPABILITY_MANIFEST.capabilities.map((capability) => capability.id)),
    );
    assert.deepEqual(
      catalogue.cliOperationFlows.map((flow) => flow.id),
      sorted(CAPABILITY_MANIFEST.cliOperations.map((operation) => operation.recordId)),
    );
    assert.deepEqual(
      catalogue.cliOperationFlows.flatMap((operation) => operation.variants.map((variant) => variant.id)),
      sorted(CAPABILITY_MANIFEST.cliOperations.flatMap((operation) => (
        (operation.variants ?? []).map((variant) => `${operation.recordId}.${variant.id}`)
      ))),
    );

    const lifecycleFamilies = SCHEMA_LIFECYCLE_REGISTRY.map((family) => family.id);
    const lifecycleContracts = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => family.compatibility.map((item) => item.id));
    const lifecycleProfiles = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => (
      'metadata' in family ? family.metadata.privacyProfiles.map((item) => item.id) : []
    ));
    const lifecycleConsumers = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => (
      'metadata' in family ? family.metadata.consumerEdges.map((item) => item.id) : []
    ));
    const metadataVersions = [...new Set(SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => (
      'metadata' in family ? [family.metadata.metadataVersion] : []
    )))].sort((left, right) => left - right);
    assert.deepEqual(catalogue.schemaFamilies.map((item) => item.id), sorted(lifecycleFamilies));
    assert.deepEqual(catalogue.schemaContracts.map((item) => item.id), sorted(lifecycleContracts));
    assert.deepEqual(catalogue.schemaPrivacyProfiles.map((item) => item.id), sorted(lifecycleProfiles));
    assert.deepEqual(catalogue.schemaConsumerFlows.map((item) => item.id), sorted(lifecycleConsumers));
    assert.deepEqual(catalogue.coverage, {
      capabilityManifest: {
        schema: CAPABILITY_MANIFEST_SCHEMA,
        version: CAPABILITY_MANIFEST_VERSION,
        capabilityCount: CAPABILITY_MANIFEST.capabilities.length,
        cliOperationCount: CAPABILITY_MANIFEST.cliOperations.length,
        cliVariantCount: CAPABILITY_MANIFEST.cliOperations.reduce((sum, operation) => sum + (operation.variants?.length ?? 0), 0),
      },
      cliCommandCatalogue: {
        schema: CLI_COMMAND_CATALOGUE_SCHEMA,
        version: CLI_COMMAND_CATALOGUE_VERSION,
      },
      schemaLifecycleRegistry: {
        familyCount: lifecycleFamilies.length,
        compatibilityCount: lifecycleContracts.length,
        privacyProfileCount: lifecycleProfiles.length,
        consumerFlowCount: lifecycleConsumers.length,
        metadataVersions,
      },
      outsideLifecycleRegistry: {
        classification: 'not_applicable',
        reason: 'Schema-like inventory entries outside the canonical lifecycle registry are not assigned fabricated privacy semantics by this catalogue.',
      },
    });

    const consumerContractPairs = new Set(catalogue.schemaConsumerFlows.flatMap((flow) => [
      ...flow.acceptedContracts.flatMap((contract) => contract.versions.map((version) => `${contract.schema}\u0000${version}`)),
      ...(flow.emittedContract ? [`${flow.emittedContract.schema}\u0000${flow.emittedContract.version}`] : []),
    ]));
    for (const contract of catalogue.schemaContracts) {
      assert.ok(consumerContractPairs.has(`${contract.lifecycleSchema}\u0000${contract.currentVersion}`), contract.id);
    }
    for (const profile of catalogue.schemaPrivacyProfiles) {
      assert.ok(profile.includedCategories.length > 0, profile.id);
      assert.ok(profile.excludedCategories.length > 0, profile.id);
      assert.ok(profile.consumerFlowIds.length > 0, profile.id);
      assert.deepEqual(
        profile.consumerFlowIds,
        sorted(catalogue.schemaConsumerFlows
          .filter((flow) => flow.familyId === profile.familyId && flow.privacyProfileId === profile.id)
          .map((flow) => flow.id)),
      );
    }
  });

  test('is exact-keyed, deterministic, detached, deeply frozen and bounded before copying', () => {
    assertExactKeys(PRIVACY_DATA_FLOW_CATALOGUE, ROOT_KEYS);
    for (const flow of PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows) {
      assertExactKeys(flow, ['id', 'title', 'requestPurpose', 'job', ...BOUNDARY_KEYS]);
    }
    for (const operation of PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows) {
      assertExactKeys(operation, [
        'id', 'command', 'capabilityFamilyId', 'title', 'requestPurpose', 'collectionMode',
        ...BOUNDARY_KEYS, 'variants',
      ]);
      for (const variant of operation.variants) {
        assertExactKeys(variant, ['id', 'operationId', 'variantId', 'title', 'requestPurpose', ...BOUNDARY_KEYS]);
      }
    }
    assertDeeplyFrozen(PRIVACY_DATA_FLOW_CATALOGUE);
    assert.ok(Buffer.byteLength(serialisePrivacyDataFlowCatalogue(PRIVACY_DATA_FLOW_CATALOGUE), 'utf8') <= MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES);

    const detachedSource = mutableCatalogue();
    const detached = definePrivacyDataFlowCatalogue(detachedSource);
    const firstTitle = detached.capabilityFlows[0]!.title;
    detachedSource.capabilityFlows[0]!.title = 'Changed after validation';
    assert.equal(detached.capabilityFlows[0]!.title, firstTitle);

    const scrambled = mutableCatalogue();
    scrambled.capabilityFlows.reverse();
    scrambled.cliOperationFlows.reverse();
    for (const operation of scrambled.cliOperationFlows) operation.variants.reverse();
    scrambled.schemaFamilies.reverse();
    for (const family of scrambled.schemaFamilies) {
      family.compatibilityIds.reverse();
      family.privacyProfileIds.reverse();
      family.consumerFlowIds.reverse();
    }
    scrambled.schemaContracts.reverse();
    scrambled.schemaPrivacyProfiles.reverse();
    for (const profile of scrambled.schemaPrivacyProfiles) profile.consumerFlowIds.reverse();
    scrambled.schemaConsumerFlows.reverse();
    assert.equal(
      serialisePrivacyDataFlowCatalogue(scrambled),
      serialisePrivacyDataFlowCatalogue(PRIVACY_DATA_FLOW_CATALOGUE),
    );

    const extraRoot = mutableCatalogue() as Record<string, unknown>;
    extraRoot.extra = true;
    assert.throws(() => definePrivacyDataFlowCatalogue(extraRoot), /exact keys/u);
    const extraNested = mutableCatalogue() as Record<string, unknown>;
    ((extraNested.capabilityFlows as Array<Record<string, unknown>>)[0]!).extra = true;
    assert.throws(() => definePrivacyDataFlowCatalogue(extraNested), /exact keys/u);

    const longString = mutableCatalogue();
    longString.capabilityFlows[0]!.title = 'x'.repeat(4_097);
    assert.throws(() => definePrivacyDataFlowCatalogue(longString), /bounded text/u);
    const countOverflow = mutableCatalogue();
    countOverflow.cliOperationFlows[0]!.variants = Array(MAX_PRIVACY_CLI_VARIANTS + 1).fill(null);
    assert.throws(() => definePrivacyDataFlowCatalogue(countOverflow), /count bound/u);
    const byteOverflow = mutableCatalogue();
    for (const [flowIndex, flow] of byteOverflow.capabilityFlows.slice(0, 3).entries()) {
      flow.nonInferences = Array.from({ length: 128 }, (_, index) => (
        `${flowIndex}-${index}-${'x'.repeat(4_000)}`
      ));
    }
    assert.throws(() => definePrivacyDataFlowCatalogue(byteOverflow), /pre-copy byte budget/u);
  });

  test('rejects unsupported versions, unknown source identities, duplicate IDs and inconsistent joins', () => {
    for (const version of [0, 2]) {
      const changed = mutableCatalogue() as Record<string, unknown>;
      changed.version = version;
      assert.throws(() => definePrivacyDataFlowCatalogue(changed), /future or legacy versions are unsupported/u);
    }

    const duplicate = mutableCatalogue();
    duplicate.capabilityFlows[1]!.id = duplicate.capabilityFlows[0]!.id;
    assert.throws(() => definePrivacyDataFlowCatalogue(duplicate), /identifiers must be unique/u);

    const unknownCapability = mutableCatalogue();
    unknownCapability.cliOperationFlows[0]!.capabilityFamilyId = 'unknown_capability';
    assert.throws(() => definePrivacyDataFlowCatalogue(unknownCapability), /CLI joins are inconsistent/u);

    const unknownFamily = mutableCatalogue();
    unknownFamily.schemaContracts[0]!.familyId = 'unknown-family';
    assert.throws(() => definePrivacyDataFlowCatalogue(unknownFamily), /unknown join|inconsistent family/u);

    const wrongProfile = mutableCatalogue();
    const flow = wrongProfile.schemaConsumerFlows[0]!;
    const otherProfile = wrongProfile.schemaPrivacyProfiles.find(
      (profile: Record<string, unknown>) => profile.familyId !== flow.familyId,
    )!;
    flow.privacyProfileId = otherProfile.id;
    assert.throws(() => definePrivacyDataFlowCatalogue(wrongProfile), /inconsistent consumer join|unknown join/u);

    const badCoverage = mutableCatalogue();
    badCoverage.coverage.cliCommandCatalogue.schema = 'whoisleuth.unknown-cli-catalogue';
    assert.throws(() => definePrivacyDataFlowCatalogue(badCoverage), /source schema identities are unsupported/u);

    const badOutcome = mutableCatalogue();
    badOutcome.capabilityFlows[0].normalisedOutcomes.partial = badOutcome.capabilityFlows[0].outcomes.includes('partial')
      ? 'not_declared_for_boundary'
      : 'explicit_outcome';
    assert.throws(() => definePrivacyDataFlowCatalogue(badOutcome), /normalised outcome projections are inconsistent/u);

    const buildInput = canonicalBuildInput();
    assert.throws(() => buildPrivacyDataFlowCatalogue({
      ...buildInput,
      cliCommandCatalogue: { ...buildInput.cliCommandCatalogue, version: 2 },
    } as never), /exact current CLI command catalogue version/u);
  });

  test('keeps CLI inventory, help and request-free plans aligned with canonical flow identities', () => {
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_SCHEMA, CLI_COMMAND_CATALOGUE_SCHEMA);
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_VERSION, CLI_COMMAND_CATALOGUE_VERSION);
    for (const definition of CLI_COMMAND_REGISTRY) {
      const flow = PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows.find(
        (candidate) => candidate.id === `command.cli.${definition.command}`,
      );
      assert.ok(flow, definition.command);
      assert.equal(flow.command, definition.command);
      assert.equal(flow.title, definition.completion.description);
      assert.equal(flow.requestPurpose, definition.collection.scope);
      assert.equal(flow.collectionMode, definition.collection.mode);
      const help = commandHelp(definition.command);
      assert.match(help, new RegExp(definition.collection.mode === 'offline' ? 'Collection:\\n  Offline:' : 'Collection:\\n  Network:', 'u'));
      assert.ok(help.includes(definition.collection.scope));
      assert.ok(help.includes(definition.reference.boundary));
    }

    const lookupPlan = buildCliLookupPlan('catalogue.example.test', classifyQuery('catalogue.example.test'), true);
    assert.equal(lookupPlan.planning.networkRequestsMade, false);
    for (const source of lookupPlan.planning.sources) {
      assert.ok(PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows.some((flow) => flow.id === source.source), source.source);
    }
    for (const preflight of [
      buildCollectionPreflight({ command: 'bulk', targetCount: 2, targetLimit: 50, deep: true, concurrency: 2, output: 'json', checkpoint: false }),
      buildCollectionPreflight({ command: 'discover-scan', targetCount: 3, targetLimit: 50, deep: false, concurrency: 2, output: 'json', checkpoint: false }),
    ]) {
      assert.equal(preflight.networkRequestsMade, false);
      const flow = PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows.find((item) => item.command === preflight.command)!;
      assert.equal(flow.variants.find((variant) => variant.variantId === `plan_${preflight.mode}`)?.networkMode, 'none');
      assert.notEqual(flow.variants.find((variant) => variant.variantId === `collect_${preflight.mode}`)?.networkMode, 'none');
    }

    assert.equal(cliInvocationNetworkEffect('doctor', []), 'offline');
    assert.equal(cliInvocationNetworkEffect('doctor', ['--network']), 'network');
    for (const command of ['lookup', 'bulk', 'discover-scan'] as const) {
      assert.equal(cliInvocationNetworkEffect(command, ['--plan']), 'offline');
      assert.equal(cliInvocationNetworkEffect(command, []), 'network');
    }
    assert.equal(cliInvocationNetworkEffect('workflow-run', []), 'offline');
    assert.equal(cliInvocationNetworkEffect('workflow-run', ['--approve-network']), 'network');
  });

  test('keeps offline, retention, export, outcome and non-inference meanings separate', () => {
    const allBoundaries = [
      ...PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows,
      ...PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows,
      ...PRIVACY_DATA_FLOW_CATALOGUE.cliOperationFlows.flatMap((operation) => operation.variants),
    ];
    const offline = allBoundaries.filter((flow) => flow.networkMode === 'none');
    assert.ok(offline.length > 0);
    for (const flow of offline) {
      assert.deepEqual(flow.dataSent, ['none']);
      assert.deepEqual(flow.recipientClasses, ['none']);
      assert.ok(flow.processingClasses.includes('offline_processing_no_request'));
      assert.equal(flow.processingClasses.includes('third_party_disclosure'), false);
    }

    const transientExport = PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows.find((flow) => flow.id === 'availability')!;
    assert.equal(transientExport.retention.mode, 'transient');
    assert.equal(transientExport.exports.mode, 'deliberate_bounded');
    assert.equal(transientExport.processingClasses.includes('browser_local_retention'), false);
    assert.ok(transientExport.processingClasses.includes('deliberate_local_file_export'));
    const transientNoExport = PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows.find((flow) => flow.id === 'external_intelligence')!;
    assert.equal(transientNoExport.retention.mode, 'transient');
    assert.equal(transientNoExport.exports.mode, 'none');
    assert.equal(transientNoExport.processingClasses.includes('deliberate_local_file_export'), false);
    const browserRetention = PRIVACY_DATA_FLOW_CATALOGUE.capabilityFlows.find((flow) => flow.id === 'analyst_cases')!;
    assert.equal(browserRetention.retention.mode, 'browser_deliberate');
    assert.ok(browserRetention.processingClasses.includes('browser_local_retention'));

    for (const flow of allBoundaries) {
      assert.ok(flow.outcomes.length > 0, flow.id);
      assert.ok(flow.nonInferences.includes(PRIVACY_CATALOGUE_INVARIANTS[3]), flow.id);
      assert.deepEqual(flow.normalisedOutcomes, Object.fromEntries([
        'unavailable', 'blocked', 'partial', 'unsupported',
      ].map((state) => [
        state,
        flow.outcomes.includes(state) ? 'explicit_outcome' : 'not_declared_for_boundary',
      ])), flow.id);
    }
    assert.deepEqual(PRIVACY_DATA_FLOW_CATALOGUE.processingClasses, PRIVACY_PROCESSING_CLASSES);
  });

  test('preserves version-1 capability contracts and byte-exact generated artefacts', () => {
    const manifestBytes = JSON.stringify(CAPABILITY_MANIFEST);
    assert.equal(Buffer.byteLength(manifestBytes, 'utf8'), 82_381);
    assert.equal(sha256(manifestBytes), 'dd80ec029ee520ef32e63aee55308be0ba39dc4d274df97fb8096a2980b1e33a');
    const publicReportBytes = JSON.stringify(capabilityReport('express', {}));
    assert.equal(Buffer.byteLength(publicReportBytes, 'utf8'), 2_545);
    assert.equal(sha256(publicReportBytes), 'd67a69dc51fcf2db4c564d9e8764ddd684abbdcae54a413d71d760912b80611a');

    const json = readFileSync(JSON_PATH, 'utf8');
    const markdown = readFileSync(MARKDOWN_PATH, 'utf8');
    assert.equal(json, renderPrivacyDataFlowCatalogueJson());
    assert.equal(markdown, renderPrivacyDataFlowCatalogueMarkdown());
    assert.equal(json, serialisePrivacyDataFlowCatalogue(JSON.parse(json)));

    const fixture = PRIVACY_DATA_FLOW_CATALOGUE_LIFECYCLE_FAMILY.fixtures[0]!;
    assert.equal(fixture.path, 'docs/privacy-data-flow-catalogue.json');
    assert.equal(fixture.bytes, Buffer.byteLength(json, 'utf8'));
    assert.equal(fixture.sha256, sha256(json));
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.schema, PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA);
    assert.deepEqual(PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.supportedVersions, [1]);
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.futureVersionBehavior, 'reject');
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.migration, 'exact_current_only');
    assert.equal(PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.writeSemantics, 'read_only');
  });

  test('keeps generated artefacts target-free and rejects sensitive value shapes', () => {
    const generated = [
      readFileSync(JSON_PATH, 'utf8'),
      readFileSync(MARKDOWN_PATH, 'utf8'),
    ].join('\n');
    assert.doesNotMatch(generated, /(?:example\.(?:com|test)|192\.0\.2\.|AS64500)/iu);
    assert.doesNotMatch(generated, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu);
    assert.doesNotMatch(generated, /https?:\/\/[^\s"')]+/iu);
    assert.doesNotMatch(generated, /(?:\/Users\/|\/home\/|[A-Z]:\\\\)/u);
    assert.doesNotMatch(generated, /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u);
    assert.doesNotMatch(generated, /\bBearer\s+[A-Za-z0-9._~-]+/u);
    assert.doesNotMatch(generated, /(?:^|[\r\n])(?:Cookie|Set-Cookie|Authorization):/iu);

    const parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as unknown;
    const pending: unknown[] = [parsed];
    while (pending.length > 0) {
      const value = pending.pop();
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          assert.doesNotMatch(key, /^(?:target|query|password|token|secret|cookie|credentialValue|authorisationValue|authorizationValue)$/iu);
          pending.push(child);
        }
      }
    }
  });

  test('keeps critical public privacy facts aligned without duplicating catalogue prose', () => {
    const privacyPage = readFileSync(new URL('../frontend/src/routes/(public)/privacy/+page.svelte', import.meta.url), 'utf8');
    const privacyNotice = readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
    const publicPrivacySurfaces = [privacyPage, privacyNotice].map(normaliseWhitespace);
    const criticalFacts = [
      { category: 'compatibility', pattern: new RegExp(`Case schema ${CASE_SCHEMA_VERSION}.*Case schema ${PUBLIC_CASE_SCHEMA_VERSION} remains readable`, 'iu') },
      { category: 'compatibility', pattern: new RegExp(`workspace archive version ${WORKSPACE_ARCHIVE_VERSION}.*version ${PUBLIC_WORKSPACE_ARCHIVE_VERSION} remains readable`, 'iu') },
      { category: 'storage', pattern: /IndexedDB as plaintext JSON/iu },
      { category: 'network', pattern: /Single and Bulk lookups send the selected target/iu },
      { category: 'export', pattern: /full saved Lookup.*Review every file before sharing/iu },
      { category: 'deletion', pattern: /Deleting browser data does not delete separately downloaded files/iu },
    ] as const;
    for (const fact of criticalFacts) {
      for (const contents of publicPrivacySurfaces) {
        assert.match(contents, fact.pattern, `Public privacy surface omits ${fact.category} fact.`);
      }
    }

    const resourcesPage = readFileSync(new URL('../frontend/src/routes/(public)/resources/+page.svelte', import.meta.url), 'utf8');
    assert.doesNotMatch(privacyPage, /<PrivacyDataFlowSummary/u);
    assert.match(privacyPage, /privacy-data-flow-catalogue\.md/u);
    assert.doesNotMatch(resourcesPage, /<PrivacyDataFlowSummary/u);
    assert.match(resourcesPage, /id="privacy"[\s\S]*href="\/privacy"/u);
    const apiGuidance = readFileSync(new URL('../docs/registry-data-contract.md', import.meta.url), 'utf8');
    assert.match(apiGuidance, /fixed documentation, not a new runtime endpoint/u);
    assert.match(apiGuidance, /neither changes nor\s+extends the version-1 `\/api\/capabilities` response/u);
  });
});
