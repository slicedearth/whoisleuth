'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRdap } = require('../lib/rdap');
const fixtures = require('../fixtures/rdap-registry-fixtures');

function observed(parsed, key) {
  if (key === 'registrarHandle') return parsed.registrar?.handle || null;
  if (key === 'registrantHandle') return parsed.registrant?.handle || null;
  if (key === 'orgHandle') return parsed.org?.handle || null;
  if (key === 'abuseHandle') return parsed.abuse?.handle || null;
  if (key === 'relatedLink') return parsed.links.find((link) => link.rel === 'related')?.href || null;
  if (key === 'createdDate') return parsed.lifecycle?.createdDate || null;
  if (key === 'updatedDate') return parsed.lifecycle?.updatedDate || null;
  return parsed[key];
}

describe('RDAP registry compatibility fixtures', () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const parsed = parseRdap(fixture.type, fixture.input);
      assert.ok(parsed, `${fixture.name}: parsed result`);
      for (const [key, expected] of Object.entries(fixture.expected)) {
        assert.deepEqual(observed(parsed, key), expected, `${fixture.name}: ${key}`);
      }
    });
  }
});
