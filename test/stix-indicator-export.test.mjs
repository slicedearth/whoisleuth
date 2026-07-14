import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStixIndicatorExport, MAX_STIX_INDICATORS } from '../frontend/src/lib/analysis/stix-indicator-export.js';

const NOW = '2026-07-14T08:00:00.000Z';

function result(domain, overrides = {}) {
  return {
    domain, availability: 'registered', risk: 80, trusted: null, status: 'complete',
    saved: { scanDepth: 'deep', riskModelVersion: 4, observedAt: '2026-07-14T07:59:00.000Z' },
    ...overrides,
  };
}

function ids() {
  let value = 0;
  return (type) => `${type}--00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

function exported(records, options = {}) {
  return buildStixIndicatorExport(records, { generatedAt: NOW, idFactory: ids(), ...options });
}

test('builds a STIX 2.1 bundle with separately attributed observation and inference', () => {
  const bundle = JSON.parse(exported([result('Candidate.Example')]).content);
  assert.equal(bundle.type, 'bundle');
  assert.match(bundle.id, /^bundle--/);
  assert.equal(bundle.objects.length, 5);
  const identity = bundle.objects.find((item) => item.type === 'identity');
  const domain = bundle.objects.find((item) => item.type === 'domain-name');
  const observation = bundle.objects.find((item) => item.type === 'observed-data');
  const indicator = bundle.objects.find((item) => item.type === 'indicator');
  const relationship = bundle.objects.find((item) => item.type === 'relationship');
  assert.equal(domain.value, 'candidate.example');
  assert.equal(identity.x_whoisleuth_export_version, 1);
  assert.equal(identity.x_whoisleuth_generated_at, NOW);
  assert.equal(observation.created_by_ref, identity.id);
  assert.equal(observation.x_whoisleuth_evidence_kind, 'direct-observation');
  assert.equal(observation.x_whoisleuth_source, 'bulk');
  assert.equal(indicator.x_whoisleuth_evidence_kind, 'heuristic-inference');
  assert.equal(relationship.relationship_type, 'based-on');
  assert.equal(relationship.source_ref, indicator.id);
  assert.equal(relationship.target_ref, observation.id);
});

test('retains bounded Risk provenance without claiming confidence or maliciousness', () => {
  const bundle = JSON.parse(exported([result('candidate.example')]).content);
  const indicator = bundle.objects.find((item) => item.type === 'indicator');
  assert.equal(indicator.x_whoisleuth_risk_score, 80);
  assert.equal(indicator.x_whoisleuth_risk_model_version, 4);
  assert.match(indicator.x_whoisleuth_false_positive_warning, /false positives/i);
  assert.equal('confidence' in indicator, false);
  assert.equal('indicator_types' in indicator, false);
  assert.doesNotMatch(JSON.stringify(bundle), /malicious|threat-actor|malware/i);
});

test('uses the scan timestamp when present and discloses its basis', () => {
  const observation = JSON.parse(exported([result('candidate.example')]).content).objects.find((item) => item.type === 'observed-data');
  assert.equal(observation.first_observed, '2026-07-14T07:59:00.000Z');
  assert.equal(observation.last_observed, '2026-07-14T07:59:00.000Z');
  assert.equal(observation.x_whoisleuth_observed_at_basis, 'scan');
});

test('falls back to export time and labels that weaker timestamp basis', () => {
  const observation = JSON.parse(exported([result('candidate.example', { saved: { scanDepth: 'fast' } })]).content).objects.find((item) => item.type === 'observed-data');
  assert.equal(observation.first_observed, NOW);
  assert.equal(observation.x_whoisleuth_observed_at_basis, 'export');
  assert.equal(observation.x_whoisleuth_scan_depth, 'fast');
});

test('uses canonical sorted domains and excludes ineligible or duplicate findings', () => {
  const output = exported([
    result('z.example'), result('A.example'), result('a.example'),
    result('safe.example', { trusted: 'official' }), result('low.example', { risk: 69 }),
  ]);
  assert.deepEqual(output.domains, ['a.example', 'z.example']);
  assert.equal(JSON.parse(output.content).objects.filter((item) => item.type === 'indicator').length, 2);
});

test('caps retained candidates and reports truncation', () => {
  const output = exported(Array.from({ length: MAX_STIX_INDICATORS + 1 }, (_, index) => result(`item-${index}.example`)));
  assert.equal(output.domains.length, MAX_STIX_INDICATORS);
  assert.equal(output.truncated, true);
  assert.equal(JSON.parse(output.content).objects.length, 1 + MAX_STIX_INDICATORS * 4);
});

test('empty exports remain valid bundles with producer provenance', () => {
  const output = exported([]);
  assert.deepEqual(output.domains, []);
  assert.equal(output.truncated, false);
  assert.deepEqual(JSON.parse(output.content).objects.map((item) => item.type), ['identity']);
});

test('rejects non-array input and malformed injected identifiers', () => {
  assert.throws(() => buildStixIndicatorExport({}, { generatedAt: NOW, idFactory: ids() }), /requires an array/);
  assert.throws(() => buildStixIndicatorExport([], { generatedAt: NOW, idFactory: () => 'bad-id' }), /invalid identity identifier/);
  assert.throws(() => buildStixIndicatorExport([result('one.example'), result('two.example')], {
    generatedAt: NOW,
    idFactory: (type) => `${type}--00000000-0000-4000-8000-000000000001`,
  }), /duplicate identifier/);
});

test('returns a safe STIX filename, media type, and canonical generation time', () => {
  const output = exported([result('candidate.example')]);
  assert.equal(output.filename, 'whoisleuth-defensive-domains-2026-07-14.stix.json');
  assert.equal(output.mimeType, 'application/stix+json;charset=utf-8');
  assert.equal(output.generatedAt, NOW);
  assert.ok(output.content.endsWith('\n'));
});
