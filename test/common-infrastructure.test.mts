import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildCommonInfrastructureSnapshot,
  FRESHNESS_DAYS,
  MAX_SOURCE_BYTES,
  main,
  parseArguments,
  SNAPSHOT_PATH,
} from '../tools/common-infrastructure-snapshot.mts';
import {
  classifyCommonInfrastructureAddress,
  COMMON_INFRASTRUCTURE_SNAPSHOT,
  parseCommonInfrastructureSnapshot,
} from '../frontend/src/lib/analysis/common-infrastructure.ts';

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
    const activeIds = COMMON_INFRASTRUCTURE_SNAPSHOT.sources.map((source) => source.id);
    const excludedIds = COMMON_INFRASTRUCTURE_SNAPSHOT.excludedSources.map((source) => source.id);
    assert.deepEqual([...activeIds, ...excludedIds].sort(), [
      'amazon-aws', 'cloudflare', 'google-gcp', 'public-dns-core',
    ]);
    assert.ok(activeIds.includes('public-dns-core'));
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

    const customSources = [
      ...structuredClone(COMMON_INFRASTRUCTURE_SNAPSHOT.sources)
        .filter((source) => source.id !== 'google-gcp'),
      {
        id: 'google-gcp', label: 'Google Cloud Platform', category: 'cloud_platform',
        sourceDate: '2026-08-10', sourceDigestSha256: '1'.repeat(64), values: ['2001:4860::/32'],
      },
    ];
    const custom = parseCommonInfrastructureSnapshot({
      ...structuredClone(COMMON_INFRASTRUCTURE_SNAPSHOT),
      entryCount: customSources.reduce((total, source) => total + source.values.length, 0),
      sources: customSources,
      excludedSources: COMMON_INFRASTRUCTURE_SNAPSHOT.excludedSources
        .filter((source) => source.id !== 'google-gcp'),
    });
    assert.ok(classifyCommonInfrastructureAddress('2001:4860::1', custom)
      .some((match) => match.sourceId === 'google-gcp'));
  });

  test('keeps malformed and non-matching values neutral', () => {
    assert.deepEqual(classifyCommonInfrastructureAddress(''), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('not-an-address'), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('192.0.2.1'), []);
    assert.deepEqual(classifyCommonInfrastructureAddress('2001:db8::1'), []);
  });

  test('builds from fresh exact-CIDR sources and explicitly excludes fully validated stale sources', async () => {
    const bodies = [
      warningList(20260720, ['198.18.0.0/24']),
      warningList(20260720, ['198.19.0.0/24']),
      warningList(20260720, ['2001:4860::/32']),
    ];
    let calls = 0;
    const snapshot = await buildCommonInfrastructureSnapshot('a'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response(bodies[calls++] ?? '', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    assert.equal(snapshot.sources.length, 4);
    assert.deepEqual(snapshot.excludedSources, []);
    assert.equal(snapshot.entryCount, 9);

    const stale = await buildCommonInfrastructureSnapshot('a'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response(warningList(20240101, ['198.19.0.0/24'])),
    });
    assert.deepEqual(stale.sources.map((source) => source.id), ['public-dns-core']);
    assert.equal(stale.excludedSources.length, 3);
    assert.ok(stale.excludedSources.every((source) => source.reason === 'stale'));

    const exactBoundary = await buildCommonInfrastructureSnapshot('a'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response(warningList(20260701, ['198.19.0.0/24'])),
    });
    assert.equal(exactBoundary.sources.length, 4, `A source exactly ${FRESHNESS_DAYS} days old remains active.`);
    const beyondBoundary = await buildCommonInfrastructureSnapshot('a'.repeat(40), {
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      fetchImpl: async () => new Response(warningList(20260630, ['198.19.0.0/24'])),
    });
    assert.equal(beyondBoundary.sources.length, 1);
    assert.equal(beyondBoundary.excludedSources.length, 3);

    await assert.rejects(
      buildCommonInfrastructureSnapshot('a'.repeat(40), {
        now: () => new Date('2026-03-01T00:00:00.000Z'),
        fetchImpl: async () => new Response(warningList(20260231, ['198.19.0.0/24'])),
      }),
      /not a valid date/iu,
    );
  });

  test('rejects oversized responses before parsing', async () => {
    await assert.rejects(
      buildCommonInfrastructureSnapshot('b'.repeat(40), {
        now: () => new Date('2026-07-31T00:00:00.000Z'),
        fetchImpl: async () => new Response('{}', {
          status: 200,
          headers: { 'content-length': String(MAX_SOURCE_BYTES + 1) },
        }),
      }),
      /exceeds its byte limit/iu,
    );
  });

  test('fails closed when any required upstream source cannot be validated', async () => {
    let calls = 0;
    await assert.rejects(
      buildCommonInfrastructureSnapshot('b'.repeat(40), {
        now: () => new Date('2026-07-31T00:00:00.000Z'),
        fetchImpl: async () => {
          calls += 1;
          return calls === 2
            ? new Response('temporarily unavailable', { status: 503 })
            : new Response(warningList(20260720, ['198.18.0.0/24']));
        },
      }),
      /HTTP 503/iu,
    );
    assert.equal(calls, 2);
  });

  test('check-only compares the complete retained source set rather than only the commit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-common-infrastructure-'));
    const outputPath = path.join(directory, SNAPSHOT_PATH);
    const bodies = [
      warningList(20260720, ['198.18.0.0/24']),
      warningList(20260720, ['198.19.0.0/24']),
      warningList(20260720, ['2001:4860::/32']),
    ];
    const buildOptions = () => {
      let calls = 0;
      return {
        now: () => new Date('2026-07-31T00:00:00.000Z'),
        fetchImpl: async () => new Response(bodies[calls++] ?? '', { status: 200 }),
      };
    };
    try {
      const snapshot = await buildCommonInfrastructureSnapshot('c'.repeat(40), buildOptions());
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 0);

      const changed = structuredClone(snapshot);
      const firstSource = changed.sources[0];
      assert.ok(firstSource);
      Object.assign(firstSource, { sourceDigestSha256: '0'.repeat(64) });
      await writeFile(outputPath, `${JSON.stringify(changed, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 1);

      const changedValue = structuredClone(snapshot);
      const changedSource = changedValue.sources[0];
      assert.ok(changedSource);
      Object.assign(changedSource, {
        values: changedSource.values.map((value, index) => index === 0 ? '203.0.113.0/24' : value),
      });
      await writeFile(outputPath, `${JSON.stringify(changedValue, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 1);

      const changedLabel = structuredClone(snapshot);
      const labelledSource = changedLabel.sources[0];
      assert.ok(labelledSource);
      Object.assign(labelledSource, { label: 'Unreviewed replacement label' });
      await writeFile(outputPath, `${JSON.stringify(changedLabel, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 1);

      const changedContract = structuredClone(snapshot) as Record<string, unknown>;
      changedContract.maximumEntries = 19_999;
      await writeFile(outputPath, `${JSON.stringify(changedContract, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 1);

      const changedGeneratedAt = structuredClone(snapshot) as Record<string, unknown>;
      changedGeneratedAt.generatedAt = '2026-07-30T00:00:00.000Z';
      await writeFile(outputPath, `${JSON.stringify(changedGeneratedAt, null, 2)}\n`, 'utf8');
      assert.equal(await main(['--commit', 'c'.repeat(40), '--check-only'], {
        repositoryRoot: directory,
        ...buildOptions(),
        stdout: { write: () => true },
        stderr: { write: () => true },
      }), 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects incomplete, duplicated, malformed, and partially excluded retained snapshots', () => {
    const snapshot = structuredClone(COMMON_INFRASTRUCTURE_SNAPSHOT) as Record<string, unknown>;
    const sources = snapshot.sources as Array<Record<string, unknown>>;
    assert.throws(
      () => parseCommonInfrastructureSnapshot({ ...snapshot, sources: sources.slice(1) }),
      /unsupported contract|entry count/iu,
    );
    assert.throws(
      () => parseCommonInfrastructureSnapshot({ ...snapshot, sources: [sources[0], sources[0], ...sources.slice(2)] }),
      /invalid contract/iu,
    );
    assert.throws(
      () => parseCommonInfrastructureSnapshot({ ...snapshot, excludedSources: [{ id: 'missing', reason: 'stale' }] }),
      /excluded source|entry count/iu,
    );
    const malformed = structuredClone(snapshot) as Record<string, unknown>;
    const malformedSources = malformed.sources as Array<Record<string, unknown>>;
    malformedSources[0] = { ...malformedSources[0], sourceDate: '2026-02-31' };
    assert.throws(() => parseCommonInfrastructureSnapshot(malformed), /invalid contract/iu);
    const invalidCidr = structuredClone(snapshot) as Record<string, unknown>;
    const invalidSources = invalidCidr.sources as Array<Record<string, unknown>>;
    invalidSources[0] = { ...invalidSources[0], values: ['999.1.1.1/24'] };
    invalidCidr.entryCount = 1 + invalidSources.slice(1)
      .reduce((total, source) => total + (source.values as unknown[]).length, 0);
    assert.throws(() => parseCommonInfrastructureSnapshot(invalidCidr), /invalid contract/iu);
  });

  test('parses explicit maintenance arguments without accepting moving refs', () => {
    assert.deepEqual(parseArguments([]), {
      commit: '950282a018f0552d99f156412b650d31e7ff4688',
      checkOnly: false,
    });
    assert.deepEqual(parseArguments(['--commit', 'c'.repeat(40), '--check-only']), {
      commit: 'c'.repeat(40),
      checkOnly: true,
    });
    assert.throws(() => parseArguments(['--commit', 'main']), /full lowercase SHA-1/iu);
  });
});
