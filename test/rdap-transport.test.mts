import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fetchRdapDetailedWithTimeout,
  fetchRdapWithTimeout,
} from '../lib/rdap-transport.mts';

test('returns bounded RDAP status and text through an injected safe transport', async () => {
  const result = await fetchRdapWithTimeout('https://rdap.example.test/domain/example.test', {
    headers: { Accept: 'application/rdap+json' },
  }, 1_000, {
    fetch: async (_url, options) => {
      assert.ok(options?.signal);
      assert.equal(options.signal.aborted, false);
      return new Response('{"objectClassName":"domain"}', { status: 200 });
    },
    readText: async (_response, maximumBytes) => {
      assert.equal(maximumBytes, 2_000_000);
      return { text: '{"objectClassName":"domain"}', truncated: false, bytesRead: 28 };
    },
  });
  assert.deepEqual(result, {
    status: 200,
    ok: true,
    text: '{"objectClassName":"domain"}',
  });
});

test('retains the validated final URL for detailed RDAP transport', async () => {
  const result = await fetchRdapDetailedWithTimeout('https://rdap.example.test/domain/example.test', {}, 1_000, {
    fetchDetailed: async () => ({
      response: new Response('{}', { status: 404 }),
      requestedUrl: 'https://rdap.example.test/domain/example.test',
      finalUrl: 'https://registry.example.test/domain/example.test',
      redirected: true,
      redirectCount: 1,
      redirectLimitReached: false,
      hops: [],
      durationMs: 10,
    }),
    readText: async () => ({ text: '{}', truncated: false, bytesRead: 2 }),
  });
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.finalUrl, 'https://registry.example.test/domain/example.test');
});

test('rejects truncated bodies and propagates the transport deadline', async () => {
  await assert.rejects(fetchRdapWithTimeout('https://rdap.example.test/domain/example.test', {}, 1_000, {
    fetch: async () => new Response('{}'),
    readText: async () => ({ text: '', truncated: true, bytesRead: 2_000_000 }),
  }), /exceeded 2000000 bytes/u);

  await assert.rejects(fetchRdapWithTimeout('https://rdap.example.test/domain/example.test', {}, 1, {
    fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
      assert.ok(options?.signal);
      const signal = options.signal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }), (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
});

test('uses the shared safe transports by default and rejects private-address targets offline', async () => {
  await assert.rejects(
    fetchRdapWithTimeout('https://127.0.0.1/domain/example.test', {}, 1_000),
    /private|public|blocked|refused|address/iu,
  );
  await assert.rejects(
    fetchRdapDetailedWithTimeout('https://127.0.0.1/domain/example.test', {}, 1_000),
    /private|public|blocked|refused|address/iu,
  );
});

test('uses the default capped reader when only a safe transport is injected', async () => {
  const basic = await fetchRdapWithTimeout('https://rdap.example.test/domain/example.test', {}, 1_000, {
    fetch: async () => new Response('{"state":"basic"}', { status: 200 }),
  });
  assert.equal(basic.text, '{"state":"basic"}');

  const detailed = await fetchRdapDetailedWithTimeout('https://rdap.example.test/domain/example.test', {}, 1_000, {
    fetchDetailed: async () => ({
      response: new Response('{"state":"detailed"}', { status: 200 }),
      requestedUrl: 'https://rdap.example.test/domain/example.test',
      finalUrl: 'https://rdap.example.test/domain/example.test',
      redirected: false,
      redirectCount: 0,
      redirectLimitReached: false,
      hops: [],
      durationMs: 1,
    }),
  });
  assert.equal(detailed.text, '{"state":"detailed"}');
});
