import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepFocusBelow } from '../frontend/src/lib/visible-focus.ts';

test('sticky focus protection respects pointer release, modal ownership and teardown', (context) => {
  class ElementStub extends EventTarget {
    top = 10; bottom = 30; modal = false;
    children = new Set<ElementStub>();
    contains(value: ElementStub) { return value === this || this.children.has(value); }
    closest() { return this.modal ? this : null; }
    getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; }
  }
  const container = new ElementStub(), target = new ElementStub(), boundary = new ElementStub();
  container.children.add(target); boundary.bottom = 54;
  const document = { activeElement: target as ElementStub | null };
  const movements: ScrollToOptions[] = [];
  const window = Object.assign(new EventTarget(), { scrollBy(value: ScrollToOptions) { movements.push(value); } });
  for (const [key, value] of Object.entries({ HTMLElement: ElementStub, document, window })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => { if (before) Object.defineProperty(globalThis, key, before); else Reflect.deleteProperty(globalThis, key); });
  }
  let surface: ElementStub | null = boundary;
  const guard = keepFocusBelow(container as unknown as HTMLElement, () => surface as unknown as HTMLElement | null);
  const focus = () => container.dispatchEvent(new Event('focusin'));
  focus(); assert.deepEqual(movements, [{ top: -56, behavior: 'instant' }]);
  for (const release of ['pointerup', 'pointercancel', 'blur']) {
    const before: number = movements.length;
    container.dispatchEvent(new Event('pointerdown')); focus();
    assert.equal(movements.length, before, 'pressed targets must not move');
    window.dispatchEvent(new Event(release)); focus();
    assert.equal(movements.length, before + 1);
  }
  const before = movements.length;
  target.modal = true; focus(); target.modal = false;
  target.top = 100; target.bottom = 120; focus();
  target.top = -30; target.bottom = -10; focus();
  target.top = 10; target.bottom = 30;
  boundary.children.add(target); focus(); boundary.children.clear();
  boundary.bottom = -1; focus(); boundary.bottom = 54;
  document.activeElement = new ElementStub(); focus();
  document.activeElement = null; focus(); document.activeElement = target;
  surface = null; focus(); surface = boundary;
  assert.equal(movements.length, before);
  guard.reveal(); assert.equal(movements.length, before + 1);
  guard.destroy(); focus(); assert.equal(movements.length, before + 1);
});
