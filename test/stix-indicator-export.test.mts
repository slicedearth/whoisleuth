import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStixIndicatorExport, MAX_STIX_INDICATORS } from '../frontend/src/lib/analysis/stix-indicator-export.ts';

const NOW = '2026-07-14T08:00:00.000Z';

type StixObject = Record<string, unknown>;
type StixBundle = { type: string; id: string; objects: StixObject[] };

function result(domain: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain, availability: 'registered', risk: 80, trusted: null, status: 'complete',
    profileContext: {
      sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '',
    },
    saved: { scanDepth: 'deep', riskModelVersion: 4, observedAt: '2026-07-14T07:59:00.000Z' },
    ...overrides,
  };
}

function ids() {
  let value = 0;
  return (type: string) => `${type}--00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
}

function exported(records: unknown[], options: Record<string, unknown> = {}) {
  return buildStixIndicatorExport(records, { generatedAt: NOW, idFactory: ids(), ...options });
}

function bundleFrom(content: string): StixBundle {
  const bundle = JSON.parse(content) as unknown;
  assert.ok(bundle && typeof bundle === 'object' && !Array.isArray(bundle));
  const value = bundle as Record<string, unknown>;
  assert.equal(typeof value.type, 'string');
  assert.equal(typeof value.id, 'string');
  assert.ok(Array.isArray(value.objects));
  return value as StixBundle;
}

function objectByType(bundle: StixBundle, type: string): StixObject {
  const value = bundle.objects.find((item) => item.type === type);
  assert.ok(value, `Missing STIX ${type} object`);
  return value;
}

test('builds a STIX 2.1 bundle with separately attributed observation and inference', () => {
  const bundle = bundleFrom(exported([result('Candidate.Example')]).content);
  assert.equal(bundle.type, 'bundle');
  assert.match(bundle.id, /^bundle--/);
  assert.equal(bundle.objects.length, 5);
  const identity = objectByType(bundle, 'identity');
  const domain = objectByType(bundle, 'domain-name');
  const observation = objectByType(bundle, 'observed-data');
  const indicator = objectByType(bundle, 'indicator');
  const relationship = objectByType(bundle, 'relationship');
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
  const bundle = bundleFrom(exported([result('candidate.example')]).content);
  const indicator = objectByType(bundle, 'indicator');
  assert.equal(indicator.x_whoisleuth_risk_score, 80);
  assert.equal(indicator.x_whoisleuth_risk_model_version, 4);
  const warning = indicator.x_whoisleuth_false_positive_warning;
  assert.ok(typeof warning === 'string');
  assert.match(warning, /false positives/i);
  assert.equal('confidence' in indicator, false);
  assert.equal('indicator_types' in indicator, false);
  assert.doesNotMatch(JSON.stringify(bundle), /malicious|threat-actor|malware/i);
});

test('uses the scan timestamp when present and discloses its basis', () => {
  const observation = objectByType(bundleFrom(exported([result('candidate.example')]).content), 'observed-data');
  assert.equal(observation.first_observed, '2026-07-14T07:59:00.000Z');
  assert.equal(observation.last_observed, '2026-07-14T07:59:00.000Z');
  assert.equal(observation.x_whoisleuth_observed_at_basis, 'scan');
});

test('falls back to export time and labels that weaker timestamp basis', () => {
  const observation = objectByType(
    bundleFrom(exported([result('candidate.example', { saved: { scanDepth: 'fast' } })]).content),
    'observed-data',
  );
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
  assert.equal(bundleFrom(output.content).objects.filter((item) => item.type === 'indicator').length, 2);
});

test('caps retained candidates and reports truncation', () => {
  const output = exported(Array.from({ length: MAX_STIX_INDICATORS + 1 }, (_, index) => result(`item-${index}.example`)));
  assert.equal(output.domains.length, MAX_STIX_INDICATORS);
  assert.equal(output.truncated, true);
  assert.equal(bundleFrom(output.content).objects.length, 1 + MAX_STIX_INDICATORS * 4);
});

test('empty exports remain valid bundles with producer provenance', () => {
  const output = exported([]);
  assert.deepEqual(output.domains, []);
  assert.equal(output.truncated, false);
  assert.deepEqual(bundleFrom(output.content).objects.map((item) => item.type), ['identity']);
});

test('rejects non-array input and malformed injected identifiers', () => {
  assert.throws(() => buildStixIndicatorExport({}, { generatedAt: NOW, idFactory: ids() }), /requires an array/);
  assert.throws(() => buildStixIndicatorExport([], { generatedAt: NOW, idFactory: () => 'bad-id' }), /invalid identity identifier/);
  assert.throws(() => buildStixIndicatorExport([result('one.example'), result('two.example')], {
    generatedAt: NOW,
    idFactory: (type: string) => `${type}--00000000-0000-4000-8000-000000000001`,
  }), /duplicate identifier/);
});

test('returns a safe STIX filename, media type, and canonical generation time', () => {
  const output = exported([result('candidate.example')]);
  assert.equal(output.filename, 'whoisleuth-defensive-domains-2026-07-14.stix.json');
  assert.equal(output.mimeType, 'application/stix+json;charset=utf-8');
  assert.equal(output.generatedAt, NOW);
  assert.ok(output.content.endsWith('\n'));
});
