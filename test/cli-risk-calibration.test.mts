import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { formatTerminalRiskCalibration } from '../cli/formatters/terminal.mts';
import {
  MAX_CLI_OUTPUT_BYTES,
  writePrivateFile,
  type OutputFileOperations,
} from '../cli/output-file.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_RECORDS,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  readRiskCalibrationInputBounded,
} from '../cli/risk-calibration.mts';
import { explainRiskScore, explainRiskScoreV6, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import {
  buildRiskCalibrationSummaryReport,
  parseRiskCalibrationSummaryReport,
  RISK_CALIBRATION_SUMMARY_SCHEMA,
} from '../lib/risk-calibration-summary.mts';
import { runCli } from '../cli/runner.mts';

function capture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

function record(overrides = {}) {
  return {
    id: 'case-1',
    domain: 'login.example.test',
    analystDisposition: 'confirmed_abuse',
    evidence: {
      availability: 'registered',
      mutationTypes: ['dictionary'],
      faviconMatch: true,
      phishingLanguageMatch: 'verify account',
      hasPasswordField: true,
      activityStatus: 'active',
      hasMx: true,
    },
    ...overrides,
  };
}

function dataset(records = [record()]) {
  return {
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records,
  };
}

describe('risk-calibrate arguments and bounded input', () => {
  test('accepts a file or stdin with terminal and JSON output', () => {
    assert.deepEqual(parseCliArguments(['risk-calibrate', 'dataset.json']), {
      action: 'risk-calibrate', source: 'dataset.json', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['risk-calibrate', '--json', '--no-color']), {
      action: 'risk-calibrate', source: null, output: 'json', quiet: false, color: false,
    });
    assert.deepEqual(parseCliArguments(['risk-calibrate', 'dataset.json', '--summary-json']), {
      action: 'risk-calibrate', source: 'dataset.json', output: 'summary_json', quiet: false, color: true,
    });
  });

  test('rejects duplicate output, incompatible quiet mode, unknown options, and multiple files', () => {
    assert.throws(() => parseCliArguments(['risk-calibrate', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['risk-calibrate', '--json', '--summary-json']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['risk-calibrate', '--summary-json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['risk-calibrate', '--json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['risk-calibrate', '--threshold', '50']), /Unknown option/);
    assert.throws(() => parseCliArguments(['risk-calibrate', 'one.json', 'two.json']), /one optional dataset/);
  });

  test('reads bounded UTF-8 and rejects an oversized stream', async () => {
    const text = JSON.stringify(dataset());
    assert.equal(await readRiskCalibrationInputBounded(Readable.from([text])), text);
    await assert.rejects(
      readRiskCalibrationInputBounded(Readable.from(['x'.repeat(MAX_RISK_CALIBRATION_INPUT_BYTES + 1)])),
      /limited to/,
    );
  });
});

describe('risk calibration dataset projection', () => {
  test('projects only known bounded scoring evidence without mutating input', () => {
    const input = dataset([record({
      unknownRecord: 'discard me',
      evidence: {
        availability: 'registered',
        mutationTypes: ['dictionary', 'dictionary'],
        domainAgeDays: 30,
        unknownEvidence: { raw: 'discard me too' },
      },
    })]);
    const before = structuredClone(input);
    const parsed = parseRiskCalibrationDataset(JSON.stringify(input));
    assert.deepEqual(input, before);
    assert.deepEqual(requiredValue(parsed.records[0]).evidence, {
      availability: 'registered', mutationTypes: ['dictionary'], domainAgeDays: 30,
    });
    assert.doesNotMatch(JSON.stringify(parsed), /unknownRecord|unknownEvidence|discard me/);
  });

  test('normalizes domain case and a final root dot while requiring unique IDs', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'one', domain: 'LOGIN.EXAMPLE.TEST.' }),
      record({ id: 'two', domain: 'mail.example.test' }),
    ])));
    assert.equal(requiredValue(parsed.records[0]).domain, 'login.example.test');
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'same' }), record({ id: 'same', domain: 'other.example.test' }),
    ]))), /must be unique/);
  });

  test('rejects the wrong schema, empty and oversized collections, and malformed records', () => {
    assert.throws(() => parseRiskCalibrationDataset('{}'), /must use/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify({
      ...dataset([record()]),
      version: String(RISK_CALIBRATION_DATASET_VERSION),
    })), /must use/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([]))), /non-empty records/);
    const tooMany = Array.from({ length: MAX_RISK_CALIBRATION_RECORDS + 1 }, (_, index) => record({ id: `r-${index}` }));
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset(tooMany))), /record limit/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ id: 'bad\nvalue' })]))), /control characters/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ domain: 'not a host' })]))), /valid ASCII DNS hostname/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ domain: '192.0.2.1' })]))), /not an IP address/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ analystDisposition: 'malicious' })]))), /unsupported/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ reviewReasonCode: 'invented' })]))), /reviewReasonCode is unsupported/);
  });

  test('rejects malformed scalar evidence instead of coercing it', () => {
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'missing' } })]))), /availability is unsupported/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', hasMx: 1 } })]))), /must be true or false/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', domainAgeDays: 100_001 } })]))), /domainAgeDays/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', activityStatus: 'online' } })]))), /activityStatus is unsupported/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', mutationTypes: ['invented'] } })]))), /mutationTypes\[0\] is unsupported/);
  });

  test('preserves bounded integer and fractional domain ages and rejects non-finite or out-of-range values', () => {
    for (const domainAgeDays of [0, 17, 17.5, 100_000]) {
      const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([record({
        evidence: { availability: 'registered', domainAgeDays },
      })])));
      assert.equal(parsed.records[0]?.evidence.domainAgeDays, domainAgeDays);
    }
    for (const domainAgeDays of [-0.1, 100_000.1]) {
      assert.throws(
        () => parseRiskCalibrationDataset(JSON.stringify(dataset([record({
          evidence: { availability: 'registered', domainAgeDays },
        })]))),
        /finite number from 0 to 100000/u,
      );
    }
    const nonFinite = JSON.stringify(dataset([record({
      evidence: { availability: 'registered', domainAgeDays: 1 },
    })])).replace('"domainAgeDays":1', '"domainAgeDays":1e309');
    assert.throws(() => parseRiskCalibrationDataset(nonFinite), /valid bounded JSON|finite number from 0 to 100000/u);
  });

  test('bounds and projects external provider evidence', () => {
    const providers = Array.from({ length: 11 }, (_, index) => ({
      provider: { id: `provider-${index}` }, state: 'success', findings: [],
    }));
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({
      evidence: { availability: 'registered', threatIntelligence: { providers } },
    })]))), /provider limit/);

    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([record({
      evidence: {
        availability: 'registered',
        threatIntelligence: {
          providers: [{
            provider: { id: 'urlscan_search', secret: 'discard' },
            state: 'success',
            observation: { observedAt: '2026-07-18T00:00:00.000Z', raw: 'discard' },
            findings: [{ category: 'phishing', lastObservedAt: '2026-07-17T00:00:00.000Z', raw: 'discard' }],
          }],
        },
      },
    })])));
    assert.doesNotMatch(JSON.stringify(parsed), /secret|raw|discard/);
    const projectedRecord = parsed.records[0];
    const projectedProvider = projectedRecord?.evidence.threatIntelligence?.providers[0];
    assert.ok(projectedProvider);
    assert.equal(projectedProvider.provider.id, 'urlscan_search');
  });
});

describe('offline Risk calibration report', () => {
  test('reports score bands and threshold metrics without changing the model', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'positive-high' }),
      record({ id: 'negative-low', domain: 'ordinary.example.test', analystDisposition: 'expected', evidence: { availability: 'registered' } }),
      record({ id: 'context-only', domain: 'review.example.test', analystDisposition: 'suspicious', evidence: { availability: 'registered' } }),
      record({ id: 'not-scored', domain: 'available.example.test', analystDisposition: 'confirmed_abuse', evidence: { availability: 'available' } }),
    ])));
    const report = buildRiskCalibrationReport(parsed, explainRiskScore, {
      generatedAt: '2026-07-18T00:00:00.000Z',
      modelVersion: RISK_MODEL_VERSION,
      reviewThreshold: RISK_REVIEW_THRESHOLD,
    });
    assert.equal(report.schema, 'whoisleuth.cli.risk-calibration');
    assert.equal(report.version, 3);
    assert.equal(report.mode, 'detailed');
    assert.equal(report.riskModelVersion, 7);
    assert.deepEqual(report.summary, {
      total: 4,
      positive: 1,
      negative: 1,
      excluded: 2,
      scoreBands: { not_scored: 1, '0_39': 2, '40_69': 0, '70_100': 1 },
    });
    const current = report.thresholds.find((item: { threshold: number }) => item.threshold === 70);
    assert.deepEqual(current, {
      threshold: 70,
      truePositive: 1,
      falsePositive: 0,
      trueNegative: 1,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      specificity: 1,
      falsePositiveRate: 0,
      f1: 1,
      balancedAccuracy: 1,
      confidence95: {
        precision: { lower: 0.2065, upper: 1 },
        recall: { lower: 0.2065, upper: 1 },
        specificity: { lower: 0.2065, upper: 1 },
      },
    });
    assert.ok(report.strata.every((stratum) => stratum.insufficientSample));
    assert.deepEqual(report.modelComparison, {
      available: false,
      previousModelVersion: null,
      currentModelVersion: 7,
      scoresChanged: 0,
      bandsChanged: 0,
      thresholdClassificationsChanged: 0,
    });
    assert.equal(requiredValue(report.records[2]).exclusionReason, 'contextual_disposition');
    assert.equal(requiredValue(report.records[3]).exclusionReason, 'not_scored');
    assert.deepEqual(requiredValue(report.records[0]).interoperabilityTags, []);
    assert.equal(report.interpretation.automaticTuning, false);
    assert.equal(report.interpretation.networkRequests, false);
    assert.match(report.interpretation.statement, /does not.*prove maliciousness or safety/i);
  });

  test('uses null metrics when a denominator is unavailable', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ analystDisposition: 'unreviewed', evidence: { availability: 'registered' } }),
    ])));
    const report = buildRiskCalibrationReport(parsed, explainRiskScore, {
      modelVersion: RISK_MODEL_VERSION, reviewThreshold: RISK_REVIEW_THRESHOLD,
    });
    assert.equal(requiredValue(report.thresholds[0]).precision, null);
    assert.equal(requiredValue(report.thresholds[0]).recall, null);
    assert.equal(requiredValue(report.thresholds[0]).specificity, null);
  });

  test('replays v1 and v2 subdomain records against their canonical registrable target', () => {
    const threatIntelligence = {
      providers: ['urlscan_search', 'urlhaus_host'].map((id) => ({
        provider: { id },
        state: 'success',
        observation: { observedAt: '2026-07-18T00:00:00.000Z' },
        findings: [{ category: 'phishing', lastObservedAt: '2026-07-17T00:00:00.000Z' }],
      })),
    };
    for (const version of [1, RISK_CALIBRATION_DATASET_VERSION] as const) {
      const parsed = parseRiskCalibrationDataset(JSON.stringify({
        ...dataset([record({
          domain: 'portal.example.test',
          evidence: { availability: 'registered', threatIntelligence },
        })]),
        version,
      }));
      const scoringInputs: Parameters<typeof explainRiskScore>[0][] = [];
      const report = buildRiskCalibrationReport(parsed, (input) => {
        scoringInputs.push(input);
        return explainRiskScore(input);
      }, {
        modelVersion: RISK_MODEL_VERSION,
        reviewThreshold: RISK_REVIEW_THRESHOLD,
      });
      const scoringInput = requiredValue(scoringInputs[0]);
      assert.equal(scoringInput.domain, 'example.test');
      assert.match(JSON.stringify(scoringInput), /"target":\{"type":"domain","value":"example\.test","exposure":"registrable_domain"\}/u);
      assert.equal(report.records[0]?.domain, 'portal.example.test');
      assert.ok(report.records[0]?.factors.some((factor) => factor.label === 'Corroborated recent external phishing/malware records'));
    }
  });

  test('replays the previous model without changing labels or current results', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'positive-high' }),
      record({ id: 'negative-low', domain: 'ordinary.example.test', analystDisposition: 'expected', evidence: { availability: 'registered' } }),
    ])));
    const report = buildRiskCalibrationReport(parsed, explainRiskScore, {
      modelVersion: RISK_MODEL_VERSION,
      reviewThreshold: RISK_REVIEW_THRESHOLD,
      previousModelVersion: 6,
      explainPreviousRiskScore: explainRiskScoreV6,
    });
    assert.equal(report.modelComparison.available, true);
    assert.equal(report.modelComparison.previousModelVersion, 6);
    assert.equal(report.modelComparison.currentModelVersion, 7);
    assert.equal(report.modelComparison.scoresChanged, 2);
    assert.equal(report.summary.positive, 1);
    assert.equal(report.summary.negative, 1);
  });

  test('projects a strict target-free summary without record identifiers or evidence', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'private-positive', domain: 'private-positive.example.test' }),
      record({
        id: 'private-negative', domain: 'private-negative.example.test', analystDisposition: 'expected',
        evidence: { availability: 'registered' },
      }),
    ])));
    const full = buildRiskCalibrationReport(parsed, explainRiskScore, {
      generatedAt: '2026-08-10T00:00:00.000Z',
      modelVersion: RISK_MODEL_VERSION,
      reviewThreshold: RISK_REVIEW_THRESHOLD,
      previousModelVersion: 6,
      explainPreviousRiskScore: explainRiskScoreV6,
    });
    const summary = buildRiskCalibrationSummaryReport(full);
    const encoded = JSON.stringify(summary);
    assert.equal(summary.schema, RISK_CALIBRATION_SUMMARY_SCHEMA);
    assert.equal(summary.summary.total, 2);
    assert.deepEqual(summary.privacy, { targetsRetained: 0, identifiersRetained: 0, rawEvidenceRetained: 0 });
    assert.doesNotMatch(encoded, /private-positive|private-negative|example\.test|"records"|"factors"|"evidence"/iu);
    assert.deepEqual(parseRiskCalibrationSummaryReport(encoded), summary);

    const changed = { ...summary, summary: { ...summary.summary, positive: 2 } };
    assert.throws(() => parseRiskCalibrationSummaryReport(JSON.stringify(changed)), /label counts are inconsistent/iu);
    const unsafe = { ...summary, privacy: { ...summary.privacy, targetsRetained: 1 } };
    assert.throws(() => parseRiskCalibrationSummaryReport(JSON.stringify(unsafe)), /retain zero targets/iu);
  });

  test('terminal output stays bounded and points to complete JSON', () => {
    const records = Array.from({ length: 101 }, (_, index) => record({
      id: `case-${index}`,
      domain: `host-${index}.example.test`,
      analystDisposition: 'expected',
      evidence: { availability: 'registered' },
    }));
    const report = buildRiskCalibrationReport(parseRiskCalibrationDataset(JSON.stringify(dataset(records))), explainRiskScore, {
      modelVersion: RISK_MODEL_VERSION, reviewThreshold: RISK_REVIEW_THRESHOLD,
    });
    const output = formatTerminalRiskCalibration(report);
    assert.match(output, /1 additional records omitted/);
    assert.match(output, /use --json/);
    assert.doesNotMatch(output, /host-100\.example\.test/);
  });
});

describe('risk-calibrate runner', () => {
  test('runs from stdin as an offline JSON transformation', async () => {
    const stdout = capture();
    const stderr = capture();
    let networkCalled = false;
    const code = await runCli(['risk-calibrate', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: Readable.from([JSON.stringify(dataset())]),
      now: () => '2026-07-18T00:00:00.000Z',
      runUnifiedLookup: async () => { networkCalled = true; },
      fetchHomepage: async () => { networkCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr.value(), '');
    assert.equal(networkCalled, false);
    assert.equal(JSON.parse(stdout.value()).generatedAt, '2026-07-18T00:00:00.000Z');
  });

  test('emits a target-free summary for the explicit summary output', async () => {
    const stdout = capture();
    const code = await runCli(['risk-calibrate', '--summary-json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      stdin: Readable.from([JSON.stringify(dataset())]),
      now: () => '2026-08-10T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    const summary = parseRiskCalibrationSummaryReport(stdout.value());
    assert.equal(summary.schema, RISK_CALIBRATION_SUMMARY_SCHEMA);
    assert.equal(summary.summary.total, 1);
    assert.doesNotMatch(stdout.value(), /case-1|login\.example\.test|"records"/iu);
  });

  test('writes terminal, detailed JSON, and target-free summary output through the private file route', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-risk-calibration-output-'));
    const routes = [
      { name: 'terminal', arguments: [] as string[], file: 'risk.txt' },
      { name: 'detailed', arguments: ['--json'], file: 'risk.json' },
      { name: 'summary', arguments: ['--summary-json'], file: 'risk-summary.json' },
    ] as const;
    try {
      for (const route of routes) {
        const destination = join(directory, route.file);
        const stdout = capture();
        const stderr = capture();
        const code = await runCli([
          'risk-calibrate',
          ...route.arguments,
          '--output',
          destination,
        ], {
          stdout: stdout.stream,
          stderr: stderr.stream,
          stdin: Readable.from([JSON.stringify(dataset())]),
          now: () => '2026-08-10T00:00:00.000Z',
        });
        assert.equal(code, EXIT_CODES.SUCCESS, route.name);
        assert.equal(stdout.value(), '', route.name);
        assert.equal(stderr.value(), '', route.name);
        assert.equal((await stat(destination)).mode & 0o777, 0o600, route.name);
        const output = await readFile(destination, 'utf8');
        assert.ok(Buffer.byteLength(output, 'utf8') <= MAX_CLI_OUTPUT_BYTES, route.name);
        assert.equal(output.endsWith('\n'), true, route.name);
        if (route.name === 'terminal') {
          assert.match(output, /Risk model/u);
        } else if (route.name === 'detailed') {
          assert.equal(JSON.parse(output).mode, 'detailed');
          assert.match(output, /login\.example\.test/u);
        } else {
          const summary = parseRiskCalibrationSummaryReport(output);
          assert.equal(summary.mode, 'summary');
          assert.doesNotMatch(output, /case-1|login\.example\.test|"records"/iu);
        }
      }

      const destination = join(directory, 'risk.json');
      const before = await readFile(destination, 'utf8');
      const refused = capture();
      assert.equal(await runCli(['risk-calibrate', '--json', '--output', destination], {
        stdout: capture().stream,
        stderr: refused.stream,
        stdin: Readable.from([JSON.stringify(dataset())]),
      }), EXIT_CODES.USAGE);
      assert.match(refused.value(), /already exists/u);
      assert.equal(await readFile(destination, 'utf8'), before);

      await writeFile(destination, 'stale\n', { mode: 0o644 });
      assert.equal(await runCli(['risk-calibrate', '--json', '--output', destination, '--force'], {
        stdout: capture().stream,
        stderr: capture().stream,
        stdin: Readable.from([JSON.stringify(dataset())]),
        now: () => '2026-08-10T00:00:00.000Z',
      }), EXIT_CODES.SUCCESS);
      assert.equal(JSON.parse(await readFile(destination, 'utf8')).mode, 'detailed');
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('accepts the private sink byte ceiling and rejects ceiling plus one before opening a file', async () => {
    let opens = 0;
    const operations: OutputFileOperations = {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      async open() {
        opens += 1;
        return {
          async writeFile() {},
          async sync() {},
          async close() {},
        };
      },
      async link() {},
      async rename() {},
      async unlink() {},
    };
    const boundary = 'x'.repeat(MAX_CLI_OUTPUT_BYTES);
    assert.equal(
      await writePrivateFile('risk-calibration-boundary.json', boundary, {}, operations),
      join(process.cwd(), 'risk-calibration-boundary.json'),
    );
    assert.equal(opens, 1);
    await assert.rejects(
      writePrivateFile('risk-calibration-over-limit.json', `${boundary}x`, {}, operations),
      new RegExp(`limited to ${MAX_CLI_OUTPUT_BYTES} bytes`, 'u'),
    );
    assert.equal(opens, 1);
  });

  test('missing or malformed input is a usage error and quiet suppresses output', async () => {
    const missing = capture();
    assert.equal(await runCli(['risk-calibrate'], {
      stdout: capture().stream, stderr: missing.stream, readRiskCalibrationInput: async () => '',
    }), EXIT_CODES.USAGE);
    assert.match(missing.value(), /requires one dataset/);

    const malformed = capture();
    assert.equal(await runCli(['risk-calibrate'], {
      stdout: capture().stream, stderr: malformed.stream, readRiskCalibrationInput: async () => '{}',
    }), EXIT_CODES.USAGE);
    assert.match(malformed.value(), /must use/);

    const quiet = capture();
    assert.equal(await runCli(['risk-calibrate', '--quiet'], {
      stdout: quiet.stream, stderr: capture().stream, readRiskCalibrationInput: async () => JSON.stringify(dataset()),
    }), EXIT_CODES.SUCCESS);
    assert.equal(quiet.value(), '');
  });
});
