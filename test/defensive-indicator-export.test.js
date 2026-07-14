import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefensiveIndicatorExport,
  isDefensiveIndicatorCandidate,
  MAX_DEFENSIVE_INDICATOR_INPUTS,
  MAX_DEFENSIVE_INDICATORS,
} from '../frontend/src/lib/analysis/defensive-indicator-export.js';

const NOW = '2026-07-14T08:00:00.000Z';

function result(domain, overrides = {}) {
  return { domain, availability: 'registered', risk: 80, trusted: null, status: 'complete', ...overrides };
}

test('candidate eligibility requires a high-risk, registered, untrusted domain', () => {
  assert.equal(isDefensiveIndicatorCandidate(result('candidate.invalid')), true);
  assert.equal(isDefensiveIndicatorCandidate(result('candidate.invalid', { risk: 69 })), false);
  assert.equal(isDefensiveIndicatorCandidate(result('candidate.invalid', { availability: 'available' })), false);
  assert.equal(isDefensiveIndicatorCandidate(result('candidate.invalid', { trusted: 'official' })), false);
  assert.equal(isDefensiveIndicatorCandidate(result('candidate.invalid', { status: 'error' })), false);
  assert.equal(isDefensiveIndicatorCandidate(result('not a domain')), false);
});

test('domain-list export is deterministic, deduplicated, and warns about false positives', () => {
  const exported = buildDefensiveIndicatorExport([
    result('Z.invalid'), result('a.invalid'), result('A.INVALID'), result('safe.invalid', { trusted: 'allowlisted' }),
  ], { generatedAt: NOW });
  assert.equal(exported.format, 'domains');
  assert.deepEqual(exported.domains, ['a.invalid', 'z.invalid']);
  assert.match(exported.content, /Review before use\. Heuristic findings can include false positives\./);
  assert.match(exported.content, /\na\.invalid\nz\.invalid\n$/);
  assert.equal(exported.filename, 'whoisleuth-defensive-domains-2026-07-14.txt');
});

test('hosts format emits inert local sink mappings', () => {
  const exported = buildDefensiveIndicatorExport([result('candidate.invalid')], { format: 'hosts', generatedAt: NOW });
  assert.match(exported.content, /0\.0\.0\.0 candidate\.invalid\n$/);
  assert.doesNotMatch(exported.content, /https?:\/\//);
});

test('dnsmasq format emits one bounded address rule per domain', () => {
  const exported = buildDefensiveIndicatorExport([result('candidate.invalid')], { format: 'dnsmasq', generatedAt: NOW });
  assert.match(exported.content, /address=\/candidate\.invalid\/0\.0\.0\.0\n$/);
});

test('RPZ format uses absolute owners, wildcard coverage, and a valid 32-bit serial', () => {
  const exported = buildDefensiveIndicatorExport([result('candidate.invalid')], { format: 'rpz', generatedAt: NOW });
  assert.match(exported.content, /@ IN SOA localhost\. root\.localhost\. \((\d+) 60 60 60 60\)/);
  const serial = Number(exported.content.match(/\((\d+) 60/)?.[1]);
  assert.ok(Number.isSafeInteger(serial) && serial >= 0 && serial <= 0xffffffff);
  assert.match(exported.content, /candidate\.invalid\. CNAME \./);
  assert.match(exported.content, /\*\.candidate\.invalid\. CNAME \./);
  assert.equal(exported.filename, 'whoisleuth-defensive-domains-2026-07-14.zone');
});

test('riskScore is accepted as the stored-score field when risk is absent', () => {
  const exported = buildDefensiveIndicatorExport([{ domain: 'stored.invalid', availability: 'registered', riskScore: 70 }], { generatedAt: NOW });
  assert.deepEqual(exported.domains, ['stored.invalid']);
});

test('invalid format and timestamp inputs fall back without entering output text', () => {
  const exported = buildDefensiveIndicatorExport([result('candidate.invalid')], { format: 'not-real', generatedAt: 'bad\nvalue' });
  assert.equal(exported.format, 'domains');
  assert.doesNotMatch(exported.content, /bad\nvalue/);
  assert.ok(Number.isFinite(Date.parse(exported.generatedAt)));
});

test('input traversal and retained output are bounded with explicit truncation', () => {
  const records = Array.from({ length: MAX_DEFENSIVE_INDICATOR_INPUTS + 1 }, (_, index) => result(`item-${index}.invalid`));
  const exported = buildDefensiveIndicatorExport(records, { generatedAt: NOW });
  assert.equal(exported.domains.length, MAX_DEFENSIVE_INDICATORS);
  assert.equal(exported.truncated, true);
});

test('empty exports remain reviewable and syntactically complete', () => {
  const exported = buildDefensiveIndicatorExport([], { format: 'hosts', generatedAt: NOW });
  assert.deepEqual(exported.domains, []);
  assert.match(exported.content, /0 high-risk registered domains/);
  assert.ok(exported.content.endsWith('\n'));
});

test('rejects non-array input rather than traversing arbitrary objects', () => {
  assert.throws(() => buildDefensiveIndicatorExport({}), /requires an array/);
});
