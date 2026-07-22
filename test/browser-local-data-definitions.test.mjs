import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BROWSER_LOCAL_COLLECTIONS,
  SHORTLIST_COLLECTION,
  WATCHLISTS_COLLECTION,
} from '../frontend/src/lib/browser-local-data-definitions.ts';

const NOW = '2026-07-22T01:00:00.000Z';

function roundTrip(definition, document) {
  const normalized = definition.normalize(document);
  const before = definition.serialize(normalized);
  const joined = definition.normalize(definition.join(definition.split(normalized), definition.schemaVersion));
  return { before, after: definition.serialize(joined), joined };
}

describe('browser-local collection definitions', () => {
  test('every empty collection survives record splitting without changing its canonical document', () => {
    for (const definition of BROWSER_LOCAL_COLLECTIONS) {
      const result = roundTrip(definition, definition.empty());
      assert.equal(result.after, result.before, definition.id);
    }
  });

  test('shortlist records retain their semantic fields and canonical envelope', () => {
    const input = {
      schema: 'whoisleuth.shortlist',
      version: 2,
      entries: [{
        domain: 'priority.invalid',
        scanDepth: 'fast',
        availability: 'registered',
        riskModelVersion: 5,
        riskScore: 40,
        opportunityScore: 20,
        mutationTypes: ['omission'],
        savedAt: NOW,
      }],
    };
    const result = roundTrip(SHORTLIST_COLLECTION, input);
    assert.equal(result.after, result.before);
    assert.equal(result.joined.length, 1);
    assert.equal(result.joined[0].domain, 'priority.invalid');
    assert.deepEqual(SHORTLIST_COLLECTION.split(result.joined).map((record) => record.id), ['priority.invalid']);
  });

  test('watchlist names remain independent record identifiers', () => {
    const watchlist = (domain) => ({
      updatedAt: NOW,
      results: [{ domain, availability: 'registered', scanDepth: 'fast' }],
      baseline: [],
      history: [],
    });
    const input = {
      schema: 'whoisleuth.watchlists',
      version: 2,
      watchlists: {
        Priority: watchlist('priority.invalid'),
        Secondary: watchlist('secondary.invalid'),
      },
    };
    const result = roundTrip(WATCHLISTS_COLLECTION, input);
    assert.equal(result.after, result.before);
    assert.deepEqual(Object.keys(result.joined), ['Priority', 'Secondary']);
    assert.deepEqual(WATCHLISTS_COLLECTION.split(result.joined).map((record) => record.id), ['Priority', 'Secondary']);
  });
});
