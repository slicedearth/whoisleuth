const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { fetchHomepage, deriveWebsiteActivity } = require('../lib/availability');

describe('website activity classification', () => {
  test('any HTTP response proves that a web service is active', async () => {
    for (const status of [401, 403, 404, 503]) {
      const result = await fetchHomepage('example.com', {
        fetcher: async () => new Response('not inspected', { status }),
      });
      assert.equal(result.status, 'responded');
      assert.match(result.detail, new RegExp(`HTTP ${status}`));
      assert.equal(deriveWebsiteActivity(result.status, false), 'active');
    }
  });

  test('a fetched favicon resolves an otherwise inconclusive homepage probe', () => {
    assert.equal(deriveWebsiteActivity('inconclusive', true), 'active');
    assert.equal(deriveWebsiteActivity('inconclusive', false), 'unreachable');
  });

  test('parking evidence remains stronger than generic HTTP activity', () => {
    assert.equal(deriveWebsiteActivity('fetched', true, true), 'parked');
  });
});
