import assert from 'node:assert/strict';
import test from 'node:test';
import { handlesLocalLink } from '../frontend/src/lib/link-activation.ts';

function click(overrides: Partial<MouseEvent> = {}, target = '', download = false): MouseEvent {
  return {
    button: 0, defaultPrevented: false,
    metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    currentTarget: { target, hasAttribute: (name: string) => name === 'download' && download },
    ...overrides,
  } as unknown as MouseEvent;
}

test('plain mouse and keyboard anchor activations can use local navigation', () => {
  assert.equal(handlesLocalLink(click()), true);
  assert.equal(handlesLocalLink(click({ detail: 0 }, '_self')), true);
});

for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
  test(`${modifier} leaves native anchor behaviour unchanged`, () => {
    assert.equal(handlesLocalLink(click({ [modifier]: true })), false);
  });
}

test('non-primary, cancelled, detached, download and other-target links are not intercepted', () => {
  for (const button of [1, 2]) assert.equal(handlesLocalLink(click({ button })), false);
  assert.equal(handlesLocalLink(click({ defaultPrevented: true })), false);
  assert.equal(handlesLocalLink(click({ currentTarget: null })), false);
  assert.equal(handlesLocalLink(click({}, '', true)), false);
  for (const target of ['_blank', '_parent', 'review']) assert.equal(handlesLocalLink(click({}, target)), false);
});
