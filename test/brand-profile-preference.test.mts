import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_PROFILE_KEY,
  activeProfileId,
  setActiveProfile,
} from '../frontend/src/lib/brand-profiles.ts';
import {
  parseProfileList,
  profileDomainKind,
  profileSignals,
  type BrandProfileSignalProfile,
} from '../frontend/src/lib/analysis/brand-profile-signals.ts';
import { MAX_PROFILE_VALUES } from '../frontend/src/lib/analysis/brand-profile-model.ts';

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
    assert.throws(() => activeProfileId(), /Could not read the active-profile preference/u);
    assert.throws(() => setActiveProfile('profile_3-valid'), /storage may be full or unavailable/u);
  });
});

test('normalizes explicit profile domain roles without treating unrelated domains as trusted', () => {
  const profile: BrandProfileSignalProfile = {
    officialDomains: ['Official.Example.'],
    approvedPartnerDomains: ['partner.example'],
    allowlistedDomains: ['allowed.example.'],
    officialFaviconHash: 'sha256:fixture',
    officialFaviconPHash: '0f0f0f0f0f0f0f0f',
  };
  assert.equal(profileDomainKind(' official.example ', profile), 'official');
  assert.equal(profileDomainKind('PARTNER.EXAMPLE.', profile), 'partner');
  assert.equal(profileDomainKind('allowed.example', profile), 'allowlisted');
  assert.equal(profileDomainKind('unrelated.example', profile), null);
  assert.equal(profileDomainKind('', profile), null);
  assert.equal(profileDomainKind('official.example', null), null);
});

test('keeps exact, perceptual, and reused-asset profile signals independently explainable', () => {
  const profile: BrandProfileSignalProfile = {
    officialDomains: ['assets.example'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    officialFaviconHash: 'sha256:fixture',
    officialFaviconPHash: '0f0f0f0f0f0f0f0f',
  };
  assert.deepEqual(profileSignals('candidate.example', {
    faviconHash: 'sha256:fixture',
    faviconPHash: '0f0f0f0f0f0f0f0e',
    externalAssetHosts: ['ASSETS.EXAMPLE.'],
  }, profile), {
    trusted: null,
    faviconMatch: true,
    faviconNearMatch: false,
    reusesOfficialAssets: true,
  });
  assert.deepEqual(profileSignals('candidate.example', {
    faviconHash: 'sha256:other',
    faviconPHash: '0f0f0f0f0f0f0f0e',
    externalAssetHosts: 'not-an-array',
  }, profile), {
    trusted: null,
    faviconMatch: false,
    faviconNearMatch: true,
    reusesOfficialAssets: false,
  });
  assert.deepEqual(profileSignals('assets.example', {}, profile), {
    trusted: 'official',
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
  });
  assert.deepEqual(profileSignals('candidate.example', {}, null), {
    trusted: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
  });
});

test('parses bounded profile lists with stable deduplication and optional casing', () => {
  assert.deepEqual(parseProfileList(' One,Two\none\n, THREE ', true), ['one', 'two', 'three']);
  assert.deepEqual(parseProfileList(' One,one ', false), ['One', 'one']);
  assert.equal(
    parseProfileList(Array.from({ length: MAX_PROFILE_VALUES + 3 }, (_, index) => `value-${index}`).join(',')).length,
    MAX_PROFILE_VALUES,
  );
});
