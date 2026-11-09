import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNetlifyBlobTextStore, type NetlifyBlobStore } from '../lib/netlify-versioned-text-store.mts';
import { createRetainedLookupSourceReader } from '../lib/retained-source-reader.mts';
import { MAX_EDITION_STATE_BYTES, parseEditionState, runSourceEditionCycle } from '../lib/retained-source-channel.mts';
import { prepareRetainedSourceData, type EditionFile } from '../lib/retained-source-data.mts';
import { assessAutomaticSourceEdition, readAutomaticPublisher } from '../lib/retained-source-refresh.mts';
import { buildSslblSnapshotData, parseSslblCertificateCsv, SSLBL_SOURCE_URL } from '../lib/sslbl-source.mts';
import { parseKevSource } from '../lib/cisa-kev-source.mts';
import { inspectSslblCertificate } from '../lib/sslbl-intelligence.mts';
import { runRetainedSourceRefresh } from '../netlify/functions/retained-source-refresh.mts';
import { prepareSourceEdition } from '../tools/source-edition-prepare.mts';
import { runCli } from '../cli/runner.mts';
import { analyzeBrowserLibraries } from '../lib/browser-library-profile.mts';
import { createLookupHandler } from '../netlify/functions/lookup.mts';
import { createLookupHttpResponse } from '../lib/lookup-response-contract.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { buildSessionCookie, createSessionToken } from '../lib/auth.mts';
import type { safeFetchDetailed } from '../lib/safe-fetch.mts';

const NOW = new Date('2026-11-15T09:00:00.000Z');
const FIRST = 'a'.repeat(40);
const SECOND = 'b'.repeat(40);
const PROD = { deploy: { context: 'production' } };
const PREVIEW = { deploy: { context: 'deploy-preview' } };
const TARGET = 'example.test';
const CERTIFICATE = { certificate: { fingerprintSha1: SECOND } };
const ssl = (day: number, ...prints: string[]) => `# Last updated: 2026-11-${day} 08:00:00 UTC\n`
  + prints.map(print => `2026-11-13 08:00:00,${print},Synthetic\n`).join('');
const kev = (day: number, ...ids: string[]) => JSON.stringify({
  catalogVersion: `2026.11.${day}`, dateReleased: `2026-11-${day}T08:00:00.000Z`, count: ids.length,
  vulnerabilities: ids.map(cveID => ({ cveID })),
});
const edition = async (raw: string) => prepareRetainedSourceData('sslbl',
  buildSslblSnapshotData(parseSslblCertificateCsv(raw), NOW.toISOString()), NOW);
const active = (current: EditionFile | null, previous: EditionFile | null = null) => JSON.stringify({ version: 1, current, previous });
const control = (value: object) => JSON.stringify({ version: 1, ...value });

function blobs() {
  let revision = 0;
  const values = new Map<string, { value: string; etag: string }>();
  const reads: string[] = [];
  const seed = (key: string, value: string) => values.set(key, { value, etag: String(++revision) });
  const backend: NetlifyBlobStore = {
    async getWithMetadata(key, options) {
      reads.push(key);
      assert.deepEqual(options, { consistency: 'strong', type: 'stream' });
      const existing = values.get(key);
      return existing ? { etag: existing.etag, data: new Response(existing.value).body } : null;
    },
    async set(key, value, options) {
      const current = values.get(key);
      if ('onlyIfNew' in options ? current : current?.etag !== options.onlyIfMatch) return { modified: false };
      seed(key, value);
      return { modified: true };
    },
  };
  return { seed, reads, get: (key: string) => values.get(key)?.value ?? null, store: createNetlifyBlobTextStore(backend, MAX_EDITION_STATE_BYTES) };
}

test('only opted-in production runs the target-free scheduler; an accepted edition and rollback change the same lookup reader', async () => {
  const source = blobs();
  const initial = await edition(ssl(14, FIRST));
  source.seed('state/sslbl', active(initial));
  source.seed('control/sslbl', control({ action: 'automatic' }));
  let downloads = 0;
  const options = {
    enabled: '1', now: NOW, openStore: () => source.store,
    readPublisher: async (id: string) => {
      assert.equal(id, 'sslbl');
      downloads++;
      return ssl(15, FIRST, SECOND);
    },
  };
  assert.deepEqual(await runRetainedSourceRefresh(PREVIEW, options), []);
  assert.deepEqual(await runRetainedSourceRefresh(PROD, { ...options, enabled: '0' }), []);
  assert.deepEqual(source.reads, []);
  let readTime = NOW.getTime();
  const read = createRetainedLookupSourceReader(options.openStore, () => readTime);
  const match = async () => inspectSslblCertificate(CERTIFICATE, { snapshot: (await read()).sslbl, now: NOW });
  assert.equal((await match()).verdict, 'not_listed');
  const [first, second] = await Promise.all([runRetainedSourceRefresh(PROD, options), runRetainedSourceRefresh(PROD, options)]);
  assert.equal(downloads, 1);
  assert.deepEqual([first[0]?.status, second[0]?.status].sort(), ['not_due', 'updated']);
  const promoted = parseEditionState(source.get('state/sslbl')).current!;
  assert.notEqual(promoted.digest, initial.digest);
  readTime += 10 * 60_000;
  assert.equal((await match()).verdict, 'listed');
  source.seed('control/sslbl', control({ action: 'rollback', from: promoted.digest, digest: initial.digest }));
  assert.equal((await runRetainedSourceRefresh(PROD, options))[0]?.status, 'rolled_back');
  readTime += 10 * 60_000;
  assert.equal((await match()).verdict, 'not_listed');
  assert.equal((await runRetainedSourceRefresh(PROD, options))[0]?.status, 'unchanged');
  assert.equal(downloads, 1);
});

test('rejects removals, tampered candidates and control races without replacing the active bytes', async () => {
  const source = blobs();
  const original = await edition(ssl(14, FIRST, SECOND));
  const candidate = await edition(ssl(15, FIRST));
  source.seed('state/sslbl', active(original));
  const options = { source: 'sslbl' as const, store: source.store, now: NOW, signal: new AbortController().signal,
    observe: async () => assessAutomaticSourceEdition('sslbl', ssl(15, FIRST), original, NOW) };
  source.seed('control/sslbl', control({ action: 'automatic' }));
  assert.equal((await runSourceEditionCycle(options)).status, 'review_required');
  source.seed('control/sslbl', control({ action: 'promote', from: original.digest, digest: candidate.digest }));
  source.seed('candidate/sslbl', candidate.text + ' ');
  assert.equal((await runSourceEditionCycle(options)).status, 'unavailable');
  assert.equal(parseEditionState(source.get('state/sslbl')).current?.digest, original.digest);
  source.seed('candidate/sslbl', candidate.text);
  const racingStore = {
    ...source.store,
    async read(key: string) {
      if (key === 'candidate/sslbl') source.seed('control/sslbl', control({ action: 'hold' }));
      return source.store.read(key);
    },
  };
  assert.equal((await runSourceEditionCycle({ ...options, store: racingStore })).status, 'conflict');
  assert.equal(parseEditionState(source.get('state/sslbl')).current?.digest, original.digest);
  source.seed('control/sslbl', control({ action: 'promote', from: original.digest, digest: candidate.digest }));
  assert.equal((await runSourceEditionCycle(options)).status, 'updated');
  // Recovery is possible even when the active bytes have since been damaged.
  source.seed('state/sslbl', active({ ...candidate, text: 'damaged' }, original));
  source.seed('control/sslbl', control({ action: 'rollback', from: candidate.digest, digest: original.digest }));
  assert.equal((await runSourceEditionCycle(options)).status, 'rolled_back');
  assert.deepEqual(parseEditionState(source.get('state/sslbl')), { version: 1, current: original, previous: null });
});

test('coalesces source reads and distinguishes a short provider outage from a successful fallback to bundled data', async () => {
  const source = blobs();
  const initial = await edition(ssl(14, FIRST, SECOND));
  source.seed('state/sslbl', active(initial));
  let time = NOW.getTime();
  let down = false;
  const read = createRetainedLookupSourceReader(() => {
    if (down) throw new Error('storage offline');
    return source.store;
  }, () => time);
  assert.ok((await Promise.all([read(), read()])).every(result => result.sslbl?.entryCount === 2));
  assert.deepEqual(source.reads.sort(), ['state/kev', 'state/registrar', 'state/sslbl']);
  time += 10 * 60_000;
  down = true;
  assert.equal((await read()).sslbl?.entryCount, 2);
  time += 60 * 60_000;
  assert.equal((await read()).sslbl, undefined);
  down = false;
  time += 60_000;
  source.seed('state/sslbl', active(initial));
  assert.ok((await read()).sslbl);
  source.seed('state/sslbl', active(null, initial));
  time += 10 * 60_000;
  assert.equal((await read()).sslbl, undefined);
});

test('a fixed publisher response cannot redirect, truncate or introduce invalid UTF-8', async () => {
  const fetcher = (response: Response, redirectLimitReached = false) =>
    (async (url, options, dependencies) => {
      assert.equal(url, SSLBL_SOURCE_URL);
      assert.ok(options?.signal);
      assert.equal(dependencies?.maxRedirects, 0);
      return { response, redirectLimitReached };
    }) as typeof safeFetchDetailed;
  const signal = new AbortController().signal;
  assert.equal(await readAutomaticPublisher('sslbl', signal, fetcher(new Response('text'))), 'text');
  for (const [response, redirected] of [
    [new Response(null, { status: 301 }), true],
    [new Response(new Uint8Array([0xff])), false],
    [new Response('x'.repeat(2 * 1024 * 1024 + 1)), false],
  ] as const) await assert.rejects(readAutomaticPublisher('sslbl', signal, fetcher(response, redirected)));
});

test('edition preparation and CLI admission preserve an exact local digest and reject invalid data before collection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retained-edition-test-'));
  try {
    const input = join(dir, 'feed.json');
    const output = join(dir, 'edition.json');
    await writeFile(input, kev(15, 'CVE-2019-11358'));
    const prepared = await prepareSourceEdition(['kev', output, input], NOW);
    let count = 0;
    const stdout = { write: () => {} };
    let errors = '';
    const deps = {
      stdout, stderr: { write: (value: string | Uint8Array) => { errors += String(value); } }, now: () => NOW.toISOString(),
      async runUnifiedLookup(_target: unknown, options?: Parameters<typeof runUnifiedLookup>[1]) {
        count++;
        assert.deepEqual(options?.sourceEditions?.kev?.identifiers, ['CVE-2019-11358']);
        return { rdap: { parsed: {} }, whois: {}, availability: { applicable: true, state: 'registered' },
          diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } } };
      },
    };
    const flags = ['--source-edition', output, '--source-digest', prepared.digest];
    assert.equal(await runCli(['lookup', TARGET, '--deep', '--json', ...flags], deps), 0, errors);
    const before = await readFile(output, 'utf8');
    await assert.rejects(prepareSourceEdition(['kev', output, input], NOW));
    assert.equal(await readFile(output, 'utf8'), before);
    await writeFile(output, before + ' ');
    assert.equal(await runCli(['lookup', TARGET, '--deep', '--json', ...flags], deps), 2);
    assert.equal(await runCli(['lookup', TARGET, ...flags], deps), 2);
    assert.equal(await runCli(['lookup', TARGET, '--deep', '--plan', ...flags], deps), 2);
    assert.equal(count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('known-exploited updates use existing advisory matching and preserve edition provenance', async () => {
  const older = await prepareRetainedSourceData('kev', parseKevSource(kev(14, 'CVE-2026-12345')), NOW);
  const html = '<script src="/jquery-3.3.1.min.js"></script>';
  const candidate = await assessAutomaticSourceEdition('kev', kev(15, 'CVE-2026-12345', 'CVE-2019-11358'), older, NOW);
  assert.equal(typeof candidate, 'object');
  assert.equal(await assessAutomaticSourceEdition('kev', kev(15, 'CVE-2019-11358'), older, NOW), 'review_required');
  const newData = parseKevSource(kev(15, 'CVE-2026-12345', 'CVE-2019-11358'));
  const profile = await analyzeBrowserLibraries({ html, knownExploitedEdition: newData, observedAt: NOW.toISOString() });
  assert.equal(profile.knownExploitedCatalog.version, '2026.11.15');
  assert.ok(profile.findings.some(item => item.knownExploitedIdentifiers.includes('CVE-2019-11358')));
});

test('the authenticated hosted handler uses editions only on opted-in production Deep domain lookups', async (t) => {
  t.mock.method(Date, 'now', () => NOW.getTime());
  const previous = { SITE_PASSWORD: process.env.SITE_PASSWORD, SESSION_SECRET: process.env.SESSION_SECRET };
  process.env.SITE_PASSWORD = 'test-only-secret';
  process.env.SESSION_SECRET = 'test-only-session-signing-secret';
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  } });
  const source = blobs();
  const staged = await edition(ssl(15, SECOND));
  source.seed('state/sslbl', active(staged));
  const sourceReader = createRetainedLookupSourceReader(() => source.store, () => NOW.getTime());
  const modes: boolean[] = [];
  const handler = createLookupHandler({
    sourceEditionsEnabled: '1', readSourceEditions: sourceReader, createLookupHttpResponse,
    runUnifiedLookup: (target, options) => {
      modes.push(Boolean(options?.sourceEditions?.sslbl));
      return runUnifiedLookup(target, {
        ...options, sslblNow: NOW,
        fetchRdapRecord: async () => null,
        buildWhoisChain: async () => [],
        checkDomainAvailability: async () => ({ applicable: true, state: 'registered', tls: CERTIFICATE }) as never,
        collectObservedNetworkContext: async () => null as never,
      });
    },
  });
  const cookie = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]!;
  const request = (query: string, authenticated = true) => new Request(`https://console.example/api/lookup?q=${query}`, { headers: {
    host: 'console.example', 'sec-fetch-site': 'same-origin', ...(authenticated ? { cookie } : {}),
  } });
  assert.equal((await handler(request(TARGET, false), PROD)).status, 401);
  for (const [query, ctx] of [[`${TARGET}&fast=1`, PROD], [`${TARGET}&compact=1`, PROD], [TARGET, PREVIEW]] as const) {
    assert.equal((await handler(request(query), ctx)).status, 200);
  }
  assert.deepEqual(source.reads, []);
  const response = await handler(request(TARGET), PROD);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sslbl?.verdict, 'listed');
  assert.deepEqual(modes, [false, false, false, true]);
});
