import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { registryServiceAdmissionFor } from '../lib/registry-capabilities.mts';
import { fetchRdapRecord } from '../lib/rdap.mts';
import { buildWhoisChainUncached } from '../lib/whois.mts';

describe('registry collection admission', () => {
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

  test('blocks unpublished RDAP before resolving or fetching a bootstrap service', async () => {
    let calls = 0;
    const record = await fetchRdapRecord('domain', 'example.gt', {
      fetchRecord: async () => {
        calls += 1;
        return null;
      },
    });

    assert.equal(record, null);
    assert.equal(calls, 0);
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
  });
});
