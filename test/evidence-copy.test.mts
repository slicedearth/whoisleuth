import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defangedIndicator, evidenceCitation, evidenceFactCitation } from '../frontend/src/lib/analysis/evidence-copy.ts';

test('indicator copying defangs display values without interpreting or following a URL', () => {
  assert.equal(defangedIndicator('login.example.test'), 'login[.]example[.]test');
  assert.equal(defangedIndicator('https://example.test/path?a=1'), 'hxxps://example[.]test/path?a=1');
  assert.equal(defangedIndicator('192.0.2.1'), '192[.]0[.]2[.]1');
  assert.equal(defangedIndicator('example[.]test'), 'example[.]test');
});

test('fact citations preserve provenance and contradictory completeness without copying surrounding data', () => {
  const fact = { label: 'MX observation', value: 'mail.example.test', source: 'Selected DNS response', observedAt: null, completeness: 'complete', truncated: true,
    sourceState: 'partial', observationHostname: 'example.test', limitations: ['One source timed out.'], privateNote: 'private-sentinel' };
  assert.equal(evidenceFactCitation(fact), 'MX observation\nValue: mail.example.test\nSource: Selected DNS response\nObservation hostname: example.test\nObserved: Time not supplied\nCompleteness: partial (truncated)\nSource state: partial\nLimitation: One source timed out.');
  assert.ok(!evidenceFactCitation(fact).includes('private-sentinel'));
  assert.match(evidenceFactCitation({ ...fact, truncated: false, completeness: 'unknown', value: null }), /Value: Unavailable/u);
});

test('citations retain the supplied observation instant and never substitute review time', () => {
  assert.equal(evidenceCitation('Declared permission', 'Selected file', null), 'Declared permission\nSource: Selected file\nObserved: Time not supplied');
  assert.match(evidenceCitation('DNS', 'Retained observation', '2026-09-20T10:00:00+10:00'), /2026-09-20T10:00:00\+10:00$/u);
});
