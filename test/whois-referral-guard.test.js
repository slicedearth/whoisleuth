// Covers the SSRF guard added to lib/whois.mts's whoisQuery(). After the
// first hop, the server it connects to next is a referral hostname pulled
// out of the *previous* server's own response text (buildWhoisChain()
// follows "refer:"/"whois:" fields) - a malicious or compromised registry
// could point that at an internal address. whoisQuery() now resolves and
// validates the target through the same isPrivateAddress() guard
// safe-fetch.js uses for HTTP before ever opening a socket.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const { whoisQuery } = require('../lib/whois.mts');

describe('referral target validation', () => {
  test('refuses to connect to a loopback address', async () => {
    await assert.rejects(() => whoisQuery('127.0.0.1', 'example.com'), /private\/reserved address/);
  });

  test('refuses to connect to an RFC1918 private address', async () => {
    await assert.rejects(() => whoisQuery('10.0.0.5', 'example.com'), /private\/reserved address/);
  });

  test('refuses to connect to a link-local address (cloud metadata range)', async () => {
    await assert.rejects(() => whoisQuery('169.254.169.254', 'example.com'), /private\/reserved address/);
  });

  test('refuses to connect to an IPv4-mapped loopback written as hex groups', async () => {
    await assert.rejects(() => whoisQuery('::ffff:7f00:1', 'example.com'), /private\/reserved address/);
  });

  // Deliberately not asserting a *successful* connection to a real public
  // WHOIS server here - that would make this test dependent on network
  // access and an upstream service being reachable/fast in CI. The
  // rejection path above is what changed; a real end-to-end lookup is
  // exercised manually against the running app instead.
});
