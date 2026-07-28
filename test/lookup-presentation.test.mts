import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeLookupEvidenceDensity,
  normalizeLookupTaskView,
  prioritizeLookupSectionLinks,
  readLookupPresentation,
  writeLookupPresentation,
} from '../frontend/src/lib/analysis/lookup-presentation.ts';

const links = [
  { href: '#overview' as const, label: 'Overview' },
  { href: '#web-evidence' as const, label: 'Web & DNS' },
  { href: '#registry' as const, label: 'Registry' },
  { href: '#external-intelligence' as const, label: 'External intel' },
  { href: '#case-response' as const, label: 'Case & response' },
  { href: '#raw-data' as const, label: 'Raw data' },
];

test('normalizes persisted presentation settings to conservative defaults', () => {
  assert.equal(normalizeLookupEvidenceDensity('summary'), 'summary');
  assert.equal(normalizeLookupEvidenceDensity('invalid'), 'standard');
  assert.equal(normalizeLookupTaskView('incident'), 'incident');
  assert.equal(normalizeLookupTaskView({}), 'general');
});

test('prioritizes navigation without changing or removing the shared evidence links', () => {
  const acquisition = prioritizeLookupSectionLinks(links, 'acquisition');
  assert.deepEqual(acquisition.map((link) => link.href), [
    '#overview',
    '#registry',
    '#web-evidence',
    '#case-response',
    '#external-intelligence',
    '#raw-data',
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
  assert.deepEqual(readLookupPresentation(storage), { density: 'standard', task: 'general' });

  stored = '{"broken"';
  assert.deepEqual(readLookupPresentation(storage), { density: 'standard', task: 'general' });
});
