import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { reviewSelectedServiceContext } from '../packages/relationships/selected-service-context.mts';
import { SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA, SELECTED_SERVICE_CONTEXT_VERSION } from '../packages/contracts/selected-service-context.mts';
import { runCli } from '../cli/runner.mts';

const at = '2026-11-01T00:00:00.000Z';
const input = (type = 'hostname', list: string[] = ['example.test', '.tenant.example.test']) => ({
  schema: SELECTED_SERVICE_CONTEXT_INPUT_SCHEMA, version: SELECTED_SERVICE_CONTEXT_VERSION,
  role: 'shared_service', targets: ['EXAMPLE.TEST.', 'child.example.test', 'tenant.example.test', 'a.tenant.example.test', 'unrelatedexample.test', 'example.test.other.test'],
  warningListJson: JSON.stringify({ name: 'Example shared service', version: 20261031, category: 'known', type, list }),
  provenance: { sourceUrl: 'https://example.org/warnings.json', revision: 'example-revision', licence: 'CC0-1.0' },
});

test('selected hostname context uses DNS boundaries and preserves exact, descendant and source identities', () => {
  const document = input(), original = structuredClone(document);
  const result = reviewSelectedServiceContext(document, at);
  assert.equal(result.state, 'reviewed');
  assert.deepEqual(result.results.map(row => [row.target, row.matches.length]), [
    ['example.test', 1], ['child.example.test', 1], ['tenant.example.test', 1], ['a.tenant.example.test', 2], ['unrelatedexample.test', 0], ['example.test.other.test', 0],
  ]);
  assert.equal(result.results[0]!.matches[0]!.basis, 'hostname_exact');
  assert.equal(result.results[1]!.matches[0]!.basis, 'hostname_suffix');
  assert.equal(result.results[2]!.matches.some(match => match.entry.startsWith('.')), false, 'A leading-dot entry does not match its bare suffix');
  assert.equal(result.source.digestSha256, createHash('sha256').update(document.warningListJson).digest('hex'));
  assert.equal(result.source.revision, 'example-revision');
  assert.equal(result.source.licence, 'CC0-1.0');
  assert.equal(result.source.provenance, 'analyst_selected');
  assert.deepEqual(document, original);
  assert.equal(result.networkRequestsMade, false);
  assert.doesNotMatch(JSON.stringify(result), /warningListJson|riskScore|safe":/u);
});

test('selected scanner ranges reuse exact IPv4/IPv6 membership and leave overlapping sources visible', () => {
  const result = reviewSelectedServiceContext({ ...input('cidr', ['192.0.2.0/24', '192.0.2.128/25', '2001:db8::/32']), role: 'research_scanner',
    targets: ['192.0.2.129', '192.0.3.1', '2001:db8:1::2', 'example.test'] }, at);
  assert.deepEqual(result.results.map(row => row.matches.length), [2, 0, 1, 0]);
  assert.equal(result.results[0]!.matches.every(match => match.basis === 'ip_cidr'), true);
  const removed = reviewSelectedServiceContext({ ...input('cidr', ['192.0.2.0/24']), targets: ['2001:db8::1'] }, at);
  assert.equal(removed.counts.matchedTargets, 0);
});

test('old, undated, malformed and unsupported source data cannot become a current qualification', () => {
  for (const [version, expected] of [[20260101, 'stale'], [1, 'unknown']] as const) {
    const result = reviewSelectedServiceContext({ ...input(), warningListJson: JSON.stringify({ name: 'Example historical list', version, type: 'hostname', list: ['example.test'] }) }, at);
    assert.equal(result.state, 'partial'); assert.equal(result.source.sourceHealth, expected);
    assert.equal(result.results[0]!.matches.length, 1, 'Retained context is not discarded or relabelled current');
  }
  for (const patch of [{ type: 'regex' }, { list: ['com'] }, { list: ['example.test', 'EXAMPLE.TEST'] }, { version: 20260231 }, { version: 20261102 }]) {
    assert.throws(() => reviewSelectedServiceContext({ ...input(), warningListJson: JSON.stringify({ name: 'Example list', version: 20261031, type: 'hostname', list: ['example.test'], ...patch }) }, at), TypeError);
  }
  assert.throws(() => reviewSelectedServiceContext({ ...input(), provenance: { sourceUrl: 'https://example.org/list?private=value' } }, at), TypeError);
  assert.throws(() => reviewSelectedServiceContext({ ...input(), targets: ['https://example.test/private'] }, at), TypeError);
  assert.throws(() => reviewSelectedServiceContext({ ...input(), warningListJson: '{"name":"a","name":"b"}' }, at), TypeError);
});

test('the production offline CLI preserves selected matches and partial-source exits without collection', async () => {
  let stdout = '', stderr = '';
  const document = input();
  const dependencies = { readArtifactInput: () => JSON.stringify(document), now: () => at,
    stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } },
    runUnifiedLookup: () => assert.fail('Selected-list review must not collect') };
  assert.equal(await runCli(['review-evidence', 'context.json', '--json', '--strict-exit'], dependencies), 0, stderr);
  assert.equal(JSON.parse(stdout).result.counts.matchedTargets, 4);
  stdout = '';
  assert.equal(await runCli(['review-evidence', 'context.json'], dependencies), 0, stderr);
  assert.match(stdout, /example\.test · hostname exact/u);
  assert.match(stdout, /hostname suffix/u);
  document.warningListJson = document.warningListJson.replace('20261031', '20260101'); stdout = '';
  assert.equal(await runCli(['review-evidence', 'context.json', '--quiet', '--strict-exit'], dependencies), 4, stderr);
  assert.equal(stdout, '');
});
