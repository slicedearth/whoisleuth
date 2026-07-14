import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertShortlistStoreBudget,
  buildShortlistExport,
  MAX_SHORTLIST_ENTRIES,
  MAX_SHORTLIST_INPUTS,
  mergeShortlistStores,
  normalizeShortlistRecord,
  normalizeShortlistStore,
  serializeShortlistStore,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
  shortlistStoreVersion,
} from '../frontend/src/lib/analysis/shortlist-model.js';

const NOW = '2026-07-14T08:00:00.000Z';

function record(domain = 'example.invalid', overrides = {}) {
  return {
    domain,
    scanDepth: 'deep',
    availability: 'registered',
    registrarName: 'Example Registrar',
    riskModelVersion: 5,
    riskScore: 72,
    opportunityScore: 41,
    mutationTypes: ['omission'],
    savedAt: NOW,
    ...overrides,
  };
}

test('normalizes known shortlist evidence and discards arbitrary imported fields', () => {
  const source = record(' EXAMPLE.INVALID ', {
    registrarName: 'R'.repeat(1000),
    riskScore: 101.4,
    opportunityScore: -8,
    riskFactors: [{ label: `Recent ${'x'.repeat(500)}`, points: 250 }, { label: 'bad\nlabel', points: 4 }],
    rawWhois: 'drop me',
  });
  const before = structuredClone(source);
  const normalized = normalizeShortlistRecord(source);
  assert.deepEqual(source, before);
  assert.equal(normalized.domain, 'example.invalid');
  assert.equal(normalized.riskScore, 100);
  assert.equal(normalized.opportunityScore, 0);
  assert.equal(normalized.registrarName.length, 300);
  assert.equal(normalized.riskFactors.length, 1);
  assert.equal(normalized.riskFactors[0].label.length, 200);
  assert.equal(normalized.riskFactors[0].points, 100);
  assert.equal(normalized.rawWhois, undefined);
});

test('legacy arrays remain readable and identify as schema version one', () => {
  const legacy = [record()];
  const store = normalizeShortlistStore(legacy);
  assert.equal(shortlistStoreVersion(legacy), 1);
  assert.equal(store.version, SHORTLIST_SCHEMA_VERSION);
  assert.equal(store.entries[0].domain, 'example.invalid');
});

test('versioned stores normalize, deduplicate, and retain the last bounded record', () => {
  const source = {
    schema: SHORTLIST_SCHEMA,
    version: SHORTLIST_SCHEMA_VERSION,
    entries: [record('repeat.invalid', { riskScore: 10 }), record('REPEAT.INVALID', { riskScore: 80 })],
  };
  const store = normalizeShortlistStore(source);
  assert.equal(shortlistStoreVersion(source), SHORTLIST_SCHEMA_VERSION);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].riskScore, 80);
});

test('store normalization bounds traversal and retained entries', () => {
  const source = Array.from({ length: MAX_SHORTLIST_INPUTS + 20 }, (_, index) => record(`item-${index}.invalid`));
  assert.equal(normalizeShortlistStore(source).entries.length, MAX_SHORTLIST_ENTRIES);
});

test('imports add, update, and disclose invalid and duplicate entries', () => {
  const result = mergeShortlistStores([record('local.invalid')], [
    record('local.invalid', { riskScore: 33 }),
    record('added.invalid'),
    record('ADDED.INVALID', { riskScore: 88 }),
    { domain: '' },
  ]);
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 1, updated: 1, skipped: 2 });
  assert.equal(result.entries.find((item) => item.domain === 'local.invalid').riskScore, 33);
  assert.equal(result.entries.find((item) => item.domain === 'added.invalid').riskScore, 88);
});

test('imports the current portable envelope without treating export metadata as evidence', () => {
  const portable = buildShortlistExport([record('portable.invalid')], NOW);
  const result = mergeShortlistStores([], portable);
  assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, { added: 1, updated: 0, skipped: 0 });
  assert.equal(result.entries[0].domain, 'portable.invalid');
  assert.equal(result.entries[0].exportedAt, undefined);
});

test('imports reject malformed and future structured exports', () => {
  assert.throws(() => mergeShortlistStores([], {}), /expected a shortlist export/i);
  assert.throws(() => mergeShortlistStores([], { schema: 'whoisleuth.cases', entries: [] }), /expected a shortlist export/i);
  assert.throws(() => mergeShortlistStores([], { schema: SHORTLIST_SCHEMA, version: 99, entries: [] }), /newer schema 99/i);
});

test('serialization produces a versioned envelope without mutating records', () => {
  const source = [record()];
  const before = structuredClone(source);
  const parsed = JSON.parse(serializeShortlistStore(source));
  assert.deepEqual(source, before);
  assert.equal(parsed.schema, SHORTLIST_SCHEMA);
  assert.equal(parsed.version, SHORTLIST_SCHEMA_VERSION);
  assert.equal(parsed.entries.length, 1);
});

test('oversized normalized shortlist evidence fails its UTF-8 budget', () => {
  const riskFactors = Array.from({ length: 20 }, (_, index) => ({ label: `${index}-${'x'.repeat(198)}`, points: index }));
  const records = Array.from({ length: MAX_SHORTLIST_ENTRIES }, (_, index) => record(`item-${index}.invalid`, {
    registrarName: 'R'.repeat(300),
    pageTitle: 'T'.repeat(200),
    phishingLanguageMatch: 'P'.repeat(200),
    riskFactors,
  }));
  assert.throws(() => assertShortlistStoreBudget(records), /Shortlist storage is full/);
});

test('portable exports carry schema identity and a deterministic timestamp', () => {
  const result = buildShortlistExport([record()], NOW);
  assert.equal(result.schema, SHORTLIST_SCHEMA);
  assert.equal(result.version, SHORTLIST_SCHEMA_VERSION);
  assert.equal(result.exportedAt, NOW);
  assert.equal(result.entries[0].domain, 'example.invalid');
});
