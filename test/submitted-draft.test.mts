import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDraftRevision } from '../frontend/src/lib/controllers/submitted-draft.ts';

describe('submitted draft ownership', () => {
  it('clears only an unchanged submitted revision', () => {
    const draft = createDraftRevision(() => 'record-a');
    draft.changed();
    const accepted = draft.capture();
    assert.equal(accepted(), true);
    draft.changed();
    assert.equal(accepted(), false);
    assert.equal(draft.capture()(), true);
  });

  it('preserves a later edit even when its text is changed back', () => {
    const draft = createDraftRevision(() => 'record-a');
    const accepted = draft.capture();
    draft.changed();
    draft.changed();
    assert.equal(accepted(), false);
  });

  it('does not clear another record or an independently edited form', () => {
    let owner = 'record-a';
    const first = createDraftRevision(() => owner);
    const second = createDraftRevision(() => owner);
    const accepted = first.capture();
    second.changed();
    assert.equal(accepted(), true);
    owner = 'record-b';
    assert.equal(accepted(), false);
  });
});
