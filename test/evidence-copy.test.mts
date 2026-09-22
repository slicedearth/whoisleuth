import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defangedIndicator, evidenceCitation } from '../frontend/src/lib/analysis/evidence-copy.ts';

test('indicator copying defangs display values without interpreting or following a URL', () => {
  assert.equal(defangedIndicator('login.example.test'), 'login[.]example[.]test');
  assert.equal(defangedIndicator('https://example.test/path?a=1'), 'hxxps://example[.]test/path?a=1');
  assert.equal(defangedIndicator('192.0.2.1'), '192[.]0[.]2[.]1');
  assert.equal(defangedIndicator('example[.]test'), 'example[.]test');
});

test('citations retain the supplied observation instant and never substitute review time', () => {
  assert.equal(evidenceCitation('Declared permission', 'Selected file', null), 'Declared permission\nSource: Selected file\nObserved: Time not supplied');
  assert.match(evidenceCitation('DNS', 'Retained observation', '2026-09-20T10:00:00+10:00'), /2026-09-20T10:00:00\+10:00$/u);
});
