import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  CLI_FAIL_POLICIES,
  CLI_FAIL_POLICIES_BY_COMMAND,
  evaluateCliFailPolicies,
  parseCliFailPolicies,
} from '../cli/fail-policy.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { checkDomainAvailability, fetchHomepage } from '../lib/availability.mts';
import { collectDnsIntelligence } from '../lib/dns-intelligence.mts';
import { fetchFaviconHash } from '../lib/favicon.mts';
import { skippedTlsObservation } from '../lib/tls-intelligence.mts';
import { buildBrandProfileExport, normalizeBrandProfile } from '../packages/workspace/brand-profile-model.mts';
import { BRAND_PROFILE_SCHEMA_VERSION, MAX_PROFILE_IMPORT_BYTES } from '../packages/contracts/workspace-portability.mts';
import { explainCliLookupRisk } from '../cli/risk-policy.mts';
import { RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../packages/analysis/risk-scoring.mts';

const observedAt = '2026-10-03T00:00:00.000Z';
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="blue"/></svg>';
const faviconHash = createHash('sha256').update(favicon).digest('hex');
const reference = normalizeBrandProfile({
  id: 'brand-policy-fixture', name: 'Private policy reference', officialDomains: ['official.example'],
  officialFaviconHash: faviconHash,
}, { nowIso: observedAt })!;

function capture() {
  let value = '';
  return { stream: { write(chunk: string) { value += chunk; } }, value: () => value };
}

async function collectedAvailability(
  domain: string,
  risky = true,
  options: NonNullable<Parameters<typeof checkDomainAvailability>[1]> = {},
) {
  // Real registration, DNS, homepage and favicon producers, with deterministic
  // source replies. No asserted Risk or severity enters the command runner.
  const html = risky
    ? '<main>Your account has been suspended. Verify your account immediately.</main><img src="https://official.example/logo.png"><form action="https://receiver.example/submit"><input type="password"></form>'
    : '<main>Ordinary active website</main>';
  const empty = async () => [];
  const availability = await checkDomainAvailability(domain, {
    ...options,
    rdapRecordPromise: Promise.resolve({ upstreamStatus: 200, parsed: {
      domain, statuses: ['active'], nameservers: [],
      events: [{ action: 'registration', date: '2026-10-01T00:00:00.000Z' }],
    } }),
    resolveNs: empty,
    collectDnsIntelligence: (hostname, dnsOptions) => collectDnsIntelligence(hostname, {
      ...dnsOptions, observedAt: () => observedAt,
      resolvers: {
        resolve4: empty, resolve6: empty, resolveCname: empty, resolveNs: empty,
        resolveCaa: empty, resolveSoa: empty, resolveHttps: empty,
        resolveMx: async () => [{ priority: 10, exchange: 'mail.example' }],
        resolveTxt: async owner => [[owner.startsWith('_dmarc.') ? 'v=DMARC1; p=none' : 'v=spf1 -all']],
      },
      queryAuthority: async () => { throw new Error('Unexpected authority request'); },
    }),
    collectTlsIntelligence: async () => skippedTlsObservation(),
    fetchHomepage: (hostname, httpOptions) => fetchHomepage(hostname, {
      ...httpOptions, fetcher: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    }),
    fetchFaviconHash: (hostname, iconOptions) => fetchFaviconHash(hostname, {
      ...iconOptions, fetcher: async () => new Response(favicon, { headers: { 'content-type': 'image/svg+xml' } }),
    }),
  });
  // The unified response attaches this classified registration identity too.
  return { ...availability, domain };
}

function collectorFixture(risky = true) {
  let requests = 0;
  const modes: Array<{ fast: boolean; compact: boolean }> = [];
  return {
    requests: () => requests,
    modes,
    collect: (async (classified, options = {}) => {
      requests++;
      modes.push({ fast: options.fast === true, compact: options.compact === true });
      return runUnifiedLookup(classified, {
        ...options,
        fetchRdapRecord: async () => null,
        buildWhoisChain: async () => [],
        checkDomainAvailability: (domain, availabilityOptions) => collectedAvailability(domain, risky, availabilityOptions),
        collectObservedNetworkContext: async () => { throw new Error('Synthetic network context unavailable'); },
      });
    }) satisfies NonNullable<Parameters<typeof runCli>[1]>['runUnifiedLookup'],
  };
}

describe('explicit CLI failure policies', () => {
  test('parses a bounded distinct policy list', () => {
    assert.deepEqual(parseCliFailPolicies('source-failure,inconclusive,source-failure', 'lookup'), ['source-failure', 'inconclusive']);
    assert.throws(() => parseCliFailPolicies('malicious', 'lookup'), /for lookup supports/iu);
    const parsed = parseCliArguments(['lookup', 'example.test', '--fail-on', 'source-failure,danger']);
    assert.equal(parsed.action, 'lookup');
    if (parsed.action === 'lookup') assert.deepEqual(parsed.failOn, ['source-failure', 'danger']);
  });

  test('accepts only policies with an executable evidence path for each command', () => {
    const argv = {
      lookup: ['lookup', 'example.test'],
      bulk: ['bulk'],
      'discover-scan': ['discover-scan', 'example.test'],
      'monitor-once': ['monitor-once'],
    } as const;
    for (const [command, supported] of Object.entries(CLI_FAIL_POLICIES_BY_COMMAND)) {
      for (const policy of CLI_FAIL_POLICIES) {
        const argumentsForPolicy = [...argv[command as keyof typeof argv], '--fail-on', policy];
        if ((supported as readonly string[]).includes(policy)) {
          assert.equal(parseCliArguments(argumentsForPolicy).action, command, `${command} should accept ${policy}`);
        } else {
          assert.throws(() => parseCliArguments(argumentsForPolicy), new RegExp(`for ${command} supports`, 'iu'));
        }
      }
    }
  });

  test('keeps ordinary findings neutral unless a selected policy matches', () => {
    const document = { availability: { state: 'inconclusive' }, diagnostics: { rdap: { status: 'partial' } }, risk: { score: 82 } };
    assert.deepEqual(evaluateCliFailPolicies(document, []), []);
    assert.deepEqual(evaluateCliFailPolicies(document, ['source-failure', 'inconclusive', 'danger']).map((item) => item.policy), ['source-failure', 'inconclusive']);
  });

  test('emits the final structured Lookup before returning the policy exit', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['lookup', 'example.test', '--json', '--fail-on', 'inconclusive'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
      now: () => '2026-08-05T06:00:00.000Z',
      runUnifiedLookup: async () => ({
        availability: { state: 'inconclusive' },
        rdap: { parsed: {} },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
      }),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.cli.lookup');
    assert.match(stderr, /Failure policy matched: inconclusive/iu);
  });

  test('detects only unexpected complete observation changes as material drift', () => {
    assert.equal(evaluateCliFailPolicies({ flightRecorder: { summary: { unexpectedChanges: 0, collectionChanges: 3 } } }, ['material-drift']).length, 0);
    assert.equal(evaluateCliFailPolicies({ flightRecorder: { summary: { unexpectedChanges: 1 } } }, ['material-drift']).length, 1);
  });

  test('does not infer danger from asserted scores, review lanes or arbitrary severity', () => {
    assert.deepEqual(evaluateCliFailPolicies({
      risk: { score: 99 }, results: [{ riskScore: 82, severity: 'critical', review: { lane: 'investigate', severity: 'danger' } }],
    }, ['danger']), []);
    assert.deepEqual(
      evaluateCliFailPolicies({ review: { state: 'inconclusive' } }, ['inconclusive']),
      [{ policy: 'inconclusive', reason: '1 authority or availability state(s) remained inconclusive' }],
    );
  });

  test('all advertised danger commands reach the canonical threshold through real collected evidence', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(observedAt) });
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-risk-'));
    const profile = path.join(directory, 'brand.json');
    try {
      await writeFile(profile, JSON.stringify(buildBrandProfileExport([
        { ...reference, id: 'other-brand', name: 'Other reference', officialDomains: ['other.example'], officialFaviconHash: 'b'.repeat(64) },
        reference,
      ], observedAt)));
      const commands = [
        ['lookup', 'candidate.example', '--json'],
        ['bulk', '--errors-only', '--json'],
        ['discover-scan', 'brand.example', '--tlds', 'example', '--scan-limit', '1', '--acquisition-only', '--json'],
      ];
      for (const argv of commands) {
        const stdout = capture(), stderr = capture(), fixture = collectorFixture();
        const code = await runCli([
          ...argv, '--deep', '--brand-profile', profile, '--brand-id', reference.id, '--fail-on', 'danger',
        ], {
          stdout: stdout.stream, stderr: stderr.stream, now: () => observedAt,
          readBulkInput: () => 'candidate.example', runUnifiedLookup: fixture.collect,
        });
        assert.equal(code, EXIT_CODES.PARTIAL_FAILURE, `${argv[0]}: ${stderr.value()}`);
        assert.equal(fixture.requests(), 1, 'policy evaluation must not repeat collection');
        assert.deepEqual(fixture.modes, [{ fast: false, compact: argv[0] !== 'lookup' }]);
        assert.match(stderr.value(), /Failure policy matched: danger/iu);
        assert.match(stderr.value(), new RegExp(`model v${RISK_MODEL_VERSION}; evidence (?:partial|limited|complete|unknown)`, 'u'));
        const document = JSON.parse(stdout.value());
        if (argv[0] !== 'lookup') assert.deepEqual(document.results, [], 'filtering must not hide the policy match');
        assert.doesNotMatch(stdout.value(), /Private policy reference|brand-policy-fixture|officialFaviconHash/u);
      }
      const evidence = await collectedAvailability('candidate.example');
      const explained = explainCliLookupRisk({ availability: evidence, mode: 'deep', observedAt }, reference)!;
      assert.ok(explained.score >= RISK_REVIEW_THRESHOLD, 'independent credential and Brand evidence must reach review');
      assert.equal(explained.modelVersion, RISK_MODEL_VERSION);
      assert.ok(explained.evidenceQuality.observedFamilies.includes('brand-presentation'));
      assert.ok(explained.evidenceQuality.observedFamilies.includes('credential-lure'));
      const incomplete = explainCliLookupRisk({
        availability: evidence, mode: 'deep', observedAt, diagnostics: { rdap: { status: 'partial' } },
      }, reference)!;
      assert.equal(incomplete.score, explained.score, 'coverage qualifies evidence rather than adding or removing points');
      assert.equal(incomplete.evidenceQuality.state, 'partial');
      assert.ok(incomplete.evidenceQuality.limitations.length > 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('below-threshold, Fast and missing evidence cannot become danger or an implicit inconclusive policy', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(observedAt) });
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-risk-neutral-'));
    const profile = path.join(directory, 'brand.json');
    try {
      await writeFile(profile, JSON.stringify(buildBrandProfileExport([reference], observedAt)));
      for (const deep of [false, true]) {
        const stdout = capture(), stderr = capture(), fixture = collectorFixture(false);
        assert.equal(await runCli([
          'lookup', 'candidate.example', '--json', '--brand-profile', profile,
          '--fail-on', 'danger', ...(deep ? ['--deep'] : []),
        ], { stdout: stdout.stream, stderr: stderr.stream, now: () => observedAt, runUnifiedLookup: fixture.collect }), EXIT_CODES.SUCCESS, stderr.value());
        assert.equal(fixture.requests(), 1);
        assert.equal(evaluateCliFailPolicies(JSON.parse(stdout.value()), ['danger'], reference).length, 0);
        assert.doesNotMatch(stderr.value(), /Failure policy matched/u);
      }
      const strictFixture = collectorFixture(false), strictErrors = capture();
      assert.equal(await runCli([
        'lookup', 'candidate.example', '--deep', '--strict-exit', '--quiet',
        '--brand-profile', profile, '--fail-on', 'danger',
      ], {
        stdout: capture().stream, stderr: strictErrors.stream, now: () => observedAt, runUnifiedLookup: strictFixture.collect,
      }), EXIT_CODES.PARTIAL_FAILURE);
      assert.match(strictErrors.value(), /Strict exit:/u);
      assert.doesNotMatch(strictErrors.value(), /Failure policy matched/u);

      const unknown = { availability: { domain: 'candidate.example', state: 'unknown' }, mode: 'deep' };
      assert.equal(explainCliLookupRisk(unknown, reference), null, 'missing eligibility is not a zero score');
      assert.deepEqual(evaluateCliFailPolicies(unknown, ['danger'], reference), []);
      assert.deepEqual(evaluateCliFailPolicies(unknown, ['danger', 'inconclusive'], reference).map(item => item.policy), ['inconclusive']);
      assert.deepEqual(evaluateCliFailPolicies({ availability: await collectedAvailability('candidate.example'), mode: 'deep' }, ['danger']), [], 'missing reference is not fabricated');
      assert.deepEqual(evaluateCliFailPolicies({
        availability: { ...await collectedAvailability('candidate.example'), externalAssetHosts: [{ toString: 'official.example' }, null] }, mode: 'deep',
      }, ['danger'], reference), [], 'malformed restored asset hosts are not coerced into reference evidence');
      assert.equal(explainCliLookupRisk({ availability: { domain: 'other.example', state: 'registered' }, registrableDomain: 'candidate.example' }, reference), null);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('restored compact evidence retains danger inputs without retaining the local Brand Profile', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(observedAt) });
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-risk-resume-'));
    const profile = path.join(directory, 'brand.json'), checkpoint = path.join(directory, 'checkpoint.json');
    const fixture = collectorFixture();
    const argv = ['bulk', '--deep', '--checkpoint', checkpoint];
    try {
      await writeFile(profile, JSON.stringify(buildBrandProfileExport([reference], observedAt)));
      assert.equal(await runCli([...argv, '--json'], {
        stdout: capture().stream, stderr: capture().stream, now: () => observedAt,
        readBulkInput: () => 'candidate.example', runUnifiedLookup: fixture.collect,
      }), EXIT_CODES.SUCCESS);
      const events = capture(), output = capture();
      assert.equal(await runCli([
        ...argv, '--resume', '--errors-only', '--quiet', '--events', '--fail-on', 'danger', '--brand-profile', profile,
      ], {
        stdout: output.stream, stderr: events.stream, now: () => observedAt,
        readBulkInput: () => 'candidate.example', runUnifiedLookup: fixture.collect,
      }), EXIT_CODES.PARTIAL_FAILURE);
      assert.equal(fixture.requests(), 1);
      assert.equal(output.value(), '');
      const progress = events.value().trim().split('\n').map(line => JSON.parse(line));
      assert.ok(progress.some(item => item.state === 'failure_policy_matched' && item.source === 'danger'));
      assert.equal(progress.at(-1).exitCode, EXIT_CODES.PARTIAL_FAILURE);
      assert.doesNotMatch(await readFile(checkpoint, 'utf8'), /Private policy reference|brand-policy-fixture|officialFaviconHash/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects malformed, future, ambiguous and oversized local references before collecting', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-risk-invalid-'));
    const profile = path.join(directory, 'brand.json');
    const exported = buildBrandProfileExport([reference], observedAt);
    let requests = 0;
    try {
      for (const input of [
        '{', JSON.stringify({ ...exported, version: BRAND_PROFILE_SCHEMA_VERSION + 1 }),
        JSON.stringify({ ...exported, profiles: [reference, reference] }), ' '.repeat(MAX_PROFILE_IMPORT_BYTES + 1),
      ]) {
        await writeFile(profile, input);
        assert.equal(await runCli(['lookup', 'candidate.example', '--deep', '--brand-profile', profile, '--fail-on', 'danger'], {
          stdout: capture().stream, stderr: capture().stream,
          runUnifiedLookup: async () => { requests++; throw new Error('Must not collect invalid input'); },
        }), EXIT_CODES.USAGE);
      }
      assert.equal(requests, 0);
      for (const [profiles, selectedId] of [
        [[reference], 'missing-brand'], [[reference, reference], reference.id],
      ] as const) {
        await writeFile(profile, JSON.stringify({ ...exported, profiles }));
        assert.equal(await runCli([
          'lookup', 'candidate.example', '--deep', '--brand-profile', profile, '--brand-id', selectedId, '--fail-on', 'danger',
        ], {
          stdout: capture().stream, stderr: capture().stream,
          runUnifiedLookup: async () => { requests++; throw new Error('Must not collect an ambiguous reference'); },
        }), EXIT_CODES.USAGE);
      }
      assert.equal(requests, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
