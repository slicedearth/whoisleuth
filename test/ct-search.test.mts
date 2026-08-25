import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_CT_QUERY_LENGTH } from '../lib/ct-query.mts';
import { searchCertificateTransparency, summarizeCtResults } from '../lib/ct-search.mts';
import { requiredValue } from './value-assertions.mts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    name_value: 'example.com',
    common_name: 'example.com',
    entry_timestamp: '2026-01-15T12:00:00.000',
    issuer_ca_id: 1000,
    serial_number: 'abc123def',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Legacy domains
// ---------------------------------------------------------------------------

describe('legacy domains', () => {
  test('returns sorted unique hostnames', () => {
    const result = summarizeCtResults([
      row({ name_value: 'c.example.com', common_name: '' }),
      row({ name_value: 'a.example.com', common_name: '' }),
      row({ name_value: 'b.example.com\nc.example.com', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, ['a.example.com', 'b.example.com', 'c.example.com']);
  });

  test('wildcard normalization', () => {
    const result = summarizeCtResults([
      row({ name_value: '*.example.com', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, ['example.com']);
  });

  test('legacy domains do not depend on tldts', () => {
    // bare co.uk has a dot → matches HOSTNAME_RE → in legacy domains.
    // tldts returns no registrable domain for it → excluded from matches.
    const result = summarizeCtResults([
      row({ name_value: 'co.uk', common_name: '' }),
      row({ name_value: 'login.example.co.uk', common_name: '' }),
      row({ name_value: 'example.co.uk', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, [
      'co.uk',
      'example.co.uk',
      'login.example.co.uk',
    ]);
    // Structured matches: co.uk has no registrable domain → absent.
    const matchDomains = result.matches.map((m) => m.domain);
    assert.deepStrictEqual(matchDomains, ['example.co.uk']);
    assert.deepStrictEqual(requiredValue(result.matches[0]).hostnames, [
      'example.co.uk',
      'login.example.co.uk',
    ]);
  });

  test('legacy truncation sets truncated', () => {
    const rows = [];
    for (let i = 0; i < 600; i++) {
      rows.push(row({ id: i + 1, name_value: `host${i}.example.com`, common_name: '' }));
    }
    const result = summarizeCtResults(rows);
    assert.equal(result.domains.length, 500);
    assert.equal(result.truncated, true);
  });

  test('invalid hostnames excluded from legacy', () => {
    const result = summarizeCtResults([
      row({ name_value: 'invalid_hostname', common_name: '' }),
      row({ name_value: 'no-dot', common_name: '' }),
      row({ name_value: 'example.com', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, ['example.com']);
  });

  test('rejects overlong certificate hostnames before public-suffix work', () => {
    const sixtyThree = 'a'.repeat(63);
    const nearLimit = `${sixtyThree}.${sixtyThree}.${sixtyThree}.${'b'.repeat(61)}`;
    const result = summarizeCtResults([
      row({ id: 1, name_value: `${'a'.repeat(64)}.example.test`, common_name: '' }),
      row({ id: 2, name_value: `${'a'.repeat(248)}.test`, common_name: '' }),
      row({ id: 3, name_value: nearLimit, common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, [nearLimit]);
    assert.equal(result.truncated, false);
  });

  test('legacy domains preserve IP-like dotted values while structured matches reject them', () => {
    // 192.168.0.1 matches HOSTNAME_RE (dotted labels with alphanumeric chars)
    // so it appears in legacy domains. It is excluded from structured matches
    // because tldts returns no registrable domain for an IP literal.
    const result = summarizeCtResults([
      row({ name_value: '192.168.0.1', common_name: '' }),
      row({ name_value: 'example.com', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, ['192.168.0.1', 'example.com']);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
  });
});

// ---------------------------------------------------------------------------
// Empty / invalid input
// ---------------------------------------------------------------------------

describe('empty and invalid input', () => {
  test('empty array', () => {
    const result = summarizeCtResults([]);
    assert.deepStrictEqual(result.domains, []);
    assert.deepStrictEqual(result.matches, []);
    assert.deepStrictEqual(result.certificateGroups, []);
    assert.equal(result.certificateGroupsTruncated, false);
    assert.equal(result.truncated, false);
  });

  test('non-array throws', () => {
    assert.throws(() => summarizeCtResults(null), /expected a JSON array/);
    assert.throws(() => summarizeCtResults({}), /expected a JSON array/);
    assert.throws(() => summarizeCtResults('not-an-array'), /expected a JSON array/);
  });

  test('rows over MAX_CT_ROWS throws', () => {
    const rows = new Array(50_001).fill(row({ id: 1, name_value: '', common_value: '' }));
    assert.throws(() => summarizeCtResults(rows), /too many rows/);
  });

  test('exactly at MAX_CT_ROWS is allowed', () => {
    const rows = new Array(50_000).fill(null);
    // Should not throw.
    const result = summarizeCtResults(rows);
    assert.ok(Array.isArray(result.domains));
  });

  test('caps newline-dense hostname work per row before parsing the retained suffix', () => {
    const names = Array.from({ length: 1_001 }, (_, index) => `host${index}.example.com`);
    const result = summarizeCtResults([
      row({ name_value: names.join('\n'), common_name: '' }),
      row({ id: 2, name_value: 'later.example.net', common_name: '' }),
    ]);
    assert.equal(result.namesExamined, 1_002);
    assert.equal(result.workTruncated, true);
    assert.equal(result.truncated, true);
    assert.equal(result.matches.some((match) => match.domain === 'example.net'), true);
    assert.equal(result.domains.includes('host1000.example.com'), false);
  });

  test('does not implicitly stringify nested hostname values', () => {
    const nested = Array.from({ length: 10_000 }, (_, index) => `host${index}.example.com`);
    const result = summarizeCtResults([
      row({ name_value: nested, common_name: { value: 'forged.example.net' } }),
      row({ id: 2, name_value: 'retained.example.org', common_name: '' }),
    ]);
    assert.deepEqual(result.domains, ['retained.example.org']);
    assert.equal(result.workTruncated, false);
  });

  test('malformed row beside valid rows', () => {
    const result = summarizeCtResults([
      null,
      row({ name_value: 'example.com' }),
      undefined,
      'not-an-object',
      row({ name_value: 'other.com' }),
    ]);
    assert.deepStrictEqual(result.domains, ['example.com', 'other.com']);
    assert.equal(result.rejectedRows, 3);
    assert.equal(result.truncated, true);
  });

  test('treats object rows without either documented name field as rejected content', () => {
    for (const missing of [
      {},
      { id: 1 },
      { id: 1, name_value: '', common_name: '' },
      { id: 1, name_value: '  ', common_name: '\n' },
      { id: 1, name_value: '\u0085', common_name: '\u0085' },
    ]) {
      const result = summarizeCtResults([missing]);
      assert.deepEqual(result.domains, []);
      assert.equal(result.rejectedRows, 1);
      assert.equal(result.truncated, true);
    }

    const mixed = summarizeCtResults([
      { id: 1 },
      row({ id: 2, name_value: 'retained.example.com', common_name: '' }),
    ]);
    assert.deepEqual(mixed.domains, ['retained.example.com']);
    assert.equal(mixed.rejectedRows, 1);
    assert.equal(mixed.truncated, true);

    const validNoCandidate = summarizeCtResults([{ name_value: 'co.uk', common_name: '' }]);
    assert.equal(validNoCandidate.rejectedRows, 0);
    assert.equal(validNoCandidate.truncated, false);

    const oneValidSibling = summarizeCtResults([{ name_value: 'a.example.com', common_name: '' }]);
    assert.equal(oneValidSibling.rejectedRows, 0);
    assert.equal(oneValidSibling.truncated, false);
  });
});

// ---------------------------------------------------------------------------
// Production search integration (mocked upstream; no network)
// ---------------------------------------------------------------------------

describe('searchCertificateTransparency', () => {
  test('empty query returns the additive empty contract without fetching', async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      throw new Error('fetch should not run');
    };

    const result = await searchCertificateTransparency('   ', { fetcher });

    assert.deepStrictEqual({ domains: result.domains, certCount: result.certCount, truncated: result.truncated, matches: result.matches }, {
      domains: [], certCount: 0, truncated: false, matches: [],
    });
    assert.equal(result.observation.version, 1);
    assert.equal(result.observation.status, 'success');
    assert.equal(result.observation.source, 'certificate_transparency');
    assert.equal(called, false);
  });

  test('preserves raw-row certCount while attaching structured provenance', async () => {
    const fetcher = async () => new Response(JSON.stringify([
      row({ id: 1, name_value: 'a.example.com', common_name: '' }),
      row({ id: 1, name_value: 'b.example.com', common_name: '' }),
    ]), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await searchCertificateTransparency('example', { fetcher });

    assert.equal(result.certCount, 2);
    assert.deepStrictEqual(result.domains, ['a.example.com', 'b.example.com']);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
    assert.equal(result.observation.complete, true);
    assert.equal(result.observation.diagnostics.certificateRows, 2);
  });

  test('marks a retained result partial when malformed source rows were excluded', async () => {
    const result = await searchCertificateTransparency('example', {
      fetcher: async () => new Response(JSON.stringify([
        row({ id: 1, name_value: 'a.example.com', common_name: '' }),
        null,
      ]), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(result.rejectedRows, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.observation.status, 'partial');
    assert.equal(result.observation.complete, false);
    assert.equal(result.observation.diagnostics.rejectedRows, 1);
    assert.match(result.observation.limitations.join(' '), /malformed fields were excluded/iu);
  });

  test('rejects malformed UTF-8 at the CT response boundary', async () => {
    for (const body of [
      '[{"id":1,"name_value":"a.example.com~","common_name":""}]',
      '[{"id":1,"name_value~":"a.example.com","common_name":""}]',
      '[{"id":1,"name_value":"a.example.com","entry_timestamp":"2026-01-01T00:00:00Z~"}]',
    ]) {
      const bytes = Buffer.from(body, 'utf8');
      const marker = bytes.indexOf('~'.charCodeAt(0));
      assert.notEqual(marker, -1);
      bytes[marker] = 0xff;
      let cancelled = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); },
        cancel() { cancelled += 1; },
      });
      await assert.rejects(
        searchCertificateTransparency('example', {
          fetcher: async () => new Response(stream, { status: 200 }),
        }),
        /utf-?8|encoded data/iu,
      );
      assert.equal(cancelled, 1);
    }
  });

  test('preserves valid split multibyte CT input and literal replacement characters', async () => {
    const body = JSON.stringify([
      row({ id: 1, name_value: 'a.example.com', common_name: '', issuer_name: 'Bücher � CA' }),
    ]);
    const bytes = new TextEncoder().encode(body);
    const splitAt = bytes.indexOf(0xc3) + 1;
    assert.ok(splitAt > 0);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    const result = await searchCertificateTransparency('example', {
      fetcher: async () => new Response(stream, { status: 200 }),
    });
    assert.equal(result.rejectedRows, 0);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.domains, ['a.example.com']);
  });

  test('rejects an invalid query before invoking the safe request boundary', async () => {
    let calls = 0;
    await assert.rejects(
      searchCertificateTransparency('x'.repeat(MAX_CT_QUERY_LENGTH + 1), {
        fetcher: async () => {
          calls += 1;
          throw new Error('fetch should not run');
        },
      }),
      /must be at most 200 characters/,
    );
    assert.equal(calls, 0);
  });

  test('rejects a non-array upstream JSON response cleanly', async () => {
    const fetcher = async () => new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await assert.rejects(
      searchCertificateTransparency('example', { fetcher }),
      /unexpected response format \(expected a JSON array\)/,
    );
  });

  test('uses the injected safe request boundary and propagates its redirect rejection', async () => {
    const calls: Array<{ url: string; options: RequestInit | undefined; redirectsLeft: number | undefined }> = [];
    const fetcher = async (url: string, options?: RequestInit, redirectsLeft?: number) => {
      calls.push({ url, options, redirectsLeft });
      throw new Error('Refusing to fetch redirect target: resolves to a private/reserved address');
    };

    await assert.rejects(
      searchCertificateTransparency('example', { fetcher }),
      /private\/reserved address/,
    );
    assert.equal(calls.length, 1);
    const call = requiredValue(calls[0]);
    assert.equal(call.url, 'https://crt.sh/?q=example&output=json');
    assert.equal(new Headers(call.options?.headers).get('accept'), 'application/json');
    assert.ok(call.options?.signal instanceof AbortSignal);
    assert.equal(call.redirectsLeft, 0);
  });

  test('preserves bounded status retry behavior through the safe request boundary', async () => {
    const responses = [
      new Response('', { status: 503 }),
      new Response(JSON.stringify([row()]), { status: 200 }),
    ];
    const waits: number[] = [];
    let calls = 0;
    const result = await searchCertificateTransparency('example', {
      fetcher: async () => {
        calls += 1;
        return requiredValue(responses.shift());
      },
      delay: async (ms) => { waits.push(ms); },
    });

    assert.equal(calls, 2);
    assert.deepStrictEqual(waits, [1500]);
    assert.equal(result.certCount, 1);
  });

  test('preserves the single timeout retry through the safe request boundary', async () => {
    let calls = 0;
    const result = await searchCertificateTransparency('example', {
      fetcher: async () => {
        calls += 1;
        if (calls === 1) throw new DOMException('timed out', 'AbortError');
        return new Response(JSON.stringify([row()]), { status: 200 });
      },
    });

    assert.equal(calls, 2);
    assert.equal(result.certCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Registrable-domain grouping
// ---------------------------------------------------------------------------

describe('registrable-domain grouping', () => {
  test('multiple hostnames on one cert grouped under one domain', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com\nb.example.com\nc.example.com', common_name: '' }),
    ]);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
    assert.deepStrictEqual(requiredValue(result.matches[0]).hostnames, ['a.example.com', 'b.example.com', 'c.example.com']);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
  });

  test('one certificate spanning two registrable domains', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com\nb.other.invalid', common_name: '' }),
    ]);
    const matchDomains = result.matches.map((m) => m.domain).sort();
    assert.deepStrictEqual(matchDomains, ['example.com', 'other.invalid']);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
    assert.equal(requiredValue(result.matches[1]).certificateCount, 1);
  });

  test('subdomains preserved while grouped by registrable domain', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'deep.sub.example.com\nlogin.example.com', common_name: 'www.example.com' }),
    ]);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
    assert.deepStrictEqual(
      requiredValue(result.matches[0]).hostnames,
      ['deep.sub.example.com', 'login.example.com', 'www.example.com'],
    );
  });

  test('multi-label public suffix (example.co.uk)', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'login.example.co.uk\nwww.example.co.uk\nexample.co.uk', common_name: '' }),
    ]);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.co.uk');
    assert.deepStrictEqual(requiredValue(result.matches[0]).hostnames, ['example.co.uk', 'login.example.co.uk', 'www.example.co.uk']);
  });

  test('bare public suffix co.uk excluded from structured matches', () => {
    const result = summarizeCtResults([
      row({ name_value: 'co.uk', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.matches, []);
    // But still in legacy.
    assert.deepStrictEqual(result.domains, ['co.uk']);
  });

  test('invalid hostnames and IP literals excluded from structured matches', () => {
    const result = summarizeCtResults([
      row({ name_value: '192.168.0.1\ninvalid_host\nexample.com', common_name: '' }),
    ]);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
  });
});

// ---------------------------------------------------------------------------
// Certificate identity
// ---------------------------------------------------------------------------

describe('certificate identity', () => {
  test('same id deduplicates within a group', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', common_name: '' }),
      row({ id: 1, name_value: 'b.example.com', common_name: '' }),
      row({ id: 2, name_value: 'c.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('retains bounded per-certificate hostname and registrable-domain groups', () => {
    const result = summarizeCtResults([
      row({ id: 41, name_value: '*.login.example.com\nwww.example.net', common_name: 'example.com', entry_timestamp: '2026-08-01T00:00:00Z' }),
      row({ id: 41, name_value: 'checkout.example.org', common_name: '', entry_timestamp: '2026-08-02T00:00:00Z' }),
      row({ id: 42, name_value: 'single.example.com', common_name: '', entry_timestamp: '2026-08-03T00:00:00Z' }),
    ]);
    const shared = requiredValue(result.certificateGroups.find((group) => group.certificateKey === 'id:41'));
    assert.deepStrictEqual(shared.domains, ['example.com', 'example.net', 'example.org']);
    assert.deepStrictEqual(shared.hostnames, ['checkout.example.org', 'example.com', 'login.example.com', 'www.example.net']);
    assert.equal(shared.observedAt, '2026-08-02T00:00:00.000Z');
    assert.equal(shared.wildcardObserved, true);
    assert.equal(result.certificateGroups.length, 2);
  });

  test('numeric string id equivalent to number id', () => {
    const result = summarizeCtResults([
      row({ id: 12345, name_value: 'a.example.com', common_name: '' }),
      row({ id: '12345', name_value: 'b.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
  });

  test('leading zeros canonicalised', () => {
    const result = summarizeCtResults([
      row({ id: '00123', name_value: 'a.example.com', common_name: '' }),
      row({ id: 123, name_value: 'b.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
  });

  test('ids above MAX_SAFE_INTEGER remain distinct', () => {
    // 9007199254740992 and 9007199254740993 both collapse to 9007199254740992
    // if passed through Number(), but must remain distinct via BigInt.
    const result = summarizeCtResults([
      row({ id: '9007199254740992', name_value: 'a.example.com', common_name: '' }),
      row({ id: '9007199254740993', name_value: 'b.example.com', common_name: '' }),
      row({ id: '9007199254740994', name_value: 'c.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 3);
  });

  test('overlong digit string rejected', () => {
    const overlong = '1'.repeat(33);
    const result = summarizeCtResults([
      row({ id: overlong, issuer_ca_id: null, serial_number: null, name_value: 'a.example.com', common_name: '' }),
      row({ id: overlong, issuer_ca_id: null, serial_number: null, name_value: 'b.example.com', common_name: '' }),
    ]);
    // Both fall through to row-level identity.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('raw id length is bounded before trimming', () => {
    const padded = `${' '.repeat(32)}1`;
    const result = summarizeCtResults([
      row({ id: padded, issuer_ca_id: null, serial_number: null, name_value: 'a.example.com', common_name: '' }),
      row({ id: padded, issuer_ca_id: null, serial_number: null, name_value: 'b.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('zero and negative ids rejected', () => {
    const result = summarizeCtResults([
      row({ id: 0, issuer_ca_id: null, serial_number: null, name_value: 'a.example.com', common_name: '' }),
      row({ id: 0, issuer_ca_id: null, serial_number: null, name_value: 'b.example.com', common_name: '' }),
      row({ id: -1, issuer_ca_id: null, serial_number: null, name_value: 'c.example.com', common_name: '' }),
    ]);
    // All fall through to row-level identity.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 3);
  });

  test('non-integer number id rejected', () => {
    const result = summarizeCtResults([
      row({ id: 1.5, issuer_ca_id: null, serial_number: null, name_value: 'a.example.com', common_name: '' }),
      row({ id: 1.5, issuer_ca_id: null, serial_number: null, name_value: 'b.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('issuer-serial composite fallback', () => {
    const result = summarizeCtResults([
      row({ id: null, issuer_ca_id: 100, serial_number: 'abc', name_value: 'a.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: 'abc', name_value: 'b.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: 'ABC', name_value: 'c.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 200, serial_number: 'abc', name_value: 'd.example.com', common_name: '' }),
    ]);
    // First three share same issuer+serial (case-insensitive serial), fourth is different.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('irrelevant serial_number rejected', () => {
    const result = summarizeCtResults([
      row({ id: null, issuer_ca_id: 100, serial_number: '\x00control', name_value: 'a.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: '\x00control', name_value: 'b.example.com', common_name: '' }),
    ]);
    // Control chars → serial rejected → both fall to row identity.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('malformed hex serial falls through to row identity', () => {
    const result = summarizeCtResults([
      row({ id: null, issuer_ca_id: 100, serial_number: 'not-hex!', name_value: 'a.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: 'not-hex!', name_value: 'b.example.com', common_name: '' }),
    ]);
    // Malformed serial → both fall to row identity → 2 distinct certs.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('serial with embedded newline rejected before trim', () => {
    const result = summarizeCtResults([
      row({ id: null, issuer_ca_id: 100, serial_number: '\nabc\n', name_value: 'a.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: '\nabc\n', name_value: 'b.example.com', common_name: '' }),
    ]);
    // Control chars in original string → serial rejected → both fall to row identity.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('raw serial length is bounded before trimming', () => {
    const padded = `${' '.repeat(128)}a`;
    const result = summarizeCtResults([
      row({ id: null, issuer_ca_id: 100, serial_number: padded, name_value: 'a.example.com', common_name: '' }),
      row({ id: null, issuer_ca_id: 100, serial_number: padded, name_value: 'b.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('row fallback identity', () => {
    const result = summarizeCtResults([
      { name_value: 'a.example.com', common_name: '' },
      { name_value: 'b.example.com', common_name: '' },
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });

  test('namespace separation prevents collision', () => {
    // A row with id=0 (rejected) at index 0 would produce `row:0`.
    // A row with id='0' (also rejected) at index 0 would also produce `row:0` — same.
    // But a row with a valid id='0' is rejected (zero), so `row:0` only comes from
    // the fallback. The namespace id:... vs row:... vs issuer-serial:... prevents
    // overlap between tiers.
    // Test: id:1 should not collide with row:1.
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', common_name: '' }),
      { name_value: 'b.example.com', common_name: '' }, // row index 1 → row:1
    ]);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 2);
  });
});

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

describe('timestamps', () => {
  test('earliest and latest valid timestamps', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '2026-03-01T00:00:00.000Z' }),
      row({ id: 2, name_value: 'a.example.com', entry_timestamp: '2026-01-01T00:00:00.000Z' }),
      row({ id: 3, name_value: 'a.example.com', entry_timestamp: '2026-06-01T00:00:00.000Z' }),
    ]);
    assert.ok(requiredValue(requiredValue(result.matches[0]).firstObservedAt).includes('2026-01-01'));
    assert.ok(requiredValue(requiredValue(result.matches[0]).lastObservedAt).includes('2026-06-01'));
  });

  test('invalid timestamps ignored', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: 'not-a-date' }),
      row({ id: 2, name_value: 'a.example.com', entry_timestamp: '2026-06-01T00:00:00.000Z' }),
      row({ id: 3, name_value: 'a.example.com', entry_timestamp: null }),
      row({ id: 4, name_value: 'a.example.com', entry_timestamp: 123456789 }),
      row({ id: 5, name_value: 'a.example.com', entry_timestamp: true }),
    ]);
    // Only the one valid timestamp.
    assert.ok(requiredValue(requiredValue(result.matches[0]).firstObservedAt).includes('2026-06-01'));
    assert.ok(requiredValue(requiredValue(result.matches[0]).lastObservedAt).includes('2026-06-01'));
  });

  test('no valid timestamps → null', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: null }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, null);
    assert.equal(requiredValue(result.matches[0]).lastObservedAt, null);
  });

  test('timestamp aggregation inspects all rows including deduplicated certs', () => {
    // Same cert ID, different timestamps.
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '2026-01-01T00:00:00.000Z' }),
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '2026-12-01T00:00:00.000Z' }),
    ]);
    // certificateCount is 1 (deduplicated), but both timestamps are used.
    assert.equal(requiredValue(result.matches[0]).certificateCount, 1);
    assert.ok(requiredValue(requiredValue(result.matches[0]).firstObservedAt).includes('2026-01-01'));
    assert.ok(requiredValue(requiredValue(result.matches[0]).lastObservedAt).includes('2026-12-01'));
  });

  test('timestamp at length boundary accepted', () => {
    // 64 chars exactly — valid ISO-8601 with fractional seconds padding.
    // '2026-01-01T00:00:00.' = 20 chars, 'Z' = 1 char, 43 zeros = 64 total.
    const ts = '2026-01-01T00:00:00.' + '0'.repeat(43) + 'Z';
    assert.equal(ts.length, 64);
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: ts }),
    ]);
    assert.notEqual(requiredValue(result.matches[0]).firstObservedAt, null);
  });

  test('overlong timestamp rejected', () => {
    const ts = 'x'.repeat(65);
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: ts }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, null);
  });

  test('raw timestamp length is bounded before trimming', () => {
    const ts = `${' '.repeat(64)}2026-01-01T00:00:00.000Z`;
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: ts }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, null);
  });

  test('timestamp with leading newline rejected', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '\n2026-01-01T00:00:00.000Z' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, null);
  });

  test('timestamp with trailing tab rejected', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '2026-01-01T00:00:00.000Z\t' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, null);
  });

  test('ordinary crt.sh timestamp still accepted', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', entry_timestamp: '2026-01-15T12:00:00.000' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).firstObservedAt, '2026-01-15T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('deterministic ordering', () => {
  test('matches sorted newest lastObservedAt first', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.example.com', common_name: '', entry_timestamp: '2026-01-01T00:00:00.000Z' }),
      row({ id: 2, name_value: 'b.other.org', common_name: '', entry_timestamp: '2026-06-01T00:00:00.000Z' }),
    ]);
    // other.org has newer timestamp → should be first.
    assert.equal(requiredValue(result.matches[0]).domain, 'other.org');
    assert.equal(requiredValue(result.matches[1]).domain, 'example.com');
  });

  test('null timestamps sorted last', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'a.com', common_name: '', entry_timestamp: '2026-01-01T00:00:00.000Z' }),
      row({ id: 2, name_value: 'b.com', common_name: '', entry_timestamp: null }),
    ]);
    assert.equal(requiredValue(result.matches[0]).domain, 'a.com');
    assert.equal(requiredValue(result.matches[1]).domain, 'b.com');
  });

  test('equal timestamps fall back to domain name', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'z.com', common_name: '', entry_timestamp: ts }),
      row({ id: 2, name_value: 'a.com', common_name: '', entry_timestamp: ts }),
    ]);
    // Both have the same timestamp; tiebreaker is domain name alphabetically.
    assert.equal(requiredValue(result.matches[0]).domain, 'a.com');
    assert.equal(requiredValue(result.matches[1]).domain, 'z.com');
  });

  test('hostnames sorted alphabetically within match', () => {
    const result = summarizeCtResults([
      row({ id: 1, name_value: 'z.example.com\na.example.com\nm.example.com', common_name: '' }),
    ]);
    assert.deepStrictEqual(requiredValue(result.matches[0]).hostnames, ['a.example.com', 'm.example.com', 'z.example.com']);
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('bounds', () => {
  test('hostname-per-match cap', () => {
    const names = [];
    for (let i = 0; i < 60; i++) {
      names.push(`host${i}.example.com`);
    }
    const result = summarizeCtResults([
      row({ id: 1, name_value: names.join('\n'), common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).hostnames.length, 50);
    assert.equal(result.truncated, true);
  });

  test('match count cap', () => {
    const rows = [];
    for (let i = 0; i < 600; i++) {
      rows.push(row({ id: i + 1, name_value: `host.unique${i}.invalid`, common_name: '' }));
    }
    const result = summarizeCtResults(rows);
    assert.equal(result.matches.length, 500);
    assert.equal(result.truncated, true);
  });

  test('certificateCount includes all deduplicated certs even when hostnames capped', () => {
    const names = [];
    for (let i = 0; i < 60; i++) {
      names.push(`host${i}.example.com`);
    }
    const result = summarizeCtResults([
      row({ id: 1, name_value: names.join('\n'), common_name: '' }),
      row({ id: 2, name_value: 'host0.example.com', common_name: '' }),
      row({ id: 3, name_value: 'host0.example.com', common_name: '' }),
    ]);
    assert.equal(requiredValue(result.matches[0]).hostnames.length, 50);
    assert.equal(requiredValue(result.matches[0]).certificateCount, 3);
  });

  test('hostname truncation does not alter timestamp aggregation', () => {
    const names = [];
    for (let i = 0; i < 60; i++) {
      names.push(`host${i}.example.com`);
    }
    const result = summarizeCtResults([
      row({ id: 1, name_value: names.join('\n'), entry_timestamp: '2026-01-01T00:00:00.000Z' }),
      row({ id: 2, name_value: 'host0.example.com', entry_timestamp: '2026-12-01T00:00:00.000Z' }),
    ]);
    assert.ok(requiredValue(requiredValue(result.matches[0]).firstObservedAt).includes('2026-01-01'));
    assert.ok(requiredValue(requiredValue(result.matches[0]).lastObservedAt).includes('2026-12-01'));
  });

  test('no-registrable-domain exclusions do not set truncated', () => {
    const result = summarizeCtResults([
      row({ name_value: 'co.uk', common_name: '' }),
      row({ name_value: 'example.com', common_name: '' }),
    ]);
    assert.equal(result.truncated, false);
  });
});

// ---------------------------------------------------------------------------
// Non-mutation
// ---------------------------------------------------------------------------

describe('non-mutation', () => {
  test('input rows not mutated', () => {
    const rows = [row({ id: 1, name_value: 'example.com' })];
    const copy = JSON.parse(JSON.stringify(rows));
    summarizeCtResults(rows);
    assert.deepStrictEqual(rows, copy);
  });
});

// ---------------------------------------------------------------------------
// Invalid structured values do not affect legacy
// ---------------------------------------------------------------------------

describe('invalid structured values do not affect legacy', () => {
  test('control character hostname excluded from both', () => {
    const result = summarizeCtResults([
      row({ name_value: 'example.com\nhost\x00.invalid', common_name: '' }),
    ]);
    assert.deepStrictEqual(result.domains, ['example.com']);
    assert.equal(result.matches.length, 1);
    assert.equal(requiredValue(result.matches[0]).domain, 'example.com');
  });
});
