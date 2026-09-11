import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkDomainAvailability, fetchHomepage } from '../lib/availability.mts';
import { collectDnsIntelligence } from '../lib/dns-intelligence.mts';
import { skippedTlsObservation } from '../lib/tls-intelligence.mts';
import { parseLookupHttpResponse } from '../lib/lookup-response-contract.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { parseLookupEvidenceReplay } from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import { buildLookupEvidenceReplayDiff } from '../frontend/src/lib/analysis/lookup-evidence-replay-diff.ts';
import { buildLookupAssetGraph } from '../packages/investigation/lookup-asset-graph.mts';
import { lookupObservationHostname } from '../packages/evidence/lookup-target.mts';
import { caseEvidenceIncomparableReasons, compareCaseEvidence, normalizeSnapshot } from '../packages/cases/case-evidence-model.mts';
import { normalizeCaseEvidencePins } from '../packages/cases/case-response-model.mts';
import { buildLookupEvidence } from '../lib/evidence-export.mts';

const HOST = 'portal.example.test';
const ROOT = 'example.test';
const NOW = '2026-09-01T00:00:00.000Z';
const RDAP = { upstreamStatus: 200, parsed: { domain: ROOT, statuses: ['active'], nameservers: [], events: [] } };
type DnsOptions = NonNullable<Parameters<typeof collectDnsIntelligence>[1]>;
const emptyResolvers = Object.fromEntries([
  'resolve4', 'resolve6', 'resolveCname', 'resolveNs', 'resolveMx', 'resolveTxt', 'resolveCaa', 'resolveSoa', 'resolveHttps',
].map((name) => [name, async () => []])) as NonNullable<DnsOptions['resolvers']>;

async function legacyDocument(): Promise<Record<string, unknown> & { schemaVersion: number; analysis: Record<string, unknown> & { availability: Record<string, unknown> } }> {
  const raw = await readFile(new URL('./fixtures/lookup-evidence-v28.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), '2f00727f88b28c83d23e69426a351c47dfd7580c563c7ddf5439cddca438398b');
  return JSON.parse(raw);
}

test('Deep supporting collectors examine the selected hostname without relabelling registration or sale evidence', async () => {
  const calls: Array<[string, string]> = [];
  const result = await checkDomainAvailability(ROOT, {
    observationHostname: HOST, rdapRecord: RDAP,
    collectDnsIntelligence: async (hostname, options) => {
      calls.push(['dns', hostname]);
      assert.equal(options?.registrationDomain, ROOT);
      return collectDnsIntelligence(hostname, { ...options, resolvers: { ...emptyResolvers, resolveNs: async () => ['ns.child.example.test'] } });
    },
    collectTlsIntelligence: async (hostname) => { calls.push(['tls', hostname]); return skippedTlsObservation(); },
    fetchHomepage: async (hostname) => {
      calls.push(['http', hostname]);
      return fetchHomepage(hostname, { fetcher: async () => new Response('<title>Domain for sale</title><p>This domain is for sale</p>', { headers: { 'content-type': 'text/html' } }) });
    },
    fetchFaviconHash: async (hostname) => { calls.push(['favicon', hostname]); return null; },
  });
  assert.deepEqual(calls, [['http', HOST], ['dns', HOST], ['tls', HOST], ['favicon', HOST]]);
  assert.equal(result.state, 'registered');
  assert.equal(result.source, 'rdap');
  assert.ok('observationHostname' in result);
  assert.equal(result.observationHostname, HOST);
  assert.deepEqual(result.nameservers, [], 'child resolver NS records cannot become registry nameservers');
  assert.deepEqual(result.dns.records.ns, ['ns.child.example.test']);
});

test('Fast collection and standalone registrable-domain collection keep their existing request scope', async () => {
  const result = await checkDomainAvailability(ROOT, {
    fast: true, observationHostname: HOST, rdapRecord: RDAP,
    fetchHomepage: async () => { throw new Error('Fast must not collect web evidence'); },
  });
  assert.equal(result.state, 'registered');
  assert.equal('observationHostname' in result, false);
  assert.equal(lookupObservationHostname({ domain: ROOT }), ROOT);
  assert.equal(lookupObservationHostname({ domain: ROOT, observationHostname: HOST }), HOST);
  assert.equal(lookupObservationHostname({ domain: ROOT, observationHostname: 'invalid..test' }), null);
});

test('cross-domain observation targets are rejected before any source work', async () => {
  let reads = 0;
  const options = { observationHostname: 'unrelated.test', get rdapRecord() { reads += 1; return RDAP; } };
  await assert.rejects(() => checkDomainAvailability(ROOT, options), /observation hostname/);
  assert.equal(reads, 0);
  await assert.rejects(() => collectDnsIntelligence(HOST, { registrationDomain: 'unrelated.test', resolvers: emptyResolvers }), /registration context/);
});

test('DNS host records and registration-delegation queries retain separate names', async () => {
  const names: string[] = [];
  const result = await collectDnsIntelligence(HOST, {
    registrationDomain: ROOT, includeExtendedContext: true,
    resolvers: { ...emptyResolvers, resolveNs: async (name) => { names.push(name); return name === ROOT ? ['ns.parent.example.test'] : ['ns.child.example.test']; } },
    queryAuthority: async () => { throw new Error('No address was supplied for an authority request'); },
  });
  assert.deepEqual(names.sort(), [ROOT, HOST].sort());
  assert.deepEqual(result.records.ns, ['ns.child.example.test']);
  assert.equal(result.delegation?.domain, ROOT);
});

test('immutable version-28 evidence keeps its registrable-domain collection meaning in both readers', async () => {
  const document = await legacyDocument();
  const raw = JSON.stringify(document);
  await verifyOfflineArtifact(raw);
  const replay = await parseLookupEvidenceReplay(raw);
  assert.equal(replay.schemaVersion, 28);
  assert.equal(replay.target, HOST);
  assert.equal(replay.observationHostname, ROOT);
});

test('hostname-scoped evidence requires the new format and binds to the submitted hostname', async () => {
  const document = await legacyDocument();
  document.schemaVersion = 29;
  document.analysis.availability.observationHostname = HOST;
  await verifyOfflineArtifact(JSON.stringify(document));
  assert.equal((await parseLookupEvidenceReplay(JSON.stringify(document))).observationHostname, HOST);
  for (const candidate of [
    { ...document, schemaVersion: 28 },
    { ...document, analysis: { ...document.analysis, availability: { ...document.analysis.availability, observationHostname: 'other.example.test' } } },
  ]) {
    await assert.rejects(() => verifyOfflineArtifact(JSON.stringify(candidate)));
    await assert.rejects(() => parseLookupEvidenceReplay(JSON.stringify(candidate)), /hostname/);
  }
  document.analysis.availability.dns = { delegation: { domain: HOST } };
  await assert.rejects(() => verifyOfflineArtifact(JSON.stringify(document)), /hostname/);
  await assert.rejects(() => parseLookupEvidenceReplay(JSON.stringify(document)), /hostname/);
});

test('replay comparisons do not mistake a changed collection hostname for changed web evidence', async () => {
  const document = await legacyDocument();
  const before = await parseLookupEvidenceReplay(JSON.stringify(document));
  document.schemaVersion = 29;
  document.analysis.availability.observationHostname = HOST;
  document.analysis.availability.pageTitle = 'A different page';
  const after = await parseLookupEvidenceReplay(JSON.stringify(document));
  const diff = buildLookupEvidenceReplayDiff(before, after);
  assert.equal(diff.rows.find((row) => row.id === 'collection:hostname')?.kind, 'collection_quality_difference');
  assert.equal(diff.rows.find((row) => row.id === 'fact:page.title')?.kind, 'collection_quality_difference');
});

test('Case snapshots preserve scope without changing historical fingerprints or comparing different hosts', () => {
  const prior = normalizeSnapshot({ inputHostname: HOST, scanDepth: 'deep', capturedAt: NOW, pageTitle: 'Old', registrar: 'Earlier registrar' }, { caseDomain: ROOT });
  assert.ok(prior);
  const current = normalizeSnapshot({ ...prior, observationHostname: HOST, pageTitle: 'New', registrar: 'Later registrar' }, { caseDomain: ROOT });
  assert.ok(current);
  assert.equal(current.observationHostname, HOST);
  assert.deepEqual(compareCaseEvidence(prior, current).map((change) => change.field), ['registrar']);
  assert.ok(caseEvidenceIncomparableReasons(prior, current).includes('observation-context'));
  const historical = normalizeSnapshot({ ...prior, observationHostname: HOST }, { caseDomain: ROOT, sourceVersion: 15 });
  assert.equal(historical?.fingerprint, prior.fingerprint);
  assert.equal(historical?.observationHostname, undefined);
});

test('the evidence graph connects registration to the parent and DNS evidence to the actual host', () => {
  const graph = buildLookupAssetGraph({ target: HOST, registrationDomain: ROOT,
    dnsRecords: { a: ['192.0.2.10'] }, dnsEvidence: { source: 'dns', complete: true, observedAt: NOW },
    rdapParsed: { registrar: { name: 'Example Registrar' } }, rdapEvidence: { complete: true, fetchedAt: NOW },
  });
  const name = (id: string) => graph.nodes.find((node) => node.id === id)?.label;
  assert.equal(name(graph.edges.find((edge) => edge.kind === 'resolves-to')!.source), HOST);
  assert.equal(name(graph.edges.find((edge) => edge.kind === 'registered-via')!.source), ROOT);
  assert.equal(graph.edges.find((edge) => edge.kind === 'registration-namespace')?.source, graph.targetId);
});

test('live response admission rejects a hostname marker that contradicts the submitted target', () => {
  const result = { type: 'domain', query: HOST, inputHostname: HOST, registrableDomain: ROOT, isSubdomain: true,
    rdap: { parsed: { domain: ROOT } }, whois: { parsed: { domainName: ROOT }, chain: [] },
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' }, availability: { status: 'complete' } },
    availability: { applicable: true, domain: ROOT, state: 'registered', observationHostname: HOST },
  };
  assert.equal(parseLookupHttpResponse(result).ok, true);
  assert.equal(buildLookupEvidence(result, { generatedAt: NOW }).analysis.availability?.observationHostname, HOST);
  result.availability.observationHostname = 'other.example.test';
  assert.equal(parseLookupHttpResponse(result).ok, false);
  assert.throws(() => buildLookupEvidence(result, { generatedAt: NOW }), /observation hostname/);
});

test('Case scope admission does not turn malformed supplied identities into legacy evidence', () => {
  const source = { pageTitle: 'Retained title', capturedAt: NOW };
  for (const observationHostname of ['other.test', 'invalid..test', 'https://portal.example.test/path']) {
    assert.equal(normalizeSnapshot({ ...source, observationHostname }, { caseDomain: ROOT }), null);
  }
  const pin = { label: 'Page title', value: 'Retained title', observedAt: NOW, observationHostname: HOST };
  assert.equal(normalizeCaseEvidencePins([pin], NOW)[0]?.observationHostname, HOST);
  assert.equal(normalizeCaseEvidencePins([pin], NOW, { sourceVersion: 15 })[0]?.observationHostname, undefined);
  for (const observationHostname of ['invalid..test', 'https://portal.example.test/path', 'PORTAL.EXAMPLE.TEST']) {
    assert.equal(normalizeCaseEvidencePins([{ ...pin, observationHostname }], NOW).length, 0);
  }
  const maximumHostname = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.test`;
  assert.equal(maximumHostname.length, 255);
  assert.equal(normalizeCaseEvidencePins([{ ...pin, observationHostname: maximumHostname }], NOW).length, 0);
  const admittedHostname = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(56)}.test`;
  assert.equal(admittedHostname.length, 253);
  assert.equal(normalizeCaseEvidencePins([{ ...pin, observationHostname: admittedHostname }], NOW)[0]?.observationHostname, admittedHostname);
});
