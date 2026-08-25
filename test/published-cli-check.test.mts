import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  checkPublishedCli,
  formatPublishedCliReport,
  main,
  parseArguments,
  PUBLISHED_CLI_REQUEST_TIMEOUT_MS,
  validateCandidateReport,
  validatePublishedManifest,
  type Fetcher,
} from '../tools/published-cli-check.mts';
import {
  MAX_CLI_PACKAGE_ENTRIES,
  MAX_CLI_PACKAGE_INSTALLED_CHECKS,
} from '../tools/cli-package.mts';

const VERSION = '1.33.0';
const PACKAGE_NAME = '@slicedearth/whoisleuth-cli';
const TAR_PAYLOAD = Buffer.from('reviewed fixture tar payload bytes');
const ARCHIVE = gzipSync(TAR_PAYLOAD, { level: 9 });
const RECOMPRESSED_ARCHIVE = gzipSync(TAR_PAYLOAD, { level: 0 });

function digest(algorithm: 'sha1' | 'sha256' | 'sha512', bytes = ARCHIVE, encoding: 'hex' | 'base64' = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function candidateReport(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'whoisleuth.cli-package-check',
    version: 3,
    packageName: PACKAGE_NAME,
    packageVersion: VERSION,
    sourceModuleCount: 260,
    packedEntryCount: 191,
    packedBytes: ARCHIVE.byteLength,
    unpackedBytes: 3_120_000,
    runtimeDependencies: {
      '@peculiar/x509': '2.0.0', maxmind: '5.0.7', parse5: '8.0.1',
      'reflect-metadata': '0.2.2', tldts: '7.4.10', undici: '8.9.0',
    },
    installedChecks: ['help', 'version', 'doctor'],
    publicationEnabled: true,
    archiveFilename: `whoisleuth-cli-${VERSION}.tgz`,
    archiveSha256: digest('sha256'),
    ...overrides,
  };
}

function publishedManifest(overrides: Record<string, unknown> = {}, archive = ARCHIVE) {
  return {
    name: PACKAGE_NAME,
    version: VERSION,
    license: 'AGPL-3.0-only',
    type: 'module',
    author: 'slicedearth',
    bin: { whoisleuth: 'bin/whoisleuth.mjs' },
    engines: { node: '>=24' },
    contentPolicy: { class: 'dual-use' },
    publishConfig: { access: 'public', provenance: true },
    repository: { type: 'git', url: 'git+https://github.com/slicedearth/whoisleuth.git' },
    homepage: 'https://whoisleuth.com/',
    bugs: { url: 'https://github.com/slicedearth/whoisleuth/issues' },
    dependencies: candidateReport().runtimeDependencies,
    dist: {
      integrity: `sha512-${digest('sha512', archive, 'base64')}`,
      shasum: digest('sha1', archive),
      tarball: `https://registry.npmjs.org/@slicedearth/whoisleuth-cli/-/whoisleuth-cli-${VERSION}.tgz`,
      fileCount: 191,
      unpackedSize: 3_120_000,
      attestations: {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/@slicedearth%2fwhoisleuth-cli@${VERSION}`,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
      signatures: [{ keyid: 'SHA256:fixture-key', sig: 'fixture-signature' }],
    },
    ...overrides,
  };
}

function capture() {
  let value = '';
  return { stream: { write(chunk: string) { value += chunk; } }, value: () => value };
}

async function withCandidate<T>(run: (paths: { report: string; archive: string }) => Promise<T>, report = candidateReport(), archive = ARCHIVE): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-published-test-'));
  const reportPath = path.join(root, 'cli-package-report.json');
  const archivePath = path.join(root, `whoisleuth-cli-${VERSION}.tgz`);
  try {
    await Promise.all([writeFile(reportPath, JSON.stringify(report)), writeFile(archivePath, archive)]);
    return await run({ report: reportPath, archive: archivePath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fixtureFetcher(manifest = publishedManifest(), archive = ARCHIVE): Fetcher {
  return async (input) => String(input).includes('/-/whoisleuth-cli-')
    ? new Response(archive, { headers: { 'content-length': String(archive.byteLength) } })
    : new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
}

describe('published CLI verification', () => {
  test('binds an npm-normalized manifest and recompressed registry archive to the exact reviewed tar payload without execution', async () => {
    assert.notDeepEqual(RECOMPRESSED_ARCHIVE, ARCHIVE);
    const manifest = publishedManifest({ author: { name: 'slicedearth' } }, RECOMPRESSED_ARCHIVE);
    const report = await withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, {
      fetcher: fixtureFetcher(manifest, RECOMPRESSED_ARCHIVE),
    }));
    assert.equal(report.schema, 'whoisleuth.published-cli-check');
    assert.equal(report.version, 3);
    assert.equal(report.candidateArchiveSha256, digest('sha256'));
    assert.equal(report.registryArchiveSha256, digest('sha256', RECOMPRESSED_ARCHIVE));
    assert.equal(report.tarPayloadSha256, digest('sha256', TAR_PAYLOAD));
    assert.equal(report.registryPackedBytes, RECOMPRESSED_ARCHIVE.byteLength);
    assert.equal(report.tarPayloadBytes, TAR_PAYLOAD.byteLength);
    assert.deepEqual(report.checks, ['metadata', 'registry-content-integrity', 'candidate-tar-payload-identity', 'archive-measurements', 'runtime-dependencies']);
    assert.match(formatPublishedCliReport(report), /recompress the gzip envelope/u);
    assert.match(formatPublishedCliReport(report), /does not cryptographically verify/u);
    assert.match(formatPublishedCliReport(report), /not installed or executed/u);
  });

  test('rejects candidate report drift and selected archive mismatch before registry access', async () => {
    assert.equal(MAX_CLI_PACKAGE_INSTALLED_CHECKS, 80);
    assert.doesNotThrow(() => validateCandidateReport(candidateReport({
      installedChecks: Array.from({ length: 71 }, (_, index) => `installed-check-${index}`),
    }), VERSION));
    assert.throws(() => validateCandidateReport(candidateReport({
      installedChecks: Array.from({ length: MAX_CLI_PACKAGE_INSTALLED_CHECKS + 1 }, (_, index) => `installed-check-${index}`),
    }), VERSION), /bounded non-empty string array/u);
    assert.throws(() => validateCandidateReport(candidateReport({ publicationEnabled: false }), VERSION), /publication-enabled/u);
    assert.throws(() => validateCandidateReport(candidateReport({ archiveSha256: 'a'.repeat(64), extra: true }), VERSION), /field contract/u);
    let fetched = false;
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, { fetcher: async () => { fetched = true; return new Response(); } }), candidateReport(), Buffer.from('different')),
      /candidate archive bytes/u,
    );
    assert.equal(fetched, false);
  });

  test('rejects lifecycle scripts, dependency ranges, provenance loss, and off-registry artifacts', () => {
    assert.doesNotThrow(() => validatePublishedManifest(publishedManifest({ author: { name: 'slicedearth' } }), VERSION));
    assert.throws(() => validatePublishedManifest(publishedManifest({ scripts: { postinstall: 'node install.mjs' } }), VERSION), /must not be private or declare lifecycle scripts/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ author: 'different-publisher' }), VERSION), /author, licence, or module type/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ author: { name: 'slicedearth', email: 'unexpected@example.test' } }), VERSION), /author, licence, or module type/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ homepage: 'https://invalid.example/' }), VERSION), /source and support links/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({ dependencies: { ...candidateReport().runtimeDependencies, parse5: '^8.0.1' } }), VERSION), /major, minor, and patch/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), attestations: { url: 'https://registry.npmjs.org/fixture', provenance: {} } },
    }), VERSION), /expected provenance predicate/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), tarball: `https://packages.invalid/whoisleuth-cli-${VERSION}.tgz` },
    }), VERSION), /outside the expected public registry boundary/u);
    assert.throws(() => validatePublishedManifest(publishedManifest({
      dist: { ...(publishedManifest().dist as object), fileCount: MAX_CLI_PACKAGE_ENTRIES + 1 },
    }), VERSION), /Published file count must be between/u);
  });

  test('rejects registry digest drift, malformed gzip, and a non-identical published tar payload', async () => {
    const changed = Buffer.from('different published bytes');
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, { fetcher: fixtureFetcher(publishedManifest(), changed) })),
      /registry integrity metadata/u,
    );
    const malformedManifest = publishedManifest({}, changed);
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, { fetcher: fixtureFetcher(malformedManifest, changed) })),
      /not a bounded gzip archive/u,
    );

    const changedTarArchive = gzipSync(Buffer.from('different published tar payload'));
    const changedManifest = publishedManifest({}, changedTarArchive);
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, { fetcher: fixtureFetcher(changedManifest, changedTarArchive) })),
      /tar payload is not byte-identical/u,
    );
  });

  test('cancels an oversized streamed registry response at the byte bound', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 9; index++) controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, {
        fetcher: async () => new Response(stream, { status: 200 }),
      })),
      /exceeds the byte limit/u,
    );
    assert.equal(cancelled, true);
  });

  test('bounds stalled registry headers and streamed bodies with one abort deadline per response', async () => {
    assert.equal(PUBLISHED_CLI_REQUEST_TIMEOUT_MS, 120_000);
    const observed: { signal: AbortSignal | null } = { signal: null };
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, {
        requestTimeoutMs: 20,
        fetcher: async (_input, init) => {
          observed.signal = init?.signal || null;
          return await new Promise<Response>(() => {});
        },
      })),
      /Published package metadata exceeded the 20 ms request deadline/u,
    );
    assert.equal(observed.signal?.aborted, true);

    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { bodyCancelled = true; },
    });
    await assert.rejects(
      () => withCandidate(({ report, archive }) => checkPublishedCli(VERSION, report, archive, {
        requestTimeoutMs: 20,
        fetcher: async (input) => String(input).includes('/-/whoisleuth-cli-')
          ? new Response(body, { status: 200 })
          : new Response(JSON.stringify(publishedManifest()), { status: 200 }),
      })),
      /Published package archive exceeded the 20 ms request deadline/u,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(bodyCancelled, true);
  });

  test('keeps candidate arguments explicit and reports bounded failures', async () => {
    const args = [VERSION, '--candidate-report', '/tmp/report.json', '--candidate-archive', `/tmp/whoisleuth-cli-${VERSION}.tgz`];
    assert.deepEqual(parseArguments(args), {
      version: VERSION, candidateReport: '/tmp/report.json', candidateArchive: `/tmp/whoisleuth-cli-${VERSION}.tgz`, json: false,
    });
    assert.equal(parseArguments([...args, '--json']).json, true);
    assert.throws(() => parseArguments([VERSION]), /Usage/u);

    const stdout = capture();
    const stderr = capture();
    const code = await main([VERSION], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, 2);
    assert.equal(stdout.value(), '');
    assert.ok(stderr.value().trimEnd().length <= 512);
  });
});
