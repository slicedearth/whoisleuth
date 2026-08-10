import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LOOKUP_URL_QUERY_LENGTH,
  MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES,
  lookupResultDepth,
  normalizeLookupTaskView,
  parseLookupTaskContext,
  prioritizeLookupSectionLinks,
  readLookupPresentation,
  reconcileLookupUrlState,
  writeLookupPresentation,
} from '../frontend/src/lib/analysis/lookup-presentation.ts';

const links = [
  { href: '#overview' as const, label: 'Overview' },
  { href: '#registry' as const, label: 'Registration' },
  { href: '#web-evidence' as const, label: 'Web & DNS' },
  { href: '#relationships-history' as const, label: 'Relationships & history' },
  { href: '#source-quality' as const, label: 'Source quality' },
  { href: '#case-response' as const, label: 'Case & response' },
  { href: '#advanced-evidence' as const, label: 'External & raw' },
];

test('normalizes persisted presentation settings to conservative defaults', () => {
  assert.equal(normalizeLookupTaskView('incident'), 'incident');
  assert.equal(normalizeLookupTaskView({}), 'general');
});

test('accepts only exact allowlisted transient task contexts', () => {
  for (const task of ['general', 'acquisition', 'brand', 'incident', 'owned']) {
    assert.equal(parseLookupTaskContext(task), task);
  }
  for (const value of [null, undefined, {}, ' Acquisition', 'acquisition ', 'ACQUISITION', 'unknown', 'x'.repeat(17)]) {
    assert.equal(parseLookupTaskContext(value), null);
  }
});

test('reconciles bounded URL context without relabelling retained evidence', () => {
  const result = { id: 'retained-fast-result' };
  const current = {
    query: 'retained.example.test',
    depth: 'deep' as const,
    task: 'brand' as const,
    result,
    completedTarget: 'retained.example.test',
    error: 'Retained error',
    retainedResultDepth: 'fast' as const,
  };

  const conflictingDepth = reconcileLookupUrlState(current, new URLSearchParams('depth=deep'), 'brand');
  assert.equal(conflictingDepth.depth, 'deep');
  assert.equal(conflictingDepth.result, null);
  assert.equal(conflictingDepth.completedTarget, '');
  assert.equal(conflictingDepth.error, '');

  const conflictingTarget = reconcileLookupUrlState(current, new URLSearchParams('q=next.example.test'), 'brand');
  assert.equal(conflictingTarget.query, 'next.example.test');
  assert.equal(conflictingTarget.result, null);
  assert.equal(conflictingTarget.completedTarget, '');
  assert.equal(conflictingTarget.error, '');

  const matching = reconcileLookupUrlState(
    { ...current, depth: 'fast', retainedResultDepth: 'fast' },
    new URLSearchParams('q=retained.example.test&depth=fast&task=acquisition'),
    'brand',
  );
  assert.equal(matching.result, result);
  assert.equal(matching.task, 'acquisition');
});

test('ignores invalid q and depth while removing stale transient task context', () => {
  const result = { id: 'retained-result' };
  const current = {
    query: 'retained.example.test',
    depth: 'fast' as const,
    task: 'acquisition' as const,
    result,
    completedTarget: 'retained.example.test',
    error: 'Retained error',
    retainedResultDepth: 'fast' as const,
  };
  for (const query of ['', '%00invalid', encodeURIComponent('x'.repeat(MAX_LOOKUP_URL_QUERY_LENGTH + 1))]) {
    const next = reconcileLookupUrlState(current, new URLSearchParams(`q=${query}&depth=DEEP&task=ACQUISITION`), 'brand');
    assert.equal(next.query, current.query);
    assert.equal(next.depth, 'fast');
    assert.equal(next.result, result);
    assert.equal(next.error, 'Retained error');
    assert.equal(next.task, 'brand');
  }
  const canonical = reconcileLookupUrlState(current, new URLSearchParams(), 'owned');
  assert.equal(canonical.task, 'owned');
  assert.equal(canonical.depth, 'fast');
  assert.equal(canonical.result, result);
});

test('recognises retained Fast evidence for generic targets without domain availability fields', () => {
  for (const type of ['ipv4', 'asn']) {
    assert.equal(lookupResultDepth({
      type,
      availability: { applicable: false, type },
      whois: { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' },
    }, 'deep'), 'fast');
  }
  assert.equal(lookupResultDepth({
    type: 'ipv4',
    availability: { applicable: false, type: 'ipv4' },
    reverseDns: { scanMode: 'deep' },
  }, 'fast'), 'deep');
});

test('prioritizes navigation without changing or removing the shared evidence links', () => {
  const acquisition = prioritizeLookupSectionLinks(links, 'acquisition');
  assert.deepEqual(acquisition.map((link) => link.href), [
    '#overview',
    '#registry',
    '#relationships-history',
    '#web-evidence',
    '#source-quality',
    '#case-response',
    '#advanced-evidence',
  ]);
  assert.deepEqual(new Set(acquisition), new Set(links));
  assert.notEqual(acquisition, links);
});

test('reads and writes a bounded versioned browser presentation preference', () => {
  let stored = '';
  const storage = {
    getItem: () => stored || null,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  writeLookupPresentation(storage, { task: 'brand' });
  assert.deepEqual(readLookupPresentation(storage), { task: 'brand' });

  stored = JSON.stringify({ version: 1, density: 'full', task: 'incident' });
  assert.deepEqual(readLookupPresentation(storage), { task: 'incident' });

  stored = JSON.stringify({ version: 2, density: 'summary', task: 'owned' });
  assert.deepEqual(readLookupPresentation(storage), { task: 'general' });

  stored = '{"broken"';
  assert.deepEqual(readLookupPresentation(storage), { task: 'general' });

  stored = 'x'.repeat(MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES + 1);
  assert.deepEqual(readLookupPresentation(storage), { task: 'general' });
});
