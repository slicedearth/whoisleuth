import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCaseAfterActionNote } from '../packages/cases/case-after-action.mts';
import { MAX_NOTE_LENGTH } from '../packages/contracts/case-portability.mts';

const empty = { delay: '', usefulEvidence: '', misleadingEvidence: '', returnedComplaint: '', nextTime: '' };
test('after-action notes keep only the supplied lessons without inventing outcomes', () => {
  assert.equal(buildCaseAfterActionNote({ ...empty, usefulEvidence: ' The timestamped observation. ', nextTime: 'Record the original source earlier.' }),
    'After-action review\n\nWhich evidence was useful?\nThe timestamped observation.\n\nWhat should change next time?\nRecord the original source earlier.');
});
test('an empty or non-text after-action review is rejected', () => {
  assert.throws(() => buildCaseAfterActionNote(empty), /at least one lesson/u);
  assert.throws(() => buildCaseAfterActionNote({ ...empty, delay: ' \n\t ' }), /at least one lesson/u);
  assert.throws(() => buildCaseAfterActionNote({ ...empty, delay: 1 as unknown as string }), /must be text/u);
});
test('the aggregate note boundary includes labels and never silently drops an answer', () => {
  const prefix = 'After-action review\n\nWhat delayed the investigation?\n';
  const exact = 'a'.repeat(MAX_NOTE_LENGTH - prefix.length);
  assert.equal(buildCaseAfterActionNote({ ...empty, delay: exact }), prefix + exact);
  assert.throws(() => buildCaseAfterActionNote({ ...empty, delay: exact + 'b' }), /no answer has been discarded/u);
  assert.throws(() => buildCaseAfterActionNote({ ...empty, delay: exact, nextTime: 'Retain this too.' }), /exceeds/u);
});
