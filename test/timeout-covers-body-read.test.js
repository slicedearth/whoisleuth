// Covers the fix applied to lib/availability.js's fetchHomepageText() and
// lib/favicon.js's fetchFaviconHash(): both used to clear their abort
// timeout as soon as response headers arrived, before reading the body,
// which left an unbounded (no-timeout) read for the rest of the response -
// a domain that sends headers immediately and then stalls or trickles the
// body could hang a deep-check worker indefinitely. The fix moves
// clearTimeout() into a `finally` block so the deadline covers the whole
// read.
//
// The actual functions can't be pointed at a local test server here - they
// go through lib/safe-fetch.js's SSRF guard, which correctly refuses to
// connect to 127.0.0.1 (that guard has its own test coverage in
// safe-fetch.test.js). This tests the timeout-covers-the-read pattern
// itself, in isolation, against a real local server that sends headers and
// then never finishes the body - the same failure mode a malicious domain
// could produce.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function startStallingServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial-data');
      // deliberately never calls res.end() - simulates a stalled/trickling
      // malicious response
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function fetchWithDeadlineCoveringTheRead(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body.getReader();
    await reader.read(); // consumes the initial chunk the server did send
    return await reader.read(); // this is the read the old code left unguarded
  } finally {
    clearTimeout(timeout);
  }
}

test('a timeout held through the body read aborts a stalled response instead of hanging', async () => {
  const server = await startStallingServer();
  const port = server.address().port;
  const deadlineMs = 300;
  const start = Date.now();

  try {
    await assert.rejects(
      () => fetchWithDeadlineCoveringTheRead(`http://127.0.0.1:${port}/`, deadlineMs),
      /aborted/i
    );
    const elapsed = Date.now() - start;
    // Generous upper bound so this isn't flaky under CI scheduling jitter,
    // while still failing if the deadline were silently ignored (which
    // would leave this hanging until the test runner's own timeout, many
    // seconds later).
    assert.ok(elapsed < deadlineMs + 2000, `expected the abort within ~${deadlineMs}ms, took ${elapsed}ms`);
  } finally {
    server.close();
  }
});
