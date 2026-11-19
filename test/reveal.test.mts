import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { revealOnScroll } from '../frontend/src/lib/reveal.ts';

interface Environment {
  observerSupported?: boolean;
  reducedMotion?: boolean;
  effects?: string;
}

function installEnvironment(context: TestContext, { observerSupported = true, reducedMotion = false, effects }: Environment = {}) {
  const observers: ObserverStub[] = [];
  class ObserverStub {
    observed: unknown[] = [];
    disconnected = false;
    callback: (entries: Array<{ isIntersecting: boolean }>) => void;
    options: IntersectionObserverInit;
    constructor(callback: ObserverStub['callback'], options: IntersectionObserverInit) {
      this.callback = callback;
      this.options = options;
      observers.push(this);
    }
    observe(node: unknown) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  }
  const globals: Record<string, unknown> = {
    IntersectionObserver: observerSupported ? ObserverStub : undefined,
    window: { innerHeight: 800, matchMedia: (query: string) => ({ matches: reducedMotion && query.includes('reduce') }) },
    document: { documentElement: { dataset: effects ? { effects } : {} } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => { if (before) Object.defineProperty(globalThis, key, before); else Reflect.deleteProperty(globalThis, key); });
  }
  return observers;
}

function section(top: number) {
  const classes = new Set<string>();
  const node = {
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    getBoundingClientRect: () => ({ top }),
  };
  return { node: node as unknown as HTMLElement, classes };
}

test('scroll reveal leaves content visible whenever it cannot or should not animate', (context) => {
  for (const environment of [{ observerSupported: false }, { reducedMotion: true }, { effects: 'minimal' }]) {
    const observers = installEnvironment(context, environment);
    const { node, classes } = section(1200);
    assert.equal(revealOnScroll(node), undefined, JSON.stringify(environment));
    assert.equal(classes.size, 0);
    assert.equal(observers.length, 0);
  }
  const observers = installEnvironment(context);
  const onScreen = section(120);
  assert.equal(revealOnScroll(onScreen.node), undefined, 'a section already in view at mount never hides');
  assert.equal(onScreen.classes.size, 0);
  assert.equal(observers.length, 0);
});

test('scroll reveal waits for intersection once and restores content on teardown', (context) => {
  const observers = installEnvironment(context);
  const { node, classes } = section(1200);
  const action = revealOnScroll(node);
  assert.ok(action);
  assert.deepEqual([...classes], ['reveal-pending']);
  const [observer] = observers;
  assert.deepEqual(observer!.observed, [node]);
  assert.equal(observer!.options.rootMargin, '0px 0px -8% 0px');

  observer!.callback([{ isIntersecting: false }]);
  assert.deepEqual([...classes], ['reveal-pending'], 'a non-intersecting entry keeps the section waiting');
  assert.equal(observer!.disconnected, false);
  observer!.callback([{ isIntersecting: false }, { isIntersecting: true }]);
  assert.deepEqual([...classes], ['reveal-in']);
  assert.equal(observer!.disconnected, true);

  const waiting = section(1600);
  const pending = revealOnScroll(waiting.node);
  assert.deepEqual([...waiting.classes], ['reveal-pending']);
  pending!.destroy();
  assert.equal(waiting.classes.size, 0, 'teardown never leaves a section hidden');
  assert.equal(observers[1]!.disconnected, true);
});
