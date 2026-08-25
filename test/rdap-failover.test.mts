import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fetchRdapFromBases, uniqueBases } from '../lib/rdap.mts';
import type { NormalizedRdapRecordFor, RdapLookupRecord } from '../lib/rdap.mts';

async function fetchFixture<const T extends string>(
  type: T,
  value: string,
  bases: unknown,
  fetchUpstream?: Parameters<typeof fetchRdapFromBases>[3],
): Promise<RdapLookupRecord<NormalizedRdapRecordFor<T>>> {
  const record = await fetchRdapFromBases(type, value, bases, fetchUpstream);
  assert.ok(record);
  return record;
}

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
    const record = await fetchFixture('domain', 'example.kg', [
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
    const record = await fetchFixture('domain', 'example.com', [
      'HTTPS://rdap.example/rdap',
    ], async () => ({ status: 404, ok: false, text: '{}' }));
    assert.equal(record.transportSecurity, 'https');
  });

  test('attributes successful and not-found responses to the admitted redirect destination', async () => {
    const redirected = await fetchFixture('domain', 'example.com', [
      'https://bootstrap.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }),
      finalUrl: 'http://final.example/domain/example.com',
    }));
    assert.equal(redirected.rdapServer, 'http://final.example/domain/example.com');
    assert.equal(redirected.transportSecurity, 'http');
    assert.equal(requiredValue(redirected.attempts[0]).endpoint, redirected.rdapServer);

    const upgraded = await fetchFixture('domain', 'free.example', [
      'http://bootstrap.example/rdap',
    ], async () => ({
      status: 404,
      ok: false,
      text: JSON.stringify({ errorCode: 404 }),
      finalUrl: 'https://final.example/domain/free.example',
    }));
    assert.equal(upgraded.rdapServer, 'https://final.example/domain/free.example');
    assert.equal(upgraded.transportSecurity, 'https');
    assert.equal(requiredValue(upgraded.attempts[0]).endpoint, upgraded.rdapServer);
  });

  test('fails over before treating a redirected response for another RDAP object as authoritative', async () => {
    for (const finalUrl of [
      'https://redirect.example/domain/other.example',
      'https://redirect.example/ip/192.0.2.1',
      'https://redirect.example/autnum/64496',
      'https://redirect.example/domain/example.com/related',
    ]) {
      let calls = 0;
      const record = await fetchFixture('domain', 'example.com', [
        'https://first.example/rdap',
        'https://second.example/rdap',
      ], async () => {
        calls += 1;
        return calls === 1
          ? { status: 404, ok: false, text: '{}', finalUrl }
          : {
              status: 404,
              ok: false,
              text: '{}',
              finalUrl: 'https://second.example/rdap/domain/example.com',
            };
      });
      assert.equal(calls, 2, finalUrl);
      assert.equal(record.rdapServer, 'https://second.example/rdap/domain/example.com', finalUrl);
      assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'not_found']);
      assert.equal(JSON.stringify(record.attempts).includes(finalUrl), false, finalUrl);
    }
  });

  test('binds final domain, IP, and ASN paths by canonical object identity', async () => {
    const unicode = await fetchFixture('domain', 'bücher.example', [
      'https://bootstrap.example/rdap',
    ], async () => ({
      status: 404,
      ok: false,
      text: '{}',
      finalUrl: 'https://redirect.example/domain/b%C3%BCcher.example',
    }));
    assert.equal(unicode.rdapServer, 'https://redirect.example/domain/b%C3%BCcher.example');

    for (const [type, value, wrongFinalUrl] of [
      ['ipv4', '192.0.2.1', 'https://redirect.example/ip/192.0.2.2'],
      ['ipv6', '2001:db8::1', 'https://redirect.example/ip/2001%3Adb8%3A%3A2'],
      ['asn', 'AS64496', 'https://redirect.example/autnum/64497'],
    ] as const) {
      let calls = 0;
      const record = await fetchFixture(type, value, [
        'https://first.example/rdap',
        'https://second.example/rdap',
      ], async () => {
        calls += 1;
        return calls === 1
          ? { status: 404, ok: false, text: '{}', finalUrl: wrongFinalUrl }
          : { status: 404, ok: false, text: '{}' };
      });
      assert.equal(calls, 2, type);
      assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'not_found'], type);
    }
  });

  test('fails over without retaining invalid redirect provenance', async () => {
    const invalidFinalUrls = [
      'https://redirect.example/domain/example.com?session=private',
      'https://redirect.example/domain/example.com#private',
      'https://user:password@redirect.example/domain/example.com',
      'https://redirect.example:8443/domain/example.com',
      'ftp://redirect.example/domain/example.com',
      'https://redirect.example/domain/example.com\nforged',
      `https://redirect.example/${'x'.repeat(2_048)}`,
    ];

    for (const finalUrl of invalidFinalUrls) {
      let calls = 0;
      const record = await fetchFixture('domain', 'example.com', [
        'https://bad.example/rdap',
        'https://good.example/rdap',
      ], async () => {
        calls += 1;
        return calls === 1
          ? {
              status: 200,
              ok: true,
              text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }),
              finalUrl,
            }
          : {
              status: 200,
              ok: true,
              text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }),
              finalUrl: 'https://good.example/rdap/domain/example.com',
            };
      });
      assert.equal(calls, 2, finalUrl);
      assert.equal(record.rdapServer, 'https://good.example/rdap/domain/example.com', finalUrl);
      assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
      assert.equal(JSON.stringify(record.attempts).includes(finalUrl), false, finalUrl);
    }
  });

  test('attributes non-object attempts to a valid final destination and preserves no-redirect compatibility', async () => {
    let calls = 0;
    const record = await fetchFixture('domain', 'example.com', [
      'https://first.example/rdap',
      'https://second.example/rdap',
    ], async () => {
      calls += 1;
      return calls === 1
        ? {
            status: 200,
            ok: true,
            text: '<html>not JSON</html>',
            finalUrl: 'https://redirect.example/domain/example.com',
          }
        : {
            status: 200,
            ok: true,
            text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }),
          };
    });
    assert.equal(requiredValue(record.attempts[0]).endpoint, 'https://redirect.example/domain/example.com');
    assert.equal(record.rdapServer, 'https://second.example/rdap/domain/example.com');
  });

  test('falls through a rate-limited endpoint to the next service', async () => {
    const calls = [];
    const record = await fetchFixture('domain', 'example.com', [
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
    assert.ok(record.parsed);
    assert.ok('domain' in record.parsed);
    assert.equal(record.parsed.domain, 'EXAMPLE.COM');
    assert.deepEqual(record.attempts.map(({ outcome, selected }) => ({ outcome, selected })), [
      { outcome: 'rate_limited', selected: false },
      { outcome: 'success', selected: true },
    ]);
  });

  test('treats an authoritative 404 as final instead of failing over', async () => {
    let calls = 0;
    const record = await fetchFixture('domain', 'free.example', [
      'https://first.example/rdap',
      'https://second.example/rdap',
    ], async () => {
      calls += 1;
      return { status: 404, ok: false, text: JSON.stringify({ errorCode: 404 }) };
    });

    assert.equal(calls, 1);
    assert.equal(record.upstreamStatus, 404);
    assert.equal(record.parsed, null);
    assert.equal(requiredValue(record.attempts[0]).outcome, 'not_found');
    assert.equal(requiredValue(record.attempts[0]).selected, true);
  });

  test('treats authoritative no-object responses consistently across query types', async () => {
    for (const [type, value] of [
      ['domain', 'free.example'],
      ['ipv4', '192.0.2.1'],
      ['ipv6', '2001:db8::1'],
      ['asn', 'AS64496'],
    ] as const) {
      let calls = 0;
      const record = await fetchFixture(type, value, [
        'https://first.example/rdap', 'https://second.example/rdap',
      ], async () => {
        calls += 1;
        return { status: 404, ok: false, text: JSON.stringify({ errorCode: 404 }) };
      });
      assert.equal(calls, 1, type);
      assert.equal(record.upstreamStatus, 404, type);
      assert.equal(record.parsed, null, type);
      assert.equal(requiredValue(record.attempts[0]).outcome, 'not_found', type);
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

  test('classifies non-JSON service errors before attempting body parsing', async () => {
    let calls = 0;
    const record = await fetchFixture('domain', 'example.com', [
      'https://unavailable.example/rdap',
      'https://good.example/rdap',
    ], async () => {
      calls += 1;
      return calls === 1
        ? { status: 503, ok: false, text: '<html>temporarily unavailable</html>' }
        : { status: 200, ok: true, text: JSON.stringify({ ldhName: 'EXAMPLE.COM' }) };
    });

    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['server_error', 'success']);
    assert.equal(requiredValue(record.attempts[0]).status, 503);
    assert.ok(requiredValue(record.attempts[0]).detail);
    assert.match(requiredValue(requiredValue(record.attempts[0]).detail), /HTTP 503/);
  });

  test('fails over when a successful response is not valid RDAP JSON', async () => {
    let calls = 0;
    const record = await fetchFixture('domain', 'example.com', [
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
    const record = await fetchFixture('domain', 'example.com', [
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
    assert.ok(requiredValue(record.attempts[0]).detail);
    assert.match(requiredValue(requiredValue(record.attempts[0]).detail), /usable RDAP object|did not match/i);
  });

  test('rejects a wrong-domain or incompatible object-class response', async () => {
    const responses = [
      { objectClassName: 'domain', ldhName: 'OTHER.EXAMPLE' },
      { objectClassName: 'autnum', ldhName: 'EXAMPLE.COM' },
      { objectClassName: 'domain', ldhName: 'EXAMPLE.COM' },
    ];
    const record = await fetchFixture('domain', 'example.com', [
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
    assert.ok(requiredValue(record.attempts[0]).detail);
    assert.ok(requiredValue(record.attempts[1]).detail);
    assert.match(requiredValue(requiredValue(record.attempts[0]).detail), /domain did not match/i);
    assert.match(requiredValue(requiredValue(record.attempts[1]).detail), /object class/i);
  });

  test('accepts an equivalent Unicode domain identity', async () => {
    const record = await fetchFixture('domain', 'xn--bcher-kva.example', [
      'https://idn.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({ objectClassName: 'domain', unicodeName: 'bücher.example' }),
    }));

    assert.ok(record.parsed);
    assert.ok('domain' in record.parsed);
    assert.equal(record.parsed.domain, 'bücher.example');
    assert.equal(requiredValue(record.attempts[0]).outcome, 'success');
  });

  test('requires IPv4 and IPv6 ranges to cover the requested address', async () => {
    const ipv4 = await fetchFixture('ipv4', '192.0.2.10', [
      'https://wrong-v4.example/rdap',
      'https://good-v4.example/rdap',
    ], async (url) => ({
      status: 200,
      ok: true,
      text: JSON.stringify(url.includes('wrong-v4')
        ? { objectClassName: 'ip network', startAddress: '198.51.100.0', endAddress: '198.51.100.255' }
        : { objectClassName: 'ip network', startAddress: '192.0.2.0', endAddress: '192.0.2.255' }),
    }));
    const ipv6 = await fetchFixture('ipv6', '2001:db8::10', [
      'https://v6.example/rdap',
    ], async () => ({
      status: 200,
      ok: true,
      text: JSON.stringify({
        objectClassName: 'ip network', startAddress: '2001:db8::', endAddress: '2001:db8::ffff',
      }),
    }));

    assert.deepEqual(ipv4.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
    assert.equal(requiredValue(ipv6.attempts[0]).outcome, 'success');
  });

  test('requires an autnum range to cover the requested ASN', async () => {
    const record = await fetchFixture('asn', 'AS64496', [
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
        assert.ok(error instanceof Error);
        assert.ok('attempts' in error);
        const attempts = error.attempts;
        assert.ok(Array.isArray(attempts));
        assert.equal(attempts.length, 3);
        assert.ok(attempts.every((attempt: unknown) => (
          typeof attempt === 'object'
          && attempt !== null
          && 'outcome' in attempt
          && attempt.outcome === 'network_error'
        )));
        assert.ok(attempts.every((attempt: unknown) => {
          assert.ok(typeof attempt === 'object' && attempt !== null && 'detail' in attempt);
          return typeof attempt.detail === 'string' && attempt.detail.length <= 240;
        }));
        assert.ok(attempts.every((attempt: unknown) => {
          assert.ok(typeof attempt === 'object' && attempt !== null && 'detail' in attempt);
          return typeof attempt.detail === 'string' && !/[\u0000-\u001f\u007f]/.test(attempt.detail);
        }));
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
