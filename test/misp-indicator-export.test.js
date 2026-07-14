import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMispIndicatorExport, MAX_MISP_ATTRIBUTES } from '../frontend/src/lib/analysis/misp-indicator-export.js';

const NOW = '2026-07-14T08:00:00.000Z';

function result(domain, overrides = {}) {
  return {
    domain, availability: 'registered', risk: 80, trusted: null, status: 'complete',
    saved: { scanDepth: 'deep', riskModelVersion: 4, observedAt: '2026-07-14T07:59:00.000Z' },
    ...overrides,
  };
}

function uuids() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

function exported(records, options = {}) {
  return buildMispIndicatorExport(records, { generatedAt: NOW, uuidFactory: uuids(), ...options });
}

test('builds an unpublished organization-only MISP event for analyst review', () => {
  const event = JSON.parse(exported([result('Candidate.Example')]).content).Event;
  assert.equal(event.date, '2026-07-14');
  assert.equal(event.published, false);
  assert.equal(event.distribution, '0');
  assert.equal(event.analysis, '0');
  assert.equal(event.threat_level_id, '4');
  assert.equal(event.disable_correlation, true);
  assert.match(event.info, /analyst review \(export v1\)$/);
  assert.equal(event.Attribute.length, 1);
});

test('emits non-IDS non-correlating domain attributes with inherited distribution', () => {
  const attribute = JSON.parse(exported([result('candidate.example')]).content).Event.Attribute[0];
  assert.equal(attribute.type, 'domain');
  assert.equal(attribute.category, 'Network activity');
  assert.equal(attribute.value, 'candidate.example');
  assert.equal(attribute.to_ids, false);
  assert.equal(attribute.disable_correlation, true);
  assert.equal(attribute.distribution, '5');
  assert.equal(attribute.deleted, false);
});

test('keeps Risk metadata heuristic and warns about false positives', () => {
  const attribute = JSON.parse(exported([result('candidate.example')]).content).Event.Attribute[0];
  assert.match(attribute.comment, /^Heuristic Bulk finding;/);
  assert.match(attribute.comment, /risk=80/);
  assert.match(attribute.comment, /risk-model=v4/);
  assert.match(attribute.comment, /scan-depth=deep/);
  assert.match(attribute.comment, /false positives are possible/);
  assert.doesNotMatch(JSON.stringify(attribute), /confirmed|malicious|confidence/i);
});

test('preserves scan observation time and its provenance basis', () => {
  const attribute = JSON.parse(exported([result('candidate.example')]).content).Event.Attribute[0];
  assert.equal(attribute.first_seen, '2026-07-14T07:59:00.000Z');
  assert.equal(attribute.last_seen, '2026-07-14T07:59:00.000Z');
  assert.match(attribute.comment, /timestamp-basis=scan/);
});

test('uses export time only when no scan observation timestamp is available', () => {
  const attribute = JSON.parse(exported([result('candidate.example', { saved: { scanDepth: 'fast' } })]).content).Event.Attribute[0];
  assert.equal(attribute.first_seen, NOW);
  assert.match(attribute.comment, /timestamp-basis=export/);
  assert.match(attribute.comment, /scan-depth=fast/);
});

test('canonicalizes, sorts, deduplicates, and excludes ineligible results', () => {
  const output = exported([
    result('z.example'), result('A.example'), result('a.example'),
    result('trusted.example', { trusted: 'official' }), result('low.example', { risk: 69 }),
  ]);
  assert.deepEqual(output.domains, ['a.example', 'z.example']);
  assert.deepEqual(JSON.parse(output.content).Event.Attribute.map((item) => item.value), ['a.example', 'z.example']);
});

test('caps attributes and reports truncation', () => {
  const output = exported(Array.from({ length: MAX_MISP_ATTRIBUTES + 1 }, (_, index) => result(`item-${index}.example`)));
  assert.equal(output.domains.length, MAX_MISP_ATTRIBUTES);
  assert.equal(output.truncated, true);
  assert.equal(JSON.parse(output.content).Event.Attribute.length, MAX_MISP_ATTRIBUTES);
});

test('empty exports retain a valid review event without attributes', () => {
  const output = exported([]);
  assert.deepEqual(output.domains, []);
  assert.deepEqual(JSON.parse(output.content).Event.Attribute, []);
});

test('rejects non-array input and invalid or duplicate UUIDs', () => {
  assert.throws(() => buildMispIndicatorExport({}, { generatedAt: NOW, uuidFactory: uuids() }), /requires an array/);
  assert.throws(() => buildMispIndicatorExport([], { generatedAt: NOW, uuidFactory: () => 'bad' }), /invalid UUID/);
  assert.throws(() => buildMispIndicatorExport([result('candidate.example')], {
    generatedAt: NOW,
    uuidFactory: () => '00000000-0000-4000-8000-000000000001',
  }), /duplicate UUID/);
});

test('returns a bounded local JSON download contract', () => {
  const output = exported([result('candidate.example')]);
  assert.equal(output.version, 1);
  assert.equal(output.filename, 'whoisleuth-defensive-domains-2026-07-14.misp.json');
  assert.equal(output.mimeType, 'application/json;charset=utf-8');
  assert.equal(output.generatedAt, NOW);
  assert.ok(output.content.endsWith('\n'));
});
