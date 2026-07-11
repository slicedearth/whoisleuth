const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { fetchRdapFromBases, uniqueBases } = require('../lib/rdap');

describe('RDAP endpoint failover', () => {
  test('prefers HTTPS and removes duplicate bootstrap endpoints', () => {
    assert.deepEqual(uniqueBases([
      'http://rdap.example/',
      'https://backup.example/',
      'https://backup.example',
    ]), [
      'https://backup.example/',
      'http://rdap.example/',
    ]);
  });

  test('falls through a rate-limited endpoint to the next service', async () => {
    const calls = [];
    const record = await fetchRdapFromBases('domain', 'example.com', [
      'https://first.example/rdap',
      'https://second.example/rdap',
    ], async (url) => {
      calls.push(url);
      if (url.includes('first.example')) {
        return { status: 429, ok: false, text: JSON.stringify({ errorCode: 429 }) };
      }
      return {
        status: 200,
        ok: true,
        text: JSON.stringify({ ldhName: 'EXAMPLE.COM', status: ['active'] }),
      };
    });

    assert.equal(calls.length, 2);
    assert.match(record.rdapServer, /second\.example/);
    assert.equal(record.parsed.domain, 'EXAMPLE.COM');
  });

  test('treats an authoritative 404 as final instead of failing over', async () => {
    let calls = 0;
    const record = await fetchRdapFromBases('domain', 'free.example', [
      'https://first.example/rdap',
      'https://second.example/rdap',
    ], async () => {
      calls += 1;
      return { status: 404, ok: false, text: JSON.stringify({ errorCode: 404 }) };
    });

    assert.equal(calls, 1);
    assert.equal(record.upstreamStatus, 404);
    assert.equal(record.parsed, null);
  });

  test('rejects service failures rather than returning them as object data', async () => {
    await assert.rejects(
      fetchRdapFromBases('domain', 'example.com', ['https://only.example/rdap'], async () => ({
        status: 503,
        ok: false,
        text: JSON.stringify({ errorCode: 503 }),
      })),
      /HTTP 503/
    );
  });

  test('fails over when a successful response is not valid RDAP JSON', async () => {
    let calls = 0;
    const record = await fetchRdapFromBases('domain', 'example.com', [
      'https://bad.example/rdap',
      'https://good.example/rdap',
    ], async () => {
      calls += 1;
      return calls === 1
        ? { status: 200, ok: true, text: '<html>temporary error</html>' }
        : { status: 200, ok: true, text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }) };
    });

    assert.equal(calls, 2);
    assert.match(record.rdapServer, /good\.example/);
  });
});
