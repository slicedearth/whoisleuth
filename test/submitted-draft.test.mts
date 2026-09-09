import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDraftRevision, restoreSubmittedFocus } from '../frontend/src/lib/controllers/submitted-draft.ts';

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

  it('restores only a connected control owned by the same live form without stealing later focus', () => {
    const origin = {} as Element;
    const body = {} as HTMLElement;
    const document = { activeElement: origin, body };
    const owner = { isConnected: true };
    let focused = 0;
    const target = {
      isConnected: true, disabled: false, ownerDocument: document,
      focus(options: FocusOptions) { assert.deepEqual(options, { preventScroll: true }); focused += 1; },
    };
    const restore = () => restoreSubmittedFocus(origin, target as unknown as HTMLElement, owner as Node);
    assert.equal(restore(), true);
    document.activeElement = body;
    assert.equal(restore(), true);
    document.activeElement = {} as Element;
    assert.equal(restore(), false);
    document.activeElement = origin;
    target.disabled = true;
    assert.equal(restore(), false);
    target.disabled = false;
    target.isConnected = false;
    assert.equal(restore(), false);
    target.isConnected = true;
    owner.isConnected = false;
    assert.equal(restore(), false);
    assert.equal(restoreSubmittedFocus(origin, null, null), false);
    assert.equal(focused, 2);
  });
});
