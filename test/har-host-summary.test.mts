import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarEntry } from '../packages/contracts/har-review.mts';
import { MAX_HAR_HOST_GROUPS, summariseHarHosts } from '../packages/investigation/har-host-summary.mts';
import { selectedHarFixture } from '../fixtures/selected-input-examples.mts';
import { runCli } from '../cli/runner.mts';

const timings = { blocked: null, dns: null, connect: null, ssl: null, send: null, wait: null, receive: null };
function entry(sequence: number, origin: string | null, overrides: Partial<HarEntry> = {}): HarEntry {
  return { sequence, startedAt: null, origin, method: 'GET', status: 200, mimeCategory: 'other', durationMs: null,
    timings, resourceType: 'other', reportedFailure: false, ...overrides };
}

test('groups requests by registrable domain and separates the page domain from third parties', () => {
  const summary = summariseHarHosts([
    entry(3, 'https://cdn.portal.example', { resourceType: 'script' }),
    entry(1, 'https://www.portal.example', { resourceType: 'document', mimeCategory: 'html' }),
    entry(2, 'https://collect.other.example', { method: 'POST', resourceType: 'fetch' }),
    entry(4, 'https://collect.other.example', { status: 503, resourceType: 'fetch' }),
    entry(5, 'https://192.0.2.10', { resourceType: 'image', reportedFailure: true }),
    entry(6, null),
  ]);
  assert.equal(summary.pageOrigin, 'https://www.portal.example');
  assert.equal(summary.pageDomain, 'portal.example');
  assert.deepEqual(summary.groups.map((group) => [group.label, group.firstParty, group.requests, group.writes, group.failures]), [
    ['portal.example', true, 2, 0, 0],
    ['other.example', false, 2, 1, 1],
    ['192.0.2.10', false, 1, 0, 1],
  ]);
  assert.deepEqual(summary.groups[0]?.origins.map((origin) => origin.origin), ['https://cdn.portal.example', 'https://www.portal.example']);
  assert.deepEqual(summary.groups[1]?.origins[0]?.resourceTypes, ['fetch']);
  assert.equal(summary.thirdPartyWrites, 1);
  assert.equal(summary.requestsWithoutOrigin, 1);
});

test('an unknown page domain leaves party unclassified, and groups are bounded', () => {
  const unknown = summariseHarHosts([entry(1, null), entry(2, null)]);
  assert.equal(unknown.pageDomain, null);
  assert.deepEqual(unknown.groups, []);
  const many = summariseHarHosts(Array.from({ length: MAX_HAR_HOST_GROUPS + 5 }, (_, index) =>
    entry(index + 1, `https://host-${index}.example`)));
  assert.equal(many.groups.length, MAX_HAR_HOST_GROUPS);
  assert.equal(many.omittedGroups, 5);
  assert.equal(many.groups[0]?.firstParty, true);
});

test('CLI intake lists the same hosts without query strings or request content', async () => {
  let output = '', errors = '';
  const code = await runCli(['intake', 'har', 'selected.har'], {
    readBinaryArtifactInput: async () => Buffer.from(selectedHarFixture()), now: () => '2026-09-20T00:05:00.000Z',
    stdout: { write(value: string) { output += value; } }, stderr: { write(value: string) { errors += value; } },
    runUnifiedLookup: async () => { throw new Error('No collection'); },
  });
  assert.equal(code, 0, errors);
  assert.match(output, /^Hosts contacted \(page domain request\.example\)$/mu);
  assert.match(output, /^ {2}request\.example · page domain · 1 request · 1 write · 0 failures$/mu);
  assert.match(output, /^ {2}later\.example · third party · 1 request · 0 writes · 1 failure$/mu);
  assert.doesNotMatch(output, /private/u);
});
