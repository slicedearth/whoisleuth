import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildRegistryInsights } from '../lib/registry-insights.mts';

describe('registry insight interpretation', () => {
  test('keeps privacy proxy, raw lifecycle statuses, and registry locks distinct', () => {
    const result = buildRegistryInsights({
      rdapStatus: 'success',
      rdapFetchedAt: '2026-07-28T00:00:00.000Z',
      rdapParsed: {
        statuses: ['client transfer prohibited', 'server update prohibited', 'redemption period'],
        registrant: { org: 'Example Privacy Protection Service' },
        abuse: { email: 'registry-abuse@example.test' },
        conformance: ['rdap_level_0'],
        redactions: [],
      },
      whoisStatus: 'complete',
      whoisParsed: {
        statuses: ['clientTransferProhibited', 'redemptionPeriod'],
        registrantOrg: 'REDACTED FOR PRIVACY',
        chainStatus: 'complete',
        fieldsTruncated: [],
      },
    });

    assert.equal(result.contactDisclosure.registryRdap.state, 'privacy_proxy');
    assert.equal(result.contactDisclosure.whois.state, 'redacted');
    assert.equal(result.lifecycle.stage, 'redemption');
    assert.equal(result.lifecycle.redemption, true);
    assert.equal(result.lifecycle.pendingDelete, false);
    assert.equal(result.lifecycle.locks.client, true);
    assert.equal(result.lifecycle.locks.server, true);
    assert.deepEqual(result.lifecycle.rawStatuses, [
      'client transfer prohibited',
      'server update prohibited',
      'redemption period',
    ]);
    assert.equal(result.publications[0]?.state, 'complete');
    assert.equal(result.abuseRouting[0]?.contact, 'registry-abuse@example.test');
    assert.equal(result.rdapCapabilities.registry.state, 'complete');
    assert.equal(result.rdapCapabilities.registry.reverseSearch.state, 'not_advertised');
    assert.equal(result.rdapCapabilities.registrar.state, 'unavailable');
  });

  test('separates pending delete from redemption and does not promise acquisition', () => {
    const result = buildRegistryInsights({
      rdapStatus: 'success',
      rdapParsed: {
        statuses: ['pendingDelete'],
        registrant: null,
        redactions: [{ name: 'Registrant', method: 'removal', postPath: '$.entities' }],
      },
      whoisStatus: 'error',
    });

    assert.equal(result.lifecycle.stage, 'pending_delete');
    assert.equal(result.lifecycle.pendingDelete, true);
    assert.equal(result.lifecycle.redemption, false);
    assert.match(result.lifecycle.limitation, /do not guarantee deletion/iu);
    assert.equal(result.contactDisclosure.registryRdap.state, 'redacted');
    assert.equal(result.contactDisclosure.whois.state, 'unavailable');
    assert.equal(result.reconciliation.state, 'partial');
  });

  test('reports source-only publication separately from conflict', () => {
    const result = buildRegistryInsights({
      rdapStatus: 'success',
      rdapParsed: {
        domain: 'candidate.example',
        registrar: { name: 'Example Registrar' },
        statuses: ['active'],
        nameservers: ['ns1.example.test'],
        registrant: { name: 'Public Registrant' },
      },
      whoisStatus: 'complete',
      whoisParsed: {
        domainName: 'candidate.example',
        registrar: 'Example Registrar',
        statuses: ['active'],
        nameservers: [],
        registrantName: 'Public Registrant',
        chainStatus: 'complete',
        fieldsTruncated: [],
      },
    });

    assert.equal(result.reconciliation.conflictCount, 0);
    assert.equal(result.reconciliation.sourceOnlyCount, 1);
    assert.equal(result.reconciliation.state, 'source_specific');
    assert.equal(result.contactDisclosure.registryRdap.state, 'public');
    assert.equal(result.contactDisclosure.whois.state, 'public');
  });

  test('keeps truncated publication diagnostics partial', () => {
    const result = buildRegistryInsights({
      rdapStatus: 'success',
      rdapParsed: {
        statuses: [],
        registrant: null,
        serverTruncated: true,
        entitiesTruncated: true,
        statusesTruncated: false,
        conformance: ['rdap_level_0'],
      },
      whoisStatus: 'partial',
      whoisParsed: {
        statuses: [],
        chainStatus: 'partial',
        fieldsTruncated: ['registrantAddress'],
      },
      registrarRdapStatus: 'unsupported',
    });

    assert.equal(result.publications[0]?.state, 'partial');
    assert.equal(result.publications[0]?.issueCount, 2);
    assert.equal(result.publications[1]?.state, 'partial');
    assert.equal(result.publications[2]?.state, 'unavailable');
    assert.equal(result.contactDisclosure.registryRdap.state, 'unavailable');
    assert.match(result.contactDisclosure.registryRdap.detail, /partial/iu);
  });

  test('does not convert a nominal success without normalized publication data into absence', () => {
    const result = buildRegistryInsights({
      rdapStatus: 'success',
      whoisStatus: 'complete',
    });

    assert.equal(result.contactDisclosure.registryRdap.state, 'unavailable');
    assert.equal(result.contactDisclosure.whois.state, 'unavailable');
    assert.equal(result.publications[0]?.state, 'unavailable');
    assert.equal(result.publications[1]?.state, 'unavailable');
  });
});
