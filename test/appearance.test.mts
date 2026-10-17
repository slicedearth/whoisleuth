import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPEARANCE_CHANGE_EVENT, APPEARANCE_STORAGE_KEY, applyAppearancePreference,
  observeAppearancePreference, parseAppearancePreference, readAppearancePreference,
  serialiseAppearancePreference, setAppearancePreference,
} from '../frontend/src/lib/appearance.ts';

test('appearance preserves legacy choices and admits only explicit terminal variants', () => {
  for (const density of ['comfortable', 'compact'] as const) {
    for (const effects of ['full', 'minimal'] as const) {
      for (const consoleStyle of ['desk', 'terminal'] as const) {
        const stored = `${density}:${effects}${consoleStyle === 'terminal' ? ':terminal' : ''}`;
        assert.deepEqual(parseAppearancePreference(stored), { density, effects, consoleStyle });
        assert.equal(serialiseAppearancePreference({ density, effects, consoleStyle }), stored);
      }
    }
  }
  for (const value of [null, undefined, {}, [], 'compact', 'COMPACT:minimal', 'compact:full:unknown', 'compact:full:terminal\n', 'x'.repeat(100_000)]) {
    assert.deepEqual(parseAppearancePreference(value), { density: 'comfortable', effects: 'full', consoleStyle: 'desk' });
  }
  assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full', consoleStyle: 'desk' });
  applyAppearancePreference({ density: 'compact', effects: 'minimal', consoleStyle: 'terminal' });
  assert.equal(setAppearancePreference({ density: 'compact', effects: 'minimal', consoleStyle: 'terminal' }), false);
  observeAppearancePreference(() => assert.fail('No browser event is available.'))();
});

test('appearance synchronises tabs, recovers unavailable storage and removes event subscriptions', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const values = new Map<string, string>();
  const dataset: Record<string, string> = {};
  let blocked = false;
  const window = Object.assign(new EventTarget(), { localStorage: {
    getItem(key: string) { if (blocked) throw new Error('unavailable'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error('unavailable'); values.set(key, value); },
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset } } });
  try {
    const observed: string[] = [];
    const stop = observeAppearancePreference(value => observed.push(serialiseAppearancePreference(value)));
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full', consoleStyle: 'desk' });
    assert.equal(setAppearancePreference({ density: 'compact', effects: 'minimal', consoleStyle: 'terminal' }), true);
    assert.equal(values.get(APPEARANCE_STORAGE_KEY), 'compact:minimal:terminal');
    assert.deepEqual(dataset, { density: 'compact', effects: 'minimal', consoleStyle: 'terminal' });
    assert.deepEqual(readAppearancePreference(), dataset);
    blocked = true;
    assert.equal(setAppearancePreference({ density: 'comfortable', effects: 'minimal', consoleStyle: 'terminal' }), false);
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'minimal', consoleStyle: 'terminal' });
    const storageEvent = (key: string | null, newValue: string | null) => {
      window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
    };
    storageEvent('unrelated', 'compact:full');
    assert.equal(observed.length, 2);
    storageEvent(APPEARANCE_STORAGE_KEY, 'compact:full');
    assert.deepEqual(dataset, { density: 'compact', effects: 'full', consoleStyle: 'desk' });
    storageEvent(APPEARANCE_STORAGE_KEY, 'comfortable:full:terminal');
    assert.deepEqual(dataset, { density: 'comfortable', effects: 'full', consoleStyle: 'terminal' });
    storageEvent(null, null);
    assert.deepEqual(dataset, { density: 'comfortable', effects: 'full', consoleStyle: 'desk' });
    stop();
    window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: 'compact:minimal' }));
    assert.equal(observed.length, 5);
    blocked = false;
    values.clear();
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full', consoleStyle: 'desk' });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
