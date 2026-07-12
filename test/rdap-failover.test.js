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

  test('retains an HTTP-only service and reports its transport', async () => {
    const record = await fetchRdapFromBases('domain', 'example.kg', [
      'http://rdap.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({ ldhName: 'EXAMPLE.KG' }),
    }));

    assert.equal(record.transportSecurity, 'http');
    assert.match(record.rdapServer, /^http:/);
  });

  test('classifies the URL scheme case-insensitively', async () => {
    const record = await fetchRdapFromBases('domain', 'example.com', [
      'HTTPS://rdap.example/rdap',
    ], async () => ({ status: 404, ok: false, text: '{}' }));
    assert.equal(record.transportSecurity, 'https');
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
    assert.deepEqual(record.attempts.map(({ outcome, selected }) => ({ outcome, selected })), [
      { outcome: 'rate_limited', selected: false },
      { outcome: 'success', selected: true },
    ]);
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
    assert.equal(record.attempts[0].outcome, 'not_found');
    assert.equal(record.attempts[0].selected, true);
  });

  test('treats authoritative no-object responses consistently across query types', async () => {
    for (const [type, value] of [
      ['domain', 'free.example'],
      ['ipv4', '192.0.2.1'],
      ['ipv6', '2001:db8::1'],
      ['asn', 'AS64496'],
    ]) {
      let calls = 0;
      const record = await fetchRdapFromBases(type, value, [
        'https://first.example/rdap', 'https://second.example/rdap',
      ], async () => {
        calls += 1;
        return { status: 404, ok: false, text: JSON.stringify({ errorCode: 404 }) };
      });
      assert.equal(calls, 1, type);
      assert.equal(record.upstreamStatus, 404, type);
      assert.equal(record.parsed, null, type);
      assert.equal(record.attempts[0].outcome, 'not_found', type);
    }
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
    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_json', 'success']);
  });

  test('fails over when a successful response has no usable RDAP object', async () => {
    let calls = 0;
    const record = await fetchRdapFromBases('domain', 'example.com', [
      'https://empty.example/rdap',
      'https://good.example/rdap',
    ], async () => {
      calls += 1;
      return {
        status: 200,
        ok: true,
        text: JSON.stringify(calls === 1 ? {} : { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' }),
      };
    });

    assert.equal(calls, 2);
    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
    assert.match(record.attempts[0].detail, /usable RDAP object|did not match/i);
  });

  test('rejects a wrong-domain or incompatible object-class response', async () => {
    const responses = [
      { objectClassName: 'domain', ldhName: 'OTHER.EXAMPLE' },
      { objectClassName: 'autnum', ldhName: 'EXAMPLE.COM' },
      { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' },
    ];
    const record = await fetchRdapFromBases('domain', 'example.com', [
      'https://wrong-name.example/rdap',
      'https://wrong-class.example/rdap',
      'https://good.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify(responses.shift()),
    }));

    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), [
      'invalid_response', 'invalid_response', 'success',
    ]);
    assert.match(record.attempts[0].detail, /domain did not match/i);
    assert.match(record.attempts[1].detail, /object class/i);
  });

  test('accepts an equivalent Unicode domain identity', async () => {
    const record = await fetchRdapFromBases('domain', 'xn--bcher-kva.example', [
      'https://idn.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({ objectClassName: 'domain', unicodeName: 'bücher.example' }),
    }));

    assert.equal(record.parsed.domain, 'bücher.example');
    assert.equal(record.attempts[0].outcome, 'success');
  });

  test('requires IPv4 and IPv6 ranges to cover the requested address', async () => {
    const ipv4 = await fetchRdapFromBases('ipv4', '192.0.2.10', [
      'https://wrong-v4.example/rdap',
      'https://good-v4.example/rdap',
    ], async (url) => ({
      status: 200,
      ok: true,
      text: JSON.stringify(url.includes('wrong-v4')
        ? { objectClassName: 'ip network', startAddress: '198.51.100.0', endAddress: '198.51.100.255' }
        : { objectClassName: 'ip network', startAddress: '192.0.2.0', endAddress: '192.0.2.255' }),
    }));
    const ipv6 = await fetchRdapFromBases('ipv6', '2001:db8::10', [
      'https://v6.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({
        objectClassName: 'ip network', startAddress: '2001:db8::', endAddress: '2001:db8::ffff',
      }),
    }));

    assert.deepEqual(ipv4.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
    assert.equal(ipv6.attempts[0].outcome, 'success');
  });

  test('requires an autnum range to cover the requested ASN', async () => {
    const record = await fetchRdapFromBases('asn', 'AS64496', [
      'https://wrong-asn.example/rdap',
      'https://good-asn.example/rdap',
    ], async (url) => ({
      status: 200,
      ok: true,
      text: JSON.stringify(url.includes('wrong-asn')
        ? { objectClassName: 'autnum', startAutnum: 64500, endAutnum: 64510 }
        : { objectClassName: 'autnum', startAutnum: 64496, endAutnum: 64499 }),
    }));

    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
  });

  test('failed attempts remain bounded and control-character safe on the thrown error', async () => {
    await assert.rejects(
      fetchRdapFromBases('domain', 'example.com', [
        'https://one.example/rdap',
        'https://two.example/rdap',
        'https://three.example/rdap',
        'https://four.example/rdap',
      ], async () => { throw new Error(`network\n${'x'.repeat(500)}`); }),
      (error) => {
        assert.equal(error.attempts.length, 3);
        assert.ok(error.attempts.every((attempt) => attempt.outcome === 'network_error'));
        assert.ok(error.attempts.every((attempt) => attempt.detail.length <= 240));
        assert.ok(error.attempts.every((attempt) => !/[\u0000-\u001f\u007f]/.test(attempt.detail)));
        return true;
      }
    );
  });

  test('drops oversized or control-bearing bootstrap endpoints', () => {
    assert.deepEqual(uniqueBases([
      `https://${'a'.repeat(2050)}.example/rdap`,
      'https://bad.example/rdap\nforged',
      'https://good.example/rdap',
    ]), ['https://good.example/rdap']);
  });
});
