const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchRegistrarRdapRecord,
  selectRegistrarRdapLink,
} = require('../lib/rdap.mts');

function link(href, extra = {}) {
  return { rel: 'related', href, type: 'application/rdap+json', ...extra };
}

function registryRecord(domain, links) {
  return {
    rdapServer: `https://registry.test/rdap/domain/${domain}`,
    parsed: { domain: domain.toUpperCase(), links },
  };
}

describe('registrar RDAP link selection', () => {
  test('selects the first eligible complete domain-object link', () => {
    const links = [
      link('http://insecure.test/domain/selection.example'),
      link('https://first.test/rdap/domain/selection.example'),
      link('https://second.test/domain/selection.example'),
    ];
    assert.equal(
      selectRegistrarRdapLink('selection.example', links),
      'https://first.test/rdap/domain/selection.example'
    );
  });

  test('ignores ineligible neighbours without changing the eligible result', () => {
    const eligible = link('https://registrar.test/domain/neighbours.example');
    const rejected = [
      link('https://registrar.test/domain/other.example'),
      link('https://registrar.test/domain/neighbours.example?q=1'),
    ];
    assert.equal(selectRegistrarRdapLink('neighbours.example', [...rejected, eligible]), eligible.href);
    assert.equal(selectRegistrarRdapLink('neighbours.example', [rejected[1], eligible, rejected[0]]), eligible.href);
  });

  test('accepts a trailing slash, media-type parameters, and an explicit default HTTPS port', () => {
    assert.equal(
      selectRegistrarRdapLink('compatible.example', [link(
        'https://registrar.test:443/rdap/domain/compatible.example/',
        { type: 'application/rdap+json; charset=utf-8' }
      )]),
      'https://registrar.test/rdap/domain/compatible.example/'
    );
  });

  test('matches Unicode input against its canonical A-label path', () => {
    assert.equal(
      selectRegistrarRdapLink('bücher.example', [
        link('https://registrar.test/domain/xn--bcher-kva.example'),
      ]),
      'https://registrar.test/domain/xn--bcher-kva.example'
    );
  });

  test('rejects every unsafe or incompatible link rule independently', () => {
    const domain = 'blocked.example';
    const invalid = [
      link(`http://registrar.test/domain/${domain}`),
      link(`https://user@registrar.test/domain/${domain}`),
      link(`https://registrar.test:8443/domain/${domain}`),
      link(`https://registrar.test/domain/${domain}?view=full`),
      link(`https://registrar.test/domain/${domain}#record`),
      link(`https://127.0.0.1/domain/${domain}`),
      link(`https://[::1]/domain/${domain}`),
      link('https://registrar.test/rdap'),
      link('https://registrar.test/domain/other.example'),
      link(`https://registrar.test/domain/${domain}`, { rel: 'self' }),
      link(`https://registrar.test/domain/${domain}`, { type: 'application/json' }),
      link(`https://${'a'.repeat(2050)}.test/domain/${domain}`),
      link(`https://registrar.test/domain/${domain}\nforged`),
    ];
    for (const candidate of invalid) {
      assert.equal(selectRegistrarRdapLink(domain, [candidate]), null, candidate.href);
    }
  });

  test('rejects a self-loop to the registry domain endpoint', () => {
    assert.equal(
      selectRegistrarRdapLink(
        'loop.example',
        [link('https://registry.test/RDAP/DOMAIN/LOOP.EXAMPLE/')],
        'https://registry.test/rdap/domain/loop.example'
      ),
      null
    );
  });
});

describe('registrar RDAP fetching', () => {
  test('returns separately attributed parsed data without mutating the registry record', async () => {
    const domain = 'success-registrar.example';
    const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
    const before = structuredClone(record);
    const result = await fetchRegistrarRdapRecord(domain, record, {
      fetchUpstream: async (url, options, timeout) => {
        assert.equal(url, `https://registrar.test/domain/${domain}`);
        assert.equal(options.headers.Accept, 'application/rdap+json');
        assert.equal(timeout, 7000);
        return {
          status: 200,
          ok: true,
          text: JSON.stringify({
            objectClassName: 'domain',
            ldhName: domain.toUpperCase(),
            status: ['active'],
            entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', 'abuse@registrar.test']]] }],
          }),
        };
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.endpoint, `https://registrar.test/domain/${domain}`);
    assert.equal(result.parsed.domain, domain.toUpperCase());
    assert.equal(result.parsed.abuse.emails[0], 'abuse@registrar.test');
    assert.equal(result.attempt.outcome, 'success');
    assert.equal(result.attempt.selected, true);
    assert.deepEqual(record, before);
  });

  test('returns and caches a neutral unsupported result without fetching', async () => {
    const domain = 'unsupported-registrar.example';
    let calls = 0;
    const options = { fetchUpstream: async () => { calls += 1; } };
    const first = await fetchRegistrarRdapRecord(domain, registryRecord(domain, []), options);
    const second = await fetchRegistrarRdapRecord(domain, registryRecord(domain, []), options);
    assert.equal(first.status, 'unsupported');
    assert.equal(second.status, 'unsupported');
    assert.equal(calls, 0);
  });

  test('returns and caches a registrar 404 as diagnostic-only not_found', async () => {
    const domain = 'missing-registrar.example';
    const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
    let calls = 0;
    const options = {
      fetchUpstream: async () => {
        calls += 1;
        return { status: 404, ok: false, text: JSON.stringify({ errorCode: 404 }) };
      },
    };
    const first = await fetchRegistrarRdapRecord(domain, record, options);
    const second = await fetchRegistrarRdapRecord(domain, record, options);
    assert.equal(first.status, 'not_found');
    assert.equal(first.parsed, null);
    assert.equal(first.attempt.outcome, 'not_found');
    assert.equal(second.status, 'not_found');
    assert.equal(calls, 1);
  });

  test('rejects wrong-domain registrar objects with bounded attempt provenance', async () => {
    const domain = 'validation-registrar.example';
    const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
    await assert.rejects(
      fetchRegistrarRdapRecord(domain, record, {
        fetchUpstream: async () => ({
          status: 200,
          ok: true,
          text: JSON.stringify({ objectClassName: 'domain', ldhName: 'OTHER.EXAMPLE' }),
        }),
      }),
      (error) => {
        assert.equal(error.registrarRdap.status, 'error');
        assert.equal(error.registrarRdap.attempt.outcome, 'invalid_response');
        assert.match(error.registrarRdap.detail, /did not match/i);
        return true;
      }
    );
  });

  test('accepts only redirects that remain inside the HTTPS matching-object boundary', async () => {
    const acceptedDomain = 'redirect-ok-registrar.example';
    const accepted = await fetchRegistrarRdapRecord(
      acceptedDomain,
      registryRecord(acceptedDomain, [link(`https://registrar.test/domain/${acceptedDomain}`)]),
      { fetchUpstream: async () => ({
        status: 200, ok: true,
        finalUrl: `https://regional-registrar.test/rdap/domain/${acceptedDomain}`,
        text: JSON.stringify({ objectClassName: 'domain', ldhName: acceptedDomain.toUpperCase() }),
      }) }
    );
    assert.equal(accepted.endpoint, `https://regional-registrar.test/rdap/domain/${acceptedDomain}`);

    for (const [domain, finalUrl] of [
      ['redirect-http-registrar.example', 'http://registrar.test/domain/redirect-http-registrar.example'],
      ['redirect-path-registrar.example', 'https://registrar.test/rdap'],
      ['redirect-name-registrar.example', 'https://registrar.test/domain/other.example'],
    ]) {
      const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
      await assert.rejects(
        fetchRegistrarRdapRecord(domain, record, { fetchUpstream: async () => ({
          status: 200, ok: true, finalUrl,
          text: JSON.stringify({ objectClassName: 'domain', ldhName: domain.toUpperCase() }),
        }) }),
        (error) => error.registrarRdap?.attempt?.outcome === 'invalid_response',
        domain
      );
    }
  });

  test('classifies HTTP, JSON, timeout, and oversized-body failures', async () => {
    const scenarios = [
      ['rate-registrar.example', async () => ({ status: 429, ok: false, text: '{}' }), 'rate_limited'],
      ['server-registrar.example', async () => ({ status: 503, ok: false, text: '<html>' }), 'server_error'],
      ['json-registrar.example', async () => ({ status: 200, ok: true, text: '<html>' }), 'invalid_json'],
      ['timeout-registrar.example', async () => { const error = new Error('timed out'); error.name = 'AbortError'; throw error; }, 'timeout'],
      ['large-registrar.example', async () => { throw new Error('Response exceeded 2000000 bytes'); }, 'invalid_response'],
    ];
    for (const [domain, fetchUpstream, expected] of scenarios) {
      const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
      await assert.rejects(
        fetchRegistrarRdapRecord(domain, record, { fetchUpstream }),
        (error) => error.registrarRdap?.attempt?.outcome === expected,
        domain
      );
    }
  });

  test('does not cache transient failures', async () => {
    const domain = 'retry-registrar.example';
    const record = registryRecord(domain, [link(`https://registrar.test/domain/${domain}`)]);
    let calls = 0;
    const fetchUpstream = async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary network failure');
      return {
        status: 200,
        ok: true,
        text: JSON.stringify({ objectClassName: 'domain', ldhName: domain.toUpperCase() }),
      };
    };
    await assert.rejects(fetchRegistrarRdapRecord(domain, record, { fetchUpstream }));
    const result = await fetchRegistrarRdapRecord(domain, record, { fetchUpstream });
    assert.equal(result.status, 'success');
    assert.equal(calls, 2);
  });
});
