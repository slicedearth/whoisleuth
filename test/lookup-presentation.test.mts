import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES,
  normalizeLookupEvidenceDensity,
  normalizeLookupTaskView,
  prioritizeLookupSectionLinks,
  readLookupPresentation,
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
  assert.equal(normalizeLookupEvidenceDensity('summary'), 'summary');
  assert.equal(normalizeLookupEvidenceDensity('invalid'), 'summary');
  assert.equal(normalizeLookupTaskView('incident'), 'incident');
  assert.equal(normalizeLookupTaskView({}), 'general');
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
  writeLookupPresentation(storage, { density: 'full', task: 'brand' });
  assert.deepEqual(readLookupPresentation(storage), { density: 'full', task: 'brand' });

  stored = JSON.stringify({ version: 2, density: 'summary', task: 'owned' });
  assert.deepEqual(readLookupPresentation(storage), { density: 'summary', task: 'general' });

  stored = '{"broken"';
  assert.deepEqual(readLookupPresentation(storage), { density: 'summary', task: 'general' });

  stored = 'x'.repeat(MAX_LOOKUP_PRESENTATION_SERIALIZED_BYTES + 1);
  assert.deepEqual(readLookupPresentation(storage), { density: 'summary', task: 'general' });
});
