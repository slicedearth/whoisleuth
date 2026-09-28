import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parse } from 'yaml';

const WORKFLOW = readFileSync(new URL('../.github/workflows/cli-release.yml', import.meta.url), 'utf8');
type Step = { run?: string; uses?: string; env?: Record<string, string>; if?: string; 'continue-on-error'?: boolean; with?: Record<string, unknown> };
const DOCUMENT = parse(WORKFLOW) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<'prepare' | 'publish', { permissions?: Record<string, string>; environment?: string; needs?: string; if?: string; steps: Step[] }>;
};
const prepare = DOCUMENT.jobs.prepare.steps;
const publish = DOCUMENT.jobs.publish.steps;
function commandIndex(steps: Step[], command: string): number {
  const matches = steps.flatMap((step, index) => step.run?.includes(command) ? [index] : []);
  assert.equal(matches.length, 1, `Expected one ${command} execution`);
  return requiredValue(matches[0]);
}

describe('scoped CLI release workflow', () => {
  test('can run only through an explicit tagged release dispatch', () => {
    assert.deepEqual(Object.keys(DOCUMENT.on), ['workflow_dispatch']);
    const provenance = requiredValue(prepare[commandIndex(prepare, 'node tools/release-provenance.mts')]);
    assert.equal(provenance.env?.EXPECTED_VERSION, '${{ inputs.version }}');
    assert.equal(provenance.env?.GITHUB_TOKEN, '${{ github.token }}');
    assert.equal(provenance.if, undefined);
    assert.equal(provenance['continue-on-error'], undefined);
    assert.equal(DOCUMENT.jobs.prepare.if, undefined);
    assert.ok(prepare.indexOf(provenance) < prepare.findIndex(step => step.run === 'npm run dependencies:audit'));
    assert.doesNotMatch(WORKFLOW, /publication_mode|initial-publish/u);
  });

  test('keeps preparation read-only and grants OIDC only to protected publication', () => {
    assert.deepEqual(DOCUMENT.permissions, { contents: 'read', actions: 'read' });
    assert.equal(DOCUMENT.jobs.prepare.permissions, undefined);
    assert.equal(DOCUMENT.jobs.publish.environment, 'npm-release');
    assert.equal(DOCUMENT.jobs.publish.needs, 'prepare');
    assert.deepEqual(DOCUMENT.jobs.publish.permissions, { contents: 'read', 'id-token': 'write' });
    assert.equal(Object.values(DOCUMENT.jobs).filter(job => job.permissions?.['id-token'] === 'write').length, 1);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions|packages): write\b/u);
    const actions = [...prepare, ...publish].flatMap(step => step.uses
      ? [{ action: step.uses.split('@')[0], revision: step.uses.split('@')[1] }] : []);
    // Required capabilities and immutable pins are the contract, not the full
    // action inventory or the order of unrelated preparation steps.
    for (const action of ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']) {
      assert.ok(prepare.some(step => step.uses?.startsWith(`${action}@`)), `Preparation requires ${action}`);
    }
    for (const action of ['actions/setup-node', 'actions/download-artifact']) {
      assert.ok(publish.some(step => step.uses?.startsWith(`${action}@`)), `Publication requires ${action}`);
    }
    for (const step of [...prepare, ...publish].filter(step => step.uses?.startsWith('actions/checkout@'))) {
      assert.equal(step.with?.['persist-credentials'], false);
    }
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
  });

  test('reviews one digest-bound archive before the stage-only registry action', () => {
    const uploadIndex = prepare.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'));
    const stageIndex = commandIndex(publish, 'npm stage publish');
    assert.ok(uploadIndex > 0 && stageIndex > commandIndex(publish, 'sha256sum --check'));
    assert.match(WORKFLOW, /test "\$\{#archives\[@\]\}" -eq 1/gu);
    assert.equal((WORKFLOW.match(/sha256sum --check/gu) ?? []).length, 2);
    assert.doesNotMatch(WORKFLOW, /NODE_AUTH_TOKEN|NPM_FIRST_PUBLISH_TOKEN|\$\{\{ secrets\./u);
    assert.doesNotMatch(WORKFLOW, /(^|[^\w])npm publish(?:\s|$)/mu);
    assert.equal((WORKFLOW.match(/npm stage publish/gu) ?? []).length, 1);
    assert.match(WORKFLOW, /npm stage publish[^\n]+--access public --provenance/u);
    assert.ok(prepare.every(step => !/\bnpm (?:publish|stage publish)\b/u.test(step.run ?? '')));
    const auditIndex = prepare.findIndex(step => step.run === 'npm run dependencies:audit');
    const installIndex = commandIndex(prepare, 'npm ci --include=optional --ignore-scripts --audit=false');
    assert.ok(auditIndex > 0 && installIndex > auditIndex && installIndex < uploadIndex);
    const installedAuditIndex = commandIndex(prepare, 'npm run dependencies:audit -- --installed-candidate');
    const assemblyIndex = commandIndex(prepare, 'npm run cli:package:release');
    assert.ok(assemblyIndex > installIndex && installedAuditIndex > assemblyIndex && installedAuditIndex < uploadIndex);
    assert.match(requiredValue(prepare[installedAuditIndex]?.run), /"\$RELEASE_DIRECTORY\/installed-dependencies\.json"/u);
    assert.equal((WORKFLOW.match(/npm run dependencies:audit/gu) ?? []).length, 2);
    assert.equal(prepare[uploadIndex]?.with?.['retention-days'], 7);
  });
});
