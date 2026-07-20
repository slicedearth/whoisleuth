import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  CODEQL_LANGUAGE,
  CODEQL_QUERY_SUITE,
  CODEQL_THREADS,
  MAX_CODEQL_RAM_MB,
  MAX_CODEQL_FINDINGS,
  MAX_CODEQL_SARIF_BYTES,
  classifyCodeqlFindings,
  formatLocalCodeqlReport,
  boundedDiagnostic,
  codeqlRamMegabytes,
  findCodeqlCommand,
  parseArguments,
  parseCodeqlSarif,
  parseCodeqlVersion,
  resolveCodeqlCommand,
  runLocalCodeql,
  runProcessBounded,
} from '../tools/local-codeql.mts';

function sarif(results = []) {
  return JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'CodeQL' } }, results }],
  });
}

function finding(overrides = {}) {
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
      ruleId: 'bad\nrule',
      level: 'unexpected',
      message: { text: `review\n${'x'.repeat(1000)}` },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: 'lib/file.mts?secret=value#fragment' },
          region: { startLine: -1 },
        },
      }],
    })]));
    assert.equal(parsed.findings[0].ruleId, 'bad rule');
    assert.equal(parsed.findings[0].level, 'warning');
    assert.ok(parsed.findings[0].message.length <= 500);
    assert.equal(parsed.findings[0].file, 'lib/file.mts');
    assert.equal(parsed.findings[0].line, null);
  });

  test('caps parsed findings while retaining the total count', () => {
    const parsed = parseCodeqlSarif(sarif(Array.from({ length: MAX_CODEQL_FINDINGS + 7 }, () => finding())));
    assert.equal(parsed.total, MAX_CODEQL_FINDINGS + 7);
    assert.equal(parsed.findings.length, MAX_CODEQL_FINDINGS);
    assert.equal(parsed.truncated, true);
  });

  test('matches reviewed findings by exact SARIF fingerprint and detects baseline drift', () => {
    const parsed = parseCodeqlSarif(sarif([finding()]));
    const baseline = [{
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

  test('does not suppress a new occurrence sharing only its rule and file', () => {
    const parsed = parseCodeqlSarif(sarif([finding()]));
    const classified = classifyCodeqlFindings(parsed, [{
      ruleId: 'js/example-rule',
      file: 'lib/example.mts',
      primaryLocationLineHash: 'different-line:1',
      primaryLocationStartColumnFingerprint: '4',
      reason: 'false_positive',
    }]);
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
});

describe('local CodeQL orchestration', () => {
  async function runFixture(results) {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-codeql-test-'));
    const calls = [];
    let removed = false;
    const runProcess = async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'version') return { exitCode: 0, stdout: '{"version":"2.23.4"}', stderr: '' };
      if (args[0] === 'database' && args[1] === 'analyze') {
        const output = args.find((arg) => arg.startsWith('--output=')).slice('--output='.length);
        await writeFile(output, sarif(results), 'utf8');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const report = await runLocalCodeql({
      repositoryRoot: process.cwd(),
      codeqlCommand: '/opt/codeql/codeql',
      runProcess,
      makeTemporaryDirectory: async () => temporaryDirectory,
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
    assert.ok(calls[1].args.includes('--language=javascript-typescript'));
    assert.ok(calls[1].args.some((arg) => arg.startsWith('--source-root=')));
    assert.ok(calls[2].args.includes('javascript-code-scanning.qls'));
    assert.ok(calls[2].args.includes('--format=sarif-latest'));
    assert.ok(calls[2].args.includes(`--threads=${CODEQL_THREADS}`));
    assert.ok(calls[2].args.some((arg) => arg.startsWith('--ram=')));
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
        removeTemporaryDirectory: async (directory) => rm(directory, { recursive: true, force: true }),
      }),
      /official CodeQL bundle/,
    );
  });
});
