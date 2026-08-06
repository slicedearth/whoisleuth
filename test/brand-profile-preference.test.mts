import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_PROFILE_KEY,
  activeProfileId,
  setActiveProfile,
} from '../frontend/src/lib/brand-profiles.ts';

type ProfilePreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function withLocalStorage(storage: ProfilePreferenceStorage, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function memoryStorage(initial: string | null): ProfilePreferenceStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(ACTIVE_PROFILE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

test('active profile preference accepts only bounded profile identifiers', () => {
  withLocalStorage(memoryStorage('profile_1-accepted'), () => {
    assert.equal(activeProfileId(), 'profile_1-accepted');
  });
  const storage = memoryStorage('x'.repeat(129));
  withLocalStorage(storage, () => {
    assert.equal(activeProfileId(), '');
    assert.throws(() => setActiveProfile('../invalid'), /identifier is invalid/u);
    assert.equal(storage.values.get(ACTIVE_PROFILE_KEY), 'x'.repeat(129));
    setActiveProfile('profile_2-valid');
    assert.equal(storage.values.get(ACTIVE_PROFILE_KEY), 'profile_2-valid');
    setActiveProfile('');
    assert.equal(storage.values.has(ACTIVE_PROFILE_KEY), false);
  });
});

test('active profile preference fails closed when browser storage is unavailable', () => {
  withLocalStorage({
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  }, () => {
    assert.equal(activeProfileId(), '');
    assert.throws(() => setActiveProfile('profile_3-valid'), /storage may be full or unavailable/u);
  });
});
