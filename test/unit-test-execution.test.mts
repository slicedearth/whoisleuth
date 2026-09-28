import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseProductionCoverage, productionCoverageArguments } from '../tools/production-coverage.mts';
import { parseTestDurationData } from '../tools/test-duration-reporter.mts';
import { resolveUnitTestExecutables, runUnitTests, unitTestExecutablePath } from '../tools/toolchain-compatibility.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

const TOOLCHAIN = fileURLToPath(new URL('../tools/toolchain-compatibility.mts', import.meta.url));
const SHELLS = ['bash', 'zsh', 'fish', 'pwsh'] as const;

function executionFixture(context: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'whoisleuth-unit-execution-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'shells with spaces');
  const log = path.join(root, 'shell-starts.txt');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'test'));
  mkdirSync(path.join(root, 'lib'));
  const environment = environmentWithoutV8Coverage();
  delete environment.NODE_TEST_CONTEXT;
  environment.WHOISLEUTH_TEST_SHELL_LOG = log;
  for (const shell of SHELLS) {
    const filename = path.join(bin, shell);
    writeFileSync(filename, '#!/bin/sh\nprintf "%s\\n" "$0" >> "$WHOISLEUTH_TEST_SHELL_LOG"\nexit 0\n', { mode: 0o755 });
    environment[`WHOISLEUTH_VERIFICATION_${shell.toUpperCase()}`] = filename;
  }
  writeFileSync(path.join(root, 'lib/ordinary.mts'), 'export function ready() { return true; }\n');
  writeFileSync(path.join(root, 'test/probe.test.mts'), [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { ready } from '../lib/ordinary.mts';",
    `import { unitTestExecutablePath } from ${JSON.stringify(new URL('../tools/toolchain-compatibility.mts', import.meta.url).href)};`,
    "test('resolved paths remain usable without repeated probes', () => {",
    '  assert.equal(ready(), true);',
    `  for (const shell of ${JSON.stringify(SHELLS)}) {`,
    '    for (let index = 0; index < 3; index += 1) {',
    '      assert.equal(unitTestExecutablePath(shell), process.env[`WHOISLEUTH_VERIFICATION_${shell.toUpperCase()}`]);',
    '    }',
    '  }',
    '});',
  ].join('\n'));
  return { root, bin, log, environment };
}

function executeFixture(fixture: ReturnType<typeof executionFixture>, nodeArguments: readonly string[]) {
  return spawnSync(process.execPath, [TOOLCHAIN, '--unit-tests', ...nodeArguments], {
    cwd: fixture.root, env: fixture.environment, encoding: 'utf8',
    timeout: 120_000, maxBuffer: 1024 * 1024,
  });
}

for (const mode of ['ordinary', 'profile', 'coverage'] as const) {
  test(`${mode} explicit full-prerequisite execution probes each shell once before workers and retains its report`, (context) => {
    const fixture = executionFixture(context);
    let args = ['--test', '--test-concurrency=4', 'test/probe.test.mts'];
    if (mode === 'profile') {
      mkdirSync(path.join(fixture.root, 'tools'));
      copyFileSync(new URL('../tools/test-duration-reporter.mts', import.meta.url), path.join(fixture.root, 'tools/reporter.mts'));
      args = [
        '--test', '--test-concurrency=4', '--test-reporter=spec', '--test-reporter-destination=stderr',
        '--test-reporter=./tools/reporter.mts', '--test-reporter-destination=stdout', 'test/probe.test.mts',
      ];
    } else if (mode === 'coverage') args = productionCoverageArguments('test/probe.test.mts');

    const child = executeFixture(fixture, args);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(readFileSync(fixture.log, 'utf8').trim().split('\n'), SHELLS.map(shell => path.join(fixture.bin, shell)));
    if (mode === 'profile') {
      const report = parseTestDurationData(child.stdout);
      assert.equal(report.totals.passed, 1);
      assert.equal(report.totals.failed, 0);
      assert.deepEqual(report.files.map(file => file.file), ['test/probe.test.mts']);
      assert.match(child.stderr, /resolved paths remain usable/u);
    } else {
      assert.match(child.stdout, /resolved paths remain usable/u);
      if (mode === 'coverage') {
        const report = parseProductionCoverage(readFileSync(path.join(fixture.root, 'test-coverage.lcov'), 'utf8'));
        assert.deepEqual(report.records.map(record => record.source), ['lib/ordinary.mts']);
        assert.equal(report.global.lines.percentage, 100);
      }
    }
  });
}

test('the unit lane runs without optional shell tooling while integration still rejects a missing prerequisite', (context) => {
  const fixture = executionFixture(context);
  const executed = path.join(fixture.root, 'unit-executed');
  writeFileSync(path.join(fixture.root, 'test/probe.test.mts'), [
    "import { test } from 'node:test';",
    "import { writeFileSync } from 'node:fs';",
    `test('ordinary domain rule', () => writeFileSync(${JSON.stringify(executed)}, 'passed'));`,
  ].join('\n'));
  writeFileSync(path.join(fixture.root, 'test/shell.integration.test.mts'),
    "throw new Error('Integration must not start with missing prerequisites.');");
  fixture.environment.WHOISLEUTH_VERIFICATION_PWSH = path.join(fixture.root, 'missing');
  const unit = executeFixture(fixture, ['--lane=unit', '--test']);
  assert.equal(unit.error, undefined);
  assert.equal(unit.status, 0, unit.stderr || unit.stdout);
  assert.equal(readFileSync(executed, 'utf8'), 'passed');
  assert.equal(existsSync(fixture.log), false, 'The pure lane must not probe a shell.');
  const integration = executeFixture(fixture, ['--lane=integration', '--test']);
  assert.equal(integration.error, undefined);
  assert.equal(integration.status, 2);
  assert.match(integration.stderr, /pwsh: not found/u);
  assert.doesNotMatch(integration.stdout, /Integration must not start/u);
});

test('shell preflight rejects unusable overrides before a test can execute', (context) => {
  const fixture = executionFixture(context);
  const executed = path.join(fixture.root, 'test-executed');
  writeFileSync(path.join(fixture.root, 'test/probe.test.mts'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(executed)}, 'unexpected');`);
  const failing = path.join(fixture.bin, 'pwsh');
  writeFileSync(failing, '#!/bin/sh\necho controlled startup failure >&2\nexit 7\n', { mode: 0o755 });
  const child = executeFixture(fixture, ['--test', 'test/probe.test.mts']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 2);
  assert.match(child.stderr, /pwsh: probe exited 7 \(controlled startup failure\)/u);
  assert.equal(existsSync(executed), false);
  assert.equal(child.stdout, '');
});

test('unit assertion failures remain failures after successful preflight', (context) => {
  const fixture = executionFixture(context);
  writeFileSync(path.join(fixture.root, 'test/probe.test.mts'), [
    "import { test } from 'node:test';",
    "test('controlled assertion failure', () => { throw new Error('expected negative control'); });",
  ].join('\n'));
  const child = executeFixture(fixture, ['--test', 'test/probe.test.mts']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /expected negative control/u);
  assert.equal(readFileSync(fixture.log, 'utf8').trim().split('\n').length, 4);
});

test('path reuse never probes again and never substitutes a broken explicit override', (context) => {
  const fixture = executionFixture(context);
  const resolved = resolveUnitTestExecutables(undefined, { cwd: fixture.root, environment: fixture.environment });
  const starts = readFileSync(fixture.log, 'utf8');
  for (const shell of SHELLS) assert.equal(unitTestExecutablePath(shell, fixture.environment), resolved.get(shell));
  assert.equal(readFileSync(fixture.log, 'utf8'), starts);
  const invalid = { ...fixture.environment, PATH: fixture.bin, WHOISLEUTH_VERIFICATION_PWSH: path.join(fixture.root, 'missing') };
  assert.throws(() => unitTestExecutablePath('pwsh', invalid), /pwsh: not found/u);
  const inert = path.join(fixture.root, 'not-executable');
  writeFileSync(inert, 'not executable', { mode: 0o600 });
  assert.throws(() => unitTestExecutablePath('pwsh', { ...invalid, WHOISLEUTH_VERIFICATION_PWSH: inert }), /pwsh: not found/u);
});

test('startup timeout is a bounded hang guard with a distinct failure, not a missing-shell report', () => {
  const timeout = Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' });
  assert.throws(() => resolveUnitTestExecutables(['pwsh'], {
    environment: { PATH: '/fixture' }, canExecute: () => true,
    probe: (_executable, args, options) => {
      assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']);
      assert.ok(Number.isSafeInteger(options.timeout) && options.timeout >= 60_000 && options.timeout <= 120_000);
      assert.equal(options.killSignal, 'SIGKILL');
      assert.equal(options.input, '');
      return { error: timeout, signal: 'SIGKILL', status: null, stderr: '' };
    },
  }), /pwsh: startup probe exceeded its \d+ ms hang guard and was terminated/u);
  assert.throws(() => runUnitTests([]), /requires Node test-runner arguments/u);
  assert.throws(() => runUnitTests(['--eval', 'throw new Error()']), /requires Node test-runner arguments/u);
});
