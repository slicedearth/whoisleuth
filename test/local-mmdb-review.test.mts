import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { open, mkdtemp, readFile, readdir, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Reader, type Response } from 'maxmind';
import { reviewLocalMmdb, inspectLocalMmdbMetadata, LOCAL_MMDB_QUERY_SCHEMA, LOCAL_MMDB_REVIEW_SCHEMA,
  MAX_LOCAL_MMDB_BYTES, MAX_LOCAL_MMDB_REVIEW_BYTES } from '../cli/local-mmdb-review.mts';
import { buildOfflineEvidenceReviewWithLocalResources, formatOfflineEvidenceReview, buildOfflineEvidenceReview } from '../cli/offline-evidence-review.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';
import { deferred } from './deferred.mts';

const FIXTURE = 'fixtures/mmdb/maxmind-db-test-data/GeoIP2-City-Test.mmdb';
const DIGEST = 'ed972738e4e03a3e56e12041a6af4d91592249d110f7e4a647e5f2fa0e639c09';
const BUILD = '2026-02-04T22:49:29.000Z';
const NOW = '2026-08-03T01:02:03.000Z';
// This address and its fake attribution come solely from the pinned upstream test database.
const ADDRESS = '81.2.69.142';
const QUERY = { schema: LOCAL_MMDB_QUERY_SCHEMA, version: 2, address: ADDRESS, sourceLabel: 'Pinned test database',
  databaseVersion: 'Analyst declaration', license: 'MIT',
  freshnessPolicy: { maxAgeDays: 300, rationale: 'Synthetic research fixture reviewed within the selected age window' } };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function temporaryDatabase(bytes: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-mmdb-fixture-'));
  directories.push(directory);
  const path = join(directory, 'selected.mmdb');
  await writeFile(path, bytes);
  return path;
}

async function current(input: Record<string, unknown> = QUERY, checkedAt = NOW, path = FIXTURE) {
  const result = await reviewLocalMmdb(input, path, checkedAt);
  assert.ok('database' in result);
  return result;
}

function capture() {
  let output = '';
  return { stream: { write(chunk: string) { output += chunk; } }, value: () => output };
}

test('current review retains exact-byte identity and intrinsic metadata separately from declared labels', async () => {
  const bytes = await readFile(FIXTURE);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), DIGEST);
  const before = structuredClone(QUERY);
  const result = await current();
  assert.equal(result.schema, LOCAL_MMDB_REVIEW_SCHEMA); assert.equal(result.version, 1);
  assert.equal(result.state, 'matched'); assert.equal(result.completeness, 'complete');
  assert.deepEqual(result.database, { sha256: DIGEST, byteLength: 22569, metadata: {
    databaseType: 'GeoIP2-City', builtAt: BUILD, binaryFormat: { major: 2, minor: 0 }, ipVersion: 6,
  } });
  assert.equal(result.source.version, 'Analyst declaration');
  assert.equal(result.freshness.state, 'current'); assert.equal(result.freshness.checkedAt, NOW);
  assert.equal(result.freshness.ageDays, (Date.parse(NOW) - Date.parse(BUILD)) / 86400000);
  assert.deepEqual(result.freshness.policy, QUERY.freshnessPolicy);
  assert.deepEqual(result.match, { network: '81.2.69.142/31', countryCode: 'GB', region: 'England', city: 'London', asn: null, asName: null });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_LOCAL_MMDB_REVIEW_BYTES);
  assert.ok(!JSON.stringify(result).includes(FIXTURE));
  for (const value of [result, result.database, result.database.metadata!, result.database.metadata!.binaryFormat,
    result.match!, result.source, result.freshness, result.freshness.policy, result.limitations]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(QUERY, before);
});

test('historical v1 keeps its exact result fields and independent expected match without a current admission claim', async () => {
  const result = await reviewLocalMmdb({ ...QUERY, version: 1 }, FIXTURE, 'invalid legacy clock');
  assert.deepEqual(Object.keys(result).sort(), ['address', 'limitations', 'match', 'source', 'state']);
  assert.equal(result.state, 'matched'); assert.equal(result.match?.network, '81.2.69.142/31');
  assert.equal(result.match?.countryCode, 'GB'); assert.equal(result.match?.city, 'London');
  assert.equal('freshness' in result, false); assert.equal('database' in result, false);
  const document = await buildOfflineEvidenceReviewWithLocalResources(JSON.stringify({ ...QUERY, version: 1 }), NOW, { mmdbPath: FIXTURE });
  assert.equal(document.version, 1);
  assert.match(formatOfflineEvidenceReview(document), /Intrinsic MMDB freshness is not assessed by this result/u);
  assert.ok(!formatOfflineEvidenceReview(document).includes('Historical query'));
});

test('current JSON-prefix review gets neutral MMDB freshness guidance without historical classification or mutation', () => {
  const document = buildOfflineEvidenceReview(JSON.stringify({ schema: 'whoisleuth.local-geoip-query', version: 1,
    address: '192.0.2.1', database: { sourceLabel: 'Synthetic prefix database', databaseVersion: 'Current supplied edition',
      license: 'Test data only', records: [{ network: '192.0.2.0/24', countryCode: 'AU' }] } }), NOW);
  const before = JSON.stringify(document);
  const text = formatOfflineEvidenceReview(document);
  assert.match(text, /Intrinsic MMDB freshness is not assessed by this result/u);
  assert.ok(!text.includes('Historical')); assert.equal(JSON.stringify(document), before);
  assert.equal((document.result as { state: string }).state, 'matched');
});

test('stale and future build clocks withhold a known matching location before lookup', async () => {
  const stale = await current({ ...QUERY, freshnessPolicy: { maxAgeDays: 30, rationale: 'Fixture for a deliberate short review window' } });
  assert.equal(stale.state, 'unavailable'); assert.equal(stale.reason, 'stale_database'); assert.equal(stale.match, null);
  assert.equal(stale.freshness.state, 'stale'); assert.equal(stale.database.sha256, DIGEST);
  const future = await current(QUERY, '2026-02-04T22:49:28.000Z');
  assert.equal(future.state, 'unavailable'); assert.equal(future.reason, 'future_database'); assert.equal(future.match, null);
  assert.equal(future.freshness.state, 'unknown');
});

test('age admission uses the explicit policy with an exact inclusive boundary, not a built-in historical cutoff', async () => {
  const bytes = await readFile(FIXTURE), metadata = new Reader<Response>(bytes).metadata;
  const policy = { maxAgeDays: 1, rationale: 'One-day synthetic boundary' };
  assert.equal(inspectLocalMmdbMetadata(metadata, bytes.length, '2026-02-05T22:49:29.000Z', policy).reason, 'admitted');
  assert.equal(inspectLocalMmdbMetadata(metadata, bytes.length, '2026-02-05T22:49:29.001Z', policy).reason, 'stale_database');
  assert.equal(inspectLocalMmdbMetadata(metadata, bytes.length, '2026-02-05T22:49:29', policy).reason, 'invalid_metadata');
  const epoch = { ...metadata, buildEpoch: new Date(0) };
  assert.equal(inspectLocalMmdbMetadata(epoch, bytes.length, '1970-01-02T00:00:00.000Z', policy).reason, 'admitted');
  const stale = inspectLocalMmdbMetadata(epoch, bytes.length, '1970-01-02T00:00:00.001Z', policy);
  assert.equal(stale.reason, 'stale_database'); assert.equal(stale.metadata?.builtAt, '1970-01-01T00:00:00.000Z');
});

test('unsupported intrinsic formats/types and malformed metadata are never admitted as location evidence', async () => {
  const bytes = await readFile(FIXTURE), metadata = new Reader<Response>(bytes).metadata;
  for (const [changes, reason] of [
    [{ databaseType: 'Other-City' }, 'unsupported_database'],
    [{ binaryFormatMajorVersion: 3 }, 'unsupported_format'], [{ binaryFormatMinorVersion: 1 }, 'unsupported_format'],
    [{ buildEpoch: new Date(NaN) }, 'invalid_metadata'], [{ buildEpoch: new Date(-1000) }, 'invalid_metadata'],
    [{ binaryFormatMajorVersion: '2' }, 'invalid_metadata'], [{ ipVersion: 5 }, 'invalid_metadata'],
    [{ nodeCount: Number.MAX_SAFE_INTEGER }, 'invalid_metadata'], [{ recordSize: '28' }, 'invalid_metadata'],
  ] as const) assert.equal(inspectLocalMmdbMetadata({ ...metadata, ...changes }, bytes.length, NOW, QUERY.freshnessPolicy).reason, reason);
  const changed = Buffer.from(bytes), offset = changed.lastIndexOf(Buffer.from('GeoIP2-City'));
  assert.ok(offset > 0); changed[offset + 5] = '9'.charCodeAt(0);
  const unsupported = await current(QUERY, NOW, await temporaryDatabase(changed));
  assert.equal(unsupported.reason, 'unsupported_database'); assert.equal(unsupported.match, null);
  assert.equal(unsupported.database.metadata?.databaseType, 'GeoIP9-City');
  assert.notEqual(unsupported.database.sha256, DIGEST);
  const corrupt = await current(QUERY, NOW, await temporaryDatabase(Buffer.from('Synthetic invalid database')));
  assert.equal(corrupt.reason, 'invalid_database'); assert.equal(corrupt.database.metadata, null); assert.equal(corrupt.match, null);
});

test('misses and non-public targets remain unavailable without empty matched results or location absence', async () => {
  const miss = await current({ ...QUERY, address: '192.0.2.1' });
  assert.equal(miss.state, 'unavailable'); assert.equal(miss.reason, 'unsupported_address'); assert.equal(miss.match, null);
  // An address adjacent to the pinned fake record has no match in this database.
  const adjacent = await current({ ...QUERY, address: '81.2.69.141' });
  assert.equal(adjacent.reason, 'no_match'); assert.equal(adjacent.state, 'unavailable'); assert.equal(adjacent.match, null);
  assert.equal(adjacent.freshness.state, 'current');
  assert.match(adjacent.limitations.join(' '), /not evidence of location or absence/u);
});

test('malformed coarse data stays partial and a native record without useful attribution is unavailable', async () => {
  const original = await readFile(FIXTURE), reader = new Reader<Response>(original);
  const start = reader.metadata.searchTreeSize + 16;
  const end = original.lastIndexOf(Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from('MaxMind.com')]));
  assert.ok(end > start);
  const replace = (bytes: Buffer, from: string, to: string) => {
    assert.equal(from.length, to.length);
    // Match the native UTF-8 string control byte as well as the text, so this
    // fixture mutation cannot accidentally alter a pointer or numeric value.
    const encoded = Buffer.from([0x40 + from.length, ...Buffer.from(from)]);
    let changed = 0;
    for (let offset = bytes.indexOf(encoded, start); offset >= start && offset < end; offset = bytes.indexOf(encoded, offset + encoded.length)) {
      bytes.write(to, offset + 1, 'ascii'); changed++;
    }
    assert.ok(changed > 0);
  };
  const malformed = Buffer.from(original);
  replace(malformed, 'GB', '!!');
  const partial = await current(QUERY, NOW, await temporaryDatabase(malformed));
  assert.equal(partial.state, 'partial', JSON.stringify(partial)); assert.equal(partial.reason, 'incomplete_record');
  assert.equal(partial.match?.countryCode, null); assert.equal(partial.match?.city, 'London');
  const unrelated = Buffer.from(original);
  replace(unrelated, 'country', 'unknown'); replace(unrelated, 'city', 'xxxx'); replace(unrelated, 'subdivisions', 'xxxxxxxxxxxx');
  const unavailable = await current(QUERY, NOW, await temporaryDatabase(unrelated));
  assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.reason, 'no_useful_record'); assert.equal(unavailable.match, null);
  assert.equal(unavailable.database.metadata?.databaseType, 'GeoIP2-City');
});

test('current policy/version/clock failures are rejected before file access', async () => {
  let reads = 0;
  const openFile = async (...args: Parameters<typeof open>) => { reads++; return await open(...args); };
  for (const changes of [{ version: 3 }, { freshnessPolicy: null }, { freshnessPolicy: { maxAgeDays: 0, rationale: 'zero' } },
    { freshnessPolicy: { maxAgeDays: 1.5, rationale: 'fraction' } }, { freshnessPolicy: { maxAgeDays: 1, rationale: '\u009b31m' } },
    { freshnessPolicy: { maxAgeDays: 1, rationale: 'x'.repeat(241) } }, { freshnessPolicy: { maxAgeDays: Number.MAX_SAFE_INTEGER, rationale: 'overflow' } }]) {
    await assert.rejects(reviewLocalMmdb({ ...QUERY, ...changes }, FIXTURE, NOW, { openFile }), /supported query|freshnessPolicy/u);
  }
  for (const checkedAt of ['2026-08-03T01:02:03', 'invalid', '2026-02-30T01:02:03.000Z']) {
    await assert.rejects(reviewLocalMmdb(QUERY, FIXTURE, checkedAt, { openFile }), /explicit review time/u);
  }
  assert.equal(reads, 0);
  await assert.rejects(buildOfflineEvidenceReviewWithLocalResources(JSON.stringify({ ...QUERY, version: 3 }), NOW, { mmdbPath: FIXTURE }), /supported versioned/u);
  assert.throws(() => buildOfflineEvidenceReview(JSON.stringify(QUERY), NOW), /requires --mmdb/u);
});

test('stable-file checks reject changed identity, length, clocks, non-files and oversize before decoding', async () => {
  const bytes = await readFile(FIXTURE);
  for (const changes of [{ dev: 2 }, { ino: 2 }, { size: bytes.length + 1 }, { mtimeMs: 2 }, { ctimeMs: 2 }]) {
    let calls = 0, closed = 0, workers = 0;
    const baseline = { dev: 1, ino: 1, size: bytes.length, mtimeMs: 1, ctimeMs: 1, isFile: () => true };
    const handle = { stat: async () => calls++ ? { ...baseline, ...changes } : baseline,
      read: async (storage: Buffer) => { bytes.copy(storage); return { bytesRead: bytes.length }; }, close: async () => { closed++; } } as unknown as FileHandle;
    await assert.rejects(reviewLocalMmdb(QUERY, FIXTURE, NOW, { openFile: async () => handle,
      createWorker: () => { workers++; throw new Error('Must not start'); } }), /changed while/u);
    assert.equal(closed, 1); assert.equal(workers, 0);
  }
  for (const initial of [{ isFile: () => false, size: 1 }, { isFile: () => true, size: MAX_LOCAL_MMDB_BYTES + 1 }]) {
    let read = false;
    const handle = { stat: async () => initial, read: async () => { read = true; }, close: async () => {} } as unknown as FileHandle;
    await assert.rejects(reviewLocalMmdb(QUERY, FIXTURE, NOW, { openFile: async () => handle }), /must be a file/u);
    assert.equal(read, false);
  }
});

test('worker transfer preserves exact bytes and discards unrelated input, paths and inherited environment', async () => {
  let worker: Worker | undefined;
  const result = await reviewLocalMmdb({ ...QUERY, privateRecord: 'must-not-retain' }, FIXTURE, NOW, { createWorker: options => {
    assert.deepEqual(options.env, {}); assert.deepEqual(options.execArgv, []);
    const data = options.workerData as { bytes: Uint8Array; identity: { sha256: string } };
    assert.equal(data.bytes.byteOffset, 0); assert.equal(data.bytes.byteLength, data.bytes.buffer.byteLength);
    assert.equal(createHash('sha256').update(data.bytes).digest('hex'), data.identity.sha256);
    assert.equal(data.identity.sha256, DIGEST); assert.ok(!JSON.stringify(options.workerData).includes('must-not-retain'));
    worker = new Worker(new URL('../cli/local-mmdb-review.mts', import.meta.url), options); return worker;
  } });
  assert.equal(result.state, 'matched'); assert.equal(worker?.threadId, -1);
});

test('importing the reader in an unrelated worker leaves its original channel usable', { timeout: 5_000 }, async () => {
  const url = new URL('../cli/local-mmdb-review.mts', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    import(${JSON.stringify(url)}).then(() => {
      parentPort.on('message', value => { parentPort.postMessage(value); parentPort.close(); });
      parentPort.postMessage('reader imported');
    });
  `, { eval: true, env: {}, execArgv: [], workerData: { unrelated: true } });
  const nextMessage = () => new Promise<unknown>((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
  });
  try {
    assert.equal(await nextMessage(), 'reader imported');
    const echoed = nextMessage(); worker.postMessage('original channel still usable');
    assert.equal(await echoed, 'original channel still usable');
  } finally { await worker.terminate(); }
});

test('a real busy worker is terminated at the processing deadline and crashes use fixed neutral errors', async () => {
  let worker: Worker | undefined;
  const timed = await reviewLocalMmdb(QUERY, FIXTURE, NOW, { deadlineMs: 50, createWorker: options => {
    worker = new Worker('while (true) {}', { ...options, eval: true }); return worker;
  } });
  assert.ok('reason' in timed); assert.equal(timed.reason, 'processing_deadline'); assert.equal(timed.match, null);
  assert.equal(worker?.threadId, -1);
  const crashed = await reviewLocalMmdb(QUERY, FIXTURE, NOW, { createWorker: options => new Worker('throw new Error("private path or record")', { ...options, eval: true }) });
  assert.ok('reason' in crashed); assert.equal(crashed.reason, 'processing_unavailable');
  assert.ok(!JSON.stringify(crashed).includes('private path or record'));
  const failed = await reviewLocalMmdb(QUERY, FIXTURE, NOW, { createWorker: () => { throw new Error('private path'); } });
  assert.ok('reason' in failed); assert.equal(failed.reason, 'processing_unavailable');
  assert.ok(!JSON.stringify(failed).includes('private path'));
});

test('MMDB cancellation closes an in-flight read before rejecting and never starts its worker', async () => {
  const controller = new AbortController(), entered = deferred<void>(), release = deferred<void>();
  const bytes = await readFile(FIXTURE);
  let closed = false, workers = 0;
  const handle = { stat: async () => ({ size: bytes.length, isFile: () => true }),
    read: async (buffer: Buffer) => { entered.resolve(); await release.promise; bytes.copy(buffer); return { bytesRead: bytes.length }; },
    close: async () => { closed = true; } } as unknown as FileHandle;
  const pending = reviewLocalMmdb(QUERY, FIXTURE, NOW, { signal: controller.signal, openFile: async () => handle,
    createWorker: () => { workers++; throw new Error('Must not start'); } });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  controller.abort(); release.resolve();
  await rejected;
  assert.equal(closed, true); assert.equal(workers, 0);
  await assert.rejects(reviewLocalMmdb(QUERY, FIXTURE, NOW, { signal: controller.signal,
    openFile: async () => { throw new Error('Must not reopen'); } }), { name: 'AbortError' });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) for (const mode of ['stdout', 'quiet', 'strict', 'file'] as const) {
  test(`the actual MMDB CLI honours first ${signal} during worker review (${mode})`, { timeout: 25_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-mmdb-interrupt-'));
    directories.push(directory);
    const source = join(directory, 'query.json'), output = join(directory, 'result.json');
    await writeFile(source, JSON.stringify(QUERY));
    // Replace only the decoding worker with a held real worker. The executable,
    // command routing, signal handlers, reader and cleanup all remain real.
    const preload = `data:text/javascript,${encodeURIComponent(`
      import threads from 'node:worker_threads';
      import { syncBuiltinESMExports } from 'node:module';
      const OriginalWorker = threads.Worker;
      threads.Worker = class extends OriginalWorker {
        constructor(url, options) {
          const held = options?.workerData?.kind === 'local-mmdb-review';
          super(held ? 'setInterval(() => {}, 1000)' : url, held ? { ...options, eval: true } : options);
          if (held) this.once('online', () => process.send?.('review-started'));
        }
      };
      syncBuiltinESMExports();
    `)}`;
    const child = spawn(process.execPath, ['--import', preload, 'bin/whoisleuth.mts', 'review-evidence', source, '--mmdb', FIXTURE,
      ...(mode === 'file' ? ['--json', '--output', output] : mode === 'quiet' ? ['--quiet'] : mode === 'strict' ? ['--strict-exit'] : [])],
      { env: environmentWithoutV8Coverage(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '';
    child.stdout!.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr!.setEncoding('utf8').on('data', value => { stderr += value; });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Worker did not start: ${stderr}`)), 15_000);
        child.once('message', value => { clearTimeout(timer); assert.equal(value, 'review-started'); resolve(); });
        void exited.then(code => { clearTimeout(timer); reject(new Error(`CLI exited before interruption: ${code}: ${stderr}`)); });
      });
      child.kill(signal);
      assert.equal(await exited, signal === 'SIGINT' ? 130 : 143);
      assert.equal(stdout, ''); assert.equal(stderr, 'Cancelled by analyst.\n');
      assert.deepEqual(await readdir(directory), ['query.json']);
    } finally { if (child.exitCode === null) { child.kill('SIGKILL'); await exited; } }
  });
}

test('CLI terminal, JSON and strict exit agree on current admission without making requests', async () => {
  let requests = 0;
  for (const [maxAgeDays, expected] of [[300, EXIT_CODES.SUCCESS], [30, EXIT_CODES.PARTIAL_FAILURE]] as const) {
    const input = JSON.stringify({ ...QUERY, freshnessPolicy: { ...QUERY.freshnessPolicy, maxAgeDays } });
    const stdout = capture();
    const code = await runCli(['review-evidence', '--mmdb', FIXTURE, '--json', '--strict-exit'], {
      stdout: stdout.stream, stderr: capture().stream, now: () => NOW, readArtifactInput: async () => input,
      runUnifiedLookup: async () => { requests++; throw new Error('Must remain offline'); },
    });
    assert.equal(code, expected);
    const document = JSON.parse(stdout.value());
    assert.equal(document.version, 1); assert.equal(document.result.schema, LOCAL_MMDB_REVIEW_SCHEMA); assert.equal(document.result.version, 1);
    const text = formatOfflineEvidenceReview(document);
    assert.match(text, /Database SHA-256/u); assert.ok(text.includes(DIGEST)); assert.match(text, /Intrinsic type.*GeoIP2-City/u);
    assert.match(text, /Declared source.*Analyst declaration/u); assert.ok(!text.includes(FIXTURE));
    assert.equal(text.includes('Matched network'), expected === EXIT_CODES.SUCCESS);
    assert.throws(() => formatOfflineEvidenceReview({ ...document, result: { ...document.result, version: 2 } }), /does not support.*result version/u);
  }
  assert.equal(requests, 0);
  const inventory = buildSchemaCompatibilityInventory();
  assert.deepEqual(inventory.entries.find(entry => entry.id === 'cli.local-mmdb-query-input')?.supportedVersions, [1, 2]);
  assert.equal(inventory.entries.find(entry => entry.id === 'cli.local-mmdb-review')?.currentVersion, 1);
});
