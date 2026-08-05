import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRegistryCohortReport,
  formatRegistryCohortReport,
  MIN_REGISTRY_COHORT_SAMPLE,
} from '../cli/registry-cohort.mts';

const NOW = '2026-08-05T00:00:00.000Z';

function lookup(index: number, options: { domain?: string; selfLink?: boolean } = {}) {
  const domain = options.domain ?? `sample-${index}.dev`;
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW, mode: 'deep', type: 'domain', query: domain, registrableDomain: domain,
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    rdap: { parsed: {
      domain: domain.toUpperCase(), handle: `D-${index}`, objectClassName: 'domain', conformance: ['rdap_level_0'],
      links: options.selfLink === false ? [] : [{ rel: 'self', href: 'https://rdap.example.invalid/domain/example.test' }],
      events: [{ action: 'registration', date: '2020-01-01T00:00:00.000Z' }], lifecycle: { createdDateIso: '2020-01-01T00:00:00.000Z' },
    } },
    whois: { skipped: true },
  };
}

test('emits target-free registry quality cohorts after the fixed sample gate', () => {
  const inputs = Array.from({ length: MIN_REGISTRY_COHORT_SAMPLE }, (_, index) => lookup(index));
  const report = buildRegistryCohortReport(inputs.map((item) => JSON.stringify(item)).join('\n'), NOW);
  assert.equal(report.cohorts[0]?.state, 'consistent');
  assert.equal(report.cohorts[0]?.sampleCount, MIN_REGISTRY_COHORT_SAMPLE);
  assert.equal(report.cohorts[0]?.publication.selfLinksObserved, MIN_REGISTRY_COHORT_SAMPLE);
  assert.doesNotMatch(JSON.stringify(report), /sample-\d/u);
  assert.match(formatRegistryCohortReport(report), /Registry quality cohort/u);
});

test('keeps small cohorts explicitly insufficient and accepts a JSON array', () => {
  const report = buildRegistryCohortReport(JSON.stringify([lookup(1), lookup(2)]), NOW);
  assert.equal(report.cohorts[0]?.state, 'insufficient_sample');
});

test('rejects malformed and over-count inputs before aggregation', () => {
  assert.throws(() => buildRegistryCohortReport('{bad', NOW), /JSONL line 1/u);
  assert.throws(() => buildRegistryCohortReport(JSON.stringify([]), NOW), /from 1/u);
});
