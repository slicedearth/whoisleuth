import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const evidence = await import('../frontend/src/lib/analysis/relationship-evidence.js');

function availability(overrides = {}) {
  return {
    nameservers: ['NS2.EXAMPLE.', 'ns1.example'],
    dns: { records: { ns: ['ns1.example.'], a: ['203.0.113.8'], aaaa: ['2001:db8::8'] } },
    faviconHash: 'a'.repeat(64),
    faviconPHash: '0f0f0f0f0f0f0f0f',
    externalAssetHosts: ['cdn.official.example', 'unrelated.example'],
    pageIdentity: {
      fingerprints: {
        identifiers: {
          values: [
            { type: 'tag-container', value: 'GTM-AB12' },
            { type: 'analytics-property', value: 'G-ABC123' },
          ],
        },
      },
    },
    tls: {
      source: 'tls', profileVersion: 1, status: 'success',
      certificate: { fingerprintSha256: 'b'.repeat(64) },
    },
    ...overrides,
  };
}

function row(domain, relationship, overrides = {}) {
  return { domain, trusted: null, relationship, ...overrides };
}

describe('relationshipObservation', () => {
  it('normalizes bounded scan-local observations without mutating the source', () => {
    const source = availability();
    const before = structuredClone(source);
    const result = evidence.relationshipObservation(source, ['official.example']);
    assert.equal(result.version, evidence.RELATIONSHIP_EVIDENCE_VERSION);
    assert.deepEqual(result.nameservers, ['ns1.example', 'ns2.example']);
    assert.deepEqual(result.ipAddresses, ['2001:db8::8', '203.0.113.8']);
    assert.deepEqual(result.trackingIdentifiers, ['analytics-property:G-ABC123', 'tag-container:GTM-AB12']);
    assert.deepEqual(result.officialAssetHosts, ['cdn.official.example']);
    assert.equal(result.faviconHash, 'a'.repeat(64));
    assert.equal(result.faviconPHash, '0f0f0f0f0f0f0f0f');
    assert.equal(result.certificateFingerprint, 'b'.repeat(64));
    assert.deepEqual(source, before);
  });

  it('accepts direct page-identity identifiers when fingerprints are unavailable', () => {
    const result = evidence.relationshipObservation({
      pageIdentity: { trackingIdentifiers: [{ type: 'tag-container', value: 'GTM-DIRECT' }] },
    });
    assert.deepEqual(result.trackingIdentifiers, ['tag-container:GTM-DIRECT']);
  });

  it('rejects malformed and control-bearing values', () => {
    const result = evidence.relationshipObservation({
      nameservers: ['bad host.example', 'ok.example', `bad\n.example`],
      dns: { records: { a: ['999.1.1.1', '1.2.3', '001.002.003.004'], aaaa: ['not::ip::value', 'fe80::1%eth0'] } },
      faviconHash: 'z'.repeat(64),
      faviconPHash: 'f'.repeat(15),
      pageIdentity: { trackingIdentifiers: [
        { type: 'Bad Type', value: 'GTM-OK' },
        { type: 'tag-container', value: 'bad_value' },
      ] },
      externalAssetHosts: [`bad\t.example`],
      tls: { source: 'tls', profileVersion: 1, status: 'success', certificate: { fingerprintSha256: 'g'.repeat(64) } },
    }, ['example']);
    assert.deepEqual(result.nameservers, ['ok.example']);
    assert.deepEqual(result.ipAddresses, ['1.2.3.4']);
    assert.deepEqual(result.trackingIdentifiers, []);
    assert.deepEqual(result.officialAssetHosts, []);
    assert.equal(result.faviconHash, null);
    assert.equal(result.faviconPHash, null);
    assert.equal(result.certificateFingerprint, null);
  });

  it('accepts only current native TLS leaf-certificate observations', () => {
    const valid = { source: 'tls', profileVersion: evidence.TLS_RELATIONSHIP_PROFILE_VERSION, status: 'partial', certificate: { fingerprintSha256: 'A'.repeat(64) } };
    assert.equal(evidence.relationshipObservation({ tls: valid }).certificateFingerprint, 'a'.repeat(64));
    for (const tls of [
      { ...valid, source: 'certificate_transparency' },
      { ...valid, profileVersion: 2 },
      { ...valid, status: 'error' },
      { ...valid, certificate: { fingerprintSha256: 'a'.repeat(63) } },
    ]) assert.equal(evidence.relationshipObservation({ tls }).certificateFingerprint, null);
  });

  it('caps each observation family and discloses truncation', () => {
    const result = evidence.relationshipObservation({
      nameservers: Array.from({ length: evidence.MAX_NAMESERVERS_PER_ROW + 1 }, (_, index) => `ns${index}.example`),
      dns: { records: { a: Array.from({ length: evidence.MAX_IPS_PER_ROW + 1 }, (_, index) => `10.0.0.${index}`) } },
      pageIdentity: { trackingIdentifiers: Array.from({ length: evidence.MAX_TRACKING_IDS_PER_ROW + 1 }, (_, index) => ({ type: 'tag-container', value: `GTM-${index}` })) },
    });
    assert.equal(result.nameservers.length, evidence.MAX_NAMESERVERS_PER_ROW);
    assert.equal(result.ipAddresses.length, evidence.MAX_IPS_PER_ROW);
    assert.equal(result.trackingIdentifiers.length, evidence.MAX_TRACKING_IDS_PER_ROW);
    assert.equal(result.truncated, true);
  });

  it('caps the configured official-domain comparison input', () => {
    const domains = Array.from({ length: evidence.MAX_OFFICIAL_DOMAINS + 1 }, (_, index) => `official-${index}.example`);
    const result = evidence.relationshipObservation({ externalAssetHosts: [domains.at(-1)] }, domains);
    assert.deepEqual(result.officialAssetHosts, []);
    assert.equal(result.truncated, true);
  });
});

describe('buildScanRelationships', () => {
  it('builds distinct, explainable relationship families in deterministic order', () => {
    const shared = evidence.relationshipObservation(availability(), ['official.example']);
    const other = evidence.relationshipObservation(availability({
      nameservers: ['ns1.example', 'ns2.example'],
      dns: { records: { a: ['203.0.113.8'] } },
      externalAssetHosts: [],
    }), ['official.example']);
    const result = evidence.buildScanRelationships([
      row('z.example', shared),
      row('a.example', other),
    ]);
    assert.deepEqual(result.groups.map((item) => item.type), ['nameserver_set', 'ip_address', 'certificate', 'tracking_identifier', 'tracking_identifier', 'favicon', 'official_asset']);
    assert.deepEqual(result.groups[0].domains, ['a.example', 'z.example']);
    assert.match(result.limitations.join(' '), /not proof of common ownership/);
    assert.match(result.limitations.join(' '), /exact native TLS leaf-certificate SHA-256/i);
    assert.equal('score' in result, false);
  });

  it('requires an exact full nameserver set, not a partial overlap', () => {
    const result = evidence.buildScanRelationships([
      row('one.example', evidence.relationshipObservation({ nameservers: ['ns1.example', 'ns2.example'] })),
      row('two.example', evidence.relationshipObservation({ nameservers: ['ns1.example'] })),
    ]);
    assert.equal(result.groups.some((item) => item.type === 'nameserver_set'), false);
  });

  it('rejects stale and future relationship observation versions at the grouping boundary', () => {
    const current = evidence.relationshipObservation({
      tls: { source: 'tls', profileVersion: 1, status: 'success', certificate: { fingerprintSha256: 'c'.repeat(64) } },
    });
    const result = evidence.buildScanRelationships([
      row('old-one.example', { ...current, version: evidence.RELATIONSHIP_EVIDENCE_VERSION - 1 }),
      row('old-two.example', { ...current, version: evidence.RELATIONSHIP_EVIDENCE_VERSION - 1 }),
      row('new-one.example', { ...current, version: evidence.RELATIONSHIP_EVIDENCE_VERSION + 1 }),
      row('new-two.example', { ...current, version: evidence.RELATIONSHIP_EVIDENCE_VERSION + 1 }),
    ]);
    assert.deepEqual(result.groups, []);
    assert.equal(result.version, evidence.RELATIONSHIP_EVIDENCE_VERSION);
  });

  it('allows a single candidate to show an official-asset relationship', () => {
    const result = evidence.buildScanRelationships([
      row('candidate.example', evidence.relationshipObservation({ externalAssetHosts: ['static.official.example'] }, ['official.example'])),
    ]);
    assert.deepEqual(result.groups, [{
      type: 'official_asset',
      label: 'Official asset relationship',
      method: 'Configured-domain host match',
      value: 'static.official.example',
      normalizedValue: 'static.official.example',
      domains: ['candidate.example'],
      description: 'One or more pages loaded an asset from this configured official domain or its subdomain.',
    }]);
  });

  it('excludes trusted rows from candidate relationships', () => {
    const observation = evidence.relationshipObservation(availability());
    const result = evidence.buildScanRelationships([
      row('official.example', observation, { trusted: 'official' }),
      row('candidate.example', observation),
    ]);
    assert.equal(result.groups.some((item) => item.type !== 'official_asset'), false);
  });

  it('does not invent certificate relationships from CT counts or hostnames', () => {
    const observation = evidence.relationshipObservation({});
    const result = evidence.buildScanRelationships([
      { ...row('one.example', observation), ct: { certificateCount: 4, hostnames: ['shared.example'] } },
      { ...row('two.example', observation), ct: { certificateCount: 4, hostnames: ['shared.example'] } },
    ]);
    assert.deepEqual(result.groups, []);
  });

  it('groups exact native leaf-certificate fingerprints across distinct domains', () => {
    const shared = evidence.relationshipObservation({
      tls: { source: 'tls', profileVersion: 1, status: 'success', certificate: { fingerprintSha256: 'c'.repeat(64) } },
    });
    const result = evidence.buildScanRelationships([
      row('two.example', shared),
      row('one.example', shared),
      row('one.example', shared),
    ]);
    assert.deepEqual(result.groups, [{
      type: 'certificate',
      label: 'Shared TLS certificate',
      method: 'Exact leaf-certificate SHA-256',
      value: 'c'.repeat(64),
      normalizedValue: 'c'.repeat(64),
      domains: ['one.example', 'two.example'],
      description: 'These domains presented the same leaf certificate in this scan. Multi-domain certificates, shared hosting, CDNs, and managed platforms are common.',
    }]);
  });

  it('does not group different certificates or a certificate observed only on a trusted row', () => {
    const observation = (fingerprint) => evidence.relationshipObservation({
      tls: { source: 'tls', profileVersion: 1, status: 'success', certificate: { fingerprintSha256: fingerprint } },
    });
    const result = evidence.buildScanRelationships([
      row('one.example', observation('a'.repeat(64))),
      row('two.example', observation('b'.repeat(64))),
      row('official.example', observation('a'.repeat(64)), { trusted: 'official' }),
    ]);
    assert.equal(result.groups.some((item) => item.type === 'certificate'), false);
  });

  it('guards degenerate perceptual favicon hashes at the shared comparison boundary', () => {
    const result = evidence.buildScanRelationships([
      row('one.example', { ...evidence.relationshipObservation({ faviconHash: 'a'.repeat(64) }), faviconPHash: '0'.repeat(16) }),
      row('two.example', { ...evidence.relationshipObservation({ faviconHash: 'b'.repeat(64) }), faviconPHash: '0'.repeat(16) }),
    ]);
    assert.equal(result.groups.some((item) => item.type === 'favicon'), false);
  });

  it('does not create a favicon relationship from duplicate rows for one domain', () => {
    const observation = evidence.relationshipObservation({ faviconHash: 'a'.repeat(64) });
    const result = evidence.buildScanRelationships([
      row('one.example', observation),
      row('one.example', observation),
    ]);
    assert.equal(result.groups.some((item) => item.type === 'favicon'), false);
  });

  it('revalidates and caps externally supplied observation arrays', () => {
    const injected = {
      ...evidence.relationshipObservation({}),
      nameservers: Array.from({ length: evidence.MAX_NAMESERVERS_PER_ROW + 1 }, (_, index) => `ns${index}.example`),
      ipAddresses: ['not-an-ip'],
      trackingIdentifiers: ['bad:value_with_underscore'],
      officialAssetHosts: [`bad\n.example`],
      faviconHash: 'unbounded-arbitrary-value',
      certificateFingerprint: 'not-a-certificate-fingerprint',
    };
    const result = evidence.buildScanRelationships([
      row('one.example', injected),
      row('two.example', injected),
    ]);
    assert.equal(result.groups.some((item) => ['ip_address', 'certificate', 'tracking_identifier', 'favicon', 'official_asset'].includes(item.type)), false);
    assert.equal(result.truncated, true);
  });

  it('caps rows, groups, and domains with explicit truncation', () => {
    const rows = Array.from({ length: evidence.MAX_RELATIONSHIP_ROWS + 1 }, (_, index) => row(
      `domain-${index}.example`,
      evidence.relationshipObservation({ dns: { records: { a: [`10.0.${Math.floor(index / 250)}.${index % 250}`] } } }),
    ));
    const result = evidence.buildScanRelationships(rows);
    assert.equal(result.truncated, true);

    const groupedRows = Array.from({ length: evidence.MAX_RELATIONSHIP_GROUPS + 1 }, (_, groupIndex) => [
      row(`group-${groupIndex}-a.example`, evidence.relationshipObservation({ dns: { records: { a: [`10.1.${Math.floor(groupIndex / 250)}.${groupIndex % 250}`] } } })),
      row(`group-${groupIndex}-b.example`, evidence.relationshipObservation({ dns: { records: { a: [`10.1.${Math.floor(groupIndex / 250)}.${groupIndex % 250}`] } } })),
    ]).flat();
    const manyGroups = evidence.buildScanRelationships(groupedRows);
    assert.equal(manyGroups.groups.length, evidence.MAX_RELATIONSHIP_GROUPS);
    assert.equal(manyGroups.truncated, true);

    const shared = evidence.relationshipObservation({ nameservers: ['ns.example'] });
    const manyDomains = evidence.buildScanRelationships(Array.from({ length: evidence.MAX_RELATIONSHIP_DOMAINS + 1 }, (_, index) => row(`shared-${index}.example`, shared)));
    assert.equal(manyDomains.groups[0].domains.length, evidence.MAX_RELATIONSHIP_DOMAINS);
    assert.equal(manyDomains.truncated, true);
  });
});
