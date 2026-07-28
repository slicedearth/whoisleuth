import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildExternalDependencies,
  expandSpfPolicy,
  reportDestinationDomain,
  validateDmarcExternalReporting,
} from '../lib/domain-posture-analysis.mts';

function query(records: unknown[] = [], error: string | null = null) {
  return { records, error };
}

function fixtureResolver(fixtures: Record<string, ReturnType<typeof query>>) {
  const requests: string[] = [];
  return {
    requests,
    resolveTxt: async (domain: string) => {
      requests.push(domain);
      return fixtures[domain] || query([]);
    },
  };
}

describe('bounded SPF expansion', () => {
  test('recurses through literal include and redirect policies with explicit counts', async () => {
    const resolver = fixtureResolver({
      '_spf.mail.example.net': query(['v=spf1 include:_edge.mail.example.net ~all']),
      '_edge.mail.example.net': query(['v=spf1 redirect=_final.mail.example.net']),
      '_final.mail.example.net': query(['v=spf1 ip4:192.0.2.0/24 -all']),
    });
    const result = await expandSpfPolicy(
      'example.test',
      query(['v=spf1 include:_spf.mail.example.net -all']),
      resolver.resolveTxt,
    );

    assert.equal(result.state, 'complete');
    assert.equal(result.lookupsUsed, 4);
    assert.equal(result.dnsLookupTerms, 3);
    assert.deepEqual(resolver.requests, [
      '_spf.mail.example.net',
      '_edge.mail.example.net',
      '_final.mail.example.net',
    ]);
    assert.equal(result.branches.at(-1)?.terminalPolicy, 'fail');
  });

  test('preserves cycles, missing branches, invalid targets, and resolver failures as partial evidence', async () => {
    const resolver = fixtureResolver({
      '_cycle.example.net': query(['v=spf1 include:_cycle.example.net -all']),
      '_missing.example.net': query([]),
      '_failed.example.net': query([], 'resolver timed out'),
    });
    const result = await expandSpfPolicy(
      'example.test',
      query(['v=spf1 include:_cycle.example.net include:_missing.example.net include:_failed.example.net include:%{d}.example.net -all']),
      resolver.resolveTxt,
    );

    assert.equal(result.state, 'partial');
    assert.ok(result.branches.some((branch) => branch.state === 'cycle'));
    assert.ok(result.branches.some((branch) => branch.state === 'not_found'));
    assert.ok(result.branches.some((branch) => branch.state === 'unavailable'));
    assert.ok(result.branches.some((branch) => branch.state === 'invalid'));
  });

  test('stops expansion when the observed DNS-term budget is exceeded', async () => {
    const resolver = fixtureResolver({
      '_wide.example.net': query(['v=spf1 a mx exists:a.example.net exists:b.example.net exists:c.example.net exists:d.example.net exists:e.example.net exists:f.example.net exists:g.example.net exists:h.example.net -all']),
    });
    const result = await expandSpfPolicy(
      'example.test',
      query(['v=spf1 include:_wide.example.net mx -all']),
      resolver.resolveTxt,
    );

    assert.equal(result.state, 'partial');
    assert.ok(result.dnsLookupTerms > result.lookupLimit);
    assert.ok(result.issues.some((issue) => /more than 10/u.test(issue)));
  });
});

describe('DMARC reporting authorization', () => {
  test('extracts bounded mail destinations and checks only external reporting domains', async () => {
    const resolver = fixtureResolver({
      'example.test._report._dmarc.reports.example.net': query(['v=DMARC1']),
    });
    const result = await validateDmarcExternalReporting(
      'example.test',
      query(['v=DMARC1; p=reject; rua=mailto:local@example.test,mailto:aggregate@reports.example.net']),
      resolver.resolveTxt,
    );

    assert.equal(result[0]?.state, 'self');
    assert.equal(result[1]?.state, 'authorized');
    assert.deepEqual(resolver.requests, ['example.test._report._dmarc.reports.example.net']);
  });

  test('keeps unsupported destinations and unavailable authorization records explicit', async () => {
    const resolver = fixtureResolver({
      'example.test._report._dmarc.reports.example.net': query([], 'resolver failed'),
    });
    const result = await validateDmarcExternalReporting(
      'example.test',
      query(['v=DMARC1; p=reject; rua=https://reports.example.net,mailto:aggregate@reports.example.net']),
      resolver.resolveTxt,
    );

    assert.equal(result[0]?.state, 'invalid_destination');
    assert.equal(result[1]?.state, 'unavailable');
    assert.equal(reportDestinationDomain('mailto:reports@reports.example.net!10m'), 'reports.example.net');
  });
});

test('external dependency inventory is deduplicated and qualified without ownership claims', () => {
  const dependencies = buildExternalDependencies({
    domain: 'example.test',
    nameservers: query(['ns1.example.test', 'ns1.dns.example.net']),
    mx: query([{ priority: 10, exchange: 'mail.example.net' }]),
    spfExpansion: {
      version: 1,
      state: 'complete',
      lookupLimit: 10,
      lookupsUsed: 2,
      voidLookupLimit: 2,
      voidLookups: 0,
      maxDepth: 5,
      dnsLookupTerms: 1,
      branches: [
        { domain: 'example.test', parent: null, relation: 'root', depth: 0, state: 'success', terminalPolicy: 'fail', dnsLookupTerms: 1, issues: [] },
        { domain: '_spf.example.net', parent: 'example.test', relation: 'include', depth: 1, state: 'success', terminalPolicy: 'fail', dnsLookupTerms: 0, issues: [] },
      ],
      issues: [],
    },
    dmarcAuthorizations: [{
      destination: 'reports.example.net',
      reportType: 'aggregate',
      recordName: 'example.test._report._dmarc.reports.example.net',
      state: 'authorized',
      error: null,
    }],
  });

  assert.equal(dependencies.length, 5);
  assert.equal(dependencies.find((dependency) => dependency.target === 'ns1.example.test')?.scope, 'same_registrable_domain');
  assert.ok(dependencies.filter((dependency) => dependency.scope === 'external').length >= 4);
  assert.ok(dependencies.every((dependency) => /not evidence/u.test(dependency.limitation)));
});
