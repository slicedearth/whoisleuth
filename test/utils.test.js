// Covers the browser-safe analysis helpers consumed by the Svelte tools.

const { test, describe, before } = require('node:test');
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

describe('entityDisplayName', () => {
  test('normalizes registrar strings and structured entities consistently', () => {
    assert.equal(utils.entityDisplayName(' Example Registrar LLC '), 'Example Registrar LLC');
    assert.equal(utils.entityDisplayName({ name: 'Example Registrar LLC', org: 'Fallback Org', handle: 'REG-1' }), 'Example Registrar LLC');
    assert.equal(utils.entityDisplayName({ name: '', org: 'Fallback Org', handle: 'REG-1' }), 'Fallback Org');
    assert.equal(utils.entityDisplayName({ name: '', org: '', handle: 'REG-1' }), 'REG-1');
  });

  test('bounds and sanitizes display values without stringifying arbitrary objects', () => {
    assert.equal(utils.entityDisplayName({ name: 'Example\u0000 Registrar\n LLC' }), 'Example Registrar LLC');
    assert.equal(utils.entityDisplayName({ unknown: 'value' }), null);
    assert.equal(utils.entityDisplayName([]), null);
    assert.equal(utils.entityDisplayName('x'.repeat(400)).length, 300);
  });
});

describe('parseDomainInput', () => {
  test('accepts newline, comma, semicolon, and tab-separated query lists', () => {
    assert.deepEqual(utils.parseDomainInput('one.example\ntwo.example').entries, ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainInput('one.example, two.example').entries, ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainInput('one.example; two.example').entries, ['one.example', 'two.example']);
    assert.deepEqual(utils.parseDomainInput('one.example\ttwo.example').entries, ['one.example', 'two.example']);
  });

  test('reads a named domain column from comma, semicolon, or tabular CSV', () => {
    assert.deepEqual(
      utils.parseDomainInput('label,domain,notes\nFirst,one.example,"a, quoted note"\nSecond,two.example,ok').entries,
      ['one.example', 'two.example']
    );
    const parsed = utils.parseDomainInput('\uFEFFdomain;owner\none.example;Alice\ntwo.example;Bob');
    assert.deepEqual(parsed.entries, ['one.example', 'two.example']);
    assert.equal(parsed.usedHeader, true);
  });

  test('keeps column zero for a headerless domain-and-notes CSV', () => {
    assert.deepEqual(
      utils.parseDomainInput('one.example,customer one\ntwo.example,customer two').entries,
      ['one.example', 'two.example']
    );
  });

  test('retains invalid cells in a one-line pasted list so the scan can report them', () => {
    assert.deepEqual(
      utils.parseDomainInput('one.example,not a domain,two.example').entries,
      ['one.example', 'not a domain', 'two.example']
    );
  });

  test('deduplicates case-insensitively and reports the removed count', () => {
    const parsed = utils.parseDomainInput('One.Example\none.example\ntwo.example');
    assert.deepEqual(parsed.entries, ['One.Example', 'two.example']);
    assert.equal(parsed.duplicates, 1);
  });
});

describe('rowsToCsv', () => {
  test('neutralizes spreadsheet formulas in every exported cell', () => {
    assert.equal(
      utils.rowsToCsv([
        ['domain', 'registrar'],
        ['example.com', '=HYPERLINK("https://evil.example")'],
        ['example.net', '  @SUM(1,2)'],
      ]),
      'domain,registrar\nexample.com,"\'=HYPERLINK(""https://evil.example"")"\nexample.net,"\'  @SUM(1,2)"'
    );
  });

  test('quotes delimiters and preserves ordinary scalar values', () => {
    assert.equal(utils.rowsToCsv([['one,two', 3, null]]), '"one,two",3,');
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
