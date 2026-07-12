const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_SAFE_FETCH_URL_LENGTH,
  safeFetchDetailed,
  readBytesCapped,
  readTextCapped,
} = require('../lib/safe-fetch');

const PUBLIC_ADDRESSES = [{ address: '8.8.8.8', family: 4 }];

function fixtureDependencies(responses, overrides = {}) {
  const requests = [];
  const resolved = [];
  const closedDispatchers = [];
  let clock = 1000;
  return {
    requests,
    resolved,
    closedDispatchers,
    dependencies: {
      resolvePublicAddresses: async (hostname) => {
        resolved.push(hostname);
        return PUBLIC_ADDRESSES;
      },
      pinnedDispatcher: () => {
        const id = closedDispatchers.length;
        return { close: async () => { closedDispatchers.push(id); } };
      },
      fetch: async (url, options) => {
        requests.push({ url, options });
        const response = responses.shift();
        if (!response) throw new Error('Unexpected fixture request');
        return response;
      },
      now: () => clock += 5,
      ...overrides,
    },
  };
}

describe('safe fetch redirect provenance', () => {
  test('records every validated redirect hop and returns the terminal response', async () => {
    const terminal = new Response('ok', { status: 200 });
    const fixture = fixtureDependencies([
      new Response('', { status: 301, headers: { location: '/next?token=public' } }),
      new Response('', { status: 307, headers: { location: 'https://cdn.example.net/final' } }),
      terminal,
    ]);

    const result = await safeFetchDetailed('https://example.com/start', {}, fixture.dependencies);

    assert.equal(result.response, terminal);
    assert.equal(result.requestedUrl, 'https://example.com/start');
    assert.equal(result.finalUrl, 'https://cdn.example.net/final');
    assert.equal(result.redirected, true);
    assert.equal(result.redirectCount, 2);
    assert.equal(result.redirectLimitReached, false);
    assert.equal(fixture.closedDispatchers.length, 3);
    assert.deepEqual(fixture.resolved, ['example.com', 'example.com', 'cdn.example.net']);
    assert.deepEqual(result.hops.map(({ url, status, location }) => ({ url, status, location })), [
      { url: 'https://example.com/start', status: 301, location: 'https://example.com/next?token=public' },
      { url: 'https://example.com/next?token=public', status: 307, location: 'https://cdn.example.net/final' },
      { url: 'https://cdn.example.net/final', status: 200, location: null },
    ]);
    assert.ok(result.hops.every((hop) => Number.isInteger(hop.durationMs) && hop.durationMs >= 0));
  });

  test('stops at the bounded redirect limit without requesting another hop', async () => {
    const fixture = fixtureDependencies([
      new Response('', { status: 302, headers: { location: '/one' } }),
      new Response('', { status: 302, headers: { location: '/two' } }),
    ], { maxRedirects: 1 });

    const result = await safeFetchDetailed('https://example.com/', {}, fixture.dependencies);

    assert.equal(result.response.status, 302);
    assert.equal(result.redirectCount, 1);
    assert.equal(result.redirectLimitReached, true);
    assert.equal(result.hops.length, 2);
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.closedDispatchers.length, 2);
  });

  test('rejects unsafe URL forms before issuing a request', async () => {
    const fixture = fixtureDependencies([]);
    await assert.rejects(
      () => safeFetchDetailed('file:///etc/passwd', {}, fixture.dependencies),
      /non-HTTP URL/
    );
    await assert.rejects(
      () => safeFetchDetailed('https://user:secret@example.com/', {}, fixture.dependencies),
      /credentials/
    );
    await assert.rejects(
      () => safeFetchDetailed(`https://example.com/${'a'.repeat(MAX_SAFE_FETCH_URL_LENGTH)}`, {}, fixture.dependencies),
      /oversized URL/
    );
    assert.equal(fixture.requests.length, 0);
  });

  test('rejects an unsafe redirect target and does not request it', async () => {
    const fixture = fixtureDependencies([
      new Response('', { status: 302, headers: { location: 'file:///etc/passwd' } }),
    ]);
    await assert.rejects(
      () => safeFetchDetailed('https://example.com/', {}, fixture.dependencies),
      /non-HTTP URL/
    );
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.closedDispatchers.length, 1);
  });

  test('closes a dispatcher when fetch fails before returning a response', async () => {
    const fixture = fixtureDependencies([], {
      fetch: async () => { throw new Error('connection failed'); },
    });

    await assert.rejects(
      () => safeFetchDetailed('https://example.com/', {}, fixture.dependencies),
      /connection failed/
    );
    assert.equal(fixture.closedDispatchers.length, 1);
  });

  test('starts graceful final cleanup without blocking response consumption', async () => {
    let closeStarted = 0;
    let finishClose;
    const closeFinished = new Promise((resolve) => { finishClose = resolve; });
    const terminal = new Response('stream remains readable', { status: 200 });
    const fixture = fixtureDependencies([terminal], {
      pinnedDispatcher: () => ({
        close: () => {
          closeStarted += 1;
          return closeFinished;
        },
      }),
    });

    const result = await safeFetchDetailed('https://example.com/', {}, fixture.dependencies);
    assert.equal(closeStarted, 1);
    assert.equal(await result.response.text(), 'stream remains readable');
    finishClose();
    await closeFinished;
  });

});

describe('capped body readers', () => {
  test('text capture never retains more than the byte cap from one oversized chunk', async () => {
    const response = new Response(Buffer.alloc(1024, 0x61));
    const result = await readTextCapped(response, 32);
    assert.equal(result.text, 'a'.repeat(32));
    assert.equal(result.bytesRead, 32);
    assert.equal(result.truncated, true);
  });

  test('binary capture never retains more than the byte cap from one oversized chunk', async () => {
    const response = new Response(Buffer.alloc(1024, 0x7f));
    const result = await readBytesCapped(response, 24);
    assert.equal(result.bytes.length, 24);
    assert.equal(result.bytesRead, 24);
    assert.equal(result.truncated, true);
  });

  test('an exact-size body is not reported as truncated', async () => {
    const result = await readTextCapped(new Response('abcd'), 4);
    assert.equal(result.text, 'abcd');
    assert.equal(result.bytesRead, 4);
    assert.equal(result.truncated, false);
  });
});
