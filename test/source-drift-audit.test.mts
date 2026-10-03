import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  auditSourceDrift, main, BROWSER_REVISION_URL, INFRASTRUCTURE_REVISION_URL,
  UNICODE_LATEST_URL, type SourceDriftBaseline,
} from '../tools/source-drift-audit.mts';
import { buildCommonInfrastructureSnapshot, CLOUDFLARE_RANGE_URLS } from '../tools/common-infrastructure-snapshot.mts';
import { parseSslblCertificateCsv, SSLBL_SOURCE_URL } from '../tools/sslbl-snapshot.mts';
import { SOURCE_URL as KEV_URL } from '../tools/cisa-kev-catalog.mts';
import { RDAP_EXTENSION_SOURCE_URL } from '../tools/rdap-extension-drift-audit.mts';
import { RDAP_EXTENSION_REGISTRY_FIXTURE } from '../fixtures/rdap-extension-registry.mts';
import { sha256Text as sha256 } from '../tools/maintainer-tool-helpers.mts';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const COMMIT = 'a'.repeat(40);
async function fixture() {
  const sslbl = `# Last updated: 2026-09-23 09:00:00 UTC\n2026-09-23 08:00:00,${'a'.repeat(40)},Fixture\n`;
  const parsed = parseSslblCertificateCsv(sslbl);
  const kev = JSON.stringify({ catalogVersion: '2026.09.22', dateReleased: '2026-09-22T00:00:00.000Z', count: 1,
    vulnerabilities: [{ cveID: 'CVE-2026-12345' }] });
  const browser = JSON.stringify({ fixture: { vulnerabilities: [], extractors: {} } });
  const unicode = '# Version: 18.0.0\n0430 ; 0061 ; MA # fixture\n';
  const extensions = 'Extension Identifier,Registry Operator,Specification,Contact,Notes\n'
    + RDAP_EXTENSION_REGISTRY_FIXTURE.entries.map(([id, status]) => `${id}${status === 'obsolete' ? ' (OBSOLETED)' : ''},Fixture,Fixture,Fixture,\n`).join('');
  const bodies = new Map<string, string>([
    [SSLBL_SOURCE_URL, sslbl], [KEV_URL, kev], [UNICODE_LATEST_URL, unicode], [RDAP_EXTENSION_SOURCE_URL, extensions],
    [BROWSER_REVISION_URL, JSON.stringify([{ sha: COMMIT, commit: { committer: { date: NOW.toISOString() } } }])],
    [INFRASTRUCTURE_REVISION_URL, JSON.stringify([{ sha: COMMIT, commit: { committer: { date: NOW.toISOString() } } }])],
    [`https://raw.githubusercontent.com/RetireJS/retire.js/${COMMIT}/repository/jsrepository.json`, browser],
    [CLOUDFLARE_RANGE_URLS[0]!, '198.19.0.0/24\n'], [CLOUDFLARE_RANGE_URLS[1]!, '2001:db8::/32\n'],
  ]);
  for (const id of ['amazon-aws', 'cloudflare', 'google-gcp']) bodies.set(
    `https://raw.githubusercontent.com/MISP/misp-warninglists/${COMMIT}/lists/${id}/list.json`,
    JSON.stringify({ type: 'cidr', version: id === 'cloudflare' ? 20260811 : 20260908, list: ['198.19.0.0/24', '2001:db8::/32'] }),
  );
  const requests: string[] = [];
  const fetchSource = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push(url);
    assert.ok(init.signal);
    assert.equal(init.redirect, 'error');
    const body = bodies.get(url);
    assert.notEqual(body, undefined, `Unexpected source: ${url}`);
    return new Response(body);
  };
  const infrastructure = await buildCommonInfrastructureSnapshot(COMMIT, {
    now: () => NOW, fetchImpl: async (url) => {
      const body = bodies.get(String(url));
      assert.notEqual(body, undefined);
      return new Response(body);
    },
  });
  const baseline: SourceDriftBaseline = {
    sslbl: { sourceUpdatedAt: parsed.sourceUpdatedAt, sourceDigestSha256: parsed.sourceDigestSha256,
      entriesDigestSha256: parsed.entriesDigestSha256, entryCount: 1, fingerprintChunks: ['a'.repeat(40)] },
    kev: { sourceSha256: sha256(kev), releasedAt: '2026-09-22T00:00:00.000Z', identifiers: ['CVE-2026-12345'] },
    browser: { sourceSha256: sha256(browser) }, infrastructure,
    unicode: { version: '18.0.0', sha256: sha256(unicode) }, extensionDigest: sha256(extensions),
  };
  return { baseline, bodies, requests, fetchSource, now: NOW };
}
function output() {
  let value = '';
  return { write: (text: string) => { value += text; }, read: () => value };
}

describe('read-only retained source drift', () => {
  test('reports the failed source stage without exposing payloads or hiding independent results', async () => {
    const scenarios = [
      { id: 'sslbl', url: SSLBL_SOURCE_URL, body: '', expected: /empty body/u },
      { id: 'sslbl', url: SSLBL_SOURCE_URL, body: 'private invalid feed', expected: /feed format could not be parsed/u },
      { id: 'kev', url: KEV_URL, body: 'private invalid JSON', expected: /not a valid JSON object/u },
      { id: 'kev', url: KEV_URL, body: '{"catalogVersion":"2026.09.21","dateReleased":"2026-09-21T00:00:00Z"}', expected: /older than the retained release/u },
      { id: 'kev', url: KEV_URL, body: '{"catalogVersion":"2026.09.23","dateReleased":"2026-09-23T00:00:00Z","count":1,"vulnerabilities":[{"cveID":"private invalid identifier"}]}', expected: /entries failed projection validation/u },
    ];
    for (const scenario of scenarios) {
      const setup = await fixture();
      const before = structuredClone(setup.baseline);
      setup.bodies.set(scenario.url, scenario.body);
      const report = await auditSourceDrift(setup);
      const row = report.checks.find(item => item.id === scenario.id)!;
      assert.equal(row.status, 'inconclusive');
      assert.match(row.detail, scenario.expected);
      assert.doesNotMatch(JSON.stringify(report), /private invalid/u);
      assert.equal(report.checks.find(item => item.id === 'unicode')?.status, 'current');
      assert.deepEqual(setup.baseline, before);
    }
  });
  test('compares every retained source against bounded fixed endpoints without rewriting the baseline', async () => {
    const setup = await fixture();
    const before = structuredClone(setup.baseline);
    const report = await auditSourceDrift(setup);
    assert.equal(report.status, 'current', JSON.stringify(report.checks));
    assert.equal(report.checks.length, 9);
    assert.equal(report.networkRequests, 12);
    assert.equal(setup.requests.length, 12);
    assert.deepEqual(setup.baseline, before);
    assert.ok(report.checks.every(item => item.status === 'current'));
  });

  test('reports changed data, latest Unicode versions and official range mismatch without installing them', async () => {
    const setup = await fixture();
    setup.bodies.set(SSLBL_SOURCE_URL, setup.bodies.get(SSLBL_SOURCE_URL)! + `2026-09-23 08:00:00,${'b'.repeat(40)},Fixture\n`);
    // Same timestamp with changed bytes is a rollback-integrity failure, not an accepted refresh.
    setup.bodies.set(SSLBL_SOURCE_URL, setup.bodies.get(SSLBL_SOURCE_URL)!.replace('09:00:00', '10:00:00'));
    setup.bodies.set(UNICODE_LATEST_URL, '# Version: 19.0.0\n0430 ; 0061 ; MA # fixture\n');
    setup.bodies.set(CLOUDFLARE_RANGE_URLS[0]!, '198.18.0.0/24\n');
    const report = await auditSourceDrift(setup);
    assert.equal(report.status, 'drift');
    assert.equal(report.checks.find(item => item.id === 'sslbl')?.observedItems, 2);
    assert.equal(report.checks.find(item => item.id === 'unicode')?.status, 'drift');
    assert.match(report.checks.find(item => item.id === 'infrastructure_cloudflare')!.detail, /Official edge ranges differ/u);
    assert.equal(report.checks.find(item => item.id === 'infrastructure_cloudflare')?.status, 'drift');
  });

  test('does not let unavailable, malformed, oversized or rolled-back responses masquerade as current data', async () => {
    const setup = await fixture();
    setup.bodies.set(UNICODE_LATEST_URL, 'x'.repeat(1_000_001));
    setup.bodies.set(BROWSER_REVISION_URL, JSON.stringify([{ sha: '../../private', commit: {} }]));
    setup.bodies.set(KEV_URL, setup.bodies.get(KEV_URL)!.replace('2026-09-22', '2026-09-21'));
    const report = await auditSourceDrift({ ...setup, fetchSource: async (url, init) =>
      url === SSLBL_SOURCE_URL ? new Response('private source detail', { status: 503 }) : setup.fetchSource(url, init) });
    for (const id of ['sslbl', 'unicode', 'browser_advisories', 'kev']) {
      const row = report.checks.find(item => item.id === id)!;
      assert.equal(row.status, 'inconclusive', id);
      assert.equal(row.observedItems, null);
    }
    assert.equal(report.checks.find(item => item.id === 'infrastructure_google-gcp')?.status, 'current');
    assert.doesNotMatch(JSON.stringify(report), /private source detail|\.\.\/private/u);
  });

  test('retains overdue verification as drift even when upstream ranges are unchanged', async () => {
    const setup = await fixture();
    const report = await auditSourceDrift({ ...setup, now: new Date('2026-10-25T12:00:00.000Z') });
    assert.equal(report.checks.find(item => item.id === 'infrastructure_cloudflare')?.status, 'drift');
    assert.match(report.checks.find(item => item.id === 'infrastructure_cloudflare')!.detail, /verification is due/u);
    assert.equal(report.checks.find(item => item.id === 'infrastructure_amazon-aws')?.status, 'drift');
    assert.equal(report.checks.find(item => item.id === 'sslbl')?.status, 'drift');
    assert.equal(report.checks.find(item => item.id === 'kev')?.status, 'drift');
  });

  test('bounds a stalled source and continues independent checks without automatic retries', async () => {
    const setup = await fixture();
    const report = await auditSourceDrift({ ...setup, requestTimeoutMs: 5,
      fetchSource: (url, init) => url === SSLBL_SOURCE_URL ? new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('timeout did not fire')), 1_000);
        init.signal!.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal!.reason); }, { once: true });
      }) : setup.fetchSource(url, init),
    });
    assert.equal(report.checks.find(item => item.id === 'sslbl')?.status, 'inconclusive');
    assert.equal(report.checks.find(item => item.id === 'rdap_extensions')?.status, 'current');
    assert.equal(report.networkRequests, 12);
  });

  test('requires explicit live mode and returns distinct current, drift and unavailable exits', async () => {
    const setup = await fixture();
    const stdout = output();
    const stderr = output();
    for (const args of [[], ['--json'], ['--live', '--live'], ['--live', '--source=https://example.test']]) {
      assert.equal(await main(args, { ...setup, stdout, stderr }), 2);
    }
    assert.equal(setup.requests.length, 0);
    assert.match(stderr.read(), /Usage:/u);
    assert.equal(await main(['--live', '--json'], { ...setup, stdout, stderr }), 0);
    assert.equal(JSON.parse(stdout.read()).status, 'current');
    setup.bodies.set(UNICODE_LATEST_URL, '# Version: 19.0.0\n');
    assert.equal(await main(['--live'], { ...setup, stdout, stderr }), 1);
    setup.bodies.set(UNICODE_LATEST_URL, 'malformed');
    assert.equal(await main(['--live'], { ...setup, stdout, stderr }), 2);
  });
});
