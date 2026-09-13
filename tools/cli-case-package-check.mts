import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { CASE_SCHEMA_VERSION, MAX_EDITABLE_CASE_OUTPUT_BYTES } from '../packages/contracts/case-portability.mts';

type RunInstalled = (args: readonly string[], label: string, expectedExitCode?: number, expectedDiagnostics?: RegExp) => Promise<string>;

/** Exercise the installed command against ordinary private files, not source imports. */
export async function checkInstalledCaseFiles(temporaryRoot: string, run: RunInstalled): Promise<readonly string[]> {
  const file = join(temporaryRoot, 'working-cases.json');
  const inputFile = join(temporaryRoot, 'case-operation.json');
  const bytes = () => readBoundedRegularFile(file, { maximumBytes: MAX_EDITABLE_CASE_OUTPUT_BYTES, label: 'Installed Case output' });
  const create = await run(['case', 'open', '--domain', 'example.test', '--title', 'Selected observation review', '--output', file], 'offline Case creation');
  if (create !== '') throw new TypeError('Installed Case file creation emitted a second copy to stdout.');
  const opened = JSON.parse((await bytes()).toString('utf8'));
  const id = opened.cases?.[0]?.id;
  if (opened.version !== CASE_SCHEMA_VERSION || opened.cases?.length !== 1 || typeof id !== 'string' || !id) {
    throw new TypeError('Installed Case creation did not produce one current identified Case.');
  }
  const note = 'Selected source still needs review.';
  const mutate = async (operation: string, options: readonly string[]) => {
    const output = await run(['case', operation, file, ...options, '--output', file, '--force'], `offline Case ${operation}`);
    if (output !== '') throw new TypeError('Installed Case mutation emitted a second copy to stdout.');
  };
  await mutate('note', ['--case-id', id, '--text', note]);
  await writeFile(inputFile, JSON.stringify({ label: 'Supplied observation', value: 'A form was retained.', source: 'Supplied capture',
    observedAt: '2026-09-01T12:00:00.000Z', completeness: 'complete', sourceState: 'complete' }), { flag: 'wx', mode: 0o600 });
  await mutate('pin', ['--input', inputFile]);
  const pinId = JSON.parse((await bytes()).toString('utf8')).cases?.[0]?.evidencePins?.[0]?.id;
  await writeFile(inputFile, JSON.stringify({ disposition: 'suspicious', reviewReasonCode: 'other_reviewed', summary: 'Review the selected form',
    rationale: 'The observation needs corroboration.', evidence: [{ pinId, stance: 'supports' }] }));
  await mutate('assess', ['--input', inputFile]);
  await writeFile(inputFile, JSON.stringify({ state: 'unavailable', observedAt: '2026-09-02T12:00:00.000Z', completeness: 'partial',
    source: 'Supplied capture', comparisonSummary: 'The later capture could not complete.' }));
  await mutate('recheck', ['--input', inputFile]);
  const original = await bytes();
  const shown = await run(['case', 'show', file, '--json'], 'offline Case JSON review');
  const record = JSON.parse(shown).cases?.[0];
  if (record?.id !== id || record.notes?.[0]?.body !== note || record.evidencePins?.length !== 2
    || record.decisions?.[0]?.evidencePinIds?.[0] !== pinId || record.observedEffects?.reviews?.[0]?.state !== 'unavailable'
    || record.observedEffects?.reviews?.[0]?.completeness !== 'partial' || record.observedEffects?.reviews?.[0]?.sourceClass !== 'analyst'
    || record.actions?.length !== 0 || record.disposition !== 'suspicious') {
    throw new TypeError('Installed Case journey lost retained evidence or changed its authority.');
  }
  const terminal = await run(['case', 'show', file, '--no-color'], 'offline Case terminal review');
  if (!terminal.includes(note) || !terminal.includes(`sha256:${createHash('sha256').update(original).digest('hex')}`)) {
    throw new TypeError('Installed Case review omitted the note or exact file digest.');
  }
  await run(['case', 'note', file, '--text', 'Refuse a stale review', '--expect-file-digest', `sha256:${'0'.repeat(64)}`,
    '--output', file, '--force'], 'offline Case stale-file refusal', 2, /reviewed file digest/u);
  await writeFile(inputFile, JSON.stringify({ label: 'New pin', value: 'Observation', unexpected: true }));
  await run(['case', 'pin', file, '--input', inputFile, '--output', file, '--force'], 'offline Case lossy-input refusal', 2, /Pin field unexpected/u);
  if (!(await bytes()).equals(original)) throw new TypeError('Installed Case refusal modified its source.');
  return ['offline-case-create', 'offline-case-note', 'offline-case-pin', 'offline-case-assessment', 'offline-case-recheck',
    'offline-case-json-review', 'offline-case-terminal-review', 'offline-case-stale-refusal', 'offline-case-lossy-input-refusal'];
}
