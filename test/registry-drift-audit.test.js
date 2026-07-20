'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CAPABILITY_ROWS,
  MAX_RDAP_BOOTSTRAP_BYTES,
  MAX_ROOT_ZONE_BYTES,
  MAX_SOURCE_RECORDS,
  RDAP_BOOTSTRAP_URL,
  REGISTRY_DRIFT_AUDIT_SCHEMA,
  ROOT_ZONE_URL,
  formatRegistryDriftAudit,
  main,
  parseArguments,
  parseRdapBootstrap,
  parseRootZoneTldList,
  runRegistryDriftAudit,
} = require('../tools/registry-drift-audit.mts');

const ROOT_ZONE = `# Version 2026010100, Last Updated Thu Jan 1 00:00:00 2026 UTC
CC
AA
BB
`;
const RDAP_BOOTSTRAP = JSON.stringify({
  publication: '2026-01-02T00:00:00Z',
  version: '1.0',
  services: [
    [['aa'], ['https://rdap-a.example/']],
    [['cc'], ['https://rdap-c.example/']],
  ],
  ignored: 'must not be retained',
});
const SNAPSHOT = Object.freeze({
  schema: 'whoisleuth.registry-standards-coverage',
  version: 1,
  verifiedAt: '2026-01-03',
  sources: {
    rootZoneVersion: '2026010100',
    rootZoneLastUpdatedAt: '2026-01-01T00:00:00.000Z',
    rdapBootstrapPublication: '2026-01-02T00:00:00.000Z',
    rdapBootstrapVersion: '1.0',
    urls: [ROOT_ZONE_URL, RDAP_BOOTSTRAP_URL],
  },
  counts: {
    activeTlds: 3,
    countryCode: 3,
    nonCountryCode: 0,
    generic: 0,
    genericRestricted: 0,
    sponsored: 0,
    infrastructure: 0,
    rdapBootstrapServiceGroups: 2,
    genericAndRestrictedRdapCovered: 0,
    sponsoredRdapCovered: 0,
    infrastructureRdapCovered: 0,
  },
  exceptions: [],
  interpretation: 'Fixture snapshot.',
});
const CAPABILITIES = Object.freeze([
  Object.freeze({ suffixes: ['aa'], rdapAccessProfile: 'iana-bootstrap' }),
  Object.freeze({ suffixes: ['bb'], rdapAccessProfile: 'no-iana-service' }),
]);

function responseFor(url) {
  if (url === ROOT_ZONE_URL) return new Response(ROOT_ZONE, { status: 200 });
  if (url === RDAP_BOOTSTRAP_URL) return new Response(RDAP_BOOTSTRAP, { status: 200 });
  throw new Error(`Unexpected URL: ${url}`);
}

function options(overrides = {}) {
  return {
    fetchSource: async (url, init) => {
      assert.equal(init.redirect, 'manual');
      assert.ok(init.signal);
      return responseFor(url);
    },
    now: () => new Date('2026-01-04T00:00:00.000Z'),
    snapshot: structuredClone(SNAPSHOT),
    capabilities: structuredClone(CAPABILITIES),
    ...overrides,
  };
}

function capture() {
  let output = '';
  return { stream: { write(value) { output += value; } }, value: () => output };
}

describe('official registry source parsers', () => {
  test('normalizes and sorts the bounded root-zone list', () => {
    const parsed = parseRootZoneTldList(ROOT_ZONE);
    assert.deepEqual(parsed, {
      version: '2026010100',
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      tlds: ['aa', 'bb', 'cc'],
    });
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen(parsed.tlds));
  });

  test('rejects malformed headers, suffixes, duplicates, NUL bytes, byte overflow, and record overflow', () => {
    assert.throws(() => parseRootZoneTldList('AA\n'), /version header/i);
    assert.throws(() => parseRootZoneTldList('# Version 2026010100, Last Updated invalid\nBAD_SUFFIX\n'), /timestamp|suffix/i);
    assert.throws(() => parseRootZoneTldList(`${ROOT_ZONE}AA\n`), /repeated/i);
    assert.throws(() => parseRootZoneTldList(`${ROOT_ZONE}\0`), /NUL/i);
    assert.throws(() => parseRootZoneTldList('x'.repeat(MAX_ROOT_ZONE_BYTES + 1)), /exceeded/i);
    const tooMany = `# Version 2026010100, Last Updated 2026-01-01T00:00:00Z\n${Array.from({ length: MAX_SOURCE_RECORDS + 1 }, (_, index) => `x${index.toString(36)}`).join('\n')}`;
    assert.throws(() => parseRootZoneTldList(tooMany), /exceeded.*suffixes/i);
  });

  test('normalizes a bounded RDAP bootstrap without retaining unknown fields', () => {
    const parsed = parseRdapBootstrap(RDAP_BOOTSTRAP);
    assert.deepEqual(parsed, {
      publication: '2026-01-02T00:00:00.000Z',
      version: '1.0',
      serviceGroupCount: 2,
      httpsServiceGroupCount: 2,
      httpOnlyServiceGroupCount: 0,
      suffixes: ['aa', 'cc'],
    });
    assert.doesNotMatch(JSON.stringify(parsed), /must not be retained/);
  });

  test('accepts official HTTP-only groups but rejects malformed or unsupported endpoints', () => {
    assert.deepEqual(parseRdapBootstrap(JSON.stringify({
      publication: '2026-01-01', version: '1.0', services: [[['aa'], ['http://rdap.example/']]],
    })).httpOnlyServiceGroupCount, 1);
    assert.throws(() => parseRdapBootstrap('{'), /valid JSON/i);
    assert.throws(() => parseRdapBootstrap('[]'), /object/i);
    assert.throws(() => parseRdapBootstrap(JSON.stringify({ publication: true, version: '1.0', services: [] })), /timestamp/i);
    assert.throws(() => parseRdapBootstrap(JSON.stringify({ publication: '2026-01-01', version: '../1', services: [[['aa'], ['https://rdap.example/']]] })), /version/i);
    assert.throws(() => parseRdapBootstrap(JSON.stringify({ publication: '2026-01-01', version: '1.0', services: [[['aa'], ['https://one.example/']], [['aa'], ['https://two.example/']]] })), /repeated/i);
    assert.throws(() => parseRdapBootstrap(JSON.stringify({ publication: '2026-01-01', version: '1.0', services: [[['aa'], ['ftp://rdap.example/']]] })), /unsupported endpoint/i);
    assert.throws(() => parseRdapBootstrap(JSON.stringify({ publication: '2026-01-01', version: '1.0', services: [[['aa'], ['https://user:secret@rdap.example/']]] })), /unsupported endpoint/i);
    assert.throws(() => parseRdapBootstrap('x'.repeat(MAX_RDAP_BOOTSTRAP_BYTES + 1)), /exceeded/i);
  });
});

describe('official registry drift report', () => {
  test('reports matching official sources and explicit claims as current', async () => {
    const report = await runRegistryDriftAudit(options());
    assert.equal(report.schema, REGISTRY_DRIFT_AUDIT_SCHEMA);
    assert.equal(report.version, 1);
    assert.equal(report.generatedAt, '2026-01-04T00:00:00.000Z');
    assert.deepEqual(report.summary, { current: 9, drift: 0, inconclusive: 0 });
    assert.equal(report.bounds.requestCount, 2);
    assert.equal(report.bounds.requestLimit, 2);
    assert.deepEqual(report.observed.rootZone, {
      version: '2026010100', lastUpdatedAt: '2026-01-01T00:00:00.000Z', activeTlds: 3,
    });
    assert.deepEqual(report.observed.rdapBootstrap, {
      publication: '2026-01-02T00:00:00.000Z', version: '1.0', serviceGroups: 2,
      httpsServiceGroups: 2, httpOnlyServiceGroups: 0, coveredTlds: 2,
    });
    assert.equal(report.baseline.catalogueVersion, 25);
    assert.doesNotMatch(JSON.stringify(report), /must not be retained|AA\nBB/);
  });

  test('identifies metadata, assignment, and RDAP-profile drift without inferring availability', async () => {
    const changedRoot = ROOT_ZONE.replace('2026010100', '2026010200').replace('BB\n', '');
    const changedRdap = JSON.stringify({
      publication: '2026-01-05T00:00:00Z',
      version: '1.1',
      services: [
        [['aa'], ['https://rdap-a.example/']],
        [['bb'], ['https://rdap-b.example/']],
        [['cc'], ['https://rdap-c.example/']],
      ],
    });
    const report = await runRegistryDriftAudit(options({
      fetchSource: async (url) => new Response(url === ROOT_ZONE_URL ? changedRoot : changedRdap, { status: 200 }),
    }));
    assert.equal(report.summary.drift, 8);
    assert.equal(report.summary.current, 1);
    const rdapAssignments = report.checks.find((check) => check.id === 'rdap_suffix_assignments');
    const assignments = report.checks.find((check) => check.id === 'explicit_suffix_assignments');
    const profiles = report.checks.find((check) => check.id === 'explicit_rdap_profiles');
    assert.deepEqual(rdapAssignments.suffixes, ['bb']);
    assert.deepEqual(assignments.suffixes, ['bb']);
    assert.deepEqual(profiles.suffixes, ['bb']);
    assert.match(report.limitations.join(' '), /does not.*decide registration.*availability.*safety.*maliciousness/i);
  });

  test('keeps unavailable and malformed sources explicitly inconclusive', async () => {
    const report = await runRegistryDriftAudit(options({
      fetchSource: async (url) => url === ROOT_ZONE_URL
        ? new Response('', { status: 503 })
        : new Response('{not-json', { status: 200 }),
    }));
    assert.deepEqual(report.summary, { current: 0, drift: 0, inconclusive: 9 });
    assert.equal(report.observed.rootZone, null);
    assert.equal(report.observed.rdapBootstrap, null);
    assert.equal(report.sources[0].status, 503);
    assert.match(report.sources[0].error, /HTTP 503/);
    assert.match(report.sources[1].error, /valid JSON/i);
  });

  test('treats a capped response as inconclusive and clamps configured deadlines', async () => {
    const report = await runRegistryDriftAudit(options({
      requestTimeoutMs: 99_999,
      totalTimeoutMs: 99_999,
      fetchSource: async (url) => url === ROOT_ZONE_URL
        ? new Response('x'.repeat(MAX_ROOT_ZONE_BYTES + 1), { status: 200 })
        : new Response(RDAP_BOOTSTRAP, { status: 200 }),
    }));
    assert.equal(report.bounds.requestTimeoutMs, 7000);
    assert.equal(report.bounds.totalTimeoutMs, 15_000);
    assert.equal(report.summary.inconclusive, 5);
    assert.match(report.sources[0].error, /exceeded/);
  });

  test('does not mutate injected snapshot or capability records', async () => {
    const snapshot = structuredClone(SNAPSHOT);
    const capabilities = structuredClone(CAPABILITIES);
    const before = structuredClone({ snapshot, capabilities });
    await runRegistryDriftAudit(options({ snapshot, capabilities }));
    assert.deepEqual({ snapshot, capabilities }, before);
  });

  test('rejects an unexpectedly large internal capability catalogue before fetching', async () => {
    let calls = 0;
    await assert.rejects(runRegistryDriftAudit(options({
      capabilities: Array.from({ length: MAX_CAPABILITY_ROWS + 1 }, () => CAPABILITIES[0]),
      fetchSource: async () => { calls += 1; return new Response('', { status: 200 }); },
    })), /capability catalogue exceeded/i);
    assert.equal(calls, 0);
  });

  test('formats a bounded neutral terminal report', async () => {
    const output = formatRegistryDriftAudit(await runRegistryDriftAudit(options()));
    assert.match(output, /^WHOISleuth official-registry drift audit/m);
    assert.match(output, /9 current, 0 drift, 0 inconclusive/);
    assert.match(output, /RDAP service transport: 2 HTTPS-capable, 0 HTTP-only/);
    assert.match(output, /does not query registries or change the embedded catalogue/);
    assert.doesNotMatch(output, /unregistered|safe|malicious/);
  });
});

describe('registry drift command boundary', () => {
  test('accepts only one optional JSON flag', () => {
    assert.deepEqual(parseArguments([]), { json: false });
    assert.deepEqual(parseArguments(['--json']), { json: true });
    assert.throws(() => parseArguments(['--json', '--json']), /only once/);
    assert.throws(() => parseArguments(['example.test']), /Unknown option/);
  });

  test('uses distinct exit states for current, drift, and inconclusive reports', async () => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await main(['--json'], { ...options(), stdout: stdout.stream, stderr: stderr.stream }), 0);
    assert.equal(stderr.value(), '');
    assert.equal(JSON.parse(stdout.value()).schema, REGISTRY_DRIFT_AUDIT_SCHEMA);

    const drift = capture();
    assert.equal(await main([], {
      ...options({
        snapshot: { ...structuredClone(SNAPSHOT), counts: { ...SNAPSHOT.counts, activeTlds: 4 } },
      }),
      stdout: drift.stream,
      stderr: capture().stream,
    }), 1);
    assert.match(drift.value(), /DRIFT\s+Active TLD count/);

    const inconclusive = capture();
    assert.equal(await main([], {
      ...options({ fetchSource: async () => new Response('', { status: 503 }) }),
      stdout: inconclusive.stream,
      stderr: capture().stream,
    }), 2);
    assert.match(inconclusive.value(), /INCONCLUSIVE/);
  });

  test('sanitizes argument errors on stderr', async () => {
    const stderr = capture();
    assert.equal(await main(['--bad\nvalue'], { stderr: stderr.stream, stdout: capture().stream }), 2);
    assert.equal(stderr.value(), 'Unknown option: --bad value\n');
  });
});
