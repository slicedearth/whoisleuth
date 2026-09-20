import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import * as monitorModule from '../cli/domain-control-monitor.mts';
import * as cliReviewModule from '../cli/domain-control-observations.mts';
import { formatJsonDocument } from '../cli/formatters/json.mts';
import * as jsonFormatterModule from '../cli/formatters/json.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import * as nodeReviewModule from '../lib/domain-control-manifest.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SUMMARY_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_ROOT_KEYS,
  CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS,
  DOMAIN_CONTROL_REVIEW_COUNT_KEYS,
  DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS,
  DOMAIN_CONTROL_REVIEW_FIELDS,
  DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_LIMITATIONS,
  DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS,
  DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS,
  DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS,
  DOMAIN_CONTROL_REVIEW_ROOT_KEYS,
  DOMAIN_CONTROL_REVIEW_SCHEMA,
  DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES,
  MAX_DOMAIN_CONTROL_REVIEW_DOMAIN_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_FIELD_INPUT_VALUES,
  MAX_DOMAIN_CONTROL_REVIEW_FIELDS,
  MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS,
  MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS,
  MAX_DOMAIN_CONTROL_REVIEW_SOURCE_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_SPKI_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_TEXT_INPUT_LENGTH,
  MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH,
  MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS,
} from '../packages/contracts/domain-control-review.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH,
  MAX_CANONICAL_DOMAIN_CONTROL_RECORDS,
  MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH,
  MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH,
  MAX_DOMAIN_CONTROL_DOMAIN_LENGTH,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES,
  MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH,
} from '../packages/contracts/domain-control-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { defineSchemaLifecycleFamily } from '../packages/contracts/schema-lifecycle.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';

const GENERATED_AT = '2026-08-20T00:00:00.000Z';

const MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'lib/domain-control-manifest.mts': nodeReviewModule,
  'cli/domain-control-monitor.mts': monitorModule,
  'cli/domain-control-observations.mts': cliReviewModule,
  'cli/formatters/json.mts': jsonFormatterModule,
};

function recursivelyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((item) => recursivelyFrozen(item, seen));
}

describe('domain-control review schema lifecycle', () => {
  test('registers supported public readers and current writers with callable hooks', () => {
    assert.deepEqual(
      SCHEMA_LIFECYCLE_REGISTRY.find((family) => family.id === DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.id),
      DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE,
    );
    assert.equal(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.owner, 'packages/contracts/domain-control-review.mts');
    assert.deepEqual(
      DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.contracts.map((contract) => [
        contract.schema,
        contract.version,
        contract.role,
        contract.readable,
        contract.emitted,
        contract.futureVersionBehaviour,
      ]),
      [
        [DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, 1, 'input', true, false, 'reject'],
        [DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, 2, 'input', true, false, 'reject'],
        [DOMAIN_CONTROL_REVIEW_SCHEMA, 1, 'document', true, false, 'reject'],
        [DOMAIN_CONTROL_REVIEW_SCHEMA, 2, 'document', true, true, 'reject'],
        [CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, 1, 'input', true, false, 'reject'],
        [CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, 2, 'input', true, false, 'reject'],
        [CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, 1, 'document', false, false, 'not_applicable'],
        [CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, 2, 'document', false, true, 'not_applicable'],
      ],
    );
    assert.equal(recursivelyFrozen(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE), true);
    for (const hook of DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.metadata.hooks) {
      const module = MODULES[hook.module];
      assert.ok(module, hook.module);
      assert.equal(Object.hasOwn(module, hook.exportName), true, `${hook.module}#${hook.exportName}`);
      assert.equal(typeof module[hook.exportName], 'function', `${hook.module}#${hook.exportName}`);
    }
  });

  test('pins every fixture byte and reproduces both current review documents exactly', async () => {
    const rawById = new Map<string, string>();
    for (const fixture of DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.fixtures) {
      const { id } = fixture;
      const raw = await readFile(new URL(`../${fixture.path}`, import.meta.url), 'utf8');
      assert.equal(raw.endsWith('\n'), true, id);
      assert.equal(Buffer.byteLength(raw, 'utf8'), fixture.bytes, id);
      assert.equal(createHash('sha256').update(raw).digest('hex'), fixture.sha256, id);
      rawById.set(id, raw);
    }

    const coreInput = JSON.parse(rawById.get(`domain-control-review-input-v${DOMAIN_CONTROL_REVIEW_VERSION}`)!);
    const coreOutput = nodeReviewModule.reviewDomainControlManifest(coreInput, GENERATED_AT);
    assert.equal(formatJsonDocument(coreOutput), rawById.get(`domain-control-review-v${DOMAIN_CONTROL_REVIEW_VERSION}`));
    const validatedCoreOutput = nodeReviewModule.validateDomainControlReviewDocument(
      JSON.parse(rawById.get(`domain-control-review-v${DOMAIN_CONTROL_REVIEW_VERSION}`)!),
    );
    assert.deepEqual(validatedCoreOutput, coreOutput);
    assert.equal(recursivelyFrozen(validatedCoreOutput), true);
    for (const mutate of [
      (document: Record<string, unknown>) => { delete document.state; },
      (document: Record<string, unknown>) => { document.unexpected = true; },
      (document: Record<string, unknown>) => {
        (document.counts as Record<string, unknown>).drift = 1;
      },
    ]) {
      const candidate = JSON.parse(rawById.get(`domain-control-review-v${DOMAIN_CONTROL_REVIEW_VERSION}`)!) as Record<string, unknown>;
      mutate(candidate);
      assert.throws(() => nodeReviewModule.validateDomainControlReviewDocument(candidate));
    }

    const cliOutput = cliReviewModule.buildCliDomainControlReview(
      rawById.get(`cli-domain-control-review-input-v${CLI_DOMAIN_CONTROL_REVIEW_VERSION}`)!,
      GENERATED_AT,
    );
    assert.equal(formatJsonDocument(cliOutput), rawById.get(`cli-domain-control-review-v${CLI_DOMAIN_CONTROL_REVIEW_VERSION}`));
    const historical = rawById.get('domain-control-review-v1')!;
    assert.equal(formatJsonDocument(nodeReviewModule.validateDomainControlReviewDocument(JSON.parse(historical))), historical);
    assert.equal(nodeReviewModule.reviewDomainControlManifest(
      JSON.parse(rawById.get('domain-control-review-input-v1')!), GENERATED_AT,
    ).version, DOMAIN_CONTROL_REVIEW_VERSION);
    assert.equal(cliReviewModule.buildCliDomainControlReview(
      rawById.get('cli-domain-control-review-input-v1')!, GENERATED_AT,
    ).version, CLI_DOMAIN_CONTROL_REVIEW_VERSION);
  });

  test('validates supported supplied manifest order and maximum DS and CAA presentations', () => {
    const baseManifest = nodeReviewModule.buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: '2026-09-20T00:00:00.000Z',
      entries: ['aa.example', 'z.example'].map((domain, index) => ({
        domain,
        nameservers: [],
        ds: index === 0 ? [{ keyTag: 65_535, algorithm: 255, digestType: 255, digest: 'ab'.repeat(512) }] : [],
        mx: [],
        caa: index === 0 ? [{ flags: 255, tag: 'issuewild', value: 'x'.repeat(500) }] : [],
        tlsIssuer: null,
        tlsSpkiSha256: null,
        registrarLock: index === 0 ? 'required' : null,
        renewalReviewAt: null,
        note: null,
      })),
    }, '2026-08-19T00:00:00.000Z');
    const { integrity, ...unsigned } = baseManifest;
    const suppliedOrder = Object.freeze({
      ...unsigned,
      entries: Object.freeze([...unsigned.entries].reverse()),
    });
    const reorderedManifest = Object.freeze({
      ...suppliedOrder,
      integrity: Object.freeze({
        ...integrity,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(suppliedOrder)).digest('hex')}`,
      }),
    });
    const review = nodeReviewModule.reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest: reorderedManifest,
      observations: [{
        domain: 'aa.example',
        fields: {
          registrarLock: {
            state: 'observed',
            values: ['required', 'not_required'],
            source: 'Saved registrar evidence',
            observedAt: GENERATED_AT,
          },
        },
      }],
    }, GENERATED_AT);
    assert.deepEqual(review.domains.map((item) => item.domain), ['z.example', 'aa.example']);
    const validated = nodeReviewModule.validateDomainControlReviewDocument(review);
    assert.deepEqual(validated, review);
    const ds = validated.domains[1]!.comparisons.find((item) => item.field === 'ds')!.desired[0]!;
    const caa = validated.domains[1]!.comparisons.find((item) => item.field === 'caa')!.desired[0]!;
    const registrarLock = validated.domains[1]!.comparisons.find((item) => item.field === 'registrarLock')!;
    assert.ok(ds.length > MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH && ds.length <= MAX_DOMAIN_CONTROL_DS_PRESENTATION_LENGTH);
    assert.ok(caa.length > MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH && caa.length <= MAX_DOMAIN_CONTROL_CAA_PRESENTATION_LENGTH);
    assert.deepEqual(registrarLock.observed, ['not_required', 'required']);
  });

  test('owns the exact review shapes and their executable bound relationships', () => {
    const keyTuples = [
      DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
      DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS,
      DOMAIN_CONTROL_REVIEW_FIELDS,
      DOMAIN_CONTROL_REVIEW_OBSERVATION_FIELD_KEYS,
      DOMAIN_CONTROL_REVIEW_ROOT_KEYS,
      DOMAIN_CONTROL_REVIEW_MANIFEST_SUMMARY_KEYS,
      DOMAIN_CONTROL_REVIEW_COUNT_KEYS,
      DOMAIN_CONTROL_REVIEW_DOMAIN_KEYS,
      DOMAIN_CONTROL_REVIEW_COMPARISON_KEYS,
      CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS,
      CLI_DOMAIN_CONTROL_REVIEW_ROOT_KEYS,
      CLI_DOMAIN_CONTROL_REVIEW_OBSERVATION_KEYS,
      CLI_DOMAIN_CONTROL_REVIEW_FIELD_KEYS,
      CLI_DOMAIN_CONTROL_REVIEW_INPUT_SUMMARY_KEYS,
      DOMAIN_CONTROL_REVIEW_LIMITATIONS,
      CLI_DOMAIN_CONTROL_REVIEW_LIMITATIONS,
    ];
    assert.equal(keyTuples.every(Object.isFrozen), true);
    assert.deepEqual(DOMAIN_CONTROL_REVIEW_INPUT_KEYS, ['schema', 'version', 'manifest', 'observations']);
    assert.deepEqual(DOMAIN_CONTROL_REVIEW_FIELDS, [
      'nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock',
    ]);
    assert.deepEqual(CLI_DOMAIN_CONTROL_REVIEW_INPUT_KEYS, ['schema', 'version', 'manifest', 'lookups']);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_FIELDS, DOMAIN_CONTROL_REVIEW_FIELDS.length);
    assert.equal(
      MAX_DOMAIN_CONTROL_REVIEW_OBSERVATIONS,
      MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES * 2,
    );
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_LOOKUPS, MAX_DOMAIN_CONTROL_MANIFEST_ENTRIES);
    assert.equal(MIN_DOMAIN_CONTROL_REVIEW_LOOKUPS, 1);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES, MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_FIELD_INPUT_VALUES, MAX_CANONICAL_DOMAIN_CONTROL_RECORDS * 4);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_SOURCE_INPUT_LENGTH, MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH * 4);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_TEXT_INPUT_LENGTH, MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH * 4);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH, 120);
    assert.equal(MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH, 500);

    const coreBounds = DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.metadata.boundProfiles
      .find((profile) => profile.id === `domain-control-review.core.v${DOMAIN_CONTROL_REVIEW_VERSION}`)?.bounds;
    assert.ok(coreBounds);
    for (const field of DOMAIN_CONTROL_REVIEW_FIELDS) {
      const boundId = field.replace(/([A-Z])/gu, '-$1').toLowerCase();
      const expectedIds = [
        `${boundId}-input-values`,
        `${boundId}-values`,
        `${boundId}-source-input`,
        `${boundId}-source`,
        `${boundId}-observed-at-input`,
        `${boundId}-observed-at`,
      ];
      assert.deepEqual(
        coreBounds.filter((bound) => expectedIds.includes(bound.id))
          .map((bound) => [bound.id, bound.maximum, bound.handling]),
        [
          [`${boundId}-input-values`, MAX_DOMAIN_CONTROL_REVIEW_FIELD_INPUT_VALUES, 'reject'],
          [`${boundId}-values`, 64, 'reject'],
          [`${boundId}-source-input`, MAX_DOMAIN_CONTROL_REVIEW_SOURCE_INPUT_LENGTH, 'reject'],
          [`${boundId}-source`, MAX_DOMAIN_CONTROL_REVIEW_SOURCE_LENGTH, 'truncate'],
          [`${boundId}-observed-at-input`, MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH * 4, 'reject'],
          [`${boundId}-observed-at`, MAX_DOMAIN_CONTROL_TIMESTAMP_LENGTH, 'reject'],
        ],
      );
    }
    const publicBounds = DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.metadata.boundProfiles
      .find((profile) => profile.id === 'domain-control-review.core.v1')?.bounds;
    assert.ok(publicBounds);
    assert.equal(publicBounds.find((bound) => bound.id === 'nameservers-values')?.maximum, 32);
    assert.equal(publicBounds.find((bound) => bound.id === 'nameservers-values')?.handling, 'reject');
    assert.deepEqual(
      coreBounds.filter((bound) => bound.path.endsWith('.values[]'))
        .map((bound) => [bound.id, bound.maximum, bound.handling]),
      [
        ['nameserver-input-text', MAX_DOMAIN_CONTROL_REVIEW_DOMAIN_INPUT_LENGTH, 'reject'],
        ['nameserver-text', MAX_DOMAIN_CONTROL_DOMAIN_LENGTH, 'truncate'],
        ['tls-issuer-input-text', MAX_DOMAIN_CONTROL_REVIEW_TEXT_INPUT_LENGTH, 'reject'],
        ['tls-issuer-text', MAX_DOMAIN_CONTROL_REVIEW_TEXT_LENGTH, 'truncate'],
        ['tls-spki-input-text', MAX_DOMAIN_CONTROL_REVIEW_SPKI_INPUT_LENGTH, 'reject'],
        ['tls-spki-text', DOMAIN_CONTROL_SPKI_SHA256_HEX_LENGTH, 'reject'],
      ],
    );
  });

  test('derives all four compatibility rows from the canonical lifecycle owner', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: GENERATED_AT });
    const expected = new Map(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.compatibility.map((entry) => [entry.id, entry]));
    assert.equal(expected.size, 4);
    for (const [id, descriptor] of expected) {
      const actual = inventory.entries.find((entry) => entry.id === id);
      assert.ok(actual, id);
      assert.deepEqual(actual, descriptor);
      assert.equal(actual.owner, 'packages/contracts/domain-control-review.mts');
    }
    assert.equal(inventory.entries.filter((entry) => (
      entry.schema === DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
      || entry.schema === DOMAIN_CONTROL_REVIEW_SCHEMA
      || entry.schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
      || entry.schema === CLI_DOMAIN_CONTROL_REVIEW_SCHEMA
    )).length, 4);
    assert.equal(
      inventory.entries.find((entry) => entry.id === 'cli.domain-control-review-input')?.byteBudget,
      MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
    );
  });

  test('keeps unsigned review serialisation explicit and rejects contradictory verifier metadata', () => {
    assert.deepEqual(
      DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.metadata.serialisationProfiles.map((profile) => [
        profile.schema,
        profile.integrity,
        profile.verifierHookIds,
      ]),
      [
        [DOMAIN_CONTROL_REVIEW_SCHEMA, 'none', []],
        [CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, 'none', []],
      ],
    );
    const contradictory = structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE) as unknown as {
      metadata: { serialisationProfiles: Array<{ integrity: string; verifierHookIds: string[] }> };
    };
    contradictory.metadata.serialisationProfiles[0]!.verifierHookIds = ['domain-control-review.node.verify-manifest'];
    assert.throws(
      () => defineSchemaLifecycleFamily(contradictory as never),
      /verifier hooks only when separate integrity verification is required/u,
    );

    const unsignedAsSigned = structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE) as any;
    unsignedAsSigned.metadata.shapes.find((shape: { id: string }) => shape.id === 'domain-control-review.document.v1')
      .normalisation = 'preserve_signed_document';
    assert.throws(
      () => defineSchemaLifecycleFamily(unsignedAsSigned),
      /inconsistent document integrity metadata/u,
    );

    const signedAsUnsigned = structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as any;
    signedAsUnsigned.metadata.shapes.find((shape: { schema: string }) => shape.schema === nodeReviewModule.DOMAIN_CONTROL_MANIFEST_SCHEMA)
      .normalisation = 'preserve_document';
    assert.throws(
      () => defineSchemaLifecycleFamily(signedAsUnsigned),
      /inconsistent document integrity metadata/u,
    );

    const signedWithoutIntegrity = structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as any;
    signedWithoutIntegrity.metadata.serialisationProfiles[0].integrity = 'none';
    signedWithoutIntegrity.metadata.serialisationProfiles[0].verifierHookIds = [];
    assert.throws(
      () => defineSchemaLifecycleFamily(signedWithoutIntegrity),
      /inconsistent document integrity metadata/u,
    );

    const unsignedWithIntegrity = structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE) as any;
    unsignedWithIntegrity.metadata.serialisationProfiles[0].integrity = 'structural_only_requires_separate_verification';
    unsignedWithIntegrity.metadata.serialisationProfiles[0].verifierHookIds = ['domain-control-review.node.verify-manifest'];
    assert.throws(
      () => defineSchemaLifecycleFamily(unsignedWithIntegrity),
      /inconsistent document integrity metadata/u,
    );
  });

  test('rejects not-applicable future handling on readable contracts', () => {
    const readableInput = structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE) as any;
    readableInput.contracts[0].futureVersionBehaviour = 'not_applicable';
    assert.throws(
      () => defineSchemaLifecycleFamily(readableInput),
      /limited to.*(?:output|document)/u,
    );

    const readableDocument = structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE) as any;
    readableDocument.contracts.find((contract: { schema: string; emitted: boolean }) => contract.schema === CLI_DOMAIN_CONTROL_REVIEW_SCHEMA && contract.emitted).readable = true;
    assert.throws(
      () => defineSchemaLifecycleFamily(readableDocument),
      /limited to.*(?:output|document)/u,
    );

  });

  test('routes the frozen saved-Lookup review without any collection request', async () => {
    const input = await readFile(new URL('./fixtures/cli-domain-control-review-input-v1.json', import.meta.url), 'utf8');
    let stdout = '';
    let requested = false;
    const code = await runCli(['domain-control', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write() {} },
      now: () => GENERATED_AT,
      readArtifactInput: async () => input,
      runUnifiedLookup: async () => { requested = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(requested, false);
    const parsed = JSON.parse(stdout) as { schema?: unknown; version?: unknown };
    assert.equal(parsed.schema, CLI_DOMAIN_CONTROL_REVIEW_SCHEMA);
    assert.equal(parsed.version, CLI_DOMAIN_CONTROL_REVIEW_VERSION);
  });

  test('declares and executes explicit review output and monitor embedding routes', async () => {
    const edges = DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE.metadata.consumerEdges;
    const monitor = edges.find((edge) => edge.operation === 'embed-review-after-bounded-passive-collection');
    assert.ok(monitor);
    assert.deepEqual(monitor.acceptedContracts.map(({ schema, versions, mode }) => ({ schema, versions, mode })), [
      { schema: DOMAIN_CONTROL_REVIEW_SCHEMA, versions: [1, 2], mode: 'embedded' },
    ]);
    assert.equal(monitor.requestMode, 'explicit_bounded_passive_deep');
    assert.equal(monitor.retentionEffect, 'operator_controlled_output');
    assert.ok(monitor.hookIds.includes('domain-control-review.node.validate-core'));
    assert.ok(monitor.hookIds.includes('domain-control-review.cli.monitor'));
    assert.ok(edges.filter((edge) => edge !== monitor).every((edge) => edge.requestMode === 'none'));

    const input = await readFile(new URL('./fixtures/cli-domain-control-review-input-v1.json', import.meta.url), 'utf8');
    let terminalOutput = '';
    let requested = false;
    assert.equal(await runCli(['domain-control'], {
      stdout: { write(value) { terminalOutput += value; } },
      stderr: { write() {} },
      now: () => GENERATED_AT,
      readArtifactInput: async () => input,
      runUnifiedLookup: async () => { requested = true; return {}; },
    }), EXIT_CODES.SUCCESS);
    assert.match(terminalOutput, /^Domain-control evidence review/u);
    assert.equal(requested, false);

    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-domain-control-review-'));
    try {
      const jsonPath = join(directory, 'review.json');
      const terminalPath = join(directory, 'review.txt');
      assert.equal(await runCli(['domain-control', '--json', '--output', jsonPath], {
        stderr: { write() {} }, now: () => GENERATED_AT, readArtifactInput: async () => input,
      }), EXIT_CODES.SUCCESS);
      assert.equal(await runCli(['domain-control', '--output', terminalPath], {
        stderr: { write() {} }, now: () => GENERATED_AT, readArtifactInput: async () => input,
      }), EXIT_CODES.SUCCESS);
      assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).schema, CLI_DOMAIN_CONTROL_REVIEW_SCHEMA);
      assert.match(await readFile(terminalPath, 'utf8'), /^Domain-control evidence review/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('retains exact public version identities through compatibility facades', () => {
    assert.equal(nodeReviewModule.DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA);
    assert.equal(nodeReviewModule.DOMAIN_CONTROL_REVIEW_SCHEMA, DOMAIN_CONTROL_REVIEW_SCHEMA);
    assert.equal(nodeReviewModule.DOMAIN_CONTROL_REVIEW_VERSION, DOMAIN_CONTROL_REVIEW_VERSION);
    assert.equal(cliReviewModule.CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA);
    assert.equal(cliReviewModule.CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, CLI_DOMAIN_CONTROL_REVIEW_SCHEMA);
    assert.equal(cliReviewModule.CLI_DOMAIN_CONTROL_REVIEW_VERSION, CLI_DOMAIN_CONTROL_REVIEW_VERSION);
  });
});
