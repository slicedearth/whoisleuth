import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
assert.equal(args.shift(), 'run');
if (args[0] === '--silent') args.shift();
const command = args.shift();
assert.ok(['sources:health', 'test:profile', 'test:duration-health', 'verification:timing:update-candidate'].includes(command));
const log = process.env.TEST_CALL_LOG;
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const call = { command, args };
fs.appendFileSync(log, JSON.stringify(call) + '\n');
const index = calls.length;
if (String(index) === process.env.TEST_FAIL_CALL) process.exit(23);
if (command === 'sources:health') {
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

type HealthStep = { run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
const healthWorkflow = parse(readFileSync(new URL('../.github/workflows/test-health.yml', import.meta.url), 'utf8'));
const healthSteps = Object.values(healthWorkflow.jobs as Record<string, { steps: HealthStep[] }>).flatMap(job => job.steps);

for (const failure of [null, 0, 1, 2, 3, 4, 5, 6]) {
  test(`scheduled health executes distinct samples and propagates ${failure === null ? 'success' : `command failure ${failure + 1}`}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'test-health-shell-'));
    const summary = path.join(directory, 'summary.md');
    const log = path.join(directory, 'calls.jsonl');
    const double = path.join(directory, 'npm-double.cjs');
    const selected = healthSteps.filter(step => /npm run (?:--silent )?(?:sources:health|test:profile|test:duration-health|verification:timing:update-candidate)(?:\s|$)/u.test(step.run ?? ''));
    assert.ok(selected.length > 0);
    try {
      await writeFile(double, HEALTH_NPM_DOUBLE);
      let status: number | null = 0;
      for (const step of selected) {
        assert.equal(step.if, undefined, 'Required health collection must not be conditionally skipped.');
        const result = spawnSync(unitTestExecutablePath('bash'), ['-e', '-c',
          'npm() { "$TEST_NODE" "$TEST_NPM_DOUBLE" "$@"; }\n' + requiredValue(step.run)], {
          cwd: directory, encoding: 'utf8', timeout: 10_000,
          env: { ...process.env, RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary,
            PROFILE_PROVENANCE: 'unit-ci-fixture-1', TEST_NODE: process.execPath, TEST_NPM_DOUBLE: double,
            TEST_CALL_LOG: log, TEST_FAIL_CALL: failure === null ? '' : String(failure) },
        });
        assert.equal(result.error, undefined, 'The shell must execute, not time out or fail to launch.');
        assert.equal(result.signal, null, 'A signal is not a command rejection.');
        status = result.status;
        if (status !== 0) break;
      }
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { command: string; args: string[] });
      const expected = ['sources:health', 'sources:health', 'test:profile', 'test:profile', 'test:profile',
        'test:duration-health', 'verification:timing:update-candidate'];
      assert.deepEqual(calls.map(call => call.command), failure === null ? expected : expected.slice(0, failure + 1));
      if (failure !== null) {
        assert.notEqual(status, 0, 'No failing producer may be hidden by a pipeline or a later command.');
        return;
      }
      assert.equal(status, 0);
      assert.deepEqual(calls[1]?.args, ['--', '--github-annotations']);
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
