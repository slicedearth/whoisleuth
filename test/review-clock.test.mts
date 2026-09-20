import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test, { type TestContext } from 'node:test';
import { reviewClock } from '../frontend/src/lib/review-clock.ts';

function browserClock(context: TestContext) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const intervals = new Map<number, { callback: () => void; delay: number }>();
  const subscriptions = new Set<() => void>();
  let nextInterval = 0;
  let now = 1_000;
  const window = Object.assign(new EventTarget(), {
    setInterval(callback: () => void, delay: number) {
      const id = ++nextInterval;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id: number) { intervals.delete(id); },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  context.mock.method(Date, 'now', () => now);
  context.after(() => {
    for (const stop of subscriptions) stop();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return {
    window, document, intervals,
    setTime(value: number) { now = value; },
    tick() { for (const interval of intervals.values()) interval.callback(); },
    subscribe(values: number[]) {
      const stop = reviewClock.subscribe(value => values.push(value));
      subscriptions.add(stop);
      return () => { subscriptions.delete(stop); stop(); };
    },
  };
}

test('review clock refreshes each server-side subscription without browser resources', (context) => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  let now = 1_000;
  context.mock.method(Date, 'now', () => now);
  const observed: number[] = [];
  const first = reviewClock.subscribe(value => observed.push(value));
  first();
  now = 61_000;
  const second = reviewClock.subscribe(value => observed.push(value));
  second();
  assert.deepEqual(observed, [1_000, 61_000]);
});

test('review views share one clock and refresh on visible ticks, return and focus', (context) => {
  const clock = browserClock(context);
  const first: number[] = [];
  const second: number[] = [];
  clock.subscribe(first);
  clock.subscribe(second);
  assert.deepEqual(first, [1_000]);
  assert.deepEqual(second, [1_000]);
  assert.equal(clock.intervals.size, 1);
  assert.equal([...clock.intervals.values()][0]?.delay, 60_000);
  assert.equal(getEventListeners(clock.document, 'visibilitychange').length, 1);
  assert.equal(getEventListeners(clock.window, 'focus').length, 1);

  clock.setTime(61_000);
  clock.tick();
  assert.deepEqual(first, [1_000, 61_000]);
  assert.deepEqual(second, first);
  clock.document.visibilityState = 'hidden';
  clock.setTime(121_000);
  clock.tick();
  clock.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(first, [1_000, 61_000]);
  assert.deepEqual(second, first);

  clock.document.visibilityState = 'visible';
  clock.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(first, [1_000, 61_000, 121_000]);
  clock.setTime(131_000);
  clock.window.dispatchEvent(new Event('focus'));
  assert.deepEqual(first, [1_000, 61_000, 121_000, 131_000]);
  assert.deepEqual(second, first);
});

test('review clock releases resources only after its last view and restarts fresh', (context) => {
  const clock = browserClock(context);
  const first: number[] = [];
  const second: number[] = [];
  const stopFirst = clock.subscribe(first);
  const stopSecond = clock.subscribe(second);
  stopFirst();
  assert.equal(clock.intervals.size, 1);
  clock.setTime(61_000);
  clock.tick();
  assert.deepEqual(first, [1_000]);
  assert.deepEqual(second, [1_000, 61_000]);

  stopSecond();
  assert.equal(clock.intervals.size, 0);
  assert.equal(getEventListeners(clock.document, 'visibilitychange').length, 0);
  assert.equal(getEventListeners(clock.window, 'focus').length, 0);
  clock.setTime(121_000);
  clock.window.dispatchEvent(new Event('focus'));
  clock.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(second, [1_000, 61_000]);

  const restarted: number[] = [];
  const stopRestarted = clock.subscribe(restarted);
  assert.deepEqual(restarted, [121_000]);
  assert.equal(clock.intervals.size, 1);
  assert.equal(getEventListeners(clock.document, 'visibilitychange').length, 1);
  assert.equal(getEventListeners(clock.window, 'focus').length, 1);
  stopRestarted();
  assert.equal(clock.intervals.size, 0);
  assert.equal(getEventListeners(clock.document, 'visibilitychange').length, 0);
  assert.equal(getEventListeners(clock.window, 'focus').length, 0);
});
