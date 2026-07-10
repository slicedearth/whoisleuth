const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let filters;
before(async () => {
  filters = await import('../public/js/bulk-filters.js');
});

const records = [
  { domain: 'open.example', availability: 'available', mutationTypes: ['dictionary'] },
  {
    domain: 'login.example', availability: 'registered', mutationTypes: ['dictionary', 'keyboard_substitution'],
    faviconMatch: true, hasPasswordField: true,
  },
  { domain: 'sale.example', availability: 'for_sale', mutationTypes: ['unicode_homoglyph'] },
  { domain: 'failed.example', availability: 'error', mutationTypes: [] },
];

describe('bulk triage filters', () => {
  test('counts availability, high-risk, and error result families', () => {
    assert.deepEqual(filters.countBulkTriage(records), {
      all: 4,
      available: 1,
      registered: 2,
      high_risk: 1,
      errors: 1,
    });
  });

  test('combines state, mutation, and signal filters', () => {
    const selected = {
      state: 'high_risk',
      mutation: 'dictionary',
      signals: new Set(['favicon', 'password']),
    };
    assert.equal(filters.matchesBulkTriage(records[1], selected), true);
    assert.equal(filters.matchesBulkTriage(records[0], selected), false);
    assert.equal(filters.matchesBulkTriage(records[2], selected), false);
  });

  test('produces labelled mutation options only for present candidates', () => {
    const counts = new Map([
      ['dictionary', 2],
      ['keyboard_substitution', 1],
      ['unused', 0],
    ]);
    assert.deepEqual(filters.mutationTriageOptions(counts, {
      dictionary: 'Phishing dictionary',
      keyboard_substitution: 'Keyboard substitution',
    }), [
      { value: 'keyboard_substitution', label: 'Keyboard substitution', count: 1 },
      { value: 'dictionary', label: 'Phishing dictionary', count: 2 },
    ]);
  });
});
