import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRegistryDate } from '../frontend/src/lib/analysis/registry-date-explanation.ts';
import { MAX_LOOKUP_DISPLAY_VALUE_LENGTH } from '../frontend/src/lib/analysis/lookup-display-shared.ts';

test('date explanations preserve exact source text and a supplied offset conversion across the UTC date boundary', () => {
  const parsed = { lifecycle: { createdDate: '2024-03-14T01:00:00+10:00', createdDateIso: '2024-03-13T15:00:00.000Z' } };
  const before = structuredClone(parsed);
  const explanation = explainRegistryDate(parsed, 'createdDate', 'rdap', 'complete');
  assert.equal(explanation.variants[0]!.source.value, '2024-03-14T01:00:00+10:00');
  assert.equal(explanation.variants[0]!.companion.value, '2024-03-13T15:00:00.000Z');
  assert.equal(explanation.variants[0]!.calculated, '2024-03-13T15:00:00.000Z');
  assert.equal(explanation.variants[0]!.check, 'The current parser reproduces the supplied ISO companion.');
  assert.deepEqual(parsed, before);
  assert.match(explanation.rule, /earliest valid registration event/);
  assert.match(explanation.provenance, /does not identify a unique original RDAP event/);
});

test('legacy date-only WHOIS values keep their missing companion separate from the current calculation', () => {
  const explanation = explainRegistryDate({ createdDate: '03.04.2024' }, 'createdDate', 'whois', 'complete');
  assert.equal(explanation.variants[0]!.path, 'parsed.createdDate');
  assert.equal(explanation.variants[0]!.source.value, '03.04.2024');
  assert.equal(explanation.variants[0]!.companion.state, 'missing');
  assert.equal(explanation.variants[0]!.companion.value, null);
  assert.equal(explanation.variants[0]!.calculated, '2024-04-03T00:00:00.000Z');
  assert.match(explanation.variants[0]!.check, /current check only/);
  assert.match(explanation.provenance, /does not identify the selected WHOIS hop or line/);
});

test('invalid dates and supplied mismatches cannot appear as successful conversions', () => {
  for (const source of ['31.02.2024', 'not a date']) {
    const result = explainRegistryDate({ lifecycle: { expiryDate: source, expiryDateIso: '2024-03-01T00:00:00.000Z' } }, 'expiryDate', 'rdap', 'complete');
    assert.equal(result.variants[0]!.calculated, null);
    assert.equal(result.variants[0]!.source.value, source);
    assert.match(result.variants[0]!.check, /does not accept/);
  }
  const result = explainRegistryDate({ lifecycle: { updatedDate: '2024-03-14', updatedDateIso: '2024-03-15T00:00:00.000Z' } }, 'updatedDate', 'rdap', 'complete');
  assert.equal(result.variants[0]!.calculated, '2024-03-14T00:00:00.000Z');
  assert.match(result.variants[0]!.check, /differs/);
  assert.match(result.rule, /latest valid last changed event/);
});

test('WHOIS aliases are deduplicated only when both exact values agree', () => {
  const fields = { createdDate: '2024-03-14', createdDateIso: '2024-03-14T00:00:00.000Z' };
  const equal = explainRegistryDate({ ...fields, lifecycle: { ...fields } }, 'createdDate', 'whois', 'complete');
  assert.equal(equal.variants.length, 1); assert.equal(equal.aliasesDiffer, false);
  for (const changed of [{ ...fields, createdDate: '2024-03-15' }, { ...fields, createdDateIso: null }]) {
    const result = explainRegistryDate({ ...changed, lifecycle: fields }, 'createdDate', 'whois', 'complete');
    assert.equal(result.aliasesDiffer, true); assert.equal(result.variants.length, 2);
    assert.deepEqual(result.variants.map(value => value.path), ['parsed.lifecycle.createdDate', 'parsed.createdDate']);
  }
});

test('partial sources, truncated prefixes and omitted events retain independent qualifications', () => {
  const partial = explainRegistryDate({ createdDate: '2024-03-14', fieldsTruncated: ['createdDate'] }, 'createdDate', 'whois', 'partial');
  assert.match(partial.limitations.join(' '), /Publication state: partial/);
  assert.match(partial.limitations.join(' '), /retained prefix/);
  const rdap = explainRegistryDate({ lifecycle: {}, eventsTruncated: true, serverTruncated: true }, 'createdDate', 'rdap', 'partial');
  assert.match(rdap.limitations.join(' '), /server reported omitted data/);
  assert.match(rdap.limitations.join(' '), /event inventory contains omitted or rejected/);
});

test('publication failure states remain distinct from an absent date', () => {
  for (const state of ['not_collected', 'not_found', 'unsupported', 'skipped', 'disabled', 'rate_limited', 'error', 'unavailable'] as const) {
    const result = explainRegistryDate({}, 'createdDate', 'rdap', state);
    assert.equal(result.state, state);
    assert.equal(result.variants[0]!.source.state, 'missing');
    assert.match(result.limitations[0]!, new RegExp(state.replaceAll('_', ' ')));
  }
});

test('bounded scalar handling neither shortens values nor executes source accessors', () => {
  const oversized = '2'.repeat(MAX_LOOKUP_DISPLAY_VALUE_LENGTH + 1);
  const result = explainRegistryDate({ createdDate: oversized, createdDateIso: 42 }, 'createdDate', 'whois', 'complete');
  assert.equal(result.variants[0]!.source.state, 'oversized');
  assert.equal(result.variants[0]!.source.value, null);
  assert.equal(result.variants[0]!.companion.state, 'invalid');
  const source = Object.defineProperty({}, 'lifecycle', { get() { throw new Error('must not execute'); } });
  assert.equal(explainRegistryDate(source, 'createdDate', 'rdap', 'complete').variants[0]!.source.state, 'missing');
  assert.throws(() => explainRegistryDate({}, 'arbitraryField' as never, 'whois', 'complete'), /supported lifecycle date/);
});
