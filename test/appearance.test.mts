import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPEARANCE_CHANGE_EVENT, APPEARANCE_STORAGE_KEY, applyAppearancePreference,
  observeAppearancePreference, parseAppearancePreference, readAppearancePreference,
  serialiseAppearancePreference, setAppearancePreference,
} from '../frontend/src/lib/appearance.ts';

test('appearance accepts four bounded preferences and rejects arbitrary retained values', () => {
  for (const density of ['comfortable', 'compact'] as const) {
    for (const effects of ['full', 'minimal'] as const) {
      assert.deepEqual(parseAppearancePreference(`${density}:${effects}`), { density, effects });
      assert.equal(serialiseAppearancePreference({ density, effects }), `${density}:${effects}`);
    }
  }
  for (const value of [null, undefined, {}, [], 'compact', 'COMPACT:minimal', 'x'.repeat(100_000)]) {
    assert.deepEqual(parseAppearancePreference(value), { density: 'comfortable', effects: 'full' });
  }
  assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full' });
  applyAppearancePreference({ density: 'compact', effects: 'minimal' });
  assert.equal(setAppearancePreference({ density: 'compact', effects: 'minimal' }), false);
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
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full' });
    assert.equal(setAppearancePreference({ density: 'compact', effects: 'minimal' }), true);
    assert.equal(values.get(APPEARANCE_STORAGE_KEY), 'compact:minimal');
    assert.deepEqual(dataset, { density: 'compact', effects: 'minimal' });
    assert.deepEqual(readAppearancePreference(), dataset);
    blocked = true;
    assert.equal(setAppearancePreference({ density: 'comfortable', effects: 'minimal' }), false);
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'minimal' });
    const storageEvent = (key: string | null, newValue: string | null) => {
      window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
    };
    storageEvent('unrelated', 'compact:full');
    assert.equal(observed.length, 2);
    storageEvent(APPEARANCE_STORAGE_KEY, 'compact:full');
    assert.deepEqual(dataset, { density: 'compact', effects: 'full' });
    storageEvent(null, null);
    assert.deepEqual(dataset, { density: 'comfortable', effects: 'full' });
    stop();
    window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: 'compact:minimal' }));
    assert.equal(observed.length, 4);
    blocked = false;
    values.clear();
    assert.deepEqual(readAppearancePreference(), { density: 'comfortable', effects: 'full' });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
