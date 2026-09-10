import assert from 'node:assert/strict';
import test from 'node:test';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import {
  buildCaseSightingStixExport,
} from '../frontend/src/lib/analysis/case-sighting-stix-export.ts';

const NOW = '2026-07-31T00:00:00.000Z';

function ids() {
  let counter = 1;
  return (type: string) => `${type}--00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
}

function record() {
  return createCase({
    domain: 'example.test',
    sighting: {
      state: 'observed_by_deployment',
      category: 'website',
      source: 'Deep lookup',
      observedAt: NOW,
      completeness: 'partial',
      limitations: ['Static page evidence does not execute JavaScript.'],
    },
  }, NOW);
}

test('exports affirmative sightings as separately attributed STIX observations and notes', () => {
  const exported = buildCaseSightingStixExport(record(), {
    generatedAt: NOW,
    idFactory: ids(),
  });
  const bundle = JSON.parse(exported.content) as { objects: Array<Record<string, unknown>> };
  assert.equal(exported.sightingCount, 1);
  assert.ok(bundle.objects.some((item) => item.type === 'domain-name' && item.value === 'example.test'));
  assert.ok(bundle.objects.some((item) => item.type === 'observed-data'
    && item.x_whoisleuth_source_qualified_state === 'observed_by_deployment'));
  assert.ok(bundle.objects.some((item) => item.type === 'note'
    && item.x_whoisleuth_completeness === 'partial'));
  assert.equal(bundle.objects.some((item) => Object.hasOwn(item, 'x_whoisleuth_evidence_pin_id')), false);
});

test('keeps not-reproduced states as notes rather than negative observations', () => {
  const current = record();
  current.sightings = [{
    ...current.sightings[0]!,
    state: 'not_reproduced',
    sourceClass: 'analyst',
  }];
  const exported = buildCaseSightingStixExport(current, {
    generatedAt: NOW,
    idFactory: ids(),
  });
  const bundle = JSON.parse(exported.content) as { objects: Array<Record<string, unknown>> };
  assert.equal(bundle.objects.some((item) => item.type === 'observed-data'), false);
  assert.ok(bundle.objects.some((item) => item.type === 'note'
    && item.x_whoisleuth_source_qualified_state === 'not_reproduced'));
});

test('retains every undated sighting as a source-qualified note without invented observation times', () => {
  const current = record();
  current.sightings = [null, '', '2026-07-31', '2026-02-30T00:00:00Z'].map((observedAt, index) => ({
    ...current.sightings[0]!, id: `undated-${index}`, observedAt,
  }));
  const exported = buildCaseSightingStixExport(current, { generatedAt: NOW, idFactory: ids() });
  const bundle = JSON.parse(exported.content) as { objects: Array<Record<string, unknown>> };
  const notes = bundle.objects.filter((item) => item.type === 'note');
  assert.equal(exported.sightingCount, 4);
  assert.equal(exported.truncated, false);
  assert.equal(notes.length, 4);
  assert.equal(bundle.objects.some((item) => item.type === 'observed-data'), false);
  for (const note of notes) {
    assert.equal(Object.hasOwn(note, 'x_whoisleuth_observed_at'), false);
    assert.match(String(note.content), /Observation time is unavailable/);
    assert.equal(note.x_whoisleuth_source, 'Deep lookup');
  }
});

test('fails closed for empty sightings, invalid domains, and invalid identifiers', () => {
  const empty = record();
  empty.sightings = [];
  assert.throws(() => buildCaseSightingStixExport(empty), /at least one/u);

  const invalid = record();
  invalid.domain = 'not a domain';
  assert.throws(() => buildCaseSightingStixExport(invalid), /valid canonical/u);
  assert.throws(
    () => buildCaseSightingStixExport(record(), { generatedAt: NOW, idFactory: () => 'bad' }),
    /invalid identity identifier/u,
  );
});
