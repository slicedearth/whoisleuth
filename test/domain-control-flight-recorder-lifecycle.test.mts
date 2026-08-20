import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { runCli } from '../cli/runner.mts';
import * as domainControlMonitorModule from '../cli/domain-control-monitor.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { MAX_CLI_OUTPUT_BYTES } from '../cli/output-file.mts';
import * as flightRecorderModule from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_COMPATIBILITY,
  DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_COMPATIBILITY,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS,
  DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
  DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS,
  MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES,
  MAX_FLIGHT_RECORDER_EVENTS,
  MAX_FLIGHT_RECORDER_FIELDS,
  MAX_FLIGHT_RECORDER_INPUT_VALUES,
  MAX_FLIGHT_RECORDER_JSON_DEPTH,
  MAX_FLIGHT_RECORDER_JSON_VALUES,
  MAX_FLIGHT_RECORDER_OBSERVATIONS,
  MAX_FLIGHT_RECORDER_SOURCE_LENGTH,
  MAX_FLIGHT_RECORDER_UNIQUE_FIELDS,
  MAX_FLIGHT_RECORDER_VALUE_LENGTH,
  MAX_FLIGHT_RECORDER_VALUES,
  MAX_FLIGHT_RECORDER_WINDOWS,
  MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH,
  MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH,
  MIN_FLIGHT_RECORDER_OBSERVATIONS,
} from '../packages/contracts/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from '../packages/contracts/domain-control-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { defineSchemaLifecycleFamily } from '../packages/contracts/schema-lifecycle.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';

const GENERATED_AT = '2026-08-02T00:00:00.000Z';

const EXPECTED_HOOKS = [
  ['domain-control-flight-recorder.node.build', 'reviewer', 'node', 'lib/domain-control-flight-recorder.mts', 'buildDomainControlFlightRecorder'],
  ['domain-control-flight-recorder.node.validate-document', 'structure_validator', 'node', 'lib/domain-control-flight-recorder.mts', 'validateDomainControlFlightRecorderDocument'],
  ['domain-control-flight-recorder.node.format-terminal', 'serialiser', 'node', 'lib/domain-control-flight-recorder.mts', 'formatDomainControlFlightRecorder'],
  ['domain-control-flight-recorder.node.serialise-json', 'serialiser', 'node', 'lib/domain-control-flight-recorder.mts', 'serializeDomainControlFlightRecorder'],
  ['domain-control-flight-recorder.cli.monitor', 'monitor', 'cli', 'cli/domain-control-monitor.mts', 'runDomainControlMonitor'],
] as const;

const HOOK_MODULES = Object.freeze({
  'lib/domain-control-flight-recorder.mts': flightRecorderModule,
  'cli/domain-control-monitor.mts': domainControlMonitorModule,
});

function recursivelyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((item) => recursivelyFrozen(item, seen));
}

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('domain-control flight-recorder lifecycle', () => {
  test('registers one immutable two-contract family with exact executable hooks', () => {
    assert.deepEqual(
      SCHEMA_LIFECYCLE_REGISTRY.find((family) => family.id === DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.id),
      DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE,
    );
    assert.equal(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.owner, 'packages/contracts/domain-control-flight-recorder.mts');
    assert.deepEqual(
      DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.contracts.map((contract) => [
        contract.schema,
        contract.version,
        contract.role,
        contract.readable,
        contract.emitted,
        contract.futureVersionBehaviour,
      ]),
      [
        [DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, 1, 'input', true, false, 'reject'],
        [DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, 1, 'document', true, true, 'reject'],
      ],
    );
    assert.equal(recursivelyFrozen(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE), true);
    assert.deepEqual(
      DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.hooks.map((hook) => [
        hook.id, hook.role, hook.runtime, hook.module, hook.exportName,
      ]),
      EXPECTED_HOOKS,
    );
    for (const hook of DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.hooks) {
      const module = HOOK_MODULES[hook.module as keyof typeof HOOK_MODULES];
      assert.ok(module, hook.module);
      assert.equal(Object.hasOwn(module, hook.exportName), true, hook.exportName);
      assert.equal(typeof module[hook.exportName as keyof typeof module], 'function');
    }
  });

  test('pins immutable input and output bytes and reproduces the current document exactly', async () => {
    const inputRaw = await fixture('domain-control-flight-recorder-input-v1.json');
    const outputRaw = await fixture('domain-control-flight-recorder-v1.json');
    for (const [id, raw] of [
      ['domain-control-flight-recorder-input-v1', inputRaw],
      ['domain-control-flight-recorder-v1', outputRaw],
    ] as const) {
      const registered = DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.fixtures
        .find((candidate) => candidate.id === id);
      assert.ok(registered, id);
      assert.equal(raw.endsWith('\n'), true, id);
      assert.equal(Buffer.byteLength(raw, 'utf8'), registered.bytes, id);
      assert.equal(createHash('sha256').update(raw).digest('hex'), registered.sha256, id);
    }
    const document = flightRecorderModule.buildDomainControlFlightRecorder(JSON.parse(inputRaw), GENERATED_AT);
    assert.equal(flightRecorderModule.serializeDomainControlFlightRecorder(document), outputRaw);
    assert.deepEqual(document, JSON.parse(outputRaw));
    const validatedDocument = flightRecorderModule.validateDomainControlFlightRecorderDocument(JSON.parse(outputRaw));
    assert.deepEqual(validatedDocument, document);
    assert.equal(recursivelyFrozen(validatedDocument), true);
    for (const mutate of [
      (candidate: Record<string, unknown>) => { delete candidate.summary; },
      (candidate: Record<string, unknown>) => { candidate.unexpected = true; },
      (candidate: Record<string, unknown>) => {
        (candidate.summary as Record<string, unknown>).observedChanges = 2;
      },
    ]) {
      const candidate = JSON.parse(outputRaw) as Record<string, unknown>;
      mutate(candidate);
      assert.throws(() => flightRecorderModule.validateDomainControlFlightRecorderDocument(candidate));
    }
    const input = JSON.parse(inputRaw) as { approvedWindows: Array<{ reason: string }> };
    assert.equal(
      document.events.find((event) => event.approvedWindow)?.approvedWindow?.reason,
      input.approvedWindows[0]?.reason,
    );
  });

  test('owns exact shapes, bounds and the no-expiry policy', () => {
    const tuples = [
      DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_OBSERVATION_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_FIELD_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_WINDOW_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_ROOT_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_EVENT_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_APPROVED_WINDOW_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_SUMMARY_KEYS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS,
      DOMAIN_CONTROL_FLIGHT_RECORDER_LIMITATIONS,
    ];
    assert.equal(tuples.every(Object.isFrozen), true);
    assert.equal(MIN_FLIGHT_RECORDER_OBSERVATIONS, 1);
    assert.equal(MAX_FLIGHT_RECORDER_OBSERVATIONS, 200);
    assert.equal(MAX_FLIGHT_RECORDER_WINDOWS, 40);
    assert.equal(MAX_FLIGHT_RECORDER_FIELDS, 24);
    assert.equal(MAX_FLIGHT_RECORDER_UNIQUE_FIELDS, DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS.length);
    assert.equal(MAX_FLIGHT_RECORDER_INPUT_VALUES, MAX_FLIGHT_RECORDER_VALUES * 2);
    assert.equal(MAX_FLIGHT_RECORDER_EVENTS, MAX_FLIGHT_RECORDER_OBSERVATIONS * MAX_FLIGHT_RECORDER_FIELDS);
    assert.equal(MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_BYTES, MAX_DOMAIN_CONTROL_MANIFEST_BYTES);
    assert.equal(MAX_DOMAIN_CONTROL_FLIGHT_RECORDER_OUTPUT_BYTES, MAX_CLI_OUTPUT_BYTES);
    assert.equal(MAX_FLIGHT_RECORDER_JSON_DEPTH, 8);
    assert.equal(MAX_FLIGHT_RECORDER_JSON_VALUES, 400_000);
    assert.equal(MAX_FLIGHT_RECORDER_SOURCE_LENGTH, 120);
    assert.equal(MAX_FLIGHT_RECORDER_VALUE_LENGTH, 500);
    assert.equal(MAX_FLIGHT_RECORDER_WINDOW_ID_LENGTH, 64);
    assert.equal(MAX_FLIGHT_RECORDER_WINDOW_REASON_LENGTH, 400);
    assert.deepEqual(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.expiryProfiles, [{
      id: 'domain-control-flight-recorder.expiry-not-applicable.v1',
      field: null,
      anchor: null,
      handling: 'not_applicable',
      phase: 'not_applicable',
      maximumLifetimeDays: null,
    }]);

    const contradictory = structuredClone(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE) as any;
    contradictory.metadata.expiryProfiles[0].field = 'expiresAt';
    assert.throws(() => defineSchemaLifecycleFamily(contradictory), /inconsistent expiry handling/u);

    const inapplicableShape = structuredClone(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE) as any;
    Object.assign(inapplicableShape.metadata.expiryProfiles[0], {
      field: 'expiresAt',
      anchor: 'checkedAt',
      handling: 'report_expired',
      phase: 'review',
      maximumLifetimeDays: null,
    });
    assert.throws(
      () => defineSchemaLifecycleFamily(inapplicableShape),
      /must reference an expiry field declared by its contract shapes/u,
    );
  });

  test('derives both compatibility rows from the canonical family', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: GENERATED_AT });
    for (const descriptor of [
      DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_COMPATIBILITY,
      DOMAIN_CONTROL_FLIGHT_RECORDER_COMPATIBILITY,
    ]) {
      assert.deepEqual(inventory.entries.find((entry) => entry.id === descriptor.id), descriptor);
      assert.equal(descriptor.owner, 'packages/contracts/domain-control-flight-recorder.mts');
    }
    assert.equal(inventory.entries.filter((entry) => (
      entry.schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
      || entry.schema === DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA
    )).length, 2);
  });

  test('rejects non-ordinary arrays and accessors without invoking caller code', async () => {
    const input = JSON.parse(await fixture('domain-control-flight-recorder-input-v1.json')) as any;
    let rootGetterCalls = 0;
    Object.defineProperty(input, 'observations', {
      enumerable: true,
      configurable: true,
      get() {
        rootGetterCalls += 1;
        return [];
      },
    });
    assert.throws(
      () => flightRecorderModule.buildDomainControlFlightRecorder(input, GENERATED_AT),
      /enumerable data field/u,
    );
    assert.equal(rootGetterCalls, 0);

    const custom = JSON.parse(await fixture('domain-control-flight-recorder-input-v1.json')) as any;
    let customMapCalls = 0;
    Object.defineProperty(custom.observations, 'map', {
      configurable: true,
      value() {
        customMapCalls += 1;
        return [];
      },
    });
    assert.throws(
      () => flightRecorderModule.buildDomainControlFlightRecorder(custom, GENERATED_AT),
      /dense array without additional fields/u,
    );
    assert.equal(customMapCalls, 0);

    const overBound = JSON.parse(await fixture('domain-control-flight-recorder-input-v1.json')) as any;
    let tailGetterCalls = 0;
    const values = new Array(MAX_FLIGHT_RECORDER_INPUT_VALUES + 1).fill('bounded value');
    Object.defineProperty(values, String(MAX_FLIGHT_RECORDER_INPUT_VALUES), {
      enumerable: true,
      configurable: true,
      get() {
        tailGetterCalls += 1;
        return 'tail';
      },
    });
    overBound.observations[0].fields[0].values = values;
    assert.throws(
      () => flightRecorderModule.buildDomainControlFlightRecorder(overBound, GENERATED_AT),
      /must contain from 0 to 64 entries/u,
    );
    assert.equal(tailGetterCalls, 0);

    const invalidRetainedTail = JSON.parse(await fixture('domain-control-flight-recorder-input-v1.json')) as any;
    invalidRetainedTail.observations[0].fields[0].values = [
      ...Array.from({ length: MAX_FLIGHT_RECORDER_VALUES }, (_, index) => `value-${index}`),
      ...new Array(MAX_FLIGHT_RECORDER_INPUT_VALUES - MAX_FLIGHT_RECORDER_VALUES - 1).fill('value-0'),
      'x'.repeat(MAX_FLIGHT_RECORDER_VALUE_LENGTH + 1),
    ];
    assert.throws(
      () => flightRecorderModule.buildDomainControlFlightRecorder(invalidRetainedTail, GENERATED_AT),
      /must contain from 1 to 500 characters/u,
    );
  });

  test('accepts observation time equality and rejects observations later than document generation', async () => {
    const input = JSON.parse(await fixture('domain-control-flight-recorder-input-v1.json')) as {
      observations: Array<{ observedAt: string }>;
    };
    const equal = flightRecorderModule.buildDomainControlFlightRecorder(input, GENERATED_AT);
    assert.equal(equal.generatedAt, GENERATED_AT);
    assert.deepEqual(flightRecorderModule.validateDomainControlFlightRecorderDocument(equal), equal);

    input.observations.at(-1)!.observedAt = '2026-08-02T00:00:00.001Z';
    assert.throws(
      () => flightRecorderModule.buildDomainControlFlightRecorder(input, GENERATED_AT),
      /observations cannot be later than generatedAt/u,
    );
  });

  test('routes frozen JSON and terminal output without making a request', async () => {
    const input = await fixture('domain-control-flight-recorder-input-v1.json');
    const expectedJson = await fixture('domain-control-flight-recorder-v1.json');
    let stdout = '';
    let requested = false;
    assert.equal(await runCli(['domain-control', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write() {} },
      now: () => GENERATED_AT,
      readArtifactInput: async () => input,
      runUnifiedLookup: async () => { requested = true; return {}; },
    }), EXIT_CODES.SUCCESS);
    assert.equal(stdout, expectedJson);
    assert.equal(requested, false);

    stdout = '';
    assert.equal(await runCli(['domain-control'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write() {} },
      now: () => GENERATED_AT,
      readArtifactInput: async () => input,
    }), EXIT_CODES.SUCCESS);
    assert.match(stdout, /^Domain-control flight recorder/u);

    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-flight-recorder-'));
    try {
      const jsonPath = join(directory, 'history.json');
      const terminalPath = join(directory, 'history.txt');
      assert.equal(await runCli(['domain-control', '--json', '--output', jsonPath], {
        stderr: { write() {} }, now: () => GENERATED_AT, readArtifactInput: async () => input,
      }), EXIT_CODES.SUCCESS);
      assert.equal(await runCli(['domain-control', '--output', terminalPath], {
        stderr: { write() {} }, now: () => GENERATED_AT, readArtifactInput: async () => input,
      }), EXIT_CODES.SUCCESS);
      assert.equal(await readFile(jsonPath, 'utf8'), expectedJson);
      assert.match(await readFile(terminalPath, 'utf8'), /^Domain-control flight recorder/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('retains exact facade identities and route declarations', () => {
    assert.equal(flightRecorderModule.DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA);
    assert.equal(flightRecorderModule.DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA);
    assert.equal(flightRecorderModule.DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION, DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION);
    assert.equal(flightRecorderModule.DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS, DOMAIN_CONTROL_FLIGHT_RECORDER_FIELDS);
    assert.deepEqual(
      DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.consumerEdges.map((edge) => edge.id),
      [
        'domain-control-flight-recorder.node-build',
        'domain-control-flight-recorder.cli-json-stdout',
        'domain-control-flight-recorder.cli-terminal-stdout',
        'domain-control-flight-recorder.cli-json-file',
        'domain-control-flight-recorder.cli-terminal-file',
        'domain-control-flight-recorder.cli-monitor-embedding',
      ],
    );
    const monitorEdge = DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.consumerEdges
      .find((edge) => edge.id === 'domain-control-flight-recorder.cli-monitor-embedding');
    assert.deepEqual(monitorEdge, {
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
    });
    const actionBounds = DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.boundProfiles
      .find((profile) => profile.id === 'domain-control-flight-recorder.monitor-action.v1')?.bounds;
    assert.deepEqual(actionBounds, [
      { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: MIN_DOMAIN_CONTROL_MONITOR_DOMAINS, maximum: MAX_DOMAIN_CONTROL_MONITOR_DOMAINS, handling: 'reject' },
      { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY, maximum: MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY, handling: 'reject' },
    ]);
    const manifestMonitorEdge = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.metadata.consumerEdges
      .find((edge) => edge.id === 'domain-control.cli-monitor');
    assert.equal(manifestMonitorEdge?.expiryPolicyId, 'domain-control.expiry.require-current.v1');
    assert.equal(manifestMonitorEdge?.requestMode, 'explicit_bounded_passive_deep');

    for (const profile of DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE.metadata.privacyProfiles) {
      assert.equal(profile.includedCategories.includes('analyst-authored-window-reasons'), true, profile.id);
      assert.equal(profile.notePolicy, 'allowed_bounded', profile.id);
    }
  });
});
