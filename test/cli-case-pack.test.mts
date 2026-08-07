import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCliCasePack,
  MAX_CASE_PACK_CASES,
  verifyCliCasePack,
} from '../cli/case-pack.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';

const NOW = '2026-08-05T03:00:00.000Z';

function exportedCases() {
  return {
    version: CASE_SCHEMA_VERSION,
    cases: [{
      id: 'case-1', domain: 'example.test', status: 'reviewing', disposition: 'unreviewed', tags: [],
      notes: [{ id: 'note-1', body: 'private analyst note', createdAt: NOW }], source: 'lookup', evidenceHistory: [], evidencePins: [], decisions: [],
      actions: [{ id: 'action-1', type: 'network_hosting_report', recipient: 'private recipient', contactSource: 'manual', contactLimitations: [], dueAt: null, state: 'planned', reference: null, followUpAt: null, outcome: null, createdAt: NOW, updatedAt: NOW }],
      assertions: [{ id: 'assertion-1', kind: 'hypothesis', statement: 'Needs review', rationale: null, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: NOW, updatedAt: NOW }],
      manualTrail: [{ id: 'trail-1', kind: 'pivot', summary: 'Reviewed related host', target: 'private target', createdAt: NOW }], sightings: [],
      branches: [{ id: 'branch-1', name: 'Private branch name', state: 'active', evidencePinIds: [], checkpointIds: [], assertionIds: ['assertion-1'], actionIds: ['action-1'], createdAt: NOW, updatedAt: NOW }],
      createdAt: NOW, updatedAt: NOW,
    }],
  };
}

describe('CLI case pack', () => {
  test('requires deliberate review and applies the public audience boundary', () => {
    assert.throws(() => buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: false }, NOW), /requires --reviewed/iu);
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW);
    assert.equal(pack.version, CASE_SCHEMA_VERSION);
    assert.equal(pack.cases.length, 1);
    assert.deepEqual(pack.cases[0]?.notes, []);
    assert.deepEqual(pack.cases[0]?.actions, []);
    assert.deepEqual(pack.cases[0]?.assertions, []);
    assert.deepEqual(pack.cases[0]?.branches, []);
    assert.equal(pack.cases[0]?.manualTrail[0]?.target, null);
    assert.match(pack.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(pack), /private analyst note|private recipient|private target|Private branch name/u);
  });

  test('emits a browser-importable top-level case collection', async () => {
    let stdout = '';
    const code = await runCli(['case-pack', '--audience', 'trusted', '--reviewed', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      readArtifactInput: async () => JSON.stringify(exportedCases()),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    const output = JSON.parse(stdout);
    assert.equal(output.version, CASE_SCHEMA_VERSION);
    assert.equal(output.packet.schema, 'whoisleuth.cli.case-pack');
    assert.equal(output.cases.length, 1);
    assert.equal(output.cases[0].actions[0].recipient, '[redacted]');
    assert.equal(output.cases[0].branches[0].name, 'Private branch name');
    assert.doesNotMatch(JSON.stringify(output), /private recipient/u);
  });

  test('verifies the complete browser hand-off and rejects changed content', () => {
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
    const changed = structuredClone(pack);
    changed.cases[0]!.domain = 'changed.invalid';
    assert.throws(() => verifyCliCasePack(changed), /failed its SHA-256/iu);
  });

  test('refuses a case set that cannot be transferred without omission', () => {
    const source = exportedCases();
    source.cases = Array.from({ length: MAX_CASE_PACK_CASES + 1 }, (_, index) => ({
      ...source.cases[0]!,
      id: `case-${index}`,
      domain: `case-${index}.invalid`,
    }));
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
      /limited to 25 reviewed cases.*no case is silently omitted/iu,
    );
  });

  test('refuses malformed records instead of silently dropping them', () => {
    const original = exportedCases();
    const source: { version: number; cases: unknown[] } = {
      version: original.version,
      cases: [...original.cases],
    };
    source.cases = [...source.cases, { id: 'invalid-case' }];
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
      /invalid or duplicate case/iu,
    );
  });

  test('keeps generated packages within the browser import byte boundary', () => {
    const source = exportedCases();
    source.cases = Array.from({ length: MAX_CASE_PACK_CASES }, (_, caseIndex) => ({
      ...source.cases[0]!,
      id: `case-${caseIndex}`,
      domain: `case-${caseIndex}.invalid`,
      notes: Array.from({ length: 50 }, (_, noteIndex) => ({
        id: `note-${caseIndex}-${noteIndex}`,
        body: 'x'.repeat(2000),
        createdAt: NOW,
      })),
    }));
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'internal', reviewed: true }, NOW),
      /exceeds the browser 2 MiB import limit.*no evidence is silently omitted/iu,
    );
    assert.equal(
      buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW).cases.length,
      MAX_CASE_PACK_CASES,
    );
  });
});
