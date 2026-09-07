import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildRegistryInsights } from '../lib/registry-insights.mts';
import { parseRdap } from '../lib/rdap.mts';

describe('registry insight interpretation', () => {
  test('uses the full admitted status inventory independently of ordering, duplicates and display caps', () => {
    for (const status of [
      [...Array.from({ length: 80 }, () => 'active'), 'pending delete'],
      ['pending delete', ...Array.from({ length: 80 }, () => 'active')],
      [...Array.from({ length: 99 }, (_, index) => `status-${index}`), 'pending delete'],
    ]) {
      const parsed = parseRdap('domain', { ldhName: 'example.test', status });
      assert.ok(parsed);
      assert.equal(parsed.statuses.length, status.length);
      assert.equal(parsed.statusesTruncated, false);
      const result = buildRegistryInsights({ rdapParsed: parsed, rdapStatus: 'success' });
      assert.equal(result.lifecycle.pendingDelete, true);
      assert.equal(result.lifecycle.stage, 'pending_delete');
      assert.equal(result.publications[0]?.state, 'complete');
      assert.ok(result.lifecycle.rawStatuses.length <= 40);
      if (status.length === 100) assert.match(result.lifecycle.limitation, /40 of 100/u);
    }
    for (const parsed of [
      { statuses: [...Array.from({ length: 100 }, () => 'active'), 'pending delete'] },
      { statuses: ['active', {}] },
      parseRdap('domain', { ldhName: 'example.test', status: [...Array.from({ length: 100 }, () => 'active'), 'pending delete'] }),
    ]) {
      const result = buildRegistryInsights({ rdapParsed: parsed, rdapStatus: 'success' });
      assert.equal(result.lifecycle.pendingDelete, null);
      assert.equal(result.publications[0]?.state, 'partial');
    }
  });

  test('scopes disclosure to registrant evidence rather than unrelated redaction prose', () => {
    const entity = { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Published Contact']]] };
    for (const name of ['Technical Email', 'Unclassified Contact']) {
      const parsed = parseRdap('domain', {
        ldhName: 'example.test', entities: [entity],
        redacted: [{ name: { description: name }, reason: { description: 'Registrant requested privacy' }, method: 'removal',
          prePath: '$.entities[?(@.roles[0] == "technical")].vcardArray' }],
      });
      assert.ok(parsed);
      assert.equal(parsed.redactions.length, 1);
      assert.equal(parsed.registrant?.name, 'Published Contact');
      const result = buildRegistryInsights({ rdapParsed: parsed, rdapStatus: 'success' });
      assert.equal(result.contactDisclosure.registryRdap.state, 'public');
      assert.equal(result.publications[0]?.redactionCount, 1);
      const missing = buildRegistryInsights({ rdapParsed: { ...parsed, registrant: null }, rdapStatus: 'success' });
      assert.equal(missing.contactDisclosure.registryRdap.state, 'unavailable');
    }
    const scoped = parseRdap('domain', { ldhName: 'example.test', entities: [entity],
      redacted: [{ name: { description: 'Registrant Email' }, method: 'removal' }],
    });
    assert.ok(scoped);
    assert.equal(scoped.redactions.length, 1);
    assert.equal(buildRegistryInsights({ rdapParsed: scoped, rdapStatus: 'success' }).contactDisclosure.registryRdap.state, 'redacted');
    const late = buildRegistryInsights({ rdapParsed: { ...scoped, redactions: [
      ...Array.from({ length: 99 }, (_, index) => ({ name: `Technical field ${index}`, method: 'removal' })),
      ...scoped.redactions,
    ] }, rdapStatus: 'success' });
    assert.equal(late.contactDisclosure.registryRdap.state, 'redacted');
    assert.equal(late.publications[0]?.redactionCount, 100);
  });

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

  test('does not invent registration or unlocked states without qualifying evidence', () => {
    const unavailable = buildRegistryInsights({
      rdapStatus: 'error',
      rdapParsed: null,
      whoisStatus: 'skipped',
      whoisParsed: null,
    });
    assert.equal(unavailable.lifecycle.stage, 'unknown');
    assert.equal(unavailable.lifecycle.label, 'Lifecycle unavailable');
    assert.equal(unavailable.lifecycle.redemption, null);
    assert.equal(unavailable.lifecycle.pendingDelete, null);
    assert.equal(unavailable.lifecycle.hold.client, null);
    assert.equal(unavailable.lifecycle.locks.client, null);
    assert.equal(unavailable.lifecycle.locks.server, null);

    const partial = buildRegistryInsights({
      rdapStatus: 'partial',
      rdapParsed: { statuses: ['pendingTransfer'], serverTruncated: true },
      whoisStatus: 'error',
    });
    assert.equal(partial.lifecycle.stage, 'pending_transfer');
    assert.equal(partial.lifecycle.pendingTransfer, true);
    assert.equal(partial.lifecycle.pendingDelete, null);
    assert.equal(partial.lifecycle.locks.client, null);
  });
});
