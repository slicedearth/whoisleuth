import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openRetainedPeek } from '../frontend/src/lib/controllers/retained-peek-key.ts';

function key(overrides: Partial<KeyboardEvent> = {}) {
  let prevented = 0;
  const event = { key: 'p', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    isComposing: false, repeat: false, defaultPrevented: false,
    preventDefault: () => { prevented++; }, ...overrides } as KeyboardEvent;
  return { event, prevented: () => prevented };
}

test('focused retained-inspection keys invoke only the supplied local action', () => {
  for (const value of ['p', 'P']) {
    const input = key({ key: value }); let opened = 0;
    openRetainedPeek(input.event, () => { opened++; });
    assert.equal(opened, 1); assert.equal(input.prevented(), 1);
  }
});

test('handled, repeated, composing and modified keys leave native/editor behaviour alone', () => {
  for (const input of [
    key({ key: 'Enter' }), key({ key: ' ' }), key({ key: 'Escape' }), key({ key: 'i', altKey: true }),
    ...(['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented'] as const).map(flag => key({ [flag]: true })),
  ]) {
    openRetainedPeek(input.event, () => assert.fail('Must not open an inspector'));
    assert.equal(input.prevented(), 0);
  }
});
