import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  CODEQL_LANGUAGE,
  CODEQL_QUERY_SUITE,
  CODEQL_STALE_DIRECTORY_AGE_MS,
  CODEQL_THREADS,
  KNOWN_CODEQL_FINDINGS,
  MAX_CODEQL_RAM_MB,
  MAX_CODEQL_FINDINGS,
  MAX_CODEQL_SARIF_BYTES,
  classifyCodeqlFindings,
  formatLocalCodeqlReport,
  boundedDiagnostic,
  codeqlRamMegabytes,
  findCodeqlCommand,
  initializeCodeqlTemporaryReservation,
  parseArguments,
  parseCodeqlSarif,
  parseCodeqlVersion,
  resolveCodeqlCommand,
  removeStaleCodeqlTemporaryDirectories,
  removeOwnedCodeqlTemporaryReservation,
  runLocalCodeql,
  runProcessBounded,
} from '../tools/local-codeql.mts';
import type { KnownCodeqlFinding, LocalCodeqlOptions } from '../tools/local-codeql.mts';

type SarifFixtureFinding = ReturnType<typeof finding>;
type RunProcess = NonNullable<LocalCodeqlOptions['runProcess']>;
type ProcessCall = Readonly<{
  command: string;
  args: readonly string[];
  options: Parameters<RunProcess>[2];
}>;

function sarif(results: readonly SarifFixtureFinding[] = []) {
  return JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'CodeQL' } }, results }],
  });
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: 'js/example-rule',
    level: 'warning',
    message: { text: 'Review this path.' },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'lib/example.mts' },
        region: { startLine: 42 },
      },
    }],
    partialFingerprints: {
      primaryLocationLineHash: 'fixture-line-hash:1',
      primaryLocationStartColumnFingerprint: '4',
    },
    ...overrides,
  };
}

describe('local CodeQL input handling', () => {
  test('uses PATH by default and accepts one bounded absolute executable path', () => {
    assert.equal(resolveCodeqlCommand(undefined), 'codeql');
    assert.equal(resolveCodeqlCommand('/opt/codeql/codeql'), '/opt/codeql/codeql');
  });

  test('discovers the conventional user-local installation without changing PATH', async () => {
    const command = await findCodeqlCommand(undefined);
    assert.ok(command === 'codeql' || path.isAbsolute(command));
    assert.equal(await findCodeqlCommand('/opt/codeql/codeql'), '/opt/codeql/codeql');
  });

  test('rejects relative, controlled, and oversized executable paths', () => {
    for (const value of ['codeql', '../codeql', '/opt/codeql\n/codeql', `/${'x'.repeat(5000)}`]) {
      assert.throws(() => resolveCodeqlCommand(value), /absolute path/);
    }
  });

  test('accepts no CLI arguments and rejects every target or option', () => {
    assert.equal(parseArguments([]), undefined);
    assert.throws(() => parseArguments(['.']), /Usage/);
    assert.throws(() => parseArguments(['--upload']), /Usage/);
  });

  test('extracts a bounded CLI version with a safe fallback', () => {
    assert.equal(parseCodeqlVersion('{"version":"2.23.4"}'), '2.23.4');
    assert.equal(parseCodeqlVersion('CodeQL command-line toolchain release 2.23.4\n'), 'CodeQL command-line toolchain release 2.23.4');
    assert.equal(parseCodeqlVersion('{bad json'), '{bad json');
  });

  test('uses at most half of system memory and preserves both ends of diagnostics', () => {
    assert.equal(codeqlRamMegabytes(8 * 1024 * 1024 * 1024), MAX_CODEQL_RAM_MB);
    assert.equal(codeqlRamMegabytes(2 * 1024 * 1024 * 1024), 1024);
    const diagnostic = boundedDiagnostic(`start ${'x'.repeat(2000)} terminal failure`, 100);
    assert.ok(diagnostic.startsWith('start '));
    assert.ok(diagnostic.endsWith('terminal failure'));
    assert.equal(diagnostic.length, 100);
  });
});

describe('local CodeQL SARIF parsing', () => {
  test('returns no findings for a valid empty analysis', () => {
    assert.deepEqual(parseCodeqlSarif(sarif()), { total: 0, findings: [], truncated: false });
  });

  test('normalizes finding severity, message, path, and line', () => {
    const parsed = parseCodeqlSarif(sarif([finding()]));
    assert.deepEqual(parsed, {
      total: 1,
      findings: [{
        ruleId: 'js/example-rule',
        level: 'warning',
        message: 'Review this path.',
        file: 'lib/example.mts',
        line: 42,
        primaryLocationLineHash: 'fixture-line-hash:1',
        primaryLocationStartColumnFingerprint: '4',
      }],
      truncated: false,
    });
  });

  test('bounds and sanitizes untrusted SARIF display strings', () => {
    const parsed = parseCodeqlSarif(sarif([finding({
      ruleId: 'bad\nrule\u00ad',
      level: 'unexpected',
      message: { text: `review\n\u0085\u034f${'x'.repeat(1000)}` },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: 'lib/file.mts?secret=value#fragment' },
          region: { startLine: -1 },
        },
      }],
    })]));
    assert.equal(requiredValue(parsed.findings[0]).ruleId, 'bad rule');
    assert.equal(requiredValue(parsed.findings[0]).level, 'warning');
    assert.ok(requiredValue(parsed.findings[0]).message.length <= 500);
    assert.equal(requiredValue(parsed.findings[0]).file, 'lib/file.mts');
    assert.equal(requiredValue(parsed.findings[0]).line, null);
    assert.doesNotMatch(JSON.stringify(parsed), /[\u0085\u00ad\u034f]/u);
  });

  test('caps parsed findings while retaining the total count', () => {
    const parsed = parseCodeqlSarif(sarif(Array.from({ length: MAX_CODEQL_FINDINGS + 7 }, () => finding())));
    assert.equal(parsed.total, MAX_CODEQL_FINDINGS + 7);
    assert.equal(parsed.findings.length, MAX_CODEQL_FINDINGS);
    assert.equal(parsed.truncated, true);
  });

  test('matches reviewed findings by exact SARIF fingerprint and detects baseline drift', () => {
    const parsed = parseCodeqlSarif(sarif([finding()]));
    const baseline: KnownCodeqlFinding[] = [{
      ruleId: 'js/example-rule',
      file: 'lib/example.mts',
      primaryLocationLineHash: 'fixture-line-hash:1',
      primaryLocationStartColumnFingerprint: '4',
      reason: 'false_positive',
    }];
    assert.deepEqual(classifyCodeqlFindings(parsed, baseline), {
      total: 1,
      known: 1,
      new: 0,
      displayed: [],
      staleBaseline: [],
      truncated: false,
    });
    const changed = classifyCodeqlFindings(parseCodeqlSarif(sarif()), baseline);
    assert.equal(changed.known, 0);
    assert.equal(changed.new, 0);
    assert.deepEqual(changed.staleBaseline, baseline);
  });

  test('pins the exact CT array-membership false positive and reopens review on drift', () => {
    const reviewed = {
      ruleId: 'js/incomplete-url-substring-sanitization',
      file: 'test/ct-search.test.mts',
      primaryLocationLineHash: '396838f0aee3b68c:1',
      primaryLocationStartColumnFingerprint: '13',
      reason: 'false_positive',
    } satisfies KnownCodeqlFinding;
    assert.deepEqual(
      KNOWN_CODEQL_FINDINGS.filter((entry) => entry.ruleId === reviewed.ruleId),
      [reviewed],
    );
    const parsed = parseCodeqlSarif(sarif([finding({
      ruleId: reviewed.ruleId,
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: reviewed.file },
          region: { startLine: 153 },
        },
      }],
      partialFingerprints: {
        primaryLocationLineHash: reviewed.primaryLocationLineHash,
        primaryLocationStartColumnFingerprint: reviewed.primaryLocationStartColumnFingerprint,
      },
    })]));
    const accepted = classifyCodeqlFindings(parsed, [reviewed]);
    assert.equal(accepted.known, 1);
    assert.equal(accepted.new, 0);
    assert.deepEqual(accepted.staleBaseline, []);

    const drifted = classifyCodeqlFindings(parsed, [{
      ...reviewed,
      primaryLocationLineHash: 'changed-line-hash:1',
    }]);
    assert.equal(drifted.known, 0);
    assert.equal(drifted.new, 1);
    assert.equal(drifted.staleBaseline.length, 1);
  });

  test('pins the complete reviewed baseline and requires every exact identity once', () => {
    const expected: KnownCodeqlFinding[] = [
      { ruleId: 'js/disabling-certificate-validation', file: 'lib/tls-intelligence.mts', primaryLocationLineHash: '11f7ddb4d3c0cb28:1', primaryLocationStartColumnFingerprint: '0', reason: 'accepted_behavior' },
      { ruleId: 'js/disabling-certificate-validation', file: 'lib/smtp-transport-review.mts', primaryLocationLineHash: '5cfcbf6f51b434cf:1', primaryLocationStartColumnFingerprint: '0', reason: 'accepted_behavior' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'c95b56b6acb3e65b:1', primaryLocationStartColumnFingerprint: '23', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'e98683a11c64bf47:1', primaryLocationStartColumnFingerprint: '26', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'e5df0635a7fe0562:1', primaryLocationStartColumnFingerprint: '53', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'f9955890d8802dc7:1', primaryLocationStartColumnFingerprint: '51', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'd958752a942a1329:1', primaryLocationStartColumnFingerprint: '69', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'bee55061202d551f:1', primaryLocationStartColumnFingerprint: '52', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: '3580829fea761be5:1', primaryLocationStartColumnFingerprint: '59', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'b269a7c62be7cb18:1', primaryLocationStartColumnFingerprint: '56', reason: 'false_positive' },
      { ruleId: 'js/missing-rate-limiting', file: 'server.mts', primaryLocationLineHash: 'e8481cbf82455fde:1', primaryLocationStartColumnFingerprint: '61', reason: 'false_positive' },
      { ruleId: 'js/incomplete-url-substring-sanitization', file: 'test/ct-search.test.mts', primaryLocationLineHash: '396838f0aee3b68c:1', primaryLocationStartColumnFingerprint: '13', reason: 'false_positive' },
    ];
    assert.deepEqual(KNOWN_CODEQL_FINDINGS, expected);

    const parsed = parseCodeqlSarif(sarif(expected.map((entry, index) => finding({
      ruleId: entry.ruleId,
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: entry.file },
          region: { startLine: index + 1 },
        },
      }],
      partialFingerprints: {
        primaryLocationLineHash: entry.primaryLocationLineHash,
        primaryLocationStartColumnFingerprint: entry.primaryLocationStartColumnFingerprint,
      },
    }))));
    assert.deepEqual(classifyCodeqlFindings(parsed), {
      total: expected.length,
      known: expected.length,
      new: 0,
      displayed: [],
      staleBaseline: [],
      truncated: false,
    });
  });

  test('does not suppress a new occurrence sharing only its rule and file', () => {
    const parsed = parseCodeqlSarif(sarif([finding()]));
    const classified = classifyCodeqlFindings(parsed, [{
      ruleId: 'js/example-rule',
      file: 'lib/example.mts',
      primaryLocationLineHash: 'different-line:1',
      primaryLocationStartColumnFingerprint: '4',
      reason: 'false_positive',
    } satisfies KnownCodeqlFinding]);
    assert.equal(classified.new, 1);
    assert.equal(classified.displayed.length, 1);
    assert.equal(classified.staleBaseline.length, 1);
  });

  test('rejects malformed, wrong-shaped, and oversized SARIF', () => {
    assert.throws(() => parseCodeqlSarif('{bad json'), /malformed/);
    assert.throws(() => parseCodeqlSarif('[]'), /unexpected/);
    assert.throws(() => parseCodeqlSarif('{}'), /runs array/);
    assert.throws(() => parseCodeqlSarif('x'.repeat(MAX_CODEQL_SARIF_BYTES + 1)), /exceeded/);
  });
});

describe('bounded CodeQL process execution', () => {
  test('rejects process output above the configured stream cap', async () => {
    await assert.rejects(
      runProcessBounded(process.execPath, ['-e', "process.stdout.write('x'.repeat(2048))"], {
        cwd: process.cwd(),
        timeoutMs: 2000,
        maxOutputBytes: 1024,
      }),
      /output exceeded/,
    );
  });

  test('terminates a process that exceeds its deadline', async () => {
    await assert.rejects(
      runProcessBounded(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
        cwd: process.cwd(),
        timeoutMs: 100,
        maxOutputBytes: 1024,
      }),
      /process deadline/,
    );
  });

  test('waits for the terminated child to close before rejecting its deadline', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-close-'));
    const marker = path.join(directory, 'closed.txt');
    try {
      const startedAt = performance.now();
      await assert.rejects(
        runProcessBounded(process.execPath, ['-e', [
          "const { writeFileSync } = require('node:fs');",
          'const marker = process.argv[1];',
          "process.on('SIGTERM', () => setTimeout(() => { writeFileSync(marker, 'closed'); process.exit(0); }, 80));",
          'setInterval(() => {}, 1000);',
        ].join(' ') , marker], {
          cwd: process.cwd(),
          // Leave enough startup margin for this child to install its signal
          // handler even when the full test suite is running in parallel.
          timeoutMs: 500,
          maxOutputBytes: 1024,
        }),
        /process deadline/iu,
      );
      assert.ok(performance.now() - startedAt >= 550);
      assert.equal(await readFile(marker, 'utf8'), 'closed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('local CodeQL orchestration', () => {
  async function runFixture(results: readonly SarifFixtureFinding[]) {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-test-'));
    const calls: ProcessCall[] = [];
    let removed = false;
    const runProcess: RunProcess = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'version') return { exitCode: 0, stdout: '{"version":"2.23.4"}', stderr: '' };
      if (args[0] === 'database' && args[1] === 'analyze') {
        const outputArgument = args.find((arg) => arg.startsWith('--output='));
        assert.ok(outputArgument);
        const output = outputArgument.slice('--output='.length);
        await writeFile(output, sarif(results), 'utf8');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const report = await runLocalCodeql({
      repositoryRoot: process.cwd(),
      codeqlCommand: '/opt/codeql/codeql',
      runProcess,
      makeTemporaryDirectory: async () => temporaryDirectory,
      cleanupStaleTemporaryDirectories: async () => 0,
      removeTemporaryDirectory: async (directory) => {
        removed = true;
        await rm(directory, { recursive: true, force: true });
      },
      knownFindings: [],
    });
    return { calls, removed, report };
  }

  test('runs the fixed language and standard query suite without a build or upload', async () => {
    const { calls, removed, report } = await runFixture([]);
    assert.equal(report.status, 'pass');
    assert.equal(report.language, CODEQL_LANGUAGE);
    assert.equal(report.querySuite, CODEQL_QUERY_SUITE);
    assert.equal(report.codeqlVersion, '2.23.4');
    assert.equal(removed, true);
    assert.deepEqual(calls.map((call) => call.args.slice(0, 2)), [
      ['version', '--format=json'],
      ['database', 'create'],
      ['database', 'analyze'],
    ]);
    const createCall = calls[1];
    const analyzeCall = calls[2];
    assert.ok(createCall);
    assert.ok(analyzeCall);
    assert.ok(createCall.args.includes('--language=javascript-typescript'));
    assert.ok(createCall.args.some((arg) => arg.startsWith('--source-root=')));
    assert.ok(analyzeCall.args.includes('javascript-code-scanning.qls'));
    assert.ok(analyzeCall.args.includes('--format=sarif-latest'));
    assert.ok(analyzeCall.args.includes(`--threads=${CODEQL_THREADS}`));
    assert.ok(analyzeCall.args.some((arg) => arg.startsWith('--ram=')));
    assert.equal(calls.flatMap((call) => call.args).includes('upload-results'), false);
    assert.equal(calls.flatMap((call) => call.args).includes('--command'), false);
  });

  test('returns a finding state and a concise human-readable report', async () => {
    const { report } = await runFixture([finding()]);
    assert.equal(report.status, 'findings');
    const output = formatLocalCodeqlReport(report);
    assert.match(output, /Result: NEW FINDINGS/);
    assert.match(output, /js\/example-rule at lib\/example\.mts:42/);
    assert.match(output, /Review this path/);
    assert.match(output, /Fingerprint: fixture-line-hash:1 \/ 4/);
  });

  test('cleans temporary data after a CodeQL failure and bounds the diagnostic', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-failure-'));
    let removed = false;
    await assert.rejects(
      runLocalCodeql({
        repositoryRoot: process.cwd(),
        codeqlCommand: '/opt/codeql/codeql',
        runProcess: async (_command, args) => args[0] === 'version'
          ? { exitCode: 0, stdout: '{"version":"2.23.4"}', stderr: '' }
          : { exitCode: 3, stdout: '', stderr: `failed\n${'x'.repeat(2000)}` },
        makeTemporaryDirectory: async () => temporaryDirectory,
        cleanupStaleTemporaryDirectories: async () => 0,
        removeTemporaryDirectory: async (directory) => {
          removed = true;
          await rm(directory, { recursive: true, force: true });
        },
      }),
      (error) => error instanceof Error && error.message.length < 1100 && /exit status 3/.test(error.message),
    );
    assert.equal(removed, true);
  });

  test('turns a missing executable into stable installation guidance', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-missing-'));
    await assert.rejects(
      runLocalCodeql({
        repositoryRoot: process.cwd(),
        codeqlCommand: '/missing/codeql',
        runProcess: async () => { throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' }); },
        makeTemporaryDirectory: async () => temporaryDirectory,
        cleanupStaleTemporaryDirectories: async () => 0,
        removeTemporaryDirectory: async (directory) => rm(directory, { recursive: true, force: true }),
      }),
      /official CodeQL bundle/,
    );
  });

  test('publishes and removes only its marker-owned temporary reservation', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-owned-'));
    let reservationDirectory = '';
    try {
      const report = await runLocalCodeql({
        repositoryRoot: process.cwd(),
        temporaryRoot,
        codeqlCommand: '/opt/codeql/codeql',
        cleanupStaleTemporaryDirectories: async () => 0,
        reservationCleanupCurrentUid: null,
        knownFindings: [],
        runProcess: async (_command, args) => {
          if (args[0] === 'version') return { exitCode: 0, stdout: '{"version":"2.23.4"}', stderr: '' };
          if (args[0] === 'database' && args[1] === 'create') {
            reservationDirectory = path.dirname(requiredValue(args[2]));
            await access(path.join(reservationDirectory, '.whoisleuth-reservation.json'));
          }
          if (args[0] === 'database' && args[1] === 'analyze') {
            const output = requiredValue(args.find((arg) => arg.startsWith('--output='))).slice('--output='.length);
            await writeFile(output, sarif(), 'utf8');
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });
      assert.equal(report.status, 'pass');
      assert.ok(reservationDirectory.startsWith(`${temporaryRoot}${path.sep}`));
      await assert.rejects(access(reservationDirectory), (error) => isCode(error, 'ENOENT'));
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

describe('local CodeQL stale reservation cleanup', () => {
  test('removes only aged marker-owned dead reservations and preserves every ambiguous entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-cleanup-'));
    const stale = path.join(root, 'whoisleuth-codeql-Ab12Cd');
    const fresh = path.join(root, 'whoisleuth-codeql-Ef34Gh');
    const active = path.join(root, 'whoisleuth-codeql-Mn78Op');
    const unmarked = path.join(root, 'whoisleuth-codeql-Qr90St');
    const lookalike = path.join(root, 'whoisleuth-codeql-too-long');
    const protectedDirectory = path.join(root, 'protected-directory');
    const linked = path.join(root, 'whoisleuth-codeql-Ij56Kl');
    const now = Date.now();
    const staleDate = new Date(now - CODEQL_STALE_DIRECTORY_AGE_MS - 1);
    try {
      await Promise.all([
        mkdir(stale),
        mkdir(fresh),
        mkdir(active),
        mkdir(unmarked),
        mkdir(lookalike),
        mkdir(protectedDirectory),
      ]);
      await initializeCodeqlTemporaryReservation(stale, { now: staleDate.getTime(), pid: 101, reservationId: 'a'.repeat(32) });
      await initializeCodeqlTemporaryReservation(fresh, { now, pid: 102, reservationId: 'b'.repeat(32) });
      await initializeCodeqlTemporaryReservation(active, { now: staleDate.getTime(), pid: 103, reservationId: 'c'.repeat(32) });
      await symlink(protectedDirectory, linked, 'dir');
      await Promise.all([
        utimes(stale, staleDate, staleDate),
        utimes(active, staleDate, staleDate),
        utimes(unmarked, staleDate, staleDate),
      ]);

      assert.equal(await removeStaleCodeqlTemporaryDirectories(root, {
        now,
        processState: (pid) => pid === 103 ? 'active' : 'dead',
      }), 1);
      await assert.rejects(access(stale), (error) => isCode(error, 'ENOENT'));
      await Promise.all([
        access(fresh),
        access(active),
        access(unmarked),
        access(lookalike),
        access(protectedDirectory),
        access(linked),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('treats a marker removed by another cleaner as an already handled candidate', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-cleanup-race-'));
    const candidate = path.join(root, 'whoisleuth-codeql-Ab12Cd');
    const now = Date.now();
    const staleDate = new Date(now - CODEQL_STALE_DIRECTORY_AGE_MS - 1);
    try {
      await mkdir(candidate);
      await initializeCodeqlTemporaryReservation(candidate, {
        now: staleDate.getTime(),
        pid: 101,
        reservationId: 'a'.repeat(32),
      });
      await utimes(candidate, staleDate, staleDate);
      let removedMarker = false;
      assert.equal(await removeStaleCodeqlTemporaryDirectories(root, {
        now,
        processState: () => 'dead',
        readMarker: async (markerPath) => {
          if (!removedMarker) {
            removedMarker = true;
            await rm(markerPath);
          }
          return readFile(markerPath);
        },
      }), 0);
      await access(candidate);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses recorded ownership without getuid and preserves a replaced reservation path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-owner-'));
    const candidate = path.join(root, 'whoisleuth-codeql-Ab12Cd');
    try {
      await mkdir(candidate);
      const original = await initializeCodeqlTemporaryReservation(candidate, { reservationId: 'a'.repeat(32) });
      await rm(candidate, { recursive: true });
      await mkdir(candidate);
      const replacement = await initializeCodeqlTemporaryReservation(candidate, { reservationId: 'b'.repeat(32) });

      assert.equal(await removeOwnedCodeqlTemporaryReservation(original, root, { currentUid: null }), false);
      await access(candidate);
      assert.equal(await removeOwnedCodeqlTemporaryReservation(replacement, root, { currentUid: null }), true);
      await assert.rejects(access(candidate), (error) => isCode(error, 'ENOENT'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
