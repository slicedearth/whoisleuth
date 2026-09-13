import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { cliInvocationNetworkEffect } from '../cli/command-reference.mts';
import { safeTerminalValue } from '../cli/formatters/terminal.mts';
import { prepareLocalDocumentWrite } from '../cli/local-document-checkpoint.mts';
import { readEditableCaseExport } from '../packages/cases/case-export-input.mts';
import { CASE_SCHEMA_VERSION, MAX_CASES, MAX_CASE_STORE_BYTES, MAX_EDITABLE_CASE_INPUT_BYTES, MAX_EDITABLE_CASE_OUTPUT_BYTES, MAX_NOTE_LENGTH, MAX_NOTES_PER_CASE } from '../packages/contracts/case-portability.mts';
import { caseRecheckAnswerContext } from '../packages/cases/case-recheck-model.mts';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { buildCaseExport, serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { mergeCases } from '../packages/cases/case-migration-model.mts';
import type { CliDependencies } from '../cli/runner-types.mts';
import { caseStoreAtCapacity } from './workspace-backup-capacity-fixture.mts';

const NOW = '2026-09-13T12:00:00.000Z';
const LATER = '2026-09-14T12:00:00.000Z';
const pin = { label: 'Selected page observation', value: 'A credential form was retained in the supplied capture.', source: 'analyst supplied capture',
  observedAt: NOW, sourceState: 'complete', completeness: 'complete', truncated: false, observationHostname: 'example.test' };
async function directory(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-case-files-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function invoke(args: string[], dependencies: CliDependencies = {}) {
  let stdout = '', stderr = '', requests = 0;
  const denied = () => { requests += 1; throw new Error('Offline Case operation attempted collection.'); };
  const code = await runCli(args, { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    now: () => NOW, runUnifiedLookup: denied, safeFetch: denied, resolvePublicAddresses: denied,
    whoisQuery: denied, fetchHomepage: denied, collectTlsIntelligence: denied, ...dependencies });
  assert.equal(requests, 0);
  return { code, stdout, stderr };
}
async function initialFile(root: string) {
  const file = join(root, 'cases.json');
  const result = await invoke(['case', 'open', '--domain', 'example.test', '--title', 'Review the selected form', '--output', file]);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  assert.equal(result.stdout, '');
  return file;
}

test('Case grammar keeps mutations explicit and every operation offline', () => {
  assert.equal(cliInvocationNetworkEffect('case', ['recheck', 'cases.json', '--input', 'recheck.json']), 'offline');
  assert.equal(parseCliArguments(['case', 'show', 'cases.json']).action, 'case');
  for (const argv of [
    ['case'], ['case', 'show'], ['case', 'note', 'cases.json', '--text', 'Review'],
    ['case', 'open', '--output', 'cases.json'], ['case', 'show', '-'],
    ['case', 'open', '--domain', 'example.test', '--new-incident', '--output', 'cases.json'],
    ['case', 'show', 'cases.json', '--input', 'pin.json'], ['case', 'show', 'cases.json', '--text', 'Review'],
    ['case', 'pin', 'cases.json', '--output', 'next.json'], ['case', 'show', 'cases.json', '--expect-file-digest', 'not-a-digest'],
    ['case', 'show', 'cases.json', '--network'], ['case', 'show', 'cases.json', '--quiet'],
  ]) assert.throws(() => parseCliArguments(argv), { message: /.+/u }, argv.join(' '));
});

test('editable admission preserves immutable public and current fixtures and rejects lossy or future inputs', () => {
  for (const name of ['case-export-v15.json', 'case-export-v16.json']) {
    const raw = readFileSync(new URL(`./fixtures/case-lifecycle/${name}`, import.meta.url), 'utf8');
    const before = JSON.parse(raw);
    const cases = readEditableCaseExport(raw);
    assert.equal(cases.length, before.cases.length);
    assert.deepEqual(cases.map(value => value.id).sort(), before.cases.map((value: { id: string }) => value.id).sort());
    assert.deepEqual(cases[0]!.notes, before.cases[0].notes);
    assert.deepEqual(readEditableCaseExport(JSON.stringify(buildCaseExport(cases, NOW))), cases);
    assert.equal(readFileSync(new URL(`./fixtures/case-lifecycle/${name}`, import.meta.url), 'utf8'), raw);
  }
  const record = createCase({ domain: 'example.test', note: 'Keep every retained note.' }, NOW);
  const base = buildCaseExport([record], NOW);
  const invalids = [
    { ...base, version: CASE_SCHEMA_VERSION + 1 }, { ...base, extra: true },
    { ...base, cases: [record, record] }, { ...base, cases: [{ ...record, source: 'unsupported' }] },
    { ...base, cases: [{ ...record, notes: [{ ...record.notes[0], body: 'x'.repeat(MAX_NOTE_LENGTH + 1) }] }] },
    { ...base, cases: [{ ...record, futureEvidence: { value: 'must not disappear' } }] },
  ];
  for (const value of invalids) assert.throws(() => readEditableCaseExport(JSON.stringify(value)));
  assert.throws(() => readEditableCaseExport(`{"version":${CASE_SCHEMA_VERSION},"version":${CASE_SCHEMA_VERSION},"cases":[]}`), /duplicate/u);
});

test('Case files support the complete offline note, evidence, assessment and recheck journey', async context => {
  const root = await directory(context), file = await initialFile(root);
  const opened = readEditableCaseExport(await readFile(file, 'utf8'))[0]!;
  assert.match(opened.id, /^[A-Za-z0-9_-]+$/u);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const note = `${'n'.repeat(1500)}\nRetain this final line.`;
  const noteFile = join(root, 'note.txt'); await writeFile(noteFile, note);
  const raw = await readFile(file, 'utf8');
  const expected = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const noted = await invoke(['case', 'note', file, '--note-file', noteFile, '--expect-file-digest', expected, '--output', file, '--force']);
  assert.equal(noted.code, EXIT_CODES.SUCCESS, noted.stderr); assert.equal(noted.stdout, '');
  const evidenceFile = join(root, 'pin.json'); await writeFile(evidenceFile, JSON.stringify(pin));
  const pinned = await invoke(['case', 'pin', file, '--input', evidenceFile, '--output', file, '--force']);
  assert.equal(pinned.code, EXIT_CODES.SUCCESS, pinned.stderr);
  const retainedPin = readEditableCaseExport(await readFile(file, 'utf8'))[0]!.evidencePins[0]!;
  const assessment = { disposition: 'suspicious', reviewReasonCode: 'other_reviewed', summary: 'Review the apparent credential request', rationale: 'The source needs independent verification.',
    evidence: [{ pinId: retainedPin.id, stance: 'supports' }, { pin: { ...pin, label: 'Counterevidence', value: 'The original hostname also serves ordinary pages.' }, stance: 'contradicts' }] };
  const assessmentFile = join(root, 'assessment.json'); await writeFile(assessmentFile, JSON.stringify(assessment));
  const assessed = await invoke(['case', 'assess', file, '--input', assessmentFile, '--output', file, '--force']);
  assert.equal(assessed.code, EXIT_CODES.SUCCESS, assessed.stderr);
  const recheck = { state: 'still_observed', observedAt: LATER, source: 'analyst supplied capture', completeness: 'complete', comparisonSummary: 'The same form was observed in a later supplied capture.', observationHostname: 'example.test' };
  const recheckFile = join(root, 'recheck.json'); await writeFile(recheckFile, JSON.stringify(recheck));
  const checked = await invoke(['case', 'recheck', file, '--input', recheckFile, '--output', file, '--force'], { now: () => LATER });
  assert.equal(checked.code, EXIT_CODES.SUCCESS, checked.stderr);
  const final = readEditableCaseExport(await readFile(file, 'utf8'))[0]!;
  assert.equal(final.id, opened.id); assert.equal(final.notes[0]!.body, note); assert.equal(final.evidencePins.length, 3);
  assert.equal(final.decisions.length, 1); assert.equal(final.disposition, 'suspicious');
  assert.deepEqual(final.decisions[0]!.evidencePinIds, [retainedPin.id]);
  assert.equal(final.assertions[0]!.kind, 'contradiction'); assert.equal(final.assertions[0]!.evidenceRelations?.[0]?.stance, 'contradicts');
  assert.equal(final.observedEffects.reviews[0]!.sourceClass, 'analyst');
  assert.equal(final.observedEffects.reviews[0]!.state, 'still_observed'); assert.equal(final.actions.length, 0);
  const imported = mergeCases([], JSON.parse(await readFile(file, 'utf8')));
  assert.equal(imported.added, 1); assert.equal(imported.skipped, 0); assert.deepEqual(imported.cases[0]!.notes, final.notes);
  const shown = await invoke(['case', 'show', file, '--no-color']);
  assert.equal(shown.code, EXIT_CODES.SUCCESS, shown.stderr);
  assert.match(shown.stdout, /Retain this final line/u); assert.match(shown.stdout, /Counterevidence/u); assert.match(shown.stdout, /still_observed/u);
  assert.equal(shown.stderr, '');
  const json = await invoke(['case', 'show', file, '--json']);
  assert.deepEqual(JSON.parse(json.stdout).cases, [final]);
  assert.ok((await readdir(root)).every(name => !name.endsWith('.workflow.lock') && !name.endsWith('.tmp')));
});

test('independent incidents require an explicit Case selection and stale reviewed digests cannot overwrite them', async context => {
  const root = await directory(context), file = await initialFile(root);
  const first = readEditableCaseExport(await readFile(file, 'utf8'))[0]!;
  const second = await invoke(['case', 'open', file, '--domain', 'example.test', '--new-incident', '--title', 'A separate incident', '--output', file, '--force']);
  assert.equal(second.code, EXIT_CODES.SUCCESS, second.stderr);
  const baseline = await readFile(file, 'utf8');
  const records = readEditableCaseExport(baseline); assert.equal(records.length, 2); assert.notEqual(records[0]!.id, records[1]!.id);
  const overwrite = await invoke(['case', 'show', file, '--case-id', first.id, '--json', '--output', file, '--force']);
  assert.equal(overwrite.code, EXIT_CODES.USAGE); assert.match(overwrite.stderr, /different path/u);
  assert.equal(await readFile(file, 'utf8'), baseline);
  const ambiguous = await invoke(['case', 'note', file, '--domain', 'example.test', '--text', 'Do not choose for me', '--output', file, '--force']);
  assert.equal(ambiguous.code, EXIT_CODES.USAGE); assert.match(ambiguous.stderr, /exactly one Case/u); assert.equal(await readFile(file, 'utf8'), baseline);
  const stale = await invoke(['case', 'note', file, '--case-id', first.id, '--text', 'Do not overwrite', '--expect-file-digest', `sha256:${'0'.repeat(64)}`, '--output', file, '--force']);
  assert.equal(stale.code, EXIT_CODES.USAGE); assert.match(stale.stderr, /reviewed file digest/u); assert.equal(await readFile(file, 'utf8'), baseline);
  const selected = await invoke(['case', 'note', file, '--case-id', first.id, '--text', 'Selected deliberately', '--output', file, '--force']);
  assert.equal(selected.code, EXIT_CODES.SUCCESS, selected.stderr);
  assert.equal(readEditableCaseExport(await readFile(file, 'utf8')).find(value => value.id === first.id)!.notes.length, 1);
});

test('invalid or over-bound new evidence never replaces the working file', async context => {
  const root = await directory(context), file = await initialFile(root), input = join(root, 'input.json');
  const baseline = await readFile(file, 'utf8');
  for (const value of [{ ...pin, value: 'x'.repeat(1001) }, { ...pin, observedAt: 'yesterday' }, { ...pin, unexpected: true }, { ...pin, id: 'inherited-id' }]) {
    await writeFile(input, JSON.stringify(value));
    const result = await invoke(['case', 'pin', file, '--input', input, '--output', file, '--force']);
    assert.equal(result.code, EXIT_CODES.USAGE, result.stderr); assert.equal(result.stdout, '');
    assert.equal(await readFile(file, 'utf8'), baseline);
  }
  await writeFile(input, JSON.stringify({ state: 'not_reproduced', observedAt: LATER, completeness: 'partial', source: 'supplied observation', comparisonSummary: 'The page was unavailable.' }));
  const recheck = await invoke(['case', 'recheck', file, '--input', input, '--output', file, '--force']);
  assert.equal(recheck.code, EXIT_CODES.USAGE); assert.equal(await readFile(file, 'utf8'), baseline);
  const record = readEditableCaseExport(baseline)[0]!;
  record.notes = Array.from({ length: MAX_NOTES_PER_CASE }, (_, index) => ({ id: `note-${index}`, body: 'Retain this note.', createdAt: NOW }));
  await writeFile(file, JSON.stringify(buildCaseExport([record], NOW)));
  const full = await readFile(file, 'utf8');
  const note = await invoke(['case', 'note', file, '--text', 'Do not evict older notes', '--output', file, '--force']);
  assert.equal(note.code, EXIT_CODES.USAGE); assert.equal(await readFile(file, 'utf8'), full);
});

test('Case mutations hold the same source and destination lease and detect edits before publication', async context => {
  const root = await directory(context), file = await initialFile(root);
  const lease = await prepareLocalDocumentWrite({ destination: file, source: file, force: true, label: 'Case', maximumInputBytes: MAX_EDITABLE_CASE_INPUT_BYTES, maximumOutputBytes: MAX_EDITABLE_CASE_OUTPUT_BYTES });
  try {
    const locked = await invoke(['case', 'note', file, '--text', 'Cannot replace a busy file', '--output', file, '--force']);
    assert.equal(locked.code, EXIT_CODES.USAGE); assert.match(locked.stderr, /already locked/u);
  } finally { assert.equal(await lease.release(), 0); }
  const replacement = JSON.stringify(buildCaseExport([createCase({ domain: 'example.test', note: 'A concurrent writer changed this file.' }, LATER)], LATER));
  const changed = await invoke(['case', 'note', file, '--text', 'Must not erase the other writer', '--output', file, '--force'], {
    now: () => { writeFileSync(file, replacement); return LATER; },
  });
  assert.equal(changed.code, EXIT_CODES.USAGE); assert.match(changed.stderr, /changed during execution/u);
  assert.equal(await readFile(file, 'utf8'), replacement);
  assert.deepEqual(await readdir(root), ['cases.json']);
});

test('CLI non-reproduction preserves the saved question, source and comparison requirements', async context => {
  const root = await directory(context), file = join(root, 'cases.json'), inputFile = join(root, 'recheck.json');
  const planned = createCase({ domain: 'example.test', assertion: { kind: 'next_step', statement: 'Is the selected form still served?',
    recheck: { targetHostname: 'example.test', baselinePinId: null, conditions: 'Same page, unauthenticated session and viewport.' } } }, NOW);
  const original = JSON.stringify(buildCaseExport([planned], NOW));
  await writeFile(file, original);
  const answer = { state: 'not_reproduced', observedAt: LATER, completeness: 'complete', source: 'supplied page observation',
    comparisonSummary: 'The selected form was not found under the saved conditions.', observationHostname: 'example.test',
    recheck: caseRecheckAnswerContext(planned.assertions[0]!, 'comparable') };
  for (const invalid of [{ ...answer, completeness: 'partial' }, { ...answer, observationHostname: 'other.example' },
    { ...answer, recheck: { ...answer.recheck, conditionsMatch: 'different' } },
    { ...answer, recheck: { ...answer.recheck, question: 'An unsaved question' } }]) {
    await writeFile(inputFile, JSON.stringify(invalid));
    const result = await invoke(['case', 'recheck', file, '--input', inputFile, '--output', file, '--force']);
    assert.equal(result.code, EXIT_CODES.USAGE, result.stderr);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  await writeFile(inputFile, JSON.stringify(answer));
  const result = await invoke(['case', 'recheck', file, '--input', inputFile, '--output', file, '--force'], { now: () => LATER });
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  const record = readEditableCaseExport(await readFile(file, 'utf8'))[0]!;
  assert.equal(record.observedEffects.reviews[0]!.state, 'not_reproduced');
  assert.deepEqual(record.observedEffects.reviews[0]!.recheck, answer.recheck);
  assert.deepEqual(record.assertions, planned.assertions);
  assert.deepEqual(record.closures, planned.closures);
});

test('current maximum-count Case files stay readable within the canonical byte budget', () => {
  const cases = Array.from({ length: MAX_CASES }, (_, index) => createCase({ domain: `case${index}.example`, note: 'n'.repeat(MAX_NOTE_LENGTH) }, NOW));
  const content = JSON.stringify(buildCaseExport(cases, NOW), null, 2);
  assert.ok(Buffer.byteLength(serializeCaseStore(cases)) <= MAX_CASE_STORE_BYTES);
  assert.equal(readEditableCaseExport(content).length, MAX_CASES);
  const invalid = updateCase(cases, cases[0]!.id, { note: 'Another retained note.' }, LATER);
  assert.equal(readEditableCaseExport(JSON.stringify(buildCaseExport(invalid.cases, LATER)))[0]!.notes.length, 2);
});

test('an exact store-byte boundary is readable and refuses one more retained byte without pruning', async context => {
  const root = await directory(context), file = join(root, 'cases.json');
  const { cases } = caseStoreAtCapacity();
  assert.equal(Buffer.byteLength(serializeCaseStore(cases)), MAX_CASE_STORE_BYTES);
  const content = JSON.stringify(buildCaseExport(cases, NOW));
  assert.equal(readEditableCaseExport(content).length, MAX_CASES);
  await writeFile(file, content);
  const writable = cases.find(record => record.notes.length < MAX_NOTES_PER_CASE)!;
  const result = await invoke(['case', 'note', file, '--case-id', writable.id, '--text', 'x', '--output', file, '--force']);
  assert.equal(result.code, EXIT_CODES.USAGE, result.stderr);
  assert.match(result.stderr, /byte budget/u);
  assert.equal(await readFile(file, 'utf8'), content);
  const padding = cases.flatMap(record => record.notes).find(note => note.body.length < MAX_NOTE_LENGTH)!;
  assert.ok(padding);
  padding.body += 'x';
  assert.throws(() => readEditableCaseExport(JSON.stringify(buildCaseExport(cases, NOW))), /byte budget/u);
});

test('long Case prose uses its domain bound without changing terminal sanitisation defaults', () => {
  const note = 'x'.repeat(MAX_NOTE_LENGTH);
  assert.equal(safeTerminalValue(note).length, 240);
  assert.equal(safeTerminalValue(note, '—', MAX_NOTE_LENGTH), note);
  assert.equal(safeTerminalValue('\u001b[31mignore\u202ethis', '—', MAX_NOTE_LENGTH).includes('\u001b'), false);
  assert.throws(() => safeTerminalValue('text', '—', Infinity), /bound/u);
});
