import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWatchBrandNames, watchContextBrandDisplay } from '../frontend/src/lib/analysis/watchlist-context-labels.ts';
import { MAX_PROFILES } from '../packages/contracts/workspace-portability.mts';

test('readable names are keyed by exact retained Brand identity', () => {
  const names = buildWatchBrandNames([{ id: 'first-brand', name: 'First Brand' }, { id: 'second-brand', name: 'Second Brand' }], 'ready');
  assert.deepEqual(watchContextBrandDisplay('first-brand', names), { label: 'Brand First Brand', description: 'Exact Brand identifier: first-brand' });
  assert.deepEqual(watchContextBrandDisplay('second-brand', names), { label: 'Brand Second Brand', description: 'Exact Brand identifier: second-brand' });
  assert.match(watchContextBrandDisplay('FIRST-BRAND', names).label, /name unavailable/);
});

test('missing or unreadable profile names remain explicit and distinct without blocking context review', () => {
  const profiles = [{ id: 'first-brand', name: 'First Brand' }];
  for (const state of ['loading', 'unavailable'] as const) {
    const names = buildWatchBrandNames(profiles, state);
    assert.equal(names.size, 0);
    assert.equal(watchContextBrandDisplay('first-brand', names).label, 'Brand name unavailable (first-brand)');
    assert.equal(watchContextBrandDisplay('second-brand', names).label, 'Brand name unavailable (second-brand)');
  }
  assert.deepEqual(watchContextBrandDisplay(null, new Map()), { label: 'Watchlist-only context', description: 'No Brand identifier is assigned to this context.' });
});

test('ambiguous exact identities never select an arbitrary profile name', () => {
  for (const profiles of [[{ id: 'same-id', name: 'First Brand' }, { id: 'same-id', name: 'Second Brand' }], [{ id: 'same-id', name: 'Second Brand' }, { id: 'same-id', name: 'First Brand' }]]) {
    assert.equal(buildWatchBrandNames(profiles, 'ready').has('same-id'), false);
  }
  assert.equal(buildWatchBrandNames([{ id: 'same-id', name: 'First Brand' }, { id: 'same-id', name: 'First Brand' }], 'ready').get('same-id'), 'First Brand');
});

test('presentation name admission stays within the existing profile bound', () => {
  const profiles = Array.from({ length: MAX_PROFILES + 1 }, (_, index) => ({ id: `brand-${index}`, name: `Example Brand ${index}` }));
  const names = buildWatchBrandNames(profiles, 'ready');
  assert.equal(names.size, MAX_PROFILES);
  assert.equal(names.has(`brand-${MAX_PROFILES}`), false);
  assert.equal(profiles.length, MAX_PROFILES + 1);
});
