// Covers public/js/utils.js's isValidEmailAddress - the guard outreach.js
// and abuse.js use before dropping a WHOIS/RDAP-sourced email into a
// mailto: URI - and createLocalStore, the localStorage wrapper shared by
// shortlist.js/watchlist.js/brand-profiles.js. utils.js has no DOM
// dependency at import time (unlike outreach.js/abuse.js, which call
// document.addEventListener when loaded), so it can be imported directly
// here the same way scoring.test.js does. createLocalStore does touch
// `localStorage` at call time (not import time), so a minimal in-memory
// stand-in is installed on `global.localStorage` before those tests run -
// Node's test environment has no browser storage API otherwise.

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let utils;
before(async () => {
  utils = await import('../public/js/utils.js');
});

describe('isValidEmailAddress', () => {
  test('accepts an ordinary single address', () => {
    assert.equal(utils.isValidEmailAddress('registrant@example.com'), true);
    assert.equal(utils.isValidEmailAddress('abuse@sub.example.co.uk'), true);
  });

  test('rejects a comma-separated address list (mailto: additional-recipient injection)', () => {
    assert.equal(utils.isValidEmailAddress('victim@example.com,attacker@evil.com'), false);
  });

  test('rejects an embedded mailto: query string (header/param injection)', () => {
    assert.equal(utils.isValidEmailAddress('victim@example.com?bcc=attacker@evil.com'), false);
    assert.equal(utils.isValidEmailAddress('victim@example.com&subject=x'), false);
  });

  test('rejects embedded whitespace/control characters', () => {
    assert.equal(utils.isValidEmailAddress('victim@example.com\nBcc: attacker@evil.com'), false);
    assert.equal(utils.isValidEmailAddress('victim @example.com'), false);
  });

  test('rejects non-address strings and non-string values', () => {
    assert.equal(utils.isValidEmailAddress('REDACTED FOR PRIVACY'), false);
    assert.equal(utils.isValidEmailAddress(''), false);
    assert.equal(utils.isValidEmailAddress(null), false);
    assert.equal(utils.isValidEmailAddress(undefined), false);
  });
});

function makeFakeLocalStorage() {
  const backing = new Map();
  return {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
    _backing: backing,
  };
}

describe('createLocalStore', () => {
  beforeEach(() => {
    global.localStorage = makeFakeLocalStorage();
  });

  test('load() returns the default value (a fresh copy) when the key is unset', () => {
    const store = utils.createLocalStore('test-key', []);
    const a = store.load();
    const b = store.load();
    assert.deepEqual(a, []);
    assert.notEqual(a, b); // distinct instances - mutating one must not affect the other
  });

  test('save() then load() round-trips a value', () => {
    const store = utils.createLocalStore('test-key', []);
    store.save([{ domain: 'example.com' }]);
    assert.deepEqual(store.load(), [{ domain: 'example.com' }]);
  });

  test('an object default (watchlist.js\'s shape) round-trips correctly', () => {
    const store = utils.createLocalStore('test-key', {});
    assert.deepEqual(store.load(), {});
    store.save({ myWatchlist: { updatedAt: '2026-01-01', results: [] } });
    assert.deepEqual(store.load(), { myWatchlist: { updatedAt: '2026-01-01', results: [] } });
  });

  test('load() falls back to the default when the stored value is corrupted JSON', () => {
    global.localStorage.setItem('test-key', '{not valid json');
    const store = utils.createLocalStore('test-key', []);
    assert.deepEqual(store.load(), []);
  });

  test('separate keys do not collide', () => {
    const storeA = utils.createLocalStore('key-a', []);
    const storeB = utils.createLocalStore('key-b', []);
    storeA.save(['a']);
    assert.deepEqual(storeA.load(), ['a']);
    assert.deepEqual(storeB.load(), []);
  });
});
