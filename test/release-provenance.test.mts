import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertSuccessfulReleaseCi,
  MAX_RELEASE_PROVENANCE_BYTES,
  releaseProvenanceIdentity,
  verifyReleaseProvenance,
} from '../tools/release-provenance.mts';

const SHA = 'a'.repeat(40);
const manifest = { version: '1.2.3', private: true };
const environment = {
  EXPECTED_VERSION: '1.2.3', GITHUB_REF: 'refs/tags/v1.2.3',
  GITHUB_SHA: SHA, GITHUB_REPOSITORY: 'example/project', GITHUB_TOKEN: '<fixture-credential>',
};
const successful = { head_sha: SHA, event: 'push', status: 'completed', conclusion: 'success' };

test('release selection requires a stable exact tag, private manifest and complete source identity', () => {
  assert.deepEqual(releaseProvenanceIdentity(environment, manifest), { repository: 'example/project', sha: SHA });
  for (const overrides of [
    { EXPECTED_VERSION: '' }, { EXPECTED_VERSION: '1.2.3-rc.1' }, { EXPECTED_VERSION: '1.2.4' },
    { GITHUB_REF: 'refs/heads/main' }, { GITHUB_REF: 'refs/tags/v1.2.4' },
    { GITHUB_SHA: 'aaaaaaa' }, { GITHUB_SHA: '--help' },
    { GITHUB_REPOSITORY: '../example/project' }, { GITHUB_REPOSITORY: 'x'.repeat(256) },
    { GITHUB_REPOSITORY: '../..' },
  ]) assert.throws(() => releaseProvenanceIdentity({ ...environment, ...overrides }, manifest));
  for (const invalid of [null, [], {}, { ...manifest, private: false }, { ...manifest, version: '1.2.4' }]) {
    assert.throws(() => releaseProvenanceIdentity(environment, invalid));
  }
});

test('only a completed successful push run for the selected full SHA supplies provenance', () => {
  assert.doesNotThrow(() => assertSuccessfulReleaseCi(SHA, { workflow_runs: [null, successful] }));
  for (const overrides of [
    { head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { event: 'workflow_dispatch' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { status: 'in_progress' }, { status: undefined },
  ]) assert.throws(() => assertSuccessfulReleaseCi(SHA, { workflow_runs: [{ ...successful, ...overrides }] }));
  for (const invalid of [null, {}, { workflow_runs: {} }, { workflow_runs: [] }, { workflow_runs: Array(101).fill(successful) }]) {
    assert.throws(() => assertSuccessfulReleaseCi(SHA, invalid));
  }
});

test('invalid selection, absent credentials and unrelated ancestry fail before any API request', async () => {
  let requests = 0, ancestryChecks = 0;
  const options = {
    isAncestor: () => { ancestryChecks++; return false; },
    fetcher: async () => { requests++; throw new Error('must not request'); },
  };
  await assert.rejects(verifyReleaseProvenance({ ...environment, EXPECTED_VERSION: '1.2.4' }, manifest, options));
  await assert.rejects(verifyReleaseProvenance({ ...environment, GITHUB_TOKEN: '' }, manifest, options));
  assert.equal(ancestryChecks, 0);
  await assert.rejects(verifyReleaseProvenance(environment, manifest, options), /reachable from origin\/main/u);
  assert.equal(ancestryChecks, 1);
  assert.equal(requests, 0);
});

test('provenance reads one fixed-origin, exact-SHA API page without following redirects', async () => {
  let requests = 0;
  await verifyReleaseProvenance(environment, manifest, {
    isAncestor: sha => { assert.equal(sha, SHA); return true; },
    fetcher: async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(url.pathname, '/repos/example/project/actions/workflows/ci.yml/runs');
      assert.deepEqual(Object.fromEntries(url.searchParams), { head_sha: SHA, status: 'completed', per_page: '100' });
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(init?.headers, {
        accept: 'application/vnd.github+json', authorization: 'Bearer <fixture-credential>',
        'x-github-api-version': '2022-11-28',
      });
      return Response.json({ workflow_runs: [successful] });
    },
  });
  assert.equal(requests, 1);
});

test('HTTP errors, redirects, absent bodies and malformed JSON cannot satisfy provenance', async () => {
  for (const response of [new Response(null, { status: 204 }), new Response('denied', { status: 403 }),
    new Response(null, { status: 302 }), new Response('{bad'), Response.json({ workflow_runs: [] })]) {
    await assert.rejects(verifyReleaseProvenance(environment, manifest, {
      isAncestor: () => true, fetcher: async () => response,
    }));
  }
  await assert.rejects(verifyReleaseProvenance(environment, manifest, {
    isAncestor: () => true, fetcher: async () => { throw new Error('fixture connection failure'); },
  }));
});

test('oversized run metadata is rejected and its stream cancelled before JSON parsing', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RELEASE_PROVENANCE_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(verifyReleaseProvenance(environment, manifest, {
    isAncestor: () => true, fetcher: async () => new Response(body),
  }), /response byte bound/u);
  assert.equal(cancelled, true);
});
