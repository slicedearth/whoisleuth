import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarEntry } from '../packages/contracts/har-review.mts';
import { harHostDomainLabel, harHostPageNote, harHostWriteMethodNote, MAX_HAR_HOST_GROUPS, summariseHarHosts } from '../packages/investigation/har-host-summary.mts';
import { selectedHarFixture } from '../fixtures/selected-input-examples.mts';
import { runCli } from '../cli/runner.mts';

const timings = { blocked: null, dns: null, connect: null, ssl: null, send: null, wait: null, receive: null };
function entry(sequence: number, origin: string | null, overrides: Partial<HarEntry> = {}): HarEntry {
  return { sequence, startedAt: null, origin, method: 'GET', status: 200, mimeCategory: 'other', durationMs: null,
    timings, resourceType: 'other', reportedFailure: false, ...overrides };
}

test('groups requests by registrable domain and separates the page domain from other domains', () => {
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
  assert.equal(summary.pageEvidence, 'document');
  assert.deepEqual(summary.groups.map((group) => [group.label, group.samePageDomain, group.requests, group.writeMethods, group.failures]), [
    ['portal.example', true, 2, 0, 0],
    ['other.example', false, 2, 1, 1],
    // An IP literal has no registrable domain, so it is not compared with the page domain.
    ['192.0.2.10', null, 1, 0, 1],
  ]);
  assert.deepEqual(summary.groups[0]?.origins.map((origin) => origin.origin), ['https://cdn.portal.example', 'https://www.portal.example']);
  assert.deepEqual(summary.groups[1]?.origins[0]?.resourceTypes, ['fetch']);
  assert.equal(summary.otherDomainWriteMethods, 1);
  assert.equal(summary.requestsWithoutOrigin, 1);
  assert.equal(harHostPageNote(summary), 'Page domain portal.example, from the first recorded document request.');
  assert.match(harHostWriteMethodNote(summary) ?? '', /^1 POST, PUT, PATCH or DELETE request went to other registrable domains\. The method alone/u);
});

test('without a document or HTML response the page stays unknown instead of following the first request', () => {
  const summary = summariseHarHosts([
    entry(1, 'https://assets.example.test', { resourceType: 'image', mimeCategory: 'image' }),
    entry(2, 'https://forms.other.test', { method: 'POST', resourceType: 'fetch' }),
  ]);
  assert.deepEqual([summary.pageOrigin, summary.pageDomain, summary.pageEvidence], [null, null, null]);
  assert.ok(summary.groups.every((group) => group.samePageDomain === null));
  assert.equal(summary.otherDomainWriteMethods, 0);
  assert.equal(harHostWriteMethodNote(summary), null);
  assert.match(harHostPageNote(summary), /not compared with a page domain/u);
  // An HTML response recorded as a fetch is not the page, even when it comes first.
  const fetched = summariseHarHosts([
    entry(1, 'https://api.other.test', { resourceType: 'fetch', mimeCategory: 'html', status: 401 }),
    entry(2, 'https://portal.example.test', { method: 'POST', resourceType: 'fetch' }),
  ]);
  assert.deepEqual([fetched.pageDomain, fetched.pageEvidence, fetched.otherDomainWriteMethods], [null, null, 0]);
  // Without a recorded request type, the first HTML response is an explicit inference.
  const html = summariseHarHosts([
    entry(1, 'https://cdn.example.test', { resourceType: 'unknown' }),
    entry(2, 'https://www.example.test', { mimeCategory: 'html', resourceType: 'unknown' }),
  ]);
  assert.deepEqual([html.pageDomain, html.pageEvidence], ['example.test', 'inferred_html_response']);
  assert.equal(harHostPageNote(html), 'Page domain example.test, inferred from the first HTML response whose request type was not recorded.');
});

test('a page on an IP literal keeps its origin without comparing hosts by domain', () => {
  const summary = summariseHarHosts([
    entry(1, 'https://192.0.2.20', { resourceType: 'document', mimeCategory: 'html' }),
    entry(2, 'https://collect.example.test', { method: 'POST', resourceType: 'fetch' }),
  ]);
  assert.deepEqual([summary.pageOrigin, summary.pageDomain, summary.otherDomainWriteMethods], ['https://192.0.2.20', null, 0]);
  assert.equal(harHostPageNote(summary),
    'Page origin https://192.0.2.20, from the first recorded document request, has no registrable domain, so hosts are not compared by domain.');
  assert.deepEqual(summary.groups.map((group) => [group.label, harHostDomainLabel(group)]),
    [['192.0.2.20', 'No registrable domain'], ['example.test', 'Page domain unknown']]);
});

test('an unknown page domain leaves party unclassified, and groups are bounded', () => {
  const unknown = summariseHarHosts([entry(1, null), entry(2, null)]);
  assert.equal(unknown.pageDomain, null);
  assert.deepEqual(unknown.groups, []);
  const many = summariseHarHosts(Array.from({ length: MAX_HAR_HOST_GROUPS + 5 }, (_, index) =>
    entry(index + 1, `https://host-${index}.example`)));
  assert.equal(many.groups.length, MAX_HAR_HOST_GROUPS);
  assert.equal(many.omittedGroups, 5);
  assert.equal(many.groups[0]?.samePageDomain, null, 'no document or HTML response identifies the page');
});

test('CLI intake lists the same hosts without query strings or request content', async () => {
  let output = '', errors = '';
  const code = await runCli(['intake', 'har', 'selected.har'], {
    readBinaryArtifactInput: async () => Buffer.from(selectedHarFixture()), now: () => '2026-09-20T00:05:00.000Z',
    stdout: { write(value: string) { output += value; } }, stderr: { write(value: string) { errors += value; } },
    runUnifiedLookup: async () => { throw new Error('No collection'); },
  });
  assert.equal(code, 0, errors);
  assert.match(output, /^Hosts contacted\n {2}Page domain request\.example, from the first recorded document request\.$/mu);
  assert.match(output, /^ {2}request\.example · page domain · 1 request · 1 write method · 0 failures$/mu);
  assert.match(output, /^ {2}later\.example · other domain · 1 request · 0 write methods · 1 failure$/mu);
  assert.doesNotMatch(output, /private/u);
});
