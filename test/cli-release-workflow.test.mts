import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const WORKFLOW = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8');

describe('scoped CLI release workflow', () => {
  test('can run only through an explicit tagged release dispatch', () => {
    assert.match(WORKFLOW, /^on:\s*\n\s{2}workflow_dispatch:/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{2}(?:push|pull_request|release|repository_dispatch):/mu);
    assert.match(WORKFLOW, /process\.env\.GITHUB_REF !== `refs\/tags\/v\$\{expected\}`/u);
    assert.match(WORKFLOW, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/u);
    assert.match(WORKFLOW, /actions\/workflows\/ci\.yml\/runs/u);
    assert.match(WORKFLOW, /endpoint\.searchParams\.set\("head_sha", sha\)/u);
    assert.match(WORKFLOW, /run\?\.head_sha === sha && run\?\.event === "push" && run\?\.conclusion === "success"/u);
    assert.doesNotMatch(WORKFLOW, /publication_mode|initial-publish/u);
  });

  test('keeps preparation read-only and grants OIDC only to protected publication', () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read\s*\n\s{2}actions: read$/mu);
    assert.match(WORKFLOW, /^\s{4}environment: npm-release$/mu);
    assert.match(WORKFLOW, /^\s{6}id-token: write$/mu);
    assert.equal((WORKFLOW.match(/id-token: write/gu) ?? []).length, 1);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions|packages): write\b/u);
    assert.match(WORKFLOW, /^\s{10}persist-credentials: false$/mu);

    const actions = [...WORKFLOW.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
      .map((match) => ({ action: match[1], revision: match[2] }));
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/setup-node',
      'actions/download-artifact',
    ]);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
  });

  test('reviews one digest-bound archive before the stage-only registry action', () => {
    const uploadIndex = WORKFLOW.indexOf('name: Upload reviewed candidate');
    const environmentIndex = WORKFLOW.indexOf('environment: npm-release');
    const stageIndex = WORKFLOW.indexOf('npm stage publish');
    assert.ok(uploadIndex > 0 && environmentIndex > uploadIndex && stageIndex > environmentIndex);
    assert.match(WORKFLOW, /test "\$\{#archives\[@\]\}" -eq 1/gu);
    assert.equal((WORKFLOW.match(/sha256sum --check/gu) ?? []).length, 2);
    assert.doesNotMatch(WORKFLOW, /NODE_AUTH_TOKEN|NPM_FIRST_PUBLISH_TOKEN|\$\{\{ secrets\./u);
    assert.doesNotMatch(WORKFLOW, /(^|[^\w])npm publish(?:\s|$)/mu);
    assert.equal((WORKFLOW.match(/npm stage publish/gu) ?? []).length, 1);
    assert.match(WORKFLOW, /npm stage publish[^\n]+--access public --provenance/u);
    assert.doesNotMatch(WORKFLOW.slice(0, environmentIndex), /\bnpm (?:publish|stage publish)\b/u);
    const auditIndex = WORKFLOW.indexOf('npm run dependencies:audit');
    const installIndex = WORKFLOW.indexOf('npm ci --include=optional --ignore-scripts --audit=false');
    assert.ok(auditIndex > 0 && installIndex > auditIndex && installIndex < uploadIndex);
    assert.equal((WORKFLOW.match(/npm run dependencies:audit/gu) ?? []).length, 1);
    const candidateUpload = WORKFLOW.slice(uploadIndex, environmentIndex);
    assert.match(candidateUpload, /retention-days: 7/u);
    assert.equal((candidateUpload.match(/retention-days:/gu) ?? []).length, 1);
  });
});
