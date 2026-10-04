import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  assertBoundedJsonStructure,
  parseBoundedJsonObject,
} from '../packages/analysis/bounded-json.mts';
import {
  conformanceBundles,
  schemaTreeSha256,
  SCHEMA_TREE_SHA256,
  SCHEMA_REVISION,
} from '../tools/stix-schema-conformance.mts';
import { buildMispIndicatorExport } from '../packages/interchange/misp-indicator-export.mts';
import {
  buildManagedIndicatorRevision,
  managedIndicatorState,
} from '../packages/interchange/managed-indicator-set.mts';
import { exportManagedIndicators } from '../packages/interchange/managed-indicator-export.mts';
import { createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  mergeExternalIntelligenceIntoCase,
  parseExternalIntelligenceDocument,
} from '../frontend/src/lib/analysis/external-intelligence-import.ts';

export const MAX_CONSUMER_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_CONSUMER_OUTPUT_BYTES = 4 * 1024 * 1024;
export const CONSUMER_TIMEOUT_MS = 30_000;
export const REVIEWED_CONSUMER_VERSIONS = Object.freeze({
  stix2: '3.0.2',
  'stix2-validator': '3.3.1',
  pymisp: '2.5.34.4',
});
const PRIVATE_CANARY = 'private-fixture-fields-must-not-export';
const NOW = '2026-08-01T00:00:00.000Z',
  NEXT = '2026-08-02T00:00:00.000Z';
const EXPIRY = '2026-09-01T00:00:00.000Z',
  RENEWED = '2026-10-01T00:00:00.000Z';
type Value = Record<string, unknown>;
export type ConsumerFixture = Readonly<{
  id: string;
  format: 'stix' | 'misp';
  value: Value;
  negative?: boolean;
}>;
type ConsumerResult = Readonly<{
  id: string;
  valid: boolean;
  value?: Value;
  errors?: number;
  warnings?: number;
  errorType?: string;
  sharedSchemaCorpus?: boolean;
  consumerWheelResourcesAbsent?: boolean;
  strict?: Readonly<{ valid: boolean; errorCount: number; errors: readonly unknown[] }>;
}>;
type ConsumerReply = Readonly<{
  version: 1;
  versions: typeof REVIEWED_CONSUMER_VERSIONS;
  networkGuardPassed: true;
  networkRefusals: 0;
  results: readonly ConsumerResult[];
}>;

function record(value: unknown): Value {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Consumer reply has an unsupported structure.');
  return value as Value;
}
function objects(value: Value): Value[] {
  const values = value.objects;
  if (!Array.isArray(values)) throw new TypeError('Expected STIX objects.');
  return values.map(record);
}
function event(value: Value): Value {
  return record(value.Event);
}
function attributes(value: Value): Value[] {
  const values = event(value).Attribute;
  if (!Array.isArray(values)) throw new TypeError('Expected MISP attributes.');
  return values.map(record);
}

export async function consumerFixtures(): Promise<readonly ConsumerFixture[]> {
  const [indicators, sightings] = conformanceBundles().map(
    (content) => JSON.parse(content) as Value,
  );
  const fixtures: ConsumerFixture[] = [
    { id: 'stix-defensive', format: 'stix', value: indicators! },
    { id: 'stix-case-sightings', format: 'stix', value: sightings! },
  ];
  const marked = structuredClone(indicators!);
  const markingId = 'marking-definition--f88d31f6-486f-44da-b317-01333bde0b82';
  (marked.objects as unknown[]).push({
    type: 'marking-definition',
    spec_version: '2.1',
    id: markingId,
    created: '2017-01-20T00:00:00.000Z',
    name: 'TLP:AMBER',
    definition_type: 'tlp',
    definition: { tlp: 'amber' },
  });
  objects(marked)
    .filter((item) => item.type === 'indicator')
    .forEach((item) => (item.object_marking_refs = [markingId]));
  fixtures.push({ id: 'stix-markings', format: 'stix', value: marked });
  const rows = [
    { domain: 'candidate.example', observedAt: '2026-07-31T00:00:00.000Z' },
    { domain: 'unknown-time.example', observedAt: null },
  ].map((row) => ({
    ...row,
    availability: 'registered',
    status: 'complete',
    risk: 85,
    riskModelVersion: 7,
    scanDepth: 'deep',
    profileContext: { sourceState: 'ready' },
    analystDisposition: 'suspicious',
    rawRdap: PRIVATE_CANARY,
    contacts: PRIVATE_CANARY,
    notes: PRIVATE_CANARY,
    credentials: PRIVATE_CANARY,
  }));
  const misp = JSON.parse(buildMispIndicatorExport(rows, { generatedAt: NOW }).content) as Value;
  fixtures.push({ id: 'misp-defensive', format: 'misp', value: misp });
  const mispMarked = structuredClone(misp);
  event(mispMarked).Tag = [{ name: 'tlp:amber' }];
  fixtures.push({ id: 'misp-markings', format: 'misp', value: mispMarked });
  const first = (
    await buildManagedIndicatorRevision(
      {
        name: 'Reserved review fixtures',
        basis: 'Explicit retained observation review.',
        expiresAt: EXPIRY,
        rows,
        selectedDomains: rows.map((row) => row.domain),
      },
      NOW,
    )
  ).manifest;
  const renewed = (
    await buildManagedIndicatorRevision(
      {
        previous: first,
        basis: 'Reconfirmed retained observations.',
        renewIds: [first.entries[0]!.id],
        expiresAt: RENEWED,
      },
      NEXT,
    )
  ).manifest;
  const withdrawn = (
    await buildManagedIndicatorRevision(
      {
        previous: renewed,
        basis: 'Corrected the reviewed attribution.',
        withdrawIds: [first.entries[0]!.id],
      },
      '2026-08-03T00:00:00.000Z',
    )
  ).manifest;
  assert.equal(managedIndicatorState(first.entries[0]!, EXPIRY), 'expired');
  for (const [label, manifest] of [
    ['new', first],
    ['renewed', renewed],
    ['expired', first],
    ['withdrawn', withdrawn],
  ] as const) {
    for (const format of ['stix', 'misp'] as const)
      fixtures.push({
        id: `${format}-managed-${label}`,
        format,
        value: JSON.parse((await exportManagedIndicators(manifest, format)).content) as Value,
      });
  }
  const malformedStix = structuredClone(indicators!);
  objects(malformedStix).find((item) => item.type === 'indicator')!.pattern = '[invalid pattern';
  fixtures.push({
    id: 'negative-stix-pattern',
    format: 'stix',
    value: malformedStix,
    negative: true,
  });
  const malformedMisp = structuredClone(misp);
  attributes(malformedMisp)[0]!.to_ids = 'not-a-boolean';
  fixtures.push({
    id: 'negative-misp-boolean',
    format: 'misp',
    value: malformedMisp,
    negative: true,
  });
  for (const fixture of fixtures)
    assert.ok(!JSON.stringify(fixture.value).includes(PRIVATE_CANARY));
  return fixtures;
}

export function runConsumer(
  python: string,
  fixtures: readonly ConsumerFixture[],
  timeoutMs = CONSUMER_TIMEOUT_MS,
): ConsumerReply {
  if (
    !python ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CONSUMER_TIMEOUT_MS ||
    !Array.isArray(fixtures) ||
    fixtures.length < 1 ||
    fixtures.length > 16
  )
    throw new TypeError('Invalid offline consumer invocation.');
  assertBoundedJsonStructure(fixtures, 'Consumer fixtures', {
    maximumStringCodeUnits: MAX_CONSUMER_INPUT_BYTES,
    maximumDepth: 16,
    maximumContainerItems: 1_000,
  });
  const input = JSON.stringify({
    version: 1,
    documents: fixtures.map(({ id, format, value }) => ({ id, format, value })),
  });
  if (Buffer.byteLength(input) > MAX_CONSUMER_INPUT_BYTES)
    throw new TypeError('Consumer fixtures exceed their byte limit.');
  const result = spawnSync(
    python,
    [
      '-I',
      '-B',
      fileURLToPath(new URL('./fixtures/interchange-consumer.py', import.meta.url)),
    ],
    {
      input,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_CONSUMER_OUTPUT_BYTES,
      env: { PATH: process.env.PATH ?? '', TZ: 'UTC' },
    },
  );
  if (result.error || result.signal || result.status !== 0)
    throw new Error('Offline consumer process failed, timed out or exceeded its output limit.');
  const reply = parseBoundedJsonObject(result.stdout, {
    label: 'Consumer reply',
    maximumBytes: MAX_CONSUMER_OUTPUT_BYTES,
  });
  if (
    reply.version !== 1 ||
    reply.networkGuardPassed !== true ||
    reply.networkRefusals !== 0 ||
    !Array.isArray(reply.results) ||
    reply.results.length !== fixtures.length ||
    JSON.stringify(reply.versions) !== JSON.stringify(REVIEWED_CONSUMER_VERSIONS)
  )
    throw new TypeError(
      'Consumer reply has an unsupported version, network refusal or result count.',
    );
  for (let index = 0; index < fixtures.length; index++) {
    const item = record(reply.results[index]);
    if (item.id !== fixtures[index]!.id || typeof item.valid !== 'boolean')
      throw new TypeError('Consumer reply does not match the requested fixtures.');
  }
  return reply as ConsumerReply;
}

export function assertMispPrivacy(value: Value): void {
  const source = event(value);
  assert.equal(source.published, false, 'MISP event must remain unpublished.');
  assert.equal(Number(source.distribution), 0, 'MISP event must remain organisation-only.');
  assert.equal(source.disable_correlation, true, 'MISP event correlation must remain disabled.');
  for (const item of attributes(value)) {
    assert.equal(item.to_ids, false, 'MISP attributes must remain non-IDS.');
    assert.equal(
      item.disable_correlation,
      true,
      'MISP attribute correlation must remain disabled.',
    );
    assert.equal(
      Number(item.distribution),
      5,
      'MISP attributes must inherit the event restriction.',
    );
  }
}

export function verifyConsumerRoundtrip(fixture: ConsumerFixture, result: ConsumerResult) {
  if (fixture.negative) {
    assert.equal(result.valid, false, 'Malformed control must not validate.');
    return { id: fixture.id, state: 'rejected control' as const };
  }
  assert.equal(
    result.valid,
    true,
    `Consumer rejected ${fixture.id} (${result.errorType ?? result.errors ?? 'unknown'}).`,
  );
  const returned = record(result.value);
  const importPreview = (value: Value) =>
    parseExternalIntelligenceDocument(
      value,
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    );
  const before = importPreview(fixture.value),
    after = importPreview(returned);
  assert.deepEqual(
    after.items,
    before.items,
    'Normalised claims, IDs, clocks and markings changed through the consumer.',
  );
  assert.equal(after.truncated, false);
  if (fixture.format === 'stix') {
    const old = objects(fixture.value),
      next = objects(returned);
    assert.deepEqual(
      next.map((item) => item.id),
      old.map((item) => item.id),
    );
    for (const source of old) {
      const item = next.find((candidate) => candidate.id === source.id)!;
      // STIX defines omitted revoked as false; stix2 omits this optional
      // default on serialisation. True withdrawal must still be explicit.
      assert.ok(item.revoked === undefined || typeof item.revoked === 'boolean');
      assert.equal(
        item.revoked ?? false,
        source.revoked ?? false,
        'STIX revocation semantics changed.',
      );
      for (const key of ['object_marking_refs']) {
        assert.deepEqual(item[key], source[key], `STIX ${key} was not preserved.`);
      }
      for (const key of Object.keys(source).filter((key) => key.startsWith('x_'))) {
        assert.deepEqual(item[key], source[key], 'STIX source-qualified custom evidence changed.');
      }
      for (const key of [
        'created',
        'modified',
        'valid_from',
        'valid_until',
        'first_observed',
        'last_observed',
      ]) {
        // Consumer serialisation may omit redundant .000 precision. Compare
        // actual UTC instants without replacing missing clocks with a value.
        if (source[key] === undefined)
          assert.equal(item[key], undefined, `STIX ${key} appeared without a source clock.`);
        else {
          assert.equal(typeof item[key], 'string', `STIX ${key} was omitted.`);
          assert.equal(
            new Date(item[key] as string).toISOString(),
            new Date(source[key] as string).toISOString(),
            `STIX ${key} changed.`,
          );
        }
      }
    }
  } else {
    assertMispPrivacy(returned);
    assert.equal(event(returned).uuid, event(fixture.value).uuid);
    assert.equal(Number(event(returned).timestamp), Number(event(fixture.value).timestamp));
    assert.deepEqual(
      attributes(returned).map((item) => item.uuid),
      attributes(fixture.value).map((item) => item.uuid),
    );
    for (const source of attributes(fixture.value)) {
      const item = attributes(returned).find((candidate) => candidate.uuid === source.uuid)!;
      assert.equal(item.deleted, source.deleted);
      assert.equal(
        item.comment,
        source.comment,
        'MISP review basis changed before the intentionally lossy Case projection.',
      );
      assert.equal(Number(item.timestamp), Number(source.timestamp));
      if (!Object.hasOwn(source, 'first_seen')) {
        assert.equal(Object.hasOwn(item, 'first_seen'), false);
        assert.equal(Object.hasOwn(item, 'last_seen'), false);
      }
    }
  }
  assert.ok(after.sourceInspection!.transformations.length > 0);
  return {
    id: fixture.id,
    state: 'roundtrip verified' as const,
    claims: after.items.length,
    excluded: after.exclusions.length,
    warnings: result.warnings ?? 0,
    strictMispSchema: result.strict?.valid ?? null,
    strictMispSchemaErrors: result.strict?.errors ?? [],
    normalisations:
      fixture.format === 'stix'
        ? [
            'UTC timestamp precision may be shortened; optional revoked:false may be omitted according to the STIX default. Originals remain unchanged.',
          ]
        : [
            'Numeric timestamp and distribution strings may be represented as numbers. Originals remain unchanged.',
          ],
    losses:
      fixture.format === 'stix'
        ? [
            'Case claims do not retain descriptions, note bodies, complete relationship history, validity windows or revocation as operational status; keep the original source.',
          ]
        : [
            'Case claims do not retain comments, expiry/review basis, IDS or correlation flags; deleted attributes are excluded, never evidence removal. Keep the original source.',
          ],
  };
}

export function verifyConsumerCaseProjection(value: Value) {
  const original = JSON.stringify(value);
  const imported = parseExternalIntelligenceDocument(
    value,
    createHash('sha256').update(original).digest('hex'),
  );
  const record = createCase({ domain: 'candidate.example' }, '2026-08-04T00:00:00.000Z');
  const merged = mergeExternalIntelligenceIntoCase(
    [record],
    record.id,
    imported,
    '2026-08-04T00:00:00.000Z',
  );
  assert.equal(merged.assertionsAdded, imported.items.length);
  const saved = normalizeCaseStore(JSON.parse(JSON.stringify(merged.cases))).cases[0]!;
  assert.deepEqual(
    saved.assertions.map((item) => item.provenance?.sourceDigestSha256),
    imported.items.map(() => imported.sourceDigestSha256),
  );
  for (const key of [
    'externalId',
    'observedAt',
    'createdAt',
    'modifiedAt',
    'markings',
    'labels',
  ] as const) {
    assert.deepEqual(
      saved.assertions.map((item) => item.provenance?.[key]),
      imported.items.map((item) => item[key]),
    );
  }
  assert.equal(
    JSON.stringify(value),
    original,
    'Case projection must not mutate its source document.',
  );
  return { assertionsVerified: saved.assertions.length };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.length !== 2 || args[0] !== '--python' || !args[1]) {
    process.stderr.write(
      'Usage: node test/interchange-consumer-harness.mts --python <approved-disposable-python>\n',
    );
    return 2;
  }
  const python = args[1];
  try {
    assert.equal(await schemaTreeSha256(), SCHEMA_TREE_SHA256);
    const fixtures = await consumerFixtures(),
      originals = JSON.stringify(fixtures);
    const reply = runConsumer(python, fixtures);
    assert.deepEqual(reply.versions, REVIEWED_CONSUMER_VERSIONS);
    assert.equal(reply.networkGuardPassed, true);
    assert.equal(reply.networkRefusals, 0);
    const results = fixtures.map((fixture, index) => {
      const result = reply.results[index]!,
        reviewed = verifyConsumerRoundtrip(fixture, result);
      if (fixture.negative) return reviewed;
      const caseProjection = verifyConsumerCaseProjection(record(result.value));
      if (fixture.format === 'misp') {
        assert.equal(result.strict!.valid, false);
        assert.ok(result.strict!.errors.length > 0);
      }
      return { ...reviewed, caseProjection };
    });
    assert.equal(results.filter((result) => result.state === 'roundtrip verified').length, 13);
    assert.equal(results.filter((result) => result.state === 'rejected control').length, 2);
    assert.equal(
      JSON.stringify(fixtures),
      originals,
      'Consumer work must never overwrite the original exports.',
    );
    assert.throws(() => runConsumer(python, fixtures, 1), /timed out/u);
    const stixResults = reply.results.filter(
      (_, index) => fixtures[index]!.format === 'stix' && !fixtures[index]!.negative,
    );
    process.stdout.write(
      JSON.stringify(
        {
          versions: reply.versions,
          offline: true,
          results,
          stixSchemaCorpus: {
            revision: SCHEMA_REVISION,
            sha256: SCHEMA_TREE_SHA256,
            shared: stixResults.every((result) => result.sharedSchemaCorpus === true),
            consumerWheelResourcesAbsent: stixResults.every(
              (result) => result.consumerWheelResourcesAbsent === true,
            ),
          },
          limitation:
            'Synthetic offline consumer exercise only; no remote MISP/STIX service, universal interchange certification or human study.',
        },
        null,
        2,
      ) + '\n',
    );
    return 0;
  } catch {
    process.stderr.write(
      'Offline consumer verification failed. Review the selected fixture and approved consumer versions.\n',
    );
    return 2;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = await main();
