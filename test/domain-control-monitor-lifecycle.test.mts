import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import * as ciReportModule from '../cli/ci-report.mts';
import {
  formatDomainControlMonitor,
  runDomainControlMonitor,
} from '../cli/domain-control-monitor.mts';
import * as monitorModule from '../cli/domain-control-monitor.mts';
import * as jsonFormatterModule from '../cli/formatters/json.mts';
import { formatCliJunit } from '../cli/ci-report.mts';
import { formatJsonDocument } from '../cli/formatters/json.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import { canonicalArtifactJson, SORTED_JSON_V1 } from '../packages/evidence/artifact-integrity.mts';
import {
  buildDomainControlManifest,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
} from '../lib/domain-control-manifest.mts';
import {
  CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
  CLI_DOMAIN_CONTROL_MONITOR_VERSION,
  DOMAIN_CONTROL_MONITOR_COLLECTION_KEYS,
  DOMAIN_CONTROL_MONITOR_COMPATIBILITY,
  DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES,
  DOMAIN_CONTROL_MONITOR_FAILURE_KEYS,
  DOMAIN_CONTROL_MONITOR_LIMITATIONS,
  DOMAIN_CONTROL_MONITOR_MANIFEST_KEYS,
  DOMAIN_CONTROL_MONITOR_ROOT_KEYS,
  DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE,
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS,
  MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH,
  MAX_DOMAIN_CONTROL_MONITOR_FAILURES,
  MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS,
  MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS,
} from '../packages/contracts/domain-control-monitor.mts';
import {
  MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY as MANIFEST_MONITOR_CONCURRENCY,
  MAX_DOMAIN_CONTROL_MONITOR_DOMAINS as MANIFEST_MONITOR_DOMAINS,
  MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY as MANIFEST_MONITOR_MINIMUM_CONCURRENCY,
  MIN_DOMAIN_CONTROL_MONITOR_DOMAINS as MANIFEST_MONITOR_MINIMUM_DOMAINS,
  LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
} from '../packages/contracts/domain-control-manifest.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';

const GENERATED_AT = '2026-08-20T00:00:00.000Z';
const MANIFEST_GENERATED_AT = '2026-08-19T00:00:00.000Z';
const MANIFEST_EXPIRES_AT = '2026-09-20T00:00:00.000Z';
const FIXTURE_BYTES = 7_332;
const FIXTURE_SHA256 = '1b505015fbc4cb6fc10b8d1c4552762fc78a21bea2f6614761e34d03f290ffb4';

const HOOK_MODULES = Object.freeze({
  'cli/domain-control-monitor.mts': monitorModule,
  'cli/formatters/json.mts': jsonFormatterModule,
  'cli/ci-report.mts': ciReportModule,
});

const EXPECTED_HOOKS = [
  ['domain-control-monitor.cli.run', 'monitor', 'cli', 'cli/domain-control-monitor.mts', 'runDomainControlMonitor'],
  ['domain-control-monitor.cli.serialise-json', 'serialiser', 'cli', 'cli/formatters/json.mts', 'formatJsonDocument'],
  ['domain-control-monitor.cli.format-terminal', 'serialiser', 'cli', 'cli/domain-control-monitor.mts', 'formatDomainControlMonitor'],
  ['domain-control-monitor.cli.format-junit', 'serialiser', 'cli', 'cli/ci-report.mts', 'formatCliJunit'],
] as const;

function recursivelyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((item) => recursivelyFrozen(item, seen));
}

function manifest(domains = ['example.test']) {
  return buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: 1,
    expiresAt: MANIFEST_EXPIRES_AT,
    entries: domains.map((domain) => ({
      domain,
      nameservers: [],
      ds: [],
      mx: [],
      caa: [],
      tlsIssuer: null,
      tlsSpkiSha256: null,
      registrarLock: null,
      renewalReviewAt: null,
      note: null,
    })),
  }, MANIFEST_GENERATED_AT);
}

function unsupportedResult() {
  return {
    diagnostics: {
      rdap: { status: 'unsupported' },
      whois: { status: 'unsupported' },
    },
    rdap: { parsed: {} },
    whois: { parsed: {} },
    availability: {
      dns: { status: 'unavailable' },
      tls: { status: 'unavailable' },
      http: { status: 'unavailable' },
      pageIdentity: { status: 'unavailable' },
    },
  };
}

async function fixture(): Promise<string> {
  return readFile(new URL('./fixtures/domain-control-monitor-v1.json', import.meta.url), 'utf8');
}

describe('domain-control monitor schema lifecycle', () => {
  test('registers one immutable exact-current family and its static hooks', () => {
    assert.deepEqual(
      SCHEMA_LIFECYCLE_REGISTRY.find((family) => family.id === DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.id),
      DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE,
    );
    assert.equal(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.owner, 'packages/contracts/domain-control-monitor.mts');
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.contracts.map((contract) => [
      contract.schema,
      contract.version,
      contract.role,
      contract.readable,
      contract.emitted,
      contract.futureVersionBehaviour,
    ]), [[CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, 1, 'document', true, true, 'reject']]);
    assert.equal(recursivelyFrozen(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE), true);
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.hooks.map((hook) => [
      hook.id, hook.role, hook.runtime, hook.module, hook.exportName,
    ]), EXPECTED_HOOKS);
    for (const hook of DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.hooks) {
      const module = HOOK_MODULES[hook.module as keyof typeof HOOK_MODULES];
      assert.ok(module, hook.module);
      assert.equal(Object.hasOwn(module, hook.exportName), true, hook.exportName);
      assert.equal(typeof module[hook.exportName as keyof typeof module], 'function');
    }
  });

  test('owns exact shape, bounds, privacy, and composition relationships', () => {
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.shapes, [{
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
    }]);
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.boundProfiles, [
      {
        id: 'domain-control-monitor.document-bounds.v1',
        bounds: [
          { id: 'observations', path: '$.observations', phase: 'normalised', unit: 'items', minimum: 1, maximum: 20, handling: 'reject' },
          { id: 'requested', path: '$.collection.requested', phase: 'normalised', unit: 'integer', minimum: 1, maximum: 20, handling: 'reject' },
          { id: 'succeeded', path: '$.collection.succeeded', phase: 'normalised', unit: 'integer', minimum: 1, maximum: 20, handling: 'reject' },
          { id: 'failed', path: '$.collection.failed', phase: 'normalised', unit: 'integer', minimum: 0, maximum: 20, handling: 'reject' },
          { id: 'failures', path: '$.collection.failures', phase: 'normalised', unit: 'items', minimum: 0, maximum: 20, handling: 'reject' },
          { id: 'failure-error', path: '$.collection.failures[].error', phase: 'normalised', unit: 'characters', minimum: 1, maximum: 300, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-monitor.cli-intake.v1',
        bounds: [
          { id: 'manifest-raw-bytes', path: '$.manifestInput', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: 16_777_216, handling: 'reject' },
          { id: 'previous-raw-bytes', path: '$.previousInput', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: 16_777_216, handling: 'reject' },
          { id: 'json-depth', path: '$', phase: 'pre_accumulation', unit: 'depth', minimum: 0, maximum: 48, handling: 'reject' },
          { id: 'json-keys', path: '$', phase: 'pre_accumulation', unit: 'keys', minimum: 1, maximum: 50_000, handling: 'reject' },
          { id: 'json-values', path: '$', phase: 'pre_accumulation', unit: 'values', minimum: 1, maximum: 100_000, handling: 'reject' },
          { id: 'json-container-items', path: '$', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: 10_000, handling: 'reject' },
        ],
      },
      {
        id: 'domain-control-monitor.action.v1',
        bounds: [
          { id: 'limit', path: '$.options.limit', phase: 'action', unit: 'entries', minimum: 1, maximum: 20, handling: 'reject' },
          { id: 'concurrency', path: '$.options.concurrency', phase: 'action', unit: 'concurrency', minimum: 1, maximum: 3, handling: 'reject' },
        ],
      },
    ]);
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.consumerRelationships, [
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
    ]);
    const runEdge = DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.consumerEdges
      .find((edge) => edge.id === 'domain-control-monitor.cli-run');
    assert.equal(runEdge?.requestMode, 'explicit_bounded_passive_deep');
    assert.equal(runEdge?.policyState, 'current');
    assert.equal(runEdge?.bindingState, 'declared_unenforced');
    assert.equal(runEdge?.expiryPolicyId, 'domain-control-monitor.expiry.not-applicable.v1');
    const privacy = DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.metadata.privacyProfiles
      .find((profile) => profile.id === runEdge?.privacyProfileId);
    assert.equal(privacy?.classification, 'analyst_authored_sensitive');
    assert.equal(privacy?.sharingReview, 'required');
    assert.equal(privacy?.excludedCategories.includes('raw-upstream-payloads'), true);
  });

  test('derives compatibility and preserves the historical manifest bound facade', () => {
    const inventory = buildSchemaCompatibilityInventory();
    assert.deepEqual(
      inventory.entries.find((entry) => entry.id === DOMAIN_CONTROL_MONITOR_COMPATIBILITY.id),
      DOMAIN_CONTROL_MONITOR_COMPATIBILITY,
    );
    assert.equal(DOMAIN_CONTROL_MONITOR_COMPATIBILITY.owner, 'packages/contracts/domain-control-monitor.mts');
    assert.equal(MANIFEST_MONITOR_DOMAINS, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS);
    assert.equal(MANIFEST_MONITOR_CONCURRENCY, MAX_DOMAIN_CONTROL_MONITOR_CONCURRENCY);
    assert.equal(MANIFEST_MONITOR_MINIMUM_DOMAINS, MIN_DOMAIN_CONTROL_MONITOR_DOMAINS);
    assert.equal(MANIFEST_MONITOR_MINIMUM_CONCURRENCY, MIN_DOMAIN_CONTROL_MONITOR_CONCURRENCY);
    assert.equal(MAX_DOMAIN_CONTROL_MONITOR_FAILURES, MAX_DOMAIN_CONTROL_MONITOR_DOMAINS);
    assert.equal(MAX_DOMAIN_CONTROL_MONITOR_ERROR_LENGTH, 300);
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES, ['Lookup failed']);
    assert.equal(Object.isFrozen(DOMAIN_CONTROL_MONITOR_FAILURE_CATEGORIES), true);
    assert.deepEqual([
      MAX_DOMAIN_CONTROL_MONITOR_INPUT_BYTES,
      MAX_DOMAIN_CONTROL_MONITOR_JSON_DEPTH,
      MAX_DOMAIN_CONTROL_MONITOR_JSON_KEYS,
      MAX_DOMAIN_CONTROL_MONITOR_JSON_VALUES,
      MAX_DOMAIN_CONTROL_MONITOR_JSON_CONTAINER_ITEMS,
    ], [16_777_216, 48, 50_000, 100_000, 10_000]);
  });

  test('pins one LF fixture and reproduces its bytes exactly through Deep collection', async () => {
    const raw = await fixture();
    assert.equal(Buffer.byteLength(raw, 'utf8'), FIXTURE_BYTES);
    assert.equal(createHash('sha256').update(raw).digest('hex'), FIXTURE_SHA256);
    assert.equal(raw.endsWith('\n'), true);
    const modes: Array<Readonly<{ fast: boolean; compact: boolean }>> = [];
    const document = await runDomainControlMonitor(JSON.stringify(manifest()), null, {
      executeLookup: async (_classified, options) => {
        assert.ok(options);
        modes.push({ fast: options.fast === true, compact: options.compact === true });
        return unsupportedResult();
      },
      now: () => GENERATED_AT,
      limit: 1,
      concurrency: 1,
    });
    assert.deepEqual(modes, [{ fast: false, compact: false }]);
    assert.equal(formatJsonDocument(document), raw);
    assert.deepEqual(document, JSON.parse(raw));
    assert.deepEqual(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE.fixtures, [{
      id: 'domain-control-monitor-v1',
      path: 'test/fixtures/domain-control-monitor-v1.json',
      bytes: FIXTURE_BYTES,
      sha256: FIXTURE_SHA256,
      contentDigestSha256: null,
      schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
      version: CLI_DOMAIN_CONTROL_MONITOR_VERSION,
      role: 'current',
      expectation: 'accepted_exact',
      expectedOutputFixtureId: null,
      scope: 'repository',
    }]);
  });

  test('fails closed on altered checkpoints before collection but retains historical expiry as provenance', async () => {
    const raw = await fixture();
    const currentManifest = JSON.stringify(manifest());
    let calls = 0;
    const executeLookup = async () => {
      calls += 1;
      return unsupportedResult();
    };
    const mutations: Array<readonly [(document: Record<string, unknown>) => void, RegExp]> = [
      [(document) => { document.version = 2; }, /must use .* version/u],
      [(document) => { document.unexpected = true; }, /exact object fields/u],
      [(document) => { delete document.collection; }, /exact object fields/u],
      [(document) => {
        const collection = document.collection as Record<string, unknown>;
        collection.succeeded = 2;
      }, /collection counts are inconsistent/u],
      [(document) => {
        const review = document.review as Record<string, unknown>;
        review.version = 2;
      }, /review must use the exact/u],
      [(document) => {
        const review = document.review as Record<string, unknown>;
        delete review.state;
      }, /review must use the exact/u],
      [(document) => {
        const review = document.review as Record<string, unknown>;
        review.unexpected = 'private-marker';
      }, /review must use the exact/u],
      [(document) => {
        const flightRecorder = document.flightRecorder as Record<string, unknown>;
        delete flightRecorder.summary;
      }, /flight recorder must use the exact/u],
      [(document) => {
        const flightRecorder = document.flightRecorder as Record<string, unknown>;
        flightRecorder.unexpected = 'private-marker';
      }, /flight recorder must use the exact/u],
      [(document) => {
        const flightRecorder = document.flightRecorder as Record<string, unknown>;
        flightRecorder.domains = ['different.test'];
      }, /embedded documents are inconsistent/u],
      [(document) => {
        (document.manifest as Record<string, unknown>).expiresAt = '2026-08-19T00:00:00.000Z';
        const review = document.review as Record<string, unknown>;
        review.state = 'expired';
        const reviewManifest = review.manifest as Record<string, unknown>;
        reviewManifest.expiresAt = '2026-08-19T00:00:00.000Z';
        reviewManifest.expired = true;
      }, /must have been unexpired when the checkpoint was generated/u],
    ];
    for (const [mutate, expected] of mutations) {
      const candidate = JSON.parse(raw) as Record<string, unknown>;
      mutate(candidate);
      await assert.rejects(() => runDomainControlMonitor(currentManifest, JSON.stringify(candidate), {
        executeLookup,
        now: () => '2026-08-21T00:00:00.000Z',
        limit: 1,
        concurrency: 1,
      }), expected);
    }
    assert.equal(calls, 0);

    const expiredCheckpoint = JSON.parse(raw) as Record<string, unknown>;
    (expiredCheckpoint.manifest as Record<string, unknown>).expiresAt = '2026-08-20T12:00:00.000Z';
    const expiredReview = (expiredCheckpoint.review as Record<string, unknown>).manifest as Record<string, unknown>;
    expiredReview.expiresAt = '2026-08-20T12:00:00.000Z';
    const document = await runDomainControlMonitor(currentManifest, JSON.stringify(expiredCheckpoint), {
      executeLookup,
      now: () => '2026-08-21T00:00:00.000Z',
      limit: 1,
      concurrency: 1,
    });
    assert.equal(calls, 1);
    assert.equal(document.flightRecorder.observationCount, 2);
  });

  test('rejects a genuinely newer checkpoint and future-dated reused observations before collection', async () => {
    const currentManifest = JSON.stringify(manifest());
    const futureCheckpoint = await runDomainControlMonitor(currentManifest, null, {
      executeLookup: async () => unsupportedResult(),
      now: () => '2026-08-22T00:00:00.000Z',
      limit: 1,
      concurrency: 1,
    });
    let calls = 0;
    await assert.rejects(() => runDomainControlMonitor(currentManifest, JSON.stringify(futureCheckpoint), {
      executeLookup: async () => {
        calls += 1;
        return unsupportedResult();
      },
      now: () => GENERATED_AT,
      limit: 1,
      concurrency: 1,
    }), /must precede the current monitor run/u);
    assert.equal(calls, 0);

    const futureObservation = JSON.parse(await fixture()) as Record<string, unknown>;
    const observations = futureObservation.observations as Array<Record<string, unknown>>;
    observations[0]!.observedAt = '2026-08-21T00:00:00.000Z';
    const backdatedObservation = JSON.parse(await fixture()) as Record<string, unknown>;
    ((backdatedObservation.observations as Array<Record<string, unknown>>)[0]!).observedAt = '2026-08-19T00:00:00.000Z';
    const futureReview = JSON.parse(await fixture()) as Record<string, unknown>;
    const reviewDomains = (futureReview.review as Record<string, unknown>).domains as Array<Record<string, unknown>>;
    const reviewComparisons = reviewDomains[0]!.comparisons as Array<Record<string, unknown>>;
    reviewComparisons[0]!.observedAt = '2026-08-22T00:00:00.000Z';
    for (const candidate of [futureObservation, backdatedObservation, futureReview]) {
      await assert.rejects(() => runDomainControlMonitor(currentManifest, JSON.stringify(candidate), {
        executeLookup: async () => {
          calls += 1;
          return unsupportedResult();
        },
        now: () => '2026-08-23T00:00:00.000Z',
        limit: 1,
        concurrency: 1,
      }), /bounded flight-recorder input contract|embedded documents are inconsistent|observation projection/u);
    }
    assert.equal(calls, 0);
  });

  test('reuses a checkpoint built from a supported supplied-order version-1 manifest', async () => {
    const current = manifest(['aa.example', 'z.example']);
    const { integrity, ...unsigned } = current;
    const legacyUnsigned = Object.freeze({
      ...unsigned,
      version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
      entries: Object.freeze([...unsigned.entries].reverse()),
    });
    const legacyManifest = Object.freeze({
      ...legacyUnsigned,
      integrity: Object.freeze({
        ...integrity,
        canonicalization: SORTED_JSON_V1,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJson(legacyUnsigned)).digest('hex')}`,
      }),
    });
    let calls = 0;
    const executeLookup = async () => {
      calls += 1;
      return unsupportedResult();
    };
    const first = await runDomainControlMonitor(JSON.stringify(legacyManifest), null, {
      executeLookup,
      now: () => GENERATED_AT,
      limit: 2,
      concurrency: 1,
    });
    assert.deepEqual(first.review.domains.map((item) => item.domain), ['z.example', 'aa.example']);
    const second = await runDomainControlMonitor(JSON.stringify(legacyManifest), JSON.stringify(first), {
      executeLookup,
      now: () => '2026-08-21T00:00:00.000Z',
      limit: 2,
      concurrency: 1,
    });
    assert.equal(calls, 4);
    assert.equal(second.flightRecorder.observationCount, 4);
  });

  test('rejects impossible success and failure identity projections before collection', async () => {
    const threeDomainManifest = JSON.stringify(manifest(['alpha.test', 'beta.test', 'gamma.test']));
    const partial = await runDomainControlMonitor(threeDomainManifest, null, {
      executeLookup: async (classified: ClassifiedQuery) => {
        if (classified.registrableDomain === 'alpha.test') return unsupportedResult();
        throw new Error('Synthetic collection failure');
      },
      now: () => GENERATED_AT,
      limit: 3,
      concurrency: 1,
    });
    const twoDomainManifest = JSON.stringify(manifest(['alpha.test', 'beta.test']));
    const complete = await runDomainControlMonitor(twoDomainManifest, null, {
      executeLookup: async () => unsupportedResult(),
      now: () => GENERATED_AT,
      limit: 2,
      concurrency: 1,
    });
    const limited = await runDomainControlMonitor(threeDomainManifest, null, {
      executeLookup: async (classified: ClassifiedQuery) => {
        if (classified.registrableDomain === 'alpha.test') return unsupportedResult();
        throw new Error('Synthetic collection failure');
      },
      now: () => GENERATED_AT,
      limit: 2,
      concurrency: 1,
    });
    const candidates: Array<readonly [Record<string, unknown>, RegExp]> = [];

    const overlapping = structuredClone(partial) as unknown as Record<string, unknown>;
    const overlappingCollection = overlapping.collection as Record<string, unknown>;
    ((overlappingCollection.failures as Array<Record<string, unknown>>)[0]!).domain = 'alpha.test';
    candidates.push([overlapping, /embedded documents are inconsistent/u]);

    const duplicateFailures = structuredClone(partial) as unknown as Record<string, unknown>;
    const duplicateCollection = duplicateFailures.collection as Record<string, unknown>;
    const duplicateFailureValues = duplicateCollection.failures as Array<Record<string, unknown>>;
    duplicateFailureValues[1]!.domain = duplicateFailureValues[0]!.domain;
    candidates.push([duplicateFailures, /failure 2 is invalid/u]);

    const invalidFailure = structuredClone(partial) as unknown as Record<string, unknown>;
    const invalidCollection = invalidFailure.collection as Record<string, unknown>;
    ((invalidCollection.failures as Array<Record<string, unknown>>)[0]!).domain = 'not a domain';
    candidates.push([invalidFailure, /failure 1 domain is invalid/u]);

    const reversedFailures = structuredClone(partial) as unknown as Record<string, unknown>;
    const reversedCollection = reversedFailures.collection as Record<string, unknown>;
    (reversedCollection.failures as Array<Record<string, unknown>>).reverse();
    candidates.push([reversedFailures, /embedded documents are inconsistent/u]);

    const unrequestedFailure = structuredClone(limited) as unknown as Record<string, unknown>;
    const unrequestedCollection = unrequestedFailure.collection as Record<string, unknown>;
    ((unrequestedCollection.failures as Array<Record<string, unknown>>)[0]!).domain = 'gamma.test';
    candidates.push([unrequestedFailure, /embedded documents are inconsistent/u]);

    const duplicateObservations = structuredClone(complete) as unknown as Record<string, unknown>;
    const observationValues = duplicateObservations.observations as Array<Record<string, unknown>>;
    observationValues[1]!.domain = observationValues[0]!.domain;
    candidates.push([duplicateObservations, /embedded documents are inconsistent/u]);

    let calls = 0;
    for (const [candidate, expected] of candidates) {
      const source = (candidate.collection as Record<string, unknown>).failed === 0
        ? twoDomainManifest
        : threeDomainManifest;
      await assert.rejects(() => runDomainControlMonitor(source, JSON.stringify(candidate), {
        executeLookup: async () => {
          calls += 1;
          return unsupportedResult();
        },
        now: () => '2026-08-21T00:00:00.000Z',
        limit: 3,
        concurrency: 1,
      }), expected);
    }
    assert.equal(calls, 0);
  });

  test('categorises thrown values without reading or retaining their messages', async () => {
    let messageReads = 0;
    const hostileError = Object.create(Error.prototype);
    Object.defineProperty(hostileError, 'message', {
      enumerable: true,
      get() {
        messageReads += 1;
        throw new Error('private-accessor-marker');
      },
    });
    const document = await runDomainControlMonitor(JSON.stringify(manifest(['alpha.test', 'beta.test'])), null, {
      executeLookup: async (classified: ClassifiedQuery) => {
        if (classified.registrableDomain === 'alpha.test') throw hostileError;
        return unsupportedResult();
      },
      now: () => GENERATED_AT,
      limit: 2,
      concurrency: 1,
    });
    assert.equal(messageReads, 0);
    assert.deepEqual(document.collection.failures, [{ domain: 'alpha.test', error: 'Lookup failed' }]);
    assert.equal(recursivelyFrozen(document), true);
    assert.doesNotMatch(JSON.stringify(document), /private-accessor-marker/u);
  });

  test('orders concurrent failures by manifest entry and keeps terminal and JUnit output target-free', async () => {
    const rejectors = new Map<string, (reason: Error) => void>();
    const pending = runDomainControlMonitor(JSON.stringify(manifest([
      'alpha.test',
      'beta.test',
      'gamma.test',
    ])), null, {
      executeLookup: async (classified: ClassifiedQuery) => {
        const domain = classified.registrableDomain || 'example.test';
        if (domain === 'gamma.test') return unsupportedResult();
        return new Promise((_resolve, reject) => rejectors.set(domain, reject));
      },
      now: () => GENERATED_AT,
      limit: 3,
      concurrency: 3,
    });
    while (rejectors.size < 2) await new Promise((resolve) => setImmediate(resolve));
    rejectors.get('beta.test')!(new Error('Request timed out at https://beta.test/private?trace=private-query-marker'));
    rejectors.get('alpha.test')!(new Error('Failed https://analyst:credential-marker@alpha.test/private/path?trace=private-query-marker'));
    const document = await pending;
    assert.deepEqual(document.collection.failures.map((failure) => failure.domain), ['alpha.test', 'beta.test']);
    assert.deepEqual(document.collection.failures.map((failure) => failure.error), ['Lookup failed', 'Lookup failed']);
    assert.equal(document.collection.failed, 2);
    const terminal = formatDomainControlMonitor(document);
    const junit = formatCliJunit(document);
    for (const output of [terminal, junit]) {
      assert.equal(output.includes('alpha.test'), false);
      assert.equal(output.includes('beta.test'), false);
      assert.equal(output.includes('gamma.test'), false);
      assert.equal(output.includes(document.manifest.digestSha256), false);
    }
    assert.doesNotMatch(JSON.stringify(document), /credential-marker|private-query-marker|\/private\/path/u);
    assert.match(terminal, /Failed\s+2/u);
    assert.match(junit, /failures="1"/u);
  });

  test('reports desired-state drift through target-free JUnit output', async () => {
    const configuredManifest = buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: 1,
      expiresAt: MANIFEST_EXPIRES_AT,
      entries: [{
        domain: 'example.test',
        nameservers: ['ns1.example.test'],
        ds: [],
        mx: [],
        caa: [],
        tlsIssuer: null,
        tlsSpkiSha256: null,
        registrarLock: null,
        renewalReviewAt: null,
        note: null,
      }],
    }, MANIFEST_GENERATED_AT);
    const document = await runDomainControlMonitor(JSON.stringify(configuredManifest), null, {
      executeLookup: async () => ({
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'unsupported' } },
        rdap: { parsed: { nameservers: ['ns2.example.test'] } },
        whois: { parsed: {} },
        availability: {
          dns: { status: 'success', records: { ns: ['ns2.example.test'], mx: [], caa: [] }, delegation: { status: 'success', records: { ds: [] } } },
          tls: { status: 'unavailable' },
          http: { status: 'unavailable' },
          pageIdentity: { status: 'unavailable' },
        },
      }),
      now: () => GENERATED_AT,
      limit: 1,
      concurrency: 1,
    });
    assert.equal(document.review.state, 'drift');
    assert.equal(document.review.counts.drift, 1);
    assert.equal(document.flightRecorder.summary.unexpectedChanges, 0);
    const junit = formatCliJunit(document);
    assert.match(junit, /tests="3" failures="1"/u);
    assert.match(junit, /name="desired domain control state"/u);
    assert.doesNotMatch(junit, /example\.test|ns1|ns2/u);
  });
});
