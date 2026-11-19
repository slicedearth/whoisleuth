import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCaseExport, createCase, mergeCases, normalizeCaseStore, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import { projectCaseForAudience } from '../packages/cases/case-record-projection.mts';
import {
  MAX_CASE_ANALYST_CONTEXT, mergeCaseAnalystContext, readCaseAnalystContext,
} from '../packages/cases/case-analyst-context.mts';
import { ANALYST_CONTEXT_CASE_SCHEMA_VERSION, CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

const NOW = '2026-08-22T00:00:00.000Z';
const LATER = '2026-08-23T00:00:00.000Z';
const digest = (character: string) => character.repeat(64);
const entry = (id: string, listSha256: string, rank: number, recordedAt = NOW) => ({ id, kind: 'popularity_rank' as const, rank, listSha256, recordedAt });

test('analyst context admits only exact popularity ranks from Case schema 22', () => {
  assert.equal(CASE_SCHEMA_VERSION, ANALYST_CONTEXT_CASE_SCHEMA_VERSION);
  assert.equal(readCaseAnalystContext(undefined), undefined);
  assert.equal(readCaseAnalystContext([]), undefined);
  assert.deepEqual(readCaseAnalystContext([entry('b', digest('b'), 9, LATER), entry('a', digest('a'), 42)]),
    [entry('a', digest('a'), 42), entry('b', digest('b'), 9, LATER)]);
  assert.throws(() => readCaseAnalystContext([entry('a', digest('a'), 42)], 21), /requires Case schema 22/u);
  for (const malformed of [
    { ...entry('a', digest('a'), 0) },
    { ...entry('a', 'not-a-digest', 1) },
    { ...entry('a', digest('A'), 1) },
    { ...entry('a', digest('a'), 1), kind: 'note' },
    { ...entry('a', digest('a'), 1), recordedAt: '2026-08-22' },
    { ...entry('a', digest('a'), 1), extra: true },
  ]) assert.throws(() => readCaseAnalystContext([malformed]), /malformed|recording time/u, JSON.stringify(malformed));
  assert.throws(() => readCaseAnalystContext([entry('a', digest('a'), 1), entry('b', digest('a'), 2)]), /unique/u);
  assert.throws(() => readCaseAnalystContext(Array.from({ length: MAX_CASE_ANALYST_CONTEXT + 1 }, (_, index) => entry(`id${index}`, index.toString(16).padStart(64, '0'), 1))), /at most/u);
});

test('a recorded rank replaces an earlier rank from the same list and stays bounded', () => {
  const created = createCase({ domain: 'ranked.example', popularityRank: { rank: 42, listSha256: digest('a') } }, NOW);
  assert.deepEqual(created.analystContext?.map(({ rank, listSha256, recordedAt }) => ({ rank, listSha256, recordedAt })),
    [{ rank: 42, listSha256: digest('a'), recordedAt: NOW }]);
  const replaced = updateCase([created], created.id, { popularityRank: { rank: 7, listSha256: digest('a') } }, LATER).record;
  assert.deepEqual(replaced.analystContext?.map((item) => item.rank), [7]);
  const second = updateCase([replaced], replaced.id, { popularityRank: { rank: 3, listSha256: digest('b') } }, LATER).record;
  assert.equal(second.analystContext?.length, 2);
  assert.throws(() => createCase({ domain: 'ranked.example', popularityRank: { rank: -1, listSha256: digest('a') } }, NOW), /malformed/u);
  let full = createCase({ domain: 'full.example' }, NOW);
  for (let index = 0; index < MAX_CASE_ANALYST_CONTEXT; index++) {
    full = updateCase([full], full.id, { popularityRank: { rank: index + 1, listSha256: index.toString(16).padStart(64, '0') } }, NOW).record;
  }
  assert.throws(() => updateCase([full], full.id, { popularityRank: { rank: 1, listSha256: digest('f') } }, NOW), /already retains/u);
  // A Case without a recorded rank has no analyst context field at all.
  assert.equal(Object.hasOwn(createCase({ domain: 'plain.example' }, NOW), 'analystContext'), false);
});

test('import merges ranks additively and rejects analyst context in older schemas', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/case-export-v22-context.json', import.meta.url), 'utf8'));
  const imported = mergeCases([], fixture).cases[0]!;
  assert.deepEqual(imported.analystContext, [entry('context-popularity-rank', digest('b'), 42, '2026-08-20T00:00:00.000Z')]);
  assert.deepEqual(buildCaseExport([imported], NOW).cases[0]!.analystContext, imported.analystContext);
  assert.deepEqual(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [imported] }).cases[0]!.analystContext, imported.analystContext);
  // Later recording wins for one list; other lists are added.
  assert.deepEqual(mergeCaseAnalystContext([entry('old', digest('b'), 50, NOW)], [entry('new', digest('b'), 40, LATER), entry('c', digest('c'), 9)])
    ?.map((item) => [item.id, item.rank]), [['c', 9], ['new', 40]]);
  const older = structuredClone(fixture);
  older.version = 21;
  assert.throws(() => mergeCases([], older), /Analyst context requires the current Case schema/u);
});

test('public packs leave out analyst-selected list ranks', () => {
  const record = createCase({ domain: 'ranked.example', popularityRank: { rank: 42, listSha256: digest('a') } }, NOW);
  assert.ok(projectCaseForAudience(record, 'internal').analystContext);
  assert.ok(projectCaseForAudience(record, 'trusted').analystContext);
  assert.equal(Object.hasOwn(projectCaseForAudience(record, 'public'), 'analystContext'), false);
});
