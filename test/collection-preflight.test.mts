import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBulkCollectionPreflight,
  buildGuidedCollectionPreflight,
  buildLookupCollectionPreflight,
  COLLECTION_PREFLIGHT_VERSION,
} from '../frontend/src/lib/analysis/collection-preflight.ts';

test('describes fast and deep Lookup collection without promising an exact request count', () => {
  const fast = buildLookupCollectionPreflight({ mode: 'fast', targetCount: 1 });
  const deep = buildLookupCollectionPreflight({
    mode: 'deep',
    targetCount: 1,
    includeSecurityTxt: true,
    includeExternalIntelligence: true,
    disabledSourceIds: ['website_probe'],
  });
  assert.equal(fast.version, COLLECTION_PREFLIGHT_VERSION);
  assert.deepEqual(fast.sources.map((source) => source.id), ['availability', 'rdap']);
  assert.equal(deep.sources.find((source) => source.id === 'security_txt')?.state, 'included');
  assert.equal(deep.sources.find((source) => source.id === 'external_intelligence')?.state, 'included');
  assert.equal(deep.sources.find((source) => source.id === 'website_probe')?.state, 'disabled');
  assert.match(deep.cautions.join(' '), /exact request count cannot be known/i);
});

test('keeps optional Lookup sources optional and explains multi-target handoff', () => {
  const preflight = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 4 });
  assert.match(preflight.summary, /handed to Bulk/i);
  assert.equal(preflight.sources.find((source) => source.id === 'security_txt')?.state, 'optional');
  assert.equal(preflight.sources.find((source) => source.id === 'external_intelligence')?.state, 'optional');
});

test('distinguishes compact Bulk collection and bounds operator-facing values', () => {
  const preflight = buildBulkCollectionPreflight({
    mode: 'deep',
    targetCount: 99_999,
    concurrency: 99,
    pacingLabel: 'Respectful pacing',
    disabledSourceIds: ['tls_intelligence'],
  });
  assert.equal(preflight.targetCount, 2_000);
  assert.match(preflight.controls[0] ?? '', /at most 12 lookups run in parallel/i);
  assert.match(preflight.cautions.join(' '), /compact triage contract/i);
  assert.equal(preflight.sources.find((source) => source.id === 'tls_intelligence')?.state, 'disabled');
});

test('guided request review preserves approval and prerequisite boundaries', () => {
  const preflight = buildGuidedCollectionPreflight({
    label: 'Deep Lookup',
    requestImpact: 'May contact registry and website sources.',
    prerequisite: 'Confirm authority for active collection.',
    requiresApproval: true,
    approved: false,
  });
  assert.equal(preflight.kind, 'guided');
  assert.match(preflight.controls[0] ?? '', /does not start until/i);
  assert.match(preflight.cautions[0] ?? '', /confirm authority/i);
  assert.match(preflight.persistence, /records progress locally/i);
});
