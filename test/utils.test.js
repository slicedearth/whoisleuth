// Covers public/js/utils.js's isValidEmailAddress - the guard outreach.js
// and abuse.js use before dropping a WHOIS/RDAP-sourced email into a
// mailto: URI. utils.js has no DOM dependency at import time (unlike
// outreach.js/abuse.js, which call document.addEventListener when loaded),
// so it can be imported directly here the same way scoring.test.js does.

const { test, describe, before } = require('node:test');
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
