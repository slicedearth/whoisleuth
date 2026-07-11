// Covers frontend/src/lib/analysis/utils.js's isValidEmailAddress - the guard outreach.js
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
  utils = await import('../frontend/src/lib/analysis/utils.js');
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

describe('parseDomainInput', () => {
  test('accepts newline, comma, semicolon, and tab-separated query lists', () => {
    assert.deepEqual(utils.parseDomainsFromText('one.example\ntwo.example'), ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainsFromText('one.example, two.example'), ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainsFromText('one.example; two.example'), ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainsFromText('one.example\ttwo.example'), ['one.example', 'two.example']);
  });

  test('reads a named domain column from comma, semicolon, or tabular CSV', () => {
    assert.deepEqual(
      utils.parseDomainsFromText('label,domain,notes\nFirst,one.example,"a, quoted note"\nSecond,two.example,ok'),
      ['one.example', 'two.example']
    );
    const parsed = utils.parseDomainInput('\uFEFFdomain;owner\none.example;Alice\ntwo.example;Bob');
    assert.deepEqual(parsed.entries, ['one.example', 'two.example']);
    assert.equal(parsed.usedHeader, true);
  });

  test('keeps column zero for a headerless domain-and-notes CSV', () => {
    assert.deepEqual(
      utils.parseDomainsFromText('one.example,customer one\ntwo.example,customer two'),
      ['one.example', 'two.example']
    );
  });

  test('retains invalid cells in a one-line pasted list so the scan can report them', () => {
    assert.deepEqual(
      utils.parseDomainsFromText('one.example,not a domain,two.example'),
      ['one.example', 'not a domain', 'two.example']
    );
  });

  test('deduplicates case-insensitively and reports the removed count', () => {
    const parsed = utils.parseDomainInput('One.Example\none.example\ntwo.example');
    assert.deepEqual(parsed.entries, ['One.Example', 'two.example']);
    assert.equal(parsed.duplicates, 1);
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

describe('hammingDistanceHex', () => {
  test('is zero for identical hashes and counts differing bits', () => {
    assert.equal(utils.hammingDistanceHex('0123456789abcdef', '0123456789abcdef'), 0);
    assert.equal(utils.hammingDistanceHex('0000000000000000', '000000000000000f'), 4);
    assert.equal(utils.hammingDistanceHex('0000000000000000', 'ffffffffffffffff'), 64);
  });

  test('returns null for malformed hashes', () => {
    assert.equal(utils.hammingDistanceHex('short', '0123456789abcdef'), null);
    assert.equal(utils.hammingDistanceHex('0123456789abcdeg', '0123456789abcdef'), null);
    assert.equal(utils.hammingDistanceHex(null, '0123456789abcdef'), null);
  });
});

describe('isInformativeFaviconHash', () => {
  test('accepts hashes with a balanced bit population', () => {
    assert.equal(utils.isInformativeFaviconHash('f0e08e86868ccce8'), true); // 28 bits
    assert.equal(utils.isInformativeFaviconHash('0010387068706000'), true); // 15 bits
  });

  test('rejects degenerate (near-all-zero / near-all-one) hashes', () => {
    assert.equal(utils.isInformativeFaviconHash('0000000000000000'), false);
    assert.equal(utils.isInformativeFaviconHash('ffffffffffffffff'), false);
    assert.equal(utils.isInformativeFaviconHash('0000000000000007'), false); // 3 bits
  });

  test('rejects malformed input', () => {
    assert.equal(utils.isInformativeFaviconHash('nothex'), false);
    assert.equal(utils.isInformativeFaviconHash(null), false);
  });
});

describe('groupBySimilarFavicon', () => {
  const near = 'f0e08e86868ccce8';
  const near2 = 'f0e08e86868cccea'; // 1 bit from `near`
  const far = '0000000000000000';

  test('groups perceptual near-duplicates within the distance threshold', () => {
    const groups = utils.groupBySimilarFavicon([
      { domain: 'a.example', faviconPHash: near },
      { domain: 'b.example', faviconPHash: near2 },
      { domain: 'c.example', faviconPHash: far },
    ], 6);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].sort(), ['a.example', 'b.example']);
  });

  test('groups byte-identical icons even when perceptually undecodable (null phash)', () => {
    const groups = utils.groupBySimilarFavicon([
      { domain: 'a.example', faviconHash: 'sha-gif-1', faviconPHash: null },
      { domain: 'b.example', faviconHash: 'sha-gif-1', faviconPHash: null },
      { domain: 'c.example', faviconHash: 'sha-gif-2', faviconPHash: null },
    ], 6);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].sort(), ['a.example', 'b.example']);
  });

  test('unions transitively across exact and perceptual links', () => {
    // a~b by perceptual distance, b~c by exact hash => one group of three.
    const groups = utils.groupBySimilarFavicon([
      { domain: 'a.example', faviconPHash: near },
      { domain: 'b.example', faviconHash: 'h1', faviconPHash: near2 },
      { domain: 'c.example', faviconHash: 'h1' },
    ], 6);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].sort(), ['a.example', 'b.example', 'c.example']);
  });

  test('drops singletons and ignores records with no favicon at all', () => {
    const groups = utils.groupBySimilarFavicon([
      { domain: 'a.example', faviconPHash: near },
      { domain: 'lonely.example', faviconPHash: far },
      { domain: 'nofavicon.example' },
    ], 6);
    assert.deepEqual(groups, []);
  });

  test('does not cluster on degenerate (all-zero) perceptual hashes', () => {
    // Two unrelated solid/monotonic favicons both hash to all-zeros. With
    // different exact hashes they must NOT be grouped - this guards stored
    // degenerate hashes from earlier scans.
    const groups = utils.groupBySimilarFavicon([
      { domain: 'a.example', faviconHash: 'exact-a', faviconPHash: '0000000000000000' },
      { domain: 'b.example', faviconHash: 'exact-b', faviconPHash: '0000000000000000' },
    ], 6);
    assert.deepEqual(groups, []);
  });
});
