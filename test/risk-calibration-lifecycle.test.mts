import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  serializeRiskCalibrationReport,
  type RiskCalibrationReport,
} from '../cli/risk-calibration.mts';
import { parseRiskCalibrationDashboard } from '../frontend/src/lib/analysis/risk-calibration-dashboard.ts';
import {
  buildRiskCalibrationDatasetExport,
  serializeRiskCalibrationDatasetExport,
  type RiskCalibrationDatasetExport,
} from '../frontend/src/lib/analysis/risk-calibration-export.ts';
import {
  buildRiskCalibrationSummaryReport,
  parseRiskCalibrationSummaryReport,
} from '../lib/risk-calibration-summary.mts';
import {
  ANALYST_REVIEW_REASON_VALUES,
} from '../lib/analyst-taxonomy.mts';
import {
  RISK_MODEL_VERSION,
  RISK_MUTATION_TYPES,
  RISK_REVIEW_THRESHOLD,
  explainRiskScore,
  explainRiskScoreV6,
} from '../lib/risk-scoring.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES,
  MAX_RISK_CALIBRATION_SUMMARY_BYTES,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS,
  RISK_CALIBRATION_REPORT_VERSION,
  RISK_CALIBRATION_MUTATION_TYPES,
  RISK_CALIBRATION_REVIEW_REASON_VALUES,
  RISK_CALIBRATION_SCHEMA_LIFECYCLE,
  serializeRiskCalibrationSnapshot,
  snapshotRiskCalibrationDatasetExportForSerialization,
  snapshotRiskCalibrationReportForSerialization,
} from '../packages/contracts/risk-calibration.mts';
import { MAX_CLI_OUTPUT_BYTES } from '../cli/output-file.mts';
import { SCHEMA_LIFECYCLE_HOOK_MODULES } from '../tools/schema-lifecycle-repository.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-08-18T00:00:00.000Z';
const EXPECTED_FIXTURES = [
  {
    id: 'risk-calibration-dataset-v1',
    path: 'test/fixtures/risk-calibration-dataset-v1.json',
    bytes: 469,
    sha256: 'aaa418ceaf06616b4436cec8bef5fb670c7d37711dce3f84678bc272307e0ec9',
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: 1,
    role: 'historical',
    expectation: 'accepted_exact',
    shapeId: 'risk-calibration.dataset.v1',
  },
  {
    id: 'risk-calibration-dataset-v2',
    path: 'test/fixtures/risk-calibration-dataset-v2.json',
    bytes: 1_154,
    sha256: 'bd650fe84923c61658d451c25d928bd5ff8e54ff585f4f059e6798c681f9a401',
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    role: 'current',
    expectation: 'accepted_exact',
    shapeId: 'risk-calibration.dataset.v2',
  },
  {
    id: 'risk-calibration-report-v1',
    path: 'test/fixtures/risk-calibration-report-v1.json',
    bytes: 3_271,
    sha256: '36b131775d086bca7c570ca483c7ead5071f810e7c445e7cca830014225b9d71',
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: 1,
    role: 'historical',
    expectation: 'historical_output_exact',
    shapeId: 'risk-calibration.report.v1',
  },
  {
    id: 'risk-calibration-report-v2',
    path: 'test/fixtures/risk-calibration-report-v2.json',
    bytes: 6_850,
    sha256: '4b7183cf127958ac483d4a53521bec9f5a00d576df5d1c54397afe06606747f6',
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: 2,
    role: 'historical',
    expectation: 'historical_output_exact',
    shapeId: 'risk-calibration.report.v2',
  },
  {
    id: 'risk-calibration-report-v3-detailed',
    path: 'test/fixtures/risk-calibration-report-v3-detailed.json',
    bytes: 7_026,
    sha256: '0c905036b05da2feb586199781444d5b575982bb5f6ef585d8f7c2e431363e8d',
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: RISK_CALIBRATION_REPORT_VERSION,
    role: 'current',
    expectation: 'accepted_exact',
    shapeId: 'risk-calibration.report.v3-detailed',
  },
  {
    id: 'risk-calibration-report-v3-summary',
    path: 'test/fixtures/risk-calibration-report-v3-summary.json',
    bytes: 5_486,
    sha256: '637e739eac58ec06f3f2c9688fb2c03d5d139536e9629e1e1a811d3c8c7563d0',
    schema: RISK_CALIBRATION_REPORT_SCHEMA,
    version: RISK_CALIBRATION_REPORT_VERSION,
    role: 'current',
    expectation: 'accepted_exact',
    shapeId: 'risk-calibration.report.v3-summary',
  },
] as const;

function valuesAtShapePath(document: unknown, shapePath: string): unknown[] {
  if (shapePath === '$') return [document];
  let current = [document];
  for (const segment of shapePath.slice(2).split('.')) {
    const repeated = segment.endsWith('[]');
    const key = repeated ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const value of current) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key)) continue;
      const child = (value as Record<string, unknown>)[key];
      if (repeated) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    current = next;
  }
  return current;
}

function assertRegisteredShape(
  document: Record<string, unknown>,
  shape: typeof RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes[number],
  fixtureId: string,
): ReadonlySet<string> {
  assert.equal(document.schema, shape.schema, fixtureId);
  assert.ok(shape.versions.includes(Number(document.version)), fixtureId);
  let matchedObjects = 0;
  const matchedPaths = new Set<string>();
  for (const objectShape of shape.objects) {
    const values = valuesAtShapePath(document, objectShape.path);
    for (const value of values) {
      if (value === null) continue;
      assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${fixtureId}:${objectShape.path}`);
      const keys = Object.keys(value as object);
      for (const key of objectShape.requiredKeys) {
        assert.ok(Object.hasOwn(value as object, key), `${fixtureId}:${objectShape.path}.${key}`);
      }
      for (const alternative of objectShape.alternativeRequiredKeys) {
        assert.ok(
          alternative.keys.some((key) => Object.hasOwn(value as object, key)),
          `${fixtureId}:${objectShape.path}:${alternative.keys.join('|')}`,
        );
      }
      if (objectShape.unknownKeys === 'reject') {
        const allowed = new Set([
          ...objectShape.requiredKeys,
          ...objectShape.optionalKeys,
          ...objectShape.alternativeRequiredKeys.flatMap(({ keys: alternatives }) => alternatives),
        ]);
        assert.deepEqual(keys.filter((key) => !allowed.has(key)), [], `${fixtureId}:${objectShape.path}`);
      }
      matchedObjects += 1;
      matchedPaths.add(objectShape.path);
    }
  }
  assert.ok(matchedObjects > 0, fixtureId);
  if (shape.discriminator) {
    assert.deepEqual(
      valuesAtShapePath(document, shape.discriminator.path),
      [shape.discriminator.value],
      fixtureId,
    );
  }
  return matchedPaths;
}

function assertEveryRegisteredObjectPath(
  shape: typeof RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes[number],
  documents: readonly Record<string, unknown>[],
  label: string,
): void {
  const covered = new Set<string>();
  for (const [index, document] of documents.entries()) {
    for (const pathValue of assertRegisteredShape(document, shape, `${label}:${index + 1}`)) {
      covered.add(pathValue);
    }
  }
  assert.deepEqual(
    [...covered].sort(),
    shape.objects.map(({ path: pathValue }) => pathValue).sort(),
    label,
  );
}

function browserDataset(): RiskCalibrationDatasetExport {
  return buildRiskCalibrationDatasetExport([{
    id: 'calibration-1',
    domain: 'candidate.example.test',
    disposition: 'confirmed_abuse',
    reviewReasonCode: 'confirmed_credential_abuse',
    evidenceHistory: [{
      capturedAt: GENERATED_AT,
      createdDate: '2026-08-01T00:00:00.000Z',
      availability: 'registered',
      mutationTypes: ['dictionary'],
      faviconMatch: true,
      hasPasswordField: true,
      activityStatus: 'active',
      hasMx: true,
      scanDepth: 'deep',
    }],
  }] as never, ['calibration-1']);
}

function currentDetailed(): RiskCalibrationReport {
  const dataset = parseRiskCalibrationDataset(serializeRiskCalibrationDatasetExport(browserDataset()));
  return buildRiskCalibrationReport(dataset, explainRiskScore, {
    generatedAt: GENERATED_AT,
    modelVersion: RISK_MODEL_VERSION,
    reviewThreshold: RISK_REVIEW_THRESHOLD,
    previousModelVersion: 6,
    explainPreviousRiskScore: explainRiskScoreV6,
  });
}

function coverageDetailed(): RiskCalibrationReport {
  const dataset = parseRiskCalibrationDataset(JSON.stringify({
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records: [
      {
        id: 'coverage-positive',
        domain: 'positive.example.test',
        analystDisposition: 'confirmed_abuse',
        reviewReasonCode: 'confirmed_credential_abuse',
        evidence: {
          availability: 'registered',
          activityStatus: 'active',
          mutationTypes: ['dictionary'],
          faviconMatch: true,
          hasPasswordField: true,
          hasMx: true,
          scanDepth: 'deep',
        },
      },
      {
        id: 'coverage-negative',
        domain: 'negative.example.test',
        analystDisposition: 'expected',
        reviewReasonCode: 'authorized_or_owned',
        evidence: { availability: 'registered', scanDepth: 'deep' },
      },
    ],
  }));
  return buildRiskCalibrationReport(dataset, explainRiskScore, {
    generatedAt: GENERATED_AT,
    modelVersion: RISK_MODEL_VERSION,
    reviewThreshold: RISK_REVIEW_THRESHOLD,
    previousModelVersion: 6,
    explainPreviousRiskScore: explainRiskScoreV6,
  });
}

function providerDataset(version: 1 | typeof RISK_CALIBRATION_DATASET_VERSION): Record<string, unknown> {
  return {
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version,
    records: [{
      id: `provider-${version}`,
      domain: `provider-${version}.example.test`,
      analystDisposition: 'confirmed_abuse',
      evidence: {
        availability: 'registered',
        threatIntelligence: {
          providers: [{
            provider: { id: 'fixture-provider' },
            state: 'complete',
            observation: { observedAt: GENERATED_AT },
            findings: [{
              category: 'credential-abuse',
              firstObservedAt: GENERATED_AT,
              lastObservedAt: GENERATED_AT,
            }],
          }],
        },
      },
    }],
  };
}

function reversedObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).reverse());
}

describe('Risk calibration lifecycle', () => {
  test('registers projected dataset history and exact report variants', () => {
    assert.equal(RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.metadataVersion, 4);
    assert.equal(RISK_CALIBRATION_SCHEMA_LIFECYCLE.compatibility[0]?.migration, 'read_only');
    assert.equal(RISK_CALIBRATION_SCHEMA_LIFECYCLE.compatibility[1]?.futureVersionBehavior, 'reject');
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.contracts.map((contract) => ({
        schema: contract.schema,
        version: contract.version,
        lifecycle: contract.lifecycle,
        readable: contract.readable,
        emitted: contract.emitted,
        extensionPolicy: contract.extensionPolicy,
      })),
      [
        { schema: RISK_CALIBRATION_DATASET_SCHEMA, version: 1, lifecycle: 'legacy', readable: true, emitted: false, extensionPolicy: 'discard_bounded' },
        { schema: RISK_CALIBRATION_DATASET_SCHEMA, version: 2, lifecycle: 'current', readable: true, emitted: true, extensionPolicy: 'discard_bounded' },
        { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: 1, lifecycle: 'retired', readable: false, emitted: false, extensionPolicy: 'reject' },
        { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: 2, lifecycle: 'retired', readable: false, emitted: false, extensionPolicy: 'reject' },
        { schema: RISK_CALIBRATION_REPORT_SCHEMA, version: 3, lifecycle: 'current', readable: true, emitted: true, extensionPolicy: 'reject' },
      ],
    );
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes
        .filter((shape) => shape.schema === RISK_CALIBRATION_REPORT_SCHEMA && shape.versions.includes(3))
        .map((shape) => shape.discriminator),
      [
        { path: '$.mode', value: 'detailed' },
        { path: '$.mode', value: 'summary' },
      ],
    );
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes
        .find(({ id }) => id === 'risk-calibration.report.v3-detailed')
        ?.objects.find(({ path }) => path === '$.summary.scoreBands')
        ?.requiredKeys,
      RISK_CALIBRATION_REPORT_SCORE_BAND_KEYS,
    );
    assert.equal(Object.isFrozen(RISK_CALIBRATION_SCHEMA_LIFECYCLE), true);
    assert.equal(Object.isFrozen(RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes), true);
    assert.deepEqual(RISK_CALIBRATION_REVIEW_REASON_VALUES, [...ANALYST_REVIEW_REASON_VALUES]);
    assert.deepEqual(RISK_CALIBRATION_MUTATION_TYPES, RISK_MUTATION_TYPES);
    assert.equal(MAX_RISK_CALIBRATION_DETAILED_REPORT_BYTES, MAX_CLI_OUTPUT_BYTES);
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.consumerEdges
        .filter(({ id }) => id.includes('-stdout') || id.endsWith('-file'))
        .map((edge) => ({
          id: edge.id,
          privacy: edge.privacyProfileId,
          retention: edge.retentionEffect,
          privateSink: edge.hookIds.includes('risk-calibration.cli.write-private-file'),
          outputBound: edge.boundProfileIds.includes('risk-calibration.cli-private-output.v1'),
          detailedJsonBound: edge.boundProfileIds.includes('risk-calibration.report-detailed-json-output.v3'),
        })),
      [
        { id: 'risk-calibration.cli-detailed-json-stdout', privacy: 'risk-calibration.detailed-output.v3', retention: 'transient_report', privateSink: false, outputBound: false, detailedJsonBound: true },
        { id: 'risk-calibration.cli-detailed-terminal-stdout', privacy: 'risk-calibration.detailed-output.v3', retention: 'transient_report', privateSink: false, outputBound: false, detailedJsonBound: false },
        { id: 'risk-calibration.cli-summary-json-stdout', privacy: 'risk-calibration.summary-output.v3', retention: 'transient_report', privateSink: false, outputBound: false, detailedJsonBound: false },
        { id: 'risk-calibration.cli-detailed-json-file', privacy: 'risk-calibration.detailed-private-file.v3', retention: 'operator_controlled_output', privateSink: true, outputBound: true, detailedJsonBound: true },
        { id: 'risk-calibration.cli-detailed-terminal-file', privacy: 'risk-calibration.detailed-private-file.v3', retention: 'operator_controlled_output', privateSink: true, outputBound: true, detailedJsonBound: false },
        { id: 'risk-calibration.cli-summary-json-file', privacy: 'risk-calibration.summary-private-file.v3', retention: 'operator_controlled_output', privateSink: true, outputBound: true, detailedJsonBound: false },
      ],
    );
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.boundProfiles
        .find(({ id }) => id === 'risk-calibration.report-summary-input.v3')
        ?.bounds.map(({ id }) => id),
      ['raw-bytes', 'serialised-bytes', 'json-depth', 'json-keys', 'json-values', 'json-container-items'],
    );
  });

  test('pins every repository fixture to exact bytes, hash, shape and variant', async () => {
    assert.deepEqual(
      RISK_CALIBRATION_SCHEMA_LIFECYCLE.fixtures.map((fixture) => ({
        id: fixture.id,
        path: fixture.path,
        bytes: fixture.bytes,
        sha256: fixture.sha256,
        schema: fixture.schema,
        version: fixture.version,
        role: fixture.role,
        expectation: fixture.expectation,
        shapeId: fixture.shapeId,
      })),
      EXPECTED_FIXTURES,
    );
    for (const fixture of RISK_CALIBRATION_SCHEMA_LIFECYCLE.fixtures) {
      const raw = await readFile(path.join(ROOT, fixture.path));
      assert.equal(raw.byteLength, fixture.bytes, fixture.id);
      assert.equal(createHash('sha256').update(raw).digest('hex'), fixture.sha256, fixture.id);
      assert.equal(raw[0], 0x7b, fixture.id);
      assert.equal(raw.at(-1), 0x0a, fixture.id);
      assert.equal(raw.includes(Buffer.from([0xef, 0xbb, 0xbf])), false, fixture.id);
      const document = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      assert.equal(document.schema, fixture.schema, fixture.id);
      assert.equal(document.version, fixture.version, fixture.id);
      const shape = RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes.find(({ id }) => id === fixture.shapeId);
      assert.ok(shape, fixture.id);
      assertRegisteredShape(document, shape, fixture.id);
    }
  });

  test('exercises every registered object path with bounded reader-compatible documents', async () => {
    for (const version of [1, RISK_CALIBRATION_DATASET_VERSION] as const) {
      const document = providerDataset(version);
      assert.doesNotThrow(() => parseRiskCalibrationDataset(JSON.stringify(document)));
      const shape = RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes
        .find(({ id }) => id === `risk-calibration.dataset.v${version}`);
      assert.ok(shape);
      assertEveryRegisteredObjectPath(shape, [document], shape.id);
    }

    const historicalV1 = JSON.parse(await readFile(
      path.join(ROOT, 'test/fixtures/risk-calibration-report-v1.json'),
      'utf8',
    )) as Record<string, unknown>;
    const detailed = coverageDetailed();
    const historicalV2 = structuredClone(detailed) as unknown as Record<string, unknown>;
    historicalV2.version = 2;
    delete historicalV2.mode;
    const summary = buildRiskCalibrationSummaryReport(detailed);
    const reports = new Map<string, Record<string, unknown>>([
      ['risk-calibration.report.v1', historicalV1],
      ['risk-calibration.report.v2', historicalV2],
      ['risk-calibration.report.v3-detailed', detailed as unknown as Record<string, unknown>],
      ['risk-calibration.report.v3-summary', summary as unknown as Record<string, unknown>],
    ]);
    for (const [shapeId, document] of reports) {
      const shape = RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.shapes.find(({ id }) => id === shapeId);
      assert.ok(shape, shapeId);
      assertEveryRegisteredObjectPath(shape, [document], shapeId);
    }
  });

  test('reproduces current browser, detailed and summary fixture bytes exactly', async () => {
    const datasetBytes = serializeRiskCalibrationDatasetExport(browserDataset());
    const parsedDataset = parseRiskCalibrationDataset(datasetBytes);
    assert.equal(parsedDataset.version, RISK_CALIBRATION_DATASET_VERSION);
    assert.equal(parsedDataset.records.length, 1);
    const reorderedDataset = structuredClone(browserDataset()) as any;
    reorderedDataset.records[0].evidence = reversedObject(reorderedDataset.records[0].evidence);
    reorderedDataset.records[0] = reversedObject(reorderedDataset.records[0]);
    reorderedDataset.export = reversedObject(reorderedDataset.export);
    assert.equal(
      serializeRiskCalibrationDatasetExport(reversedObject(reorderedDataset) as RiskCalibrationDatasetExport),
      datasetBytes,
    );
    assert.equal(
      datasetBytes,
      await readFile(path.join(ROOT, 'test/fixtures/risk-calibration-dataset-v2.json'), 'utf8'),
    );
    const detailed = currentDetailed();
    const reorderedDetailed = structuredClone(detailed) as any;
    reorderedDetailed.dataset = reversedObject(reorderedDetailed.dataset);
    reorderedDetailed.records[0].factors[0] = reversedObject(reorderedDetailed.records[0].factors[0]);
    reorderedDetailed.records[0] = reversedObject(reorderedDetailed.records[0]);
    assert.equal(
      serializeRiskCalibrationReport(reversedObject(reorderedDetailed) as never),
      serializeRiskCalibrationReport(detailed),
    );
    assert.equal(
      serializeRiskCalibrationReport(detailed),
      await readFile(path.join(ROOT, 'test/fixtures/risk-calibration-report-v3-detailed.json'), 'utf8'),
    );
    const summary = buildRiskCalibrationSummaryReport(detailed);
    const summaryBytes = serializeRiskCalibrationReport(summary);
    assert.equal(
      summaryBytes,
      await readFile(path.join(ROOT, 'test/fixtures/risk-calibration-report-v3-summary.json'), 'utf8'),
    );
    assert.deepEqual(parseRiskCalibrationSummaryReport(summaryBytes), summary);
    assert.equal(parseRiskCalibrationDashboard(summaryBytes).report.mode, 'summary');
    assert.throws(
      () => parseRiskCalibrationDashboard(serializeRiskCalibrationReport(detailed)),
      /unsupported|missing fields/iu,
    );
  });

  test('preserves both dataset versions while discarding bounded unknown fields', async () => {
    for (const version of [1, RISK_CALIBRATION_DATASET_VERSION] as const) {
      const raw = JSON.parse(await readFile(
        path.join(ROOT, `test/fixtures/risk-calibration-dataset-v${version}.json`),
        'utf8',
      )) as any;
      raw.privateRoot = 'discarded';
      raw.records[0].privateRecord = 'discarded';
      raw.records[0].evidence = {
        ...raw.records[0].evidence,
        availability: 'registered',
        state: 'available',
        privateEvidence: 'discarded',
      };
      const parsed = parseRiskCalibrationDataset(JSON.stringify(raw));
      assert.equal(parsed.version, version);
      assert.equal(parsed.records[0]?.evidence.availability, 'registered');
      assert.equal(Object.hasOwn(parsed as object, 'privateRoot'), false);
      assert.equal(Object.hasOwn(parsed.records[0] as object, 'privateRecord'), false);
      assert.equal(Object.hasOwn(parsed.records[0]?.evidence as object, 'privateEvidence'), false);
    }
  });

  test('enforces exact non-materialising pretty UTF-8 boundaries before hostile tails', () => {
    const dataset = structuredClone(browserDataset()) as RiskCalibrationDatasetExport;
    const datasetSnapshot = snapshotRiskCalibrationDatasetExportForSerialization(dataset);
    assert.equal(
      datasetSnapshot.bytes,
      new TextEncoder().encode(serializeRiskCalibrationSnapshot(datasetSnapshot)).byteLength,
    );
    assert.doesNotThrow(() => snapshotRiskCalibrationDatasetExportForSerialization(
      dataset,
      datasetSnapshot.bytes,
    ));
    const datasetPlusOne = structuredClone(dataset) as any;
    datasetPlusOne.records[0].id += 'x';
    assert.equal(
      snapshotRiskCalibrationDatasetExportForSerialization(datasetPlusOne).bytes,
      datasetSnapshot.bytes + 1,
    );
    assert.throws(
      () => snapshotRiskCalibrationDatasetExportForSerialization(datasetPlusOne, datasetSnapshot.bytes),
      new RegExp(`limited to ${datasetSnapshot.bytes} bytes`, 'u'),
    );

    const detailed = currentDetailed();
    const detailedSnapshot = snapshotRiskCalibrationReportForSerialization(detailed);
    assert.equal(
      detailedSnapshot.bytes,
      new TextEncoder().encode(serializeRiskCalibrationSnapshot(detailedSnapshot)).byteLength,
    );
    assert.doesNotThrow(() => snapshotRiskCalibrationReportForSerialization(detailed, {
      detailedMaximumBytes: detailedSnapshot.bytes,
    }));
    const detailedPlusOne = structuredClone(detailed) as any;
    detailedPlusOne.generatedAt += 'x';
    assert.equal(
      snapshotRiskCalibrationReportForSerialization(detailedPlusOne).bytes,
      detailedSnapshot.bytes + 1,
    );
    assert.throws(
      () => snapshotRiskCalibrationReportForSerialization(detailedPlusOne, {
        detailedMaximumBytes: detailedSnapshot.bytes,
      }),
      new RegExp(`limited to ${detailedSnapshot.bytes} bytes`, 'u'),
    );

    const summary = buildRiskCalibrationSummaryReport(detailed);
    const summarySnapshot = snapshotRiskCalibrationReportForSerialization(summary);
    assert.equal(
      summarySnapshot.bytes,
      new TextEncoder().encode(serializeRiskCalibrationSnapshot(summarySnapshot)).byteLength,
    );
    assert.doesNotThrow(() => snapshotRiskCalibrationReportForSerialization(summary, {
      summaryMaximumBytes: summarySnapshot.bytes,
    }));
    const summaryPlusOne = structuredClone(summary) as any;
    summaryPlusOne.generatedAt += 'x';
    assert.throws(
      () => snapshotRiskCalibrationReportForSerialization(summaryPlusOne, {
        summaryMaximumBytes: summarySnapshot.bytes,
      }),
      new RegExp(`limited to ${summarySnapshot.bytes} bytes`, 'u'),
    );

    let rootTailDescriptors = 0;
    const hostileRoot = new Proxy(dataset as object, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'version') rootTailDescriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    assert.throws(
      () => snapshotRiskCalibrationDatasetExportForSerialization(hostileRoot, 20),
      /limited to 20 bytes/u,
    );
    assert.equal(rootTailDescriptors, 0);

    const escapedHead = structuredClone(dataset) as any;
    escapedHead.records[0].id = '"'.repeat(128);
    let scalarTailDescriptors = 0;
    escapedHead.records[0] = new Proxy(escapedHead.records[0], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'domain') scalarTailDescriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    assert.throws(
      () => snapshotRiskCalibrationDatasetExportForSerialization(escapedHead, 250),
      /limited to 250 bytes/u,
    );
    assert.equal(scalarTailDescriptors, 0);
    assert.ok(datasetSnapshot.bytes < MAX_RISK_CALIBRATION_INPUT_BYTES);
    assert.ok(summarySnapshot.bytes < MAX_RISK_CALIBRATION_SUMMARY_BYTES);
  });

  test('rejects missing, extra, accessor-controlled, toJSON-controlled and divergent values', () => {
    const dataset = structuredClone(browserDataset()) as any;
    const missing = { ...dataset };
    delete missing.records;
    assert.throws(() => serializeRiskCalibrationDatasetExport(missing), /missing required fields/u);
    assert.throws(
      () => serializeRiskCalibrationDatasetExport({ ...dataset, privateMarker: true }),
      /unsupported fields/u,
    );
    let accessorCalls = 0;
    Object.defineProperty(dataset, 'records', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return [];
      },
    });
    assert.throws(() => serializeRiskCalibrationDatasetExport(dataset), /ordinary enumerable data field/u);
    assert.equal(accessorCalls, 0);

    const toJsonDataset = structuredClone(browserDataset()) as any;
    Object.defineProperty(toJsonDataset, 'toJSON', { enumerable: false, value: () => ({}) });
    assert.throws(() => serializeRiskCalibrationDatasetExport(toJsonDataset), /unsupported fields/u);

    for (const mutate of [
      (value: any) => {
        value.records = [];
        value.export = { selected: 0, included: 0, excluded: 0, exclusions: [] };
      },
      (value: any) => { value.records[0].id = '   '; },
      (value: any) => { value.records[0].domain = 'not a host'; },
      (value: any) => { value.records[0].reviewReasonCode = 'invented'; },
      (value: any) => { value.records[0].evidence.mutationTypes = ['invented']; },
      (value: any) => { value.records[0].evidence.observedAt = '   '; },
      (value: any) => { value.records[0].evidence.phishingLanguageMatch = '   '; },
    ]) {
      const incompatible = structuredClone(browserDataset()) as any;
      mutate(incompatible);
      assert.throws(() => serializeRiskCalibrationDatasetExport(incompatible), /bounded|supported|between/u);
    }

    const normalisedIdCollision = structuredClone(browserDataset()) as any;
    normalisedIdCollision.records.push({
      ...structuredClone(normalisedIdCollision.records[0]),
      id: ` ${normalisedIdCollision.records[0].id} `,
      domain: 'collision.example.test',
    });
    normalisedIdCollision.export.selected = 2;
    normalisedIdCollision.export.included = 2;
    assert.throws(
      () => parseRiskCalibrationDataset(JSON.stringify(normalisedIdCollision)),
      /must be unique/u,
    );
    assert.throws(
      () => serializeRiskCalibrationDatasetExport(normalisedIdCollision),
      /bounded supported text/u,
    );

    const providerDataset = structuredClone(browserDataset()) as any;
    providerDataset.records[0].evidence.threatIntelligence = { providers: [] };
    assert.throws(() => serializeRiskCalibrationDatasetExport(providerDataset), /unsupported fields/u);

    const divergentTarget = structuredClone(browserDataset()) as any;
    let schemaDescriptors = 0;
    const divergent = new Proxy(divergentTarget, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === 'schema' && descriptor && 'value' in descriptor) {
          schemaDescriptors += 1;
          return { ...descriptor, value: schemaDescriptors === 1 ? descriptor.value : 'changed.example' };
        }
        return descriptor;
      },
    });
    assert.throws(() => serializeRiskCalibrationDatasetExport(divergent), /changed while it was being snapshotted/u);
  });

  test('keeps the summary variant target-free and recursively freezes canonical report snapshots', () => {
    const detailed = currentDetailed();
    const summary = buildRiskCalibrationSummaryReport(detailed);
    const detailedSnapshot = snapshotRiskCalibrationReportForSerialization(detailed);
    const summarySnapshot = snapshotRiskCalibrationReportForSerialization(summary);
    assert.equal(Object.isFrozen(detailedSnapshot), true);
    assert.equal(Object.isFrozen(detailedSnapshot.document), true);
    assert.equal(Object.isFrozen(detailedSnapshot.document.records), true);
    assert.equal(Object.isFrozen((detailedSnapshot.document.records as any[])[0]?.factors), true);
    assert.equal(Object.isFrozen(summarySnapshot.document), true);
    assert.equal(Object.isFrozen(summarySnapshot.document.thresholds), true);
    assert.equal(Object.isFrozen((summarySnapshot.document.thresholds as any[])[0]?.confidence95), true);

    for (const forbidden of ['target', 'records', 'reviewReasonCode', 'evidence', 'factors', 'privateMarker']) {
      assert.throws(
        () => serializeRiskCalibrationReport({ ...summary, [forbidden]: { retained: true } } as never),
        /unsupported fields/u,
        forbidden,
      );
    }
    let privacyAccessorCalls = 0;
    const accessorSummary = structuredClone(summary) as any;
    Object.defineProperty(accessorSummary, 'privacy', {
      enumerable: true,
      get() {
        privacyAccessorCalls += 1;
        return { targetsRetained: 0, identifiersRetained: 0, rawEvidenceRetained: 0 };
      },
    });
    assert.throws(() => serializeRiskCalibrationReport(accessorSummary), /ordinary enumerable data field/u);
    assert.equal(privacyAccessorCalls, 0);
    const toJsonSummary = structuredClone(summary) as any;
    Object.defineProperty(toJsonSummary, 'toJSON', { enumerable: false, value: () => ({ records: [] }) });
    assert.throws(() => serializeRiskCalibrationReport(toJsonSummary), /unsupported fields/u);

    let modeDescriptors = 0;
    const divergentSummary = new Proxy(structuredClone(summary), {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === 'mode' && descriptor && 'value' in descriptor) {
          modeDescriptors += 1;
          return { ...descriptor, value: modeDescriptors < 3 ? 'summary' : 'detailed' };
        }
        return descriptor;
      },
    });
    assert.throws(
      () => serializeRiskCalibrationReport(divergentSummary),
      /changed while it was being snapshotted/u,
    );
  });

  test('binds every declared hook to a statically imported callable export', () => {
    for (const hook of RISK_CALIBRATION_SCHEMA_LIFECYCLE.metadata.hooks) {
      const module = SCHEMA_LIFECYCLE_HOOK_MODULES[hook.module as keyof typeof SCHEMA_LIFECYCLE_HOOK_MODULES];
      assert.ok(module, hook.id);
      assert.equal(typeof (module as Record<string, unknown>)[hook.exportName], 'function', hook.id);
    }
  });
});
