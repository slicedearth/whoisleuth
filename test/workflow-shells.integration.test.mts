import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
