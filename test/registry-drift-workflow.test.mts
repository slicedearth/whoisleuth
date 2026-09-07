import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse } from 'yaml';

const WORKFLOW = readFileSync(new URL('../.github/workflows/registry-drift.yml', import.meta.url), 'utf8');

describe('official registry drift workflow', () => {
  test('runs only on a fixed weekly schedule or explicit dispatch', () => {
    assert.match(WORKFLOW, /^\s{2}workflow_dispatch:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}schedule:\s*\n\s{4}- cron: '17 2 \* \* 1'$/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{2}(push|pull_request|repository_dispatch):/mu);
  });

  test('uses read-only permissions, fixed action revisions, and no secrets', () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.match(WORKFLOW, /^\s{10}persist-credentials: false$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.doesNotMatch(WORKFLOW, /\bsecrets\./u);

    const actions = [...WORKFLOW.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
      .map((match) => ({ action: match[1], revision: match[2] }));
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
  });

  test('runs the existing bounded command and retains only reviewable reports', () => {
    assert.match(WORKFLOW, /^\s{4}timeout-minutes: 10$/mu);
    assert.match(WORKFLOW, /npm ci --include=optional --ignore-scripts --audit=false/u);
    assert.match(WORKFLOW, /npm run --silent registry:drift -- --json > registry-drift-report\.json/u);
    assert.match(
      WORKFLOW,
      /npm run --silent registry:fixtures -- --json > registry-fixture-freshness-report\.json/u,
    );
    assert.match(
      WORKFLOW,
      /npm run --silent registrar:standing:check -- --json > registrar-standing-report\.json/u,
    );
    assert.match(
      WORKFLOW,
      /if: steps\.audit\.outputs\.exit_code != '0' \|\| steps\.fixtures\.outputs\.exit_code != '0' \|\| steps\.registrar_standing\.outputs\.exit_code != '0'[\s\S]+actions\/upload-artifact@/u,
    );
    assert.match(WORKFLOW, /name: registry-maintenance-reports/u);
    assert.match(WORKFLOW, /registry-drift-report\.json/u);
    assert.match(WORKFLOW, /registry-fixture-freshness-report\.json/u);
    assert.match(WORKFLOW, /registrar-standing-report\.json/u);
    assert.match(WORKFLOW, /retention-days: 7/u);
    const workflow = parse(WORKFLOW);
    const review = workflow.jobs.audit.steps.find((step: { env?: Record<string, string> }) => step.env?.REGISTRAR_EXIT_CODE);
    assert.ok(review);
    assert.match(review.run, /process\.exitCode = 1;/u);
    assert.doesNotMatch(WORKFLOW, /\b(?:gh issue|git commit|git push)\b/u);
  });

  test('explains source drift in the job summary while retaining the failing result', async () => {
    const workflow = parse(WORKFLOW);
    const review = workflow.jobs.audit.steps.find((step: { env?: Record<string, string> }) => step.env?.REGISTRAR_EXIT_CODE);
    assert.ok(review);
    const directory = await mkdtemp(path.join(tmpdir(), 'registry-review-summary-'));
    const summary = path.join(directory, 'summary.md');
    try {
      await Promise.all([
        writeFile(path.join(directory, 'registry-drift-report.json'), JSON.stringify({ checks: [] })),
        writeFile(path.join(directory, 'registry-fixture-freshness-report.json'), JSON.stringify({ files: [] })),
        writeFile(path.join(directory, 'registrar-standing-report.json'), JSON.stringify({ checks: [
          { id: 'iana_registrar_ids', status: 'drift', expectedItems: 10, observedItems: 11, expectedDigest: 'a'.repeat(64), observedDigest: 'b'.repeat(64) },
          { id: 'catalogue_freshness', status: 'current', expectedItems: 2, observedItems: 2 },
        ] })),
      ]);
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', review.run], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary, REGISTRY_EXIT_CODE: '0', FIXTURE_EXIT_CODE: '0', REGISTRAR_EXIT_CODE: '1' },
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      const rendered = await readFile(summary, 'utf8');
      assert.match(rendered, /Registrar standing \| 1/u);
      assert.match(rendered, /iana_registrar_ids: drift; records 10 → 11/u);
      assert.match(rendered, /Normalised digest a{64} → b{64}/u);
      assert.doesNotMatch(rendered, /catalogue_freshness/u);
      assert.match(result.stdout, /::error title=Registry maintenance requires review::/u);

      await writeFile(path.join(directory, 'registrar-standing-report.json'), '{invalid');
      const unavailable = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', review.run], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary, REGISTRY_EXIT_CODE: '0', FIXTURE_EXIT_CODE: '0', REGISTRAR_EXIT_CODE: '2' },
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      assert.ifError(unavailable.error);
      assert.equal(unavailable.status, 1);
      assert.match(await readFile(summary, 'utf8'), /Registrar report is unavailable or malformed/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
