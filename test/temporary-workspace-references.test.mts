import test from 'node:test';
import assert from 'node:assert/strict';
import { addTemporaryWorkspaceReference, TEMPORARY_WORKSPACE_REFERENCE_COUNT } from '../frontend/src/lib/analysis/temporary-workspace-references.ts';
import { LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS } from '../packages/contracts/local-application.mts';
const time = '2026-09-01T00:00:00.000Z';

test('temporary folder references preserve exact supplied text and addition order without claiming launch history', () => {
  const first = addTemporaryWorkspaceReference([], { label: ' First ', path: ' ./review folder ', basis: 'supplied' }, time);
  const next = addTemporaryWorkspaceReference(first, { label: 'Launch folder', path: './different', basis: 'current_launch' }, time);
  assert.equal(first[0]!.path, ' ./review folder '); assert.equal(first[0]!.label, 'First');
  assert.equal(next[0]!.basis, 'current_launch'); assert.equal(next[1]!.id, first[0]!.id);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first[0])); assert.equal(first.length, 1);
});

test('invalid or oversized references fail with fixed text and do not expose supplied paths', () => {
  for (const path of ['', ' ', 'private-reference\ncontrol', 'x'.repeat(LOCAL_WORKSPACE_MAX_DIRECTORY_CHARACTERS + 1)]) {
    assert.throws(() => addTemporaryWorkspaceReference([], { label: 'Reference', path, basis: 'supplied' }, time), cause => {
      assert.ok(cause instanceof TypeError); assert.equal(cause.message, 'Supply a bounded label and folder reference without control characters. No folder was inspected.'); return true;
    });
  }
  assert.throws(() => addTemporaryWorkspaceReference([], { label: 'x'.repeat(101), path: './reference', basis: 'supplied' }, time));
  assert.throws(() => addTemporaryWorkspaceReference([], { label: 'Reference', path: './reference', basis: 'supplied' }, 'unknown'), /time is unavailable/);
});

test('full shortlist refuses another reference without eviction or changing the original', () => {
  let rows = addTemporaryWorkspaceReference([], { label: '0', path: './reference-0', basis: 'supplied' }, time);
  for (let i = 1; i < TEMPORARY_WORKSPACE_REFERENCE_COUNT; i++) rows = addTemporaryWorkspaceReference(rows, { label: String(i), path: `./reference-${i}`, basis: 'supplied' }, time);
  const before = structuredClone(rows);
  assert.throws(() => addTemporaryWorkspaceReference(rows, { label: 'Next', path: './next', basis: 'supplied' }, time), /No reference was removed automatically/);
  assert.deepEqual(rows, before);
});

test('duplicate declarations cannot make remove controls ambiguous and no filesystem equivalence is inferred', () => {
  const first = addTemporaryWorkspaceReference([], { label: 'Reference', path: './reference', basis: 'supplied' }, time);
  assert.throws(() => addTemporaryWorkspaceReference(first, { label: 'Reference', path: './other', basis: 'supplied' }, time), /already in this temporary shortlist/);
  assert.throws(() => addTemporaryWorkspaceReference(first, { label: 'Other', path: './reference', basis: 'supplied' }, time), /already in this temporary shortlist/);
  const differentSpelling = addTemporaryWorkspaceReference(first, { label: 'Another declaration', path: './REFERENCE', basis: 'supplied' }, time);
  assert.equal(differentSpelling.length, 2);
});
