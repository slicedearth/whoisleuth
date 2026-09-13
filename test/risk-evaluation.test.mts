import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { describe, test } from 'node:test';
import { curateEvaluationArchive, curateEvaluationCsv, EVALUATION_SOURCE, evaluationCsvRows, evaluationDataset, evaluationReports, parseEvaluationRows } from '../tools/risk-evaluation.mts';
import { parseRiskCalibrationDashboard, calibrationRateLabel } from '../frontend/src/lib/analysis/risk-calibration-dashboard.ts';
import { RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { runCli } from '../cli/runner.mts';

const root = path.resolve(import.meta.dirname, '..');
const text = await readFile(new URL('../fixtures/risk-evaluation/rows.json', import.meta.url), 'utf8');
const rows = parseEvaluationRows(text);
const now = '2026-09-14T00:00:00.000Z';
const header = 'URL,label,HasPasswordField,HasExternalFormSubmit';

describe('external Risk evaluation examples', () => {
  test('retains source identity, original labels and an explicit minimisation boundary', () => {
    const corpus = JSON.parse(text);
    assert.deepEqual(corpus.source, EVALUATION_SOURCE);
    assert.equal(corpus.source.archiveSha256, '0a639fd03aea6308c5b1c10c92aa23c2ce1505447a9137271865cd0badc9a59a');
    assert.equal(corpus.sourceRows, 235_795);
    assert.equal(corpus.invalidUrls, 0);
    assert.equal(corpus.domainGroups, 175_509);
    assert.equal(Object.values<number>(corpus.population).reduce((sum, count) => sum + count, 0), 235_795);
    assert.ok(Number.isSafeInteger(corpus.mixedLabelDomainGroups));
    assert.ok(corpus.mixedLabelDomainGroups > 0);
    assert.equal(rows.length, 128);
    assert.equal(new Set(rows.map(row => row.domainGroup)).size, 128);
    assert.equal(new Set(rows.map(row => row.sourceRow)).size, 128);
    assert.doesNotMatch(JSON.stringify(rows), /https?:|@|<html|password=|token=/iu);
    assert.ok(rows.every(row => Object.keys(row).length === 6));
  });

  test('keeps development and evaluation groups disjoint with both classes in every feature stratum', () => {
    const development = new Set(rows.filter(row => row.split === 'development').map(row => row.domainGroup));
    const evaluation = rows.filter(row => row.split === 'evaluation');
    assert.equal(development.size, 64);
    assert.equal(evaluation.length, 64);
    assert.ok(evaluation.every(row => !development.has(row.domainGroup)));
    for (const report of evaluationReports(rows, now)) {
      assert.deepEqual(report.sourceLabels, { phishing: 32, legitimate: 32 });
      assert.equal(report.featureOverlap.length, 4);
      for (const combination of report.featureOverlap) {
        assert.equal(combination.phishing, 8);
        assert.equal(combination.legitimate, 8);
      }
    }
  });

  test('maps source labels without inventing authority, time, form linkage or label-derived features', () => {
    for (const split of ['development', 'evaluation'] as const) {
      const dataset = evaluationDataset(rows, split);
      assert.equal(dataset.records.length, 64);
      for (const record of dataset.records) {
        const source = rows.find(row => record.id === `uci-967-row-${row.sourceRow}`)!;
        assert.match(record.domain, /^row-\d+\.example\.test$/u);
        assert.equal(record.analystDisposition, source.label === 0 ? 'confirmed_abuse' : 'false_positive');
        assert.deepEqual(record.evidence, { availability: 'unknown', hasPasswordField: source.passwordField });
      }
    }
  });

  test('withholds unsupported scores in both CLI and browser reports rather than counting true negatives', () => {
    for (const { calibration } of evaluationReports(rows, now)) {
      assert.equal(calibration.generatedAt, now);
      assert.deepEqual(calibration.summary.scoreBands, { not_scored: 64, '0_39': 0, '40_69': 0, '70_100': 0 });
      assert.equal(calibration.summary.excluded, 64);
      assert.equal(calibration.summary.positive, 0);
      assert.equal(calibration.summary.negative, 0);
      const metric = calibration.thresholds.find(item => item.threshold === RISK_REVIEW_THRESHOLD)!;
      assert.equal(metric.precision, null);
      assert.equal(metric.recall, null);
      assert.equal(calibrationRateLabel(metric.precision), 'Unmeasured');
      const dashboard = parseRiskCalibrationDashboard(JSON.stringify(calibration));
      assert.equal(dashboard.includedLabels, 0);
      assert.equal(dashboard.sampleSufficiency, 'insufficient');
      assert.doesNotMatch(JSON.stringify(calibration), /domainGroup|sourceRow|example\.test/u);
    }
  });

  test('the public offline command accepts the retained evaluation projection without a collection request', async () => {
    let stdout = '', stderr = '', requests = 0;
    const code = await runCli(['risk-calibrate', '--summary-json'], {
      stdin: Readable.from([JSON.stringify(evaluationDataset(rows, 'evaluation'))]),
      stdout: new Writable({ write(chunk, _encoding, done) { stdout += chunk.toString(); done(); } }),
      stderr: new Writable({ write(chunk, _encoding, done) { stderr += chunk.toString(); done(); } }),
      now: () => now,
      runUnifiedLookup: async () => { requests += 1; },
      fetchHomepage: async () => { requests += 1; },
    });
    assert.equal(code, 0);
    assert.equal(stderr, '');
    assert.equal(requests, 0);
    assert.equal(parseRiskCalibrationDashboard(stdout).includedLabels, 0);
    assert.equal(JSON.parse(stdout).summary.total, 64);
    assert.doesNotMatch(stdout, /example\.test|domainGroup|sourceRow/u);
  });

  test('parses quoted CSV fields, embedded lines, empty fields and UTF-8 BOM without losing row identity', () => {
    assert.deepEqual([...evaluationCsvRows('\ufeffa,b,c\r\n"comma,value","quote""value","line\r\nbreak"\r\n,empty,')], [
      ['a', 'b', 'c'], ['comma,value', 'quote"value', 'line\r\nbreak'], ['', 'empty', ''],
    ]);
    assert.deepEqual([...evaluationCsvRows('a\n""')], [['a'], ['']]);
  });

  test('rejects malformed and oversized CSV structure before accumulating it', () => {
    for (const input of ['"unfinished', 'a"b', '"closed"x', 'a\0b']) assert.throws(() => [...evaluationCsvRows(input)]);
    assert.throws(() => [...evaluationCsvRows('x'.repeat(65_537))], /field is too large/u);
    assert.throws(() => [...evaluationCsvRows(Array(65).fill('x').join(','))], /too many columns/u);
    assert.throws(() => [...evaluationCsvRows('x\n'.repeat(250_002))], /too many rows/u);
  });

  test('requires exact binary source values and complete unique column identities', () => {
    for (const input of [
      'label,label\n0,1', 'URL,label\nhttps://a.example.test,0',
      `${header}\nhttps://a.example.test,1,unknown,0`, `${header}\nhttps://a.example.test,1,0`,
    ]) assert.throws(() => curateEvaluationCsv(input));
  });

  test('keeps a whole registrable domain in one split and records discarded URLs and conflicting labels', () => {
    const csv = `${header}\nhttps://first.example.test/page,0,1,0\nhttps://second.example.test/other,1,0,1\nnot-a-url,1,0,0\nfile:///private/example,0,1,1`;
    const corpus = curateEvaluationCsv(csv);
    assert.equal(corpus.sourceRows, 4);
    assert.equal(corpus.invalidUrls, 2);
    assert.equal(corpus.domainGroups, 1);
    assert.equal(corpus.mixedLabelDomainGroups, 1);
    assert.equal(corpus.rows.length, 1);
    assert.deepEqual(curateEvaluationCsv(csv), corpus);
    assert.doesNotMatch(JSON.stringify(corpus.rows), /example|https|page|other/u);
  });

  test('rejects corrupt, future-shaped, overlapping and unminimised retained rows', () => {
    const first = rows[0]!;
    const invalid = [
      [], [null], [first, first], [{ ...first, URL: 'https://private.example.test/' }],
      [{ ...first, sourceRow: 0 }], [{ ...first, domainGroup: 'raw.example.test' }],
      [{ ...first, label: 2 }], [{ ...first, passwordField: '1' }],
      [{ ...first, split: first.split === 'evaluation' ? 'development' : 'evaluation' }],
      Array.from({ length: 129 }, () => first),
    ];
    for (const candidate of invalid) assert.throws(() => parseEvaluationRows(JSON.stringify({ rows: candidate })));
    assert.throws(() => parseEvaluationRows('{"rows":[],"rows":[]}'));
  });

  test('refuses an unreviewed archive and symbolic input without retaining or extracting source data', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'evaluation-fixture-'));
    try {
      const filename = path.join(directory, 'source.zip');
      await writeFile(filename, 'unreviewed archive');
      await assert.rejects(curateEvaluationArchive(filename), /reviewed digest/u);
      const link = path.join(directory, 'linked.zip');
      await symlink(filename, link);
      await assert.rejects(curateEvaluationArchive(link));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test('runs its offline entry point with separate reports and rejects unknown arguments', () => {
    const command = path.join(root, 'tools/risk-evaluation.mts');
    const result = spawnSync(process.execPath, [command], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.reports.map((report: { split: string }) => report.split), ['development', 'evaluation']);
    assert.match(output.limitations.join(' '), /historical source dataset/u);
    assert.equal(output.source.licence, 'CC-BY-4.0');
    const failed = spawnSync(process.execPath, [command, '--unknown'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, /Evaluation failed/u);
  });
});
