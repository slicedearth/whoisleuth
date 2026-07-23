'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const { formatTerminalRiskCalibration } = require('../cli/formatters/terminal.mts');
const {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  MAX_RISK_CALIBRATION_RECORDS,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  readRiskCalibrationInputBounded,
} = require('../cli/risk-calibration.mts');
const { explainRiskScore, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } = require('../lib/risk-scoring.mts');
const { runCli } = require('../cli/runner.mts');

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
  });

  test('rejects duplicate output, incompatible quiet mode, unknown options, and multiple files', () => {
    assert.throws(() => parseCliArguments(['risk-calibrate', '--json', '--json']), /only once/);
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
    assert.deepEqual(parsed.records[0].evidence, {
      availability: 'registered', mutationTypes: ['dictionary'], domainAgeDays: 30,
    });
    assert.doesNotMatch(JSON.stringify(parsed), /unknownRecord|unknownEvidence|discard me/);
  });

  test('normalizes domain case and a final root dot while requiring unique IDs', () => {
    const parsed = parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'one', domain: 'LOGIN.EXAMPLE.TEST.' }),
      record({ id: 'two', domain: 'mail.example.test' }),
    ])));
    assert.equal(parsed.records[0].domain, 'login.example.test');
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([
      record({ id: 'same' }), record({ id: 'same', domain: 'other.example.test' }),
    ]))), /must be unique/);
  });

  test('rejects the wrong schema, empty and oversized collections, and malformed records', () => {
    assert.throws(() => parseRiskCalibrationDataset('{}'), /must use/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([]))), /non-empty records/);
    const tooMany = Array.from({ length: MAX_RISK_CALIBRATION_RECORDS + 1 }, (_, index) => record({ id: `r-${index}` }));
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset(tooMany))), /record limit/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ id: 'bad\nvalue' })]))), /control characters/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ domain: 'not a host' })]))), /valid ASCII DNS hostname/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ domain: '192.0.2.1' })]))), /not an IP address/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ analystDisposition: 'malicious' })]))), /unsupported/);
  });

  test('rejects malformed scalar evidence instead of coercing it', () => {
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'missing' } })]))), /availability is unsupported/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', hasMx: 1 } })]))), /must be true or false/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', domainAgeDays: 100_001 } })]))), /domainAgeDays/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', activityStatus: 'online' } })]))), /activityStatus is unsupported/);
    assert.throws(() => parseRiskCalibrationDataset(JSON.stringify(dataset([record({ evidence: { availability: 'registered', mutationTypes: ['invented'] } })]))), /mutationTypes\[0\] is unsupported/);
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
    assert.equal(parsed.records[0].evidence.threatIntelligence.providers[0].provider.id, 'urlscan_search');
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
    assert.equal(report.version, 1);
    assert.equal(report.riskModelVersion, 6);
    assert.deepEqual(report.summary, {
      total: 4,
      positive: 1,
      negative: 1,
      excluded: 2,
      scoreBands: { not_scored: 1, '0_39': 2, '40_69': 0, '70_100': 1 },
    });
    const current = report.thresholds.find((item) => item.threshold === 70);
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
    });
    assert.equal(report.records[2].exclusionReason, 'contextual_disposition');
    assert.equal(report.records[3].exclusionReason, 'not_scored');
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
    assert.equal(report.thresholds[0].precision, null);
    assert.equal(report.thresholds[0].recall, null);
    assert.equal(report.thresholds[0].specificity, null);
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
