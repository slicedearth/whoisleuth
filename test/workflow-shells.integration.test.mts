import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { test } from 'node:test';
import { parse } from 'yaml';
import { unitTestExecutablePath } from '../tools/toolchain-compatibility.mts';

type CiGateWorkflow = {
  jobs: {
    verify: {
      needs: string[];
      steps: Array<{ env?: Record<string, string>; run?: string }>;
    };
  };
};
const WORKFLOW = readFileSync(
  new URL('../.github/workflows/registry-drift.yml', import.meta.url),
  'utf8',
);

// Only the declared offline commands can execute. No fallback to installed npm or networking.
const HEALTH_NPM_DOUBLE = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
const operation = args.shift();
assert.ok(operation === 'ci' || operation === 'run');
if (operation === 'run' && args[0] === '--silent') args.shift();
const command = operation === 'ci' ? 'ci' : args.shift();
assert.ok(['ci', 'toolchain:check', 'test:properties', 'test:mutation', 'verification:timing:check', 'sources:health', 'test:profile', 'test:duration-health', 'verification:timing:update-candidate'].includes(command));
const log = process.env.TEST_CALL_LOG;
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const call = { command, args };
fs.appendFileSync(log, JSON.stringify(call) + '\n');
const index = calls.length;
if (String(index) === process.env.TEST_FAIL_CALL) process.exit(23);
if (command === 'ci') {
  assert.deepEqual([...args].sort(), ['--audit=false', '--ignore-scripts', '--include=optional']);
} else if (['toolchain:check', 'test:properties', 'test:mutation', 'verification:timing:check'].includes(command)) {
  assert.deepEqual(args, []);
  if (command === 'test:properties') {
    assert.equal(process.env.WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER, '10');
    assert.equal(process.env.WHOISLEUTH_FAST_CHECK_SEED, '42');
  }
} else if (command === 'sources:health') {
  assert.ok(args.length === 0 || JSON.stringify(args) === JSON.stringify(['--', '--github-annotations']));
  console.log(args.length ? 'fixture-annotations' : 'fixture-source-health');
} else if (command === 'test:profile') {
  assert.deepEqual(args, []);
  console.log(JSON.stringify({ kind: 'complete-unit-run', sample: calls.filter(call => call.command === command).length + 1 }));
} else {
  assert.equal(args.shift(), '--');
  const options = Object.groupBy(args, arg => arg.slice(2).split('=')[0]);
  const reports = options.report.map(arg => arg.slice('--report='.length));
  assert.equal(new Set(reports).size, 3);
  const samples = reports.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(samples, [1, 2, 3].map(sample => ({ kind: 'complete-unit-run', sample })));
  if (command === 'test:duration-health') {
    assert.deepEqual(Object.keys(options), ['report']);
    console.log('fixture-duration-health');
  } else {
    assert.deepEqual(Object.keys(options).sort(), ['environment', 'lane', 'provenance-id', 'report', 'sample-basis']);
    const value = key => { assert.equal(options[key].length, 1); return options[key][0].slice(key.length + 3); };
    console.log(JSON.stringify({ lane: value('lane'), provenance: value('provenance-id'),
      environment: value('environment'), sampleBasis: value('sample-basis'), reports, samples }));
  }
}
`;

type HealthStep = { run?: string; uses?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> };
const healthWorkflow = parse(readFileSync(new URL('../.github/workflows/test-health.yml', import.meta.url), 'utf8'));
const healthJobs = healthWorkflow.jobs as Record<string, {
  steps: HealthStep[];
  strategy?: { matrix?: { browser?: string[] } };
}>;
const healthSteps = requiredValue(healthJobs.profile).steps;

const expectedHealthCommands = ['ci', 'toolchain:check', 'test:properties', 'test:mutation', 'verification:timing:check',
  'sources:health', 'sources:health', 'test:profile', 'test:profile', 'test:profile',
  'test:duration-health', 'verification:timing:update-candidate'];

for (const failure of [null, ...expectedHealthCommands.map((_, index) => index)]) {
  test(`scheduled health executes distinct samples and propagates ${failure === null ? 'success' : `command failure ${failure + 1}`}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'test-health-shell-'));
    const summary = path.join(directory, 'summary.md');
    const log = path.join(directory, 'calls.jsonl');
    const double = path.join(directory, 'npm-double.cjs');
    const selected = healthSteps.filter(step => step.run !== undefined);
    assert.ok(selected.length > 0);
    try {
      await writeFile(double, HEALTH_NPM_DOUBLE);
      let status: number | null = 0;
      for (const step of selected) {
        assert.equal(step.if, undefined, 'Required health collection must not be conditionally skipped.');
        const result = spawnSync(unitTestExecutablePath('bash'), ['-e', '-c',
          'npm() { "$TEST_NODE" "$TEST_NPM_DOUBLE" "$@"; }\nsudo() { :; }\n' + requiredValue(step.run)], {
          cwd: directory, encoding: 'utf8', timeout: 10_000,
          env: { ...process.env, ...step.env, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary,
            WHOISLEUTH_FAST_CHECK_SEED: step.env?.WHOISLEUTH_FAST_CHECK_SEED === '${{ github.run_number }}' ? '42' : '',
            PROFILE_PROVENANCE: 'unit-ci-fixture-1', TEST_NODE: process.execPath, TEST_NPM_DOUBLE: double,
            TEST_CALL_LOG: log, TEST_FAIL_CALL: failure === null ? '' : String(failure) },
        });
        assert.equal(result.error, undefined, 'The shell must execute, not time out or fail to launch.');
        assert.equal(result.signal, null, 'A signal is not a command rejection.');
        status = result.status;
        if (status !== 0) break;
      }
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { command: string; args: string[] });
      assert.deepEqual(calls.map(call => call.command), failure === null ? expectedHealthCommands : expectedHealthCommands.slice(0, failure + 1));
      if (failure !== null) {
        assert.notEqual(status, 0, 'No failing producer may be hidden by a pipeline or a later command.');
        return;
      }
      assert.equal(status, 0);
      assert.deepEqual(calls.filter(call => call.command === 'sources:health')[1]?.args, ['--', '--github-annotations']);
      const displayed = await readFile(summary, 'utf8');
      assert.match(displayed, /fixture-source-health/u);
      assert.match(displayed, /fixture-duration-health/u);
      const files = globSync(path.join(directory, '*'));
      const contents = await Promise.all(files.filter(file => ![double, log, summary].includes(file)).map(async file => ({ file, text: await readFile(file, 'utf8') })));
      const candidateFile = requiredValue(contents.find(item => item.text.startsWith('{"lane":')));
      const candidate = JSON.parse(candidateFile.text);
      assert.equal(candidate.lane, 'unit');
      assert.equal(candidate.provenance, 'unit-ci-fixture-1');
      assert.equal(candidate.environment, 'linux-x64-node24-ci');
      assert.equal(candidate.sampleBasis, 'median-of-three-complete-unit-runs');
      assert.deepEqual(candidate.samples, [1, 2, 3].map(sample => ({ kind: 'complete-unit-run', sample })));
      const uploads = healthSteps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
      const uploaded = new Set(uploads.flatMap(step => String(step.with?.path).trim().split(/\r?\n/u)
        .flatMap(pattern => globSync(pattern.trim().replace('${{ runner.temp }}', directory)))));
      const duration = requiredValue(contents.find(item => item.text.includes('fixture-duration-health')));
      for (const file of [...candidate.reports, candidateFile.file, duration.file]) assert.ok(uploaded.has(file), `Missing evidence upload: ${path.basename(file)}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

// Resolve shell quoting and flag ordering without invoking a package manager,
// browser or installer. Only argument vectors and the two public test knobs leave the shell.
function capturedCommands(source: string, failure = false, environment: Record<string, string> = {}) {
  const capture = 'process.stdout.write(JSON.stringify({argv:process.argv.slice(1),multiplier:process.env.WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER,seed:process.env.WHOISLEUTH_FAST_CHECK_SEED})+"\\n");if(process.env.TEST_COMMAND_FAIL==="1")process.exit(23)';
  const declarations = ['npm', 'node', 'playwright'].map(command =>
    `${command}() { "$TEST_NODE" -e '${capture}' ${command} "$@"; }`).join('\n');
  const result = spawnSync(unitTestExecutablePath('bash'), ['-e', '-c', `${declarations}\n${source}`], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, TEST_NODE: process.execPath, TEST_COMMAND_FAIL: failure ? '1' : '0',
      WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '', WHOISLEUTH_FAST_CHECK_SEED: '', ...environment },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, calls: result.stdout.trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { argv: string[]; multiplier: string; seed: string }) };
}

for (const browser of requiredValue(healthJobs['cross-browser']?.strategy?.matrix?.browser)) {
  test(`scheduled ${browser} job executes its own preparation and preserves failure evidence`, () => {
    const steps = requiredValue(healthJobs['cross-browser']).steps;
    const environment = { WHOISLEUTH_CROSS_BROWSER_PROJECT: browser };
    const calls = steps.filter(step => step.run).flatMap(step => {
      const result = capturedCommands(requiredValue(step.run), false, environment);
      assert.equal(result.status, 0);
      return result.calls.map(call => ({ ...call, step }));
    });
    assert.deepEqual(calls.map(call => call.argv), [
      ['npm', 'ci', '--include=optional', '--ignore-scripts', '--audit=false'],
      ['npm', 'run', 'verification:ci', '--', '--group=browser-build'],
      ['npm', 'run', 'test:e2e:critical:install'],
      ['npm', 'run', 'test:e2e:cross-browser', '--', `--project=${browser}`],
      ['npm', 'run', 'test:e2e:summary'],
      ['npm', 'run', 'verification:artifacts', '--', '--cleanup=browser'],
    ]);
    for (const call of calls.slice(0, 4)) {
      assert.equal(call.step.if, undefined);
      assert.equal(capturedCommands(requiredValue(call.step.run), true, environment).status, 23);
    }
    for (const call of calls.slice(4)) assert.equal(call.step.if, 'always()');
    const upload = requiredValue(steps.find(step => step.uses?.startsWith('actions/upload-artifact@')));
    assert.equal(upload.if, 'always()');
    assert.deepEqual(String(upload.with?.path).trim().split(/\s+/u), [
      'playwright-results.json', 'playwright-report/', 'test-results/',
    ]);
    assert.ok(steps.indexOf(upload) < steps.indexOf(calls.at(-1)!.step), 'Evidence must be retained before cleanup');
  });
}

test('scheduled browser execution preserves its invocation and failure contract, not shell spelling', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/e2e-stress.yml', import.meta.url), 'utf8'));
  const allSteps = (Object.values(workflow.jobs) as { steps: HealthStep[] }[]).flatMap(job => job.steps);
  const steps = allSteps.filter(step => step.run);
  const calls = steps.flatMap(step => {
    const result = capturedCommands(requiredValue(step.run));
    assert.equal(result.status, 0);
    assert.ok(result.calls.length > 0);
    return result.calls.map(call => ({ ...call, step }));
  });
  const install = requiredValue(calls.find(call => call.argv[0] === 'npm' && call.argv[1] === 'ci'));
  assert.deepEqual(install.argv.slice(2).sort(), ['--audit=false', '--ignore-scripts', '--include=optional']);
  const scripts = calls.filter(call => call.argv[0] === 'npm' && call.argv[1] === 'run');
  assert.deepEqual(scripts.map(call => call.argv[2]).sort(), ['build', 'test:e2e:install', 'test:e2e:stress', 'test:e2e:summary']);
  const stressIndex = scripts.findIndex(call => call.argv[2] === 'test:e2e:stress');
  for (const preparation of ['build', 'test:e2e:install']) {
    assert.ok(scripts.findIndex(call => call.argv[2] === preparation) < stressIndex);
  }
  for (const call of scripts.filter(call => call.argv[2] !== 'test:e2e:summary')) {
    assert.equal(call.step.if, undefined);
    assert.equal(capturedCommands(requiredValue(call.step.run), true).status, 23);
  }
  assert.equal(scripts.find(call => call.argv[2] === 'test:e2e:summary')?.step.if, 'always()');
  const uploads = allSteps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  const results = requiredValue(uploads.find(step => step.with?.path === 'playwright-results.json'));
  assert.equal(results.if, 'always()');
  const diagnostics = requiredValue(uploads.find(step => String(step.with?.path).includes('test-results/')));
  assert.equal(diagnostics.if, 'failure()');
  assert.ok(String(diagnostics.with?.path).split(/\s+/u).includes('playwright-report/'));
});

test('stress and property scripts keep independent repetition, retry and seed expectations', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  const run = (name: string) => {
    const result = capturedCommands(requiredValue(scripts[name]));
    assert.equal(result.status, 0);
    assert.equal(result.calls.length, 1);
    return result.calls[0]!;
  };
  const browser = run('test:e2e:stress');
  assert.equal(browser.argv[0], 'playwright');
  const parsed = parseArgs({ args: browser.argv.slice(1), allowPositionals: true, strict: false,
    options: { grep: { type: 'string' }, workers: { type: 'string' }, retries: { type: 'string' }, 'repeat-each': { type: 'string' } } });
  assert.deepEqual(parsed.positionals, ['test']);
  assert.equal(parsed.values.grep, '@timing-sensitive');
  assert.equal(parsed.values.workers, '1');
  assert.equal(parsed.values.retries, '0');
  assert.equal(parsed.values['repeat-each'], '10');
  const crossBrowser = run('test:e2e:cross-browser');
  assert.equal(crossBrowser.argv[0], 'playwright');
  const crossBrowserArgs = parseArgs({ args: crossBrowser.argv.slice(1), allowPositionals: true,
    options: { config: { type: 'string' }, workers: { type: 'string' }, retries: { type: 'string' } } });
  assert.deepEqual(crossBrowserArgs.positionals, ['test']);
  assert.deepEqual(crossBrowserArgs.values, Object.assign(Object.create(null), {
    config: 'e2e/cross-browser.config.ts', workers: '1', retries: '0',
  }));
  const properties = run('test:properties');
  assert.deepEqual(properties.argv.slice(0, 2), ['node', '--test']);
  assert.ok(properties.argv.includes('test/verification-state-machines.test.mts'));
  const expanded = run('test:properties:stress');
  assert.deepEqual(expanded.argv, ['npm', 'run', 'test:properties']);
  assert.equal(expanded.multiplier, '10');
  assert.equal(expanded.seed, '334462');
  assert.deepEqual(run('test:duration-health').argv, ['node', 'tools/test-duration-health.mts']);
  assert.deepEqual(capturedCommands("playwright 'test' --repeat-each 10 --retries=0 --workers '1' --grep '@timing-sensitive'").calls[0]?.argv,
    ['playwright', 'test', '--repeat-each', '10', '--retries=0', '--workers', '1', '--grep', '@timing-sensitive']);
});

test('executes the final gate against every result, including newly added lanes', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ) as CiGateWorkflow;
  const verify = workflow.jobs.verify;
  const gate = requiredValue(verify.steps.find((step) => step.env?.NEEDS_RESULTS));
  assert.equal(gate.env?.NEEDS_RESULTS, '${{ toJSON(needs) }}');
  const successes = Object.fromEntries(
    requiredValue(verify.needs).map((name) => [name, { result: 'success' }]),
  );
  const execute = (results: unknown) =>
    spawnSync(
      unitTestExecutablePath('bash'),
      ['-e', '-o', 'pipefail', '-c', requiredValue(gate.run)],
      {
        env: { ...process.env, NEEDS_RESULTS: JSON.stringify(results) },
        encoding: 'utf8',
        timeout: 5000,
      },
    ).status;
  assert.equal(execute(successes), 0);
  assert.notEqual(execute({}), 0);
  for (const name of [...Object.keys(successes), 'future-verification']) {
    for (const result of ['failure', 'cancelled', 'skipped', null]) {
      assert.notEqual(execute({ ...successes, [name]: { result } }), 0, `${name}: ${result}`);
    }
  }
});

test('explains source drift in the job summary while retaining the failing result', async () => {
  const workflow = parse(WORKFLOW);
  const review = workflow.jobs.audit.steps.find(
    (step: { env?: Record<string, string> }) => step.env?.REGISTRAR_EXIT_CODE,
  );
  assert.ok(review);
  const directory = await mkdtemp(path.join(tmpdir(), 'registry-review-summary-'));
  const summary = path.join(directory, 'summary.md');
  try {
    await Promise.all([
      writeFile(path.join(directory, 'registry-drift-report.json'), JSON.stringify({ checks: [] })),
      writeFile(
        path.join(directory, 'registry-fixture-freshness-report.json'),
        JSON.stringify({ files: [] }),
      ),
      writeFile(
        path.join(directory, 'source-drift-report.json'),
        JSON.stringify({
          checks: [
            {
              id: 'unicode',
              label: 'Unicode confusables',
              status: 'drift',
              detail: 'New source version requires calibration.',
            },
            {
              id: 'unavailable',
              label: '<source>|`',
              status: 'inconclusive',
              observedItems: null,
              detail: 'Source unavailable.',
            },
          ],
        }),
      ),
      writeFile(
        path.join(directory, 'registrar-standing-report.json'),
        JSON.stringify({
          checks: [
            {
              id: 'iana_registrar_ids',
              status: 'drift',
              expectedItems: 10,
              observedItems: 11,
              expectedDigest: 'a'.repeat(64),
              observedDigest: 'b'.repeat(64),
            },
            { id: 'catalogue_freshness', status: 'current', expectedItems: 2, observedItems: 2 },
          ],
        }),
      ),
    ]);
    const result = spawnSync(
      unitTestExecutablePath('bash'),
      ['-e', '-o', 'pipefail', '-c', review.run],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summary,
          REGISTRY_EXIT_CODE: '0',
          FIXTURE_EXIT_CODE: '0',
          REGISTRAR_EXIT_CODE: '1',
          SOURCE_EXIT_CODE: '2',
        },
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    const rendered = await readFile(summary, 'utf8');
    assert.match(rendered, /Registrar standing \| 1/u);
    assert.match(rendered, /iana_registrar_ids: drift; records 10 → 11/u);
    assert.match(rendered, /Normalised digest a{64} → b{64}/u);
    assert.doesNotMatch(rendered, /catalogue_freshness/u);
    assert.match(rendered, /Retained source catalogues \| 2/u);
    assert.match(rendered, /Unicode confusables: drift.*requires calibration/u);
    assert.doesNotMatch(rendered, /<source>|`/u);
    assert.match(result.stdout, /::error title=Registry maintenance requires review::/u);

    await writeFile(path.join(directory, 'registrar-standing-report.json'), '{invalid');
    const unavailable = spawnSync(
      unitTestExecutablePath('bash'),
      ['-e', '-o', 'pipefail', '-c', review.run],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summary,
          REGISTRY_EXIT_CODE: '0',
          FIXTURE_EXIT_CODE: '0',
          REGISTRAR_EXIT_CODE: '2',
        },
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.ifError(unavailable.error);
    assert.equal(unavailable.status, 1);
    assert.match(await readFile(summary, 'utf8'), /Registrar report is unavailable or malformed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
