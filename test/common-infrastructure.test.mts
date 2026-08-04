import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCommonInfrastructureSnapshot,
  FRESHNESS_DAYS,
  MAX_SOURCE_BYTES,
  parseArguments,
} from '../tools/common-infrastructure-snapshot.mts';
import {
  classifyCommonInfrastructureAddress,
  COMMON_INFRASTRUCTURE_SNAPSHOT,
} from '../frontend/src/lib/analysis/common-infrastructure.ts';
import snapshotValue from '../frontend/src/lib/analysis/common-infrastructure-snapshot.json' with { type: 'json' };

function warningList(version: number, list: string[]) {
  return JSON.stringify({
    name: 'Fixture warning list',
    version,
    type: 'cidr',
    matching_attributes: ['ip-src', 'ip-dst'],
    list,
  });
}

describe('Common-infrastructure catalogue', () => {
  test('uses the checked-in bounded, attributed snapshot without a runtime request', () => {
    assert.equal(COMMON_INFRASTRUCTURE_SNAPSHOT.schema, 'whoisleuth.common-infrastructure');
    assert.equal(COMMON_INFRASTRUCTURE_SNAPSHOT.version, 1);
    assert.ok(COMMON_INFRASTRUCTURE_SNAPSHOT.entryCount > 0);
    assert.ok(COMMON_INFRASTRUCTURE_SNAPSHOT.entryCount <= 20_000);
    assert.match(COMMON_INFRASTRUCTURE_SNAPSHOT.source.repository, /^https:\/\/github\.com\/MISP\//u);
    assert.match(COMMON_INFRASTRUCTURE_SNAPSHOT.source.commit, /^[0-9a-f]{40}$/u);
    assert.equal(COMMON_INFRASTRUCTURE_SNAPSHOT.source.licence, 'CC0-1.0 OR BSD-2-Clause');
    assert.deepEqual(COMMON_INFRASTRUCTURE_SNAPSHOT.sources.map((source) => source.id), [
      'amazon-aws',
      'cloudflare',
      'google-gcp',
      'public-dns-core',
    ]);
    assert.deepEqual(snapshotValue.excludedSources.map((source) => source.id), [
      'akamai',
      'fastly',
      'microsoft-azure',
    ]);
  });

  test('qualifies exact IPv4 and IPv6 CIDR matches with provenance and limitations', () => {
    const ipv4Source = COMMON_INFRASTRUCTURE_SNAPSHOT.sources.find((source) =>
      source.values.some((value) => /^\d/u.test(value)));
    assert.ok(ipv4Source);
    const ipv4Range = ipv4Source.values.find((value) => /^\d/u.test(value));
    assert.ok(ipv4Range);
    const ipv4 = ipv4Range.split('/')[0];
    const ipv4Matches = classifyCommonInfrastructureAddress(ipv4);
    assert.ok(ipv4Matches.some((match) => match.sourceId === ipv4Source.id));
    assert.match(ipv4Matches[0]?.limitation ?? '', /not an origin host/iu);
    assert.match(ipv4Matches[0]?.sourceDigestSha256 ?? '', /^[0-9a-f]{64}$/u);

    const ipv6Source = COMMON_INFRASTRUCTURE_SNAPSHOT.sources.find((source) =>
      source.values.some((value) => value.includes(':')));
    assert.ok(ipv6Source);
    const ipv6 = ipv6Source.values.find((value) => value.includes(':'))?.split('/')[0];
    assert.ok(ipv6);
    assert.ok(classifyCommonInfrastructureAddress(ipv6)
      .some((match) => match.sourceId === ipv6Source.id));
  });

  test('keeps malformed and non-matching values neutral', () => {
    assert.deepEqual(classifyCommonInfrastructureAddress(''), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('not-an-address'), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('192.0.2.1'), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('2001:db8::1'), []);
  });

  test('builds only fresh exact-CIDR sources and records rejected sources', async () => {
    const bodies = [
      warningList(20260720, ['198.18.0.0/24']),
      warningList(20240101, ['198.19.0.0/24']),
      warningList(20260720, ['2001:4860::/32']),
      warningList(20260720, ['198.20.0.0/24']),
      warningList(20260720, ['198.21.0.0/24']),
      warningList(20260720, ['2001:db8:1::/48']),
    ];
    let calls = 0;
    const snapshot = await buildCommonInfrastructureSnapshot('a'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response(bodies[calls++] ?? '', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    assert.equal(snapshot.sources.length, 6);
    assert.equal(snapshot.excludedSources.length, 1);
    assert.match(snapshot.excludedSources[0]?.reason ?? '', new RegExp(`${FRESHNESS_DAYS}-day freshness`, 'u'));
    assert.equal(snapshot.entryCount, 11);
  });

  test('rejects oversized responses before parsing', async () => {
    const snapshot = await buildCommonInfrastructureSnapshot('b'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response('{}', {
        status: 200,
        headers: { 'content-length': String(MAX_SOURCE_BYTES + 1) },
      }),
    });
    assert.deepEqual(snapshot.sources.map((source) => source.id), ['public-dns-core']);
    assert.equal(snapshot.excludedSources.length, 6);
    assert.ok(snapshot.excludedSources.every((item) => /exceeds its byte limit/iu.test(item.reason)));
  });

  test('parses explicit maintenance arguments without accepting moving refs', () => {
    assert.deepEqual(parseArguments([]), {
      commit: '767e026cd872d0e7d233720c4079b01a6af0c9d3',
      checkOnly: false,
    });
    assert.deepEqual(parseArguments(['--commit', 'c'.repeat(40), '--check-only']), {
      commit: 'c'.repeat(40),
      checkOnly: true,
    });
    assert.throws(() => parseArguments(['--commit', 'main']), /full lowercase SHA-1/iu);
  });
});
