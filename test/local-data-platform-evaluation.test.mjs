import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA,
  LOCAL_DATA_PLATFORM_EVALUATION_VERSION,
  LOCAL_STORAGE_REFERENCE_BYTES,
  MAX_LOCAL_DATA_EVALUATION_CANDIDATES,
  MAX_LOCAL_DATA_EVALUATION_DETAIL_LENGTH,
  MAX_LOCAL_DATA_EVALUATION_STORES,
  buildLocalDataPlatformEvaluation,
  formatLocalDataPlatformEvaluation,
  main,
  parseArguments,
} from '../tools/local-data-platform-evaluation.mts';

const NOW = new Date('2026-07-22T00:00:00.000Z');
const DECLARED_BROWSER_STORE_BYTES = 10_223_616;

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += String(chunk); } }, value: () => value };
}

describe('local data platform evaluation', () => {
  test('derives the aggregate ceiling from the owning browser-store constants', () => {
    const report = buildLocalDataPlatformEvaluation({ now: () => NOW });
    assert.equal(report.schema, LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA);
    assert.equal(report.version, LOCAL_DATA_PLATFORM_EVALUATION_VERSION);
    assert.equal(report.generatedAt, NOW.toISOString());
    assert.equal(report.mode, 'offline_contract_evaluation');
    assert.equal(report.current.storeCount, 7);
    assert.ok(report.current.storeCount <= MAX_LOCAL_DATA_EVALUATION_STORES);
    assert.equal(report.current.declaredMaximumBytes, DECLARED_BROWSER_STORE_BYTES);
    assert.equal(report.current.declaredMaximumMiB, 9.75);
    assert.equal(report.current.localStorageReferenceBytes, LOCAL_STORAGE_REFERENCE_BYTES);
    assert.equal(report.current.exceedsReferenceByBytes, 4_980_736);
    assert.equal(report.current.exceedsReferenceByMiB, 4.75);
  });

  test('keeps the evaluation offline and does not inspect or change browser data', () => {
    const report = buildLocalDataPlatformEvaluation({ now: () => NOW });
    assert.deepEqual(report.boundaries, {
      networkRequests: 0,
      browserRecordsRead: 0,
      userDataRead: false,
      productionStorageChanged: false,
    });
    assert.equal(report.current.crossStoreTransactions, false);
    assert.equal(report.current.investigationSearchBuild, 'disposable_full_store_projection');
  });

  test('recommends a dependency-free native prototype without approving migration', () => {
    const report = buildLocalDataPlatformEvaluation({ now: () => NOW });
    assert.equal(report.decision.state, 'proceed_with_native_indexeddb_prototype');
    assert.equal(report.decision.recommendedCandidate, 'native_indexeddb');
    assert.equal(report.decision.migrationApproved, false);
    assert.deepEqual(report.decision.independentFutureWork, ['production_migration', 'encryption', 'pwa']);
    assert.ok(report.candidates.length <= MAX_LOCAL_DATA_EVALUATION_CANDIDATES);

    const native = report.candidates.find((candidate) => candidate.id === 'native_indexeddb');
    assert.deepEqual(native, {
      id: 'native_indexeddb',
      disposition: 'recommended',
      productionDependency: false,
      sameOriginLocal: true,
      supportsTransactions: true,
      supportsIndexedQueries: true,
      detail: 'Prototype the browser-native asynchronous database first, behind an application-owned interface.',
    });
    assert.equal(report.candidates.find((candidate) => candidate.id === 'indexeddb_wrapper')?.disposition, 'optional_later');
    assert.equal(report.candidates.find((candidate) => candidate.id === 'sqlite_wasm')?.disposition, 'defer');
    assert.equal(report.candidates.find((candidate) => candidate.id === 'localstorage')?.disposition, 'transitional');
  });

  test('retains bounded explanatory text and distinguishes measured thresholds from limitations', () => {
    const report = buildLocalDataPlatformEvaluation({ now: () => NOW });
    assert.equal(report.findings.find((finding) => finding.id === 'aggregate_capacity')?.status, 'threshold_met');
    assert.equal(report.findings.find((finding) => finding.id === 'queryability')?.status, 'threshold_met');
    assert.equal(report.findings.find((finding) => finding.id === 'privacy')?.status, 'preserve');
    assert.equal(report.findings.find((finding) => finding.id === 'offline')?.status, 'neutral');
    assert.ok([...report.findings, ...report.limitations].every((entry) => {
      const detail = typeof entry === 'string' ? entry : entry.detail;
      return detail.length > 0 && detail.length <= MAX_LOCAL_DATA_EVALUATION_DETAIL_LENGTH;
    }));
    assert.match(report.limitations.join(' '), /not a measurement of one user workspace/i);
    assert.match(report.limitations.join(' '), /quota and eviction behavior vary/i);
  });

  test('is deterministic under injected time and exposes versioned JSON without user records', async () => {
    const first = buildLocalDataPlatformEvaluation({ now: () => NOW });
    const second = buildLocalDataPlatformEvaluation({ now: () => NOW });
    assert.deepEqual(second, first);
    assert.doesNotMatch(JSON.stringify(first), /notes|registrant|password|session/i);

    const stdout = capture();
    const stderr = capture();
    assert.equal(await main(['--json'], { now: () => NOW, stdout: stdout.stream, stderr: stderr.stream }), 0);
    assert.equal(stderr.value(), '');
    assert.deepEqual(JSON.parse(stdout.value()), first);
  });

  test('formats a concise maintainer decision and rejects unsupported arguments', async () => {
    const report = buildLocalDataPlatformEvaluation({ now: () => NOW });
    const output = formatLocalDataPlatformEvaluation(report);
    assert.match(output, /9\.75 MiB across 7 stores/);
    assert.match(output, /native_indexeddb \(no production dependency\)/);
    assert.match(output, /Migration, encryption, and PWA support remain separately gated/);

    assert.deepEqual(parseArguments([]), { json: false });
    assert.deepEqual(parseArguments(['--json']), { json: true });
    assert.throws(() => parseArguments(['--json', '--json']), /only once/);
    assert.throws(() => parseArguments(['--live']), /Unknown option/);

    const stderr = capture();
    assert.equal(await main(['--live'], { now: () => NOW, stdout: capture().stream, stderr: stderr.stream }), 2);
    assert.match(stderr.value(), /Unknown option/);
  });
});
