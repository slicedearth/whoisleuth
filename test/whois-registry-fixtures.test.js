'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseWhoisChain } = require('../lib/whois');
const fixtures = require('../fixtures/whois-registry-fixtures');

describe('WHOIS registry compatibility fixtures', () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const parsed = parseWhoisChain(fixture.chain);
      for (const [field, expected] of Object.entries(fixture.expected)) {
        assert.deepEqual(parsed[field], expected, `${fixture.name}: ${field}`);
      }
    });
  }
});
