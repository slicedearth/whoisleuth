import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { registryCapabilityFor, registryServiceAdmissionFor } from '../lib/registry-capabilities.mts';
import { clearRdapBootstrapCache, fetchRdapRecord, rdapUnavailableResponse } from '../lib/rdap.mts';
import { fetchRdapRecordWithParser } from '../lib/rdap-client.mts';
import { buildWhoisChainUncached } from '../lib/whois.mts';

describe('registry collection admission', () => {
  beforeEach(clearRdapBootstrapCache);
  test('admits ordinary IANA-discovered machine services', () => {
    assert.deepEqual(
      registryServiceAdmissionFor('example.com', 'rdap')?.state,
      'allowed',
    );
    assert.deepEqual(
      registryServiceAdmissionFor('example.com', 'whois')?.state,
      'allowed',
    );
  });

  test('blocks unpublished services before opening a WHOIS socket', async () => {
    let calls = 0;
    const chain = await buildWhoisChainUncached('example.gt', {
      whoisQuery: async () => {
        calls += 1;
        return 'unexpected';
      },
    });

    assert.equal(calls, 0);
    assert.equal(chain.length, 1);
    assert.equal(chain[0]?.server, 'registry capability policy');
    assert.equal(chain[0]?.queryProfile, 'not-issued');
    assert.match(chain[0]?.error ?? '', /no socket was opened/u);
  });

  test('blocks permission-gated WHOIS before opening a socket', async () => {
    let calls = 0;
    const chain = await buildWhoisChainUncached('example.es', {
      whoisQuery: async () => {
        calls += 1;
        return 'unexpected';
      },
    });

    assert.equal(calls, 0);
    assert.equal(registryServiceAdmissionFor('example.es', 'whois')?.state, 'permission_required');
    assert.match(chain[0]?.error ?? '', /requires registry permission/u);
  });

  test('a retained absent RDAP hint does not suppress current bootstrap discovery', async () => {
    let calls = 0;
    const record = await fetchRdapRecord('domain', 'example.gt', {
      fetchRecord: async () => {
        calls += 1;
        return null;
      },
    });

    assert.equal(record, null);
    assert.equal(calls, 1);
    assert.equal(registryServiceAdmissionFor('example.gt', 'rdap')?.allowed, true);
    const diagnostic = rdapUnavailableResponse('domain', 'example.gt');
    assert.match(diagnostic.error, /via IANA bootstrap/u);
    assert.doesNotMatch(diagnostic.error, /not attempted/u);
    assert.equal('source' in diagnostic, false);
  });

  test('a newly bootstrapped service returns registry evidence without changing the retained catalogue', async () => {
    assert.equal(registryCapabilityFor('example.gt')?.rdapAccessProfile, 'no-iana-service');
    for (const published of [false, true]) {
      clearRdapBootstrapCache();
      const domain = `${published ? 'new-service' : 'no-service'}.example.gt`;
      const requests: string[] = [];
      const record = await fetchRdapRecord('domain', domain, {
        fetchRecord: (type, value, parser, options) => fetchRdapRecordWithParser(type, value, parser, {
          ...options,
          fetchUpstream: async url => {
            requests.push(url);
            if (url === 'https://data.iana.org/rdap/dns.json') {
              return { ok: true, status: 200, text: JSON.stringify({
                services: [[[published ? 'gt' : 'test'], ['https://registry.example/rdap/']]],
              }) };
            }
            assert.equal(url, `https://registry.example/rdap/domain/${domain}`);
            return { ok: true, status: 200, text: JSON.stringify({ objectClassName: 'domain', ldhName: domain }) };
          },
        }),
      });
      assert.deepEqual(requests, ['https://data.iana.org/rdap/dns.json',
        ...(published ? [`https://registry.example/rdap/domain/${domain}`] : [])]);
      if (published) {
        assert.equal(record?.parsed?.domain, domain);
        assert.equal(record?.attempts?.[0]?.outcome, 'success');
      } else {
        assert.equal(record, null);
      }
    }
    assert.equal(registryCapabilityFor('example.gt')?.rdapAccessProfile, 'no-iana-service');
    assert.equal(registryServiceAdmissionFor('example.gt', 'whois')?.allowed, false);
    assert.equal(registryServiceAdmissionFor('example.es', 'whois')?.state, 'permission_required');
  });

  test('cancelled discovery does not reach a newly admissible service', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchRdapRecord('domain', 'cancelled.example.gt', {
      signal: controller.signal,
      fetchRecord: async () => assert.fail('Cancelled collection must not start'),
    }), { name: 'AbortError' });
  });

  test('does not apply domain registry policy to IP or ASN RDAP', async () => {
    let calls = 0;
    await fetchRdapRecord('ipv4', '192.0.2.1', {
      fetchRecord: async () => {
        calls += 1;
        return null;
      },
    });
    await fetchRdapRecord('asn', 'AS64496', {
      fetchRecord: async () => {
        calls += 1;
        return null;
      },
    });

    assert.equal(calls, 2);
    assert.deepEqual(rdapUnavailableResponse('ipv4', '192.0.2.1'), {
      error: 'No RDAP registry found for "192.0.2.1" via IANA bootstrap',
    });
  });
});
