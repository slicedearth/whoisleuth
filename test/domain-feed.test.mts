import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createIncrementalSha256, sha256IdentityHex, MAX_IDENTITY_DIGEST_BYTES } from '../packages/evidence/record-identity.mts';
import { DOMAIN_FEED_CATALOGUE, DOMAIN_FEED_LIMITS, domainFeedDefinition, normalizeDomainFeedSelection,
  strictDomainFeedHostname, scanDomainFeed, projectDomainFeedMatch, buildDomainFeedReview, normalizeDomainFeedReview,
  buildDomainFeedWatchInput } from '../packages/monitoring/domain-feed.mts';
import { reviewCandidateWatchInput } from '../cli/watchlist-review.mts';

const NOW = '2026-10-04T00:00:00.000Z';
const selection = normalizeDomainFeedSelection({ hosts: ['exact.example'], terms: ['brand'], brandProfileId: 'review-profile' });
async function* chunks(bytes: Uint8Array, size = 7) { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); }
const encode = (value: string) => new TextEncoder().encode(value);
const scan = (value: string, options: Partial<Parameters<typeof scanDomainFeed>[1]> = {}) => scanDomainFeed(chunks(encode(value)), { feedId: 'tif-mini', selection, importedAt: NOW, ...options });

test('incremental identity agrees with independent platform SHA-256 across padding and chunk boundaries', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 10000, MAX_IDENTITY_DIGEST_BYTES]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 17 + 3) % 256);
    const expected = createHash('sha256').update(bytes).digest('hex');
    for (const size of [1, 63, 64, 8191]) {
      const digest = createIncrementalSha256(length);
      for (let offset = 0; offset < length; offset += size) digest.update(bytes.subarray(offset, offset + size));
      assert.equal(digest.digestHex(), expected);
      assert.throws(() => digest.update(new Uint8Array()), /finalised/u);
      assert.throws(() => digest.digestHex(), /finalised/u);
    }
    assert.equal(sha256IdentityHex(bytes), expected);
  }
  assert.throws(() => sha256IdentityHex(new Uint8Array(MAX_IDENTITY_DIGEST_BYTES + 1)), /byte limit/u);
  const bounded = createIncrementalSha256(1); bounded.update(encode('a'));
  assert.throws(() => bounded.update(encode('b')), /byte limit/u);
});

test('catalogue is a fixed plain-domain allowlist with licence attribution and distinct evidence families', () => {
  assert.equal(DOMAIN_FEED_CATALOGUE.length, 11);
  assert.equal(domainFeedDefinition('tif-full').url, 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif-onlydomains.txt');
  assert.equal(domainFeedDefinition('entropy30').kind, 'entropy-subset');
  assert.equal(domainFeedDefinition('nrd14-8').kind, 'recent-domain');
  assert.ok(DOMAIN_FEED_CATALOGUE.every(feed => feed.licence === 'GPL-3.0' && feed.licenceUrl.endsWith('/LICENSE')));
  assert.throws(() => domainFeedDefinition('https://example.test/feed'), /identifier/u);
});

test('plain domain gate rejects URL, IP, wildcard, hosts and filter syntax before compatibility normalisation', () => {
  for (const value of ['https://exact.example/path', 'exact.example:443', 'name@exact.example', 'exact.example/path',
    '*.exact.example', '||exact.example^', '0.0.0.0 exact.example', '127.0.0.1', '[2001:db8::1]', 'exact.example.',
    'exact.example\t', ' exact.example', 'bad_.example', '-bad.example', 'exact.example\u202e', 'single']) assert.equal(strictDomainFeedHostname(value), '', value);
  assert.equal(strictDomainFeedHostname('EXACT.example'), 'exact.example');
  assert.equal(strictDomainFeedHostname('例え.example'), 'xn--r8jz45g.example');
  assert.throws(() => normalizeDomainFeedSelection({ terms: ['ab'] }), /3–80/u);
  assert.throws(() => normalizeDomainFeedSelection({ hosts: ['https://exact.example'] }), /plain domain/u);
  assert.throws(() => normalizeDomainFeedSelection({ terms: Array(21).fill('brand') }), /20 literal/u);
  assert.throws(() => normalizeDomainFeedSelection({ hosts: Array(201).fill('exact.example') }), /200 exact/u);
});

test('streaming UTF-8, BOM, CRLF and no final newline keep full raw digest and distinct source clocks', async () => {
  const text = '\uFEFF# Last modified: 03 Oct 2026 07:50 UTC\r\n# Version: 2026.1003\r\n# Number of entries: 4\r\nEXACT.example\r\nsub.exact.example\r\nmybrand.example\r\n例え.example';
  const bytes = encode(text);
  for (const size of [1, 2, 64, 256 * 1024]) {
    const result = await scanDomainFeed(chunks(bytes, size), { feedId: 'nrd7', selection, importedAt: NOW });
    assert.equal(result.revision, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.equal(result.rows, 4); assert.equal(result.bytes, bytes.length);
    assert.deepEqual(result.matches.map(match => match.domain), ['exact.example', 'mybrand.example']);
    assert.equal(result.declaredPublishedAt, '2026-10-03T07:50:00.000Z');
    assert.equal(result.declaredVersion, '2026.1003'); assert.equal(result.acquiredAt, null);
    const source = result.matches[0]!.candidate.sources[0]!;
    assert.equal(source.source, 'domain-feed:nrd7'); assert.equal(source.revision, result.revision);
    assert.equal(source.observedHostname, 'exact.example'); assert.equal(source.firstLocalObservedAt, NOW);
    assert.equal(source.sourceFirstObservedAt, null); assert.equal(source.sourceLastObservedAt, null);
    assert.equal(source.completeness, 'unknown');
    assert.equal(normalizeDomainFeedReview(JSON.parse(JSON.stringify(result)))?.revision, result.revision);
  }
});

test('literal terms are not regular expressions and exact host selection never implies parent membership', async () => {
  const result = await scan('exact.example\nsub.exact.example\nmybrand.example\nother.example', { selection: normalizeDomainFeedSelection({ hosts: ['exact.example'], terms: ['.*x'] }) });
  assert.deepEqual(result.matches.map(match => match.domain), ['exact.example']);
  assert.equal(result.matches[0]!.candidate.matches.length, 0);
});

test('malformed tails, invalid UTF-8, conflicting metadata and reduced bounds produce no usable partial result', async () => {
  for (const tail of ['https://bad.example/path', '||bad.example^', '0.0.0.0 bad.example', 'bad.example\u0000'])
    await assert.rejects(scan(`exact.example\n${tail}`), /plain domain|control/u);
  await assert.rejects(scanDomainFeed(chunks(new Uint8Array([0xff])), { feedId: 'tif-mini', selection, importedAt: NOW }), /encoded|UTF/u);
  await assert.rejects(scan('exact.example\nother.example', { limits: { rows: 1 } }), /rows/u);
  await assert.rejects(scan('exact.example', { limits: { bytes: 5 } }), /bytes/u);
  await assert.rejects(scan('exact.example', { limits: { lineBytes: 5 } }), /line/u);
  await assert.rejects(scan('# Last modified: 32 Oct 2026 07:50 UTC\nexact.example'), /timestamp/u);
  await assert.rejects(scan('# Version: first\n# Version: second\nexact.example'), /conflict/u);
  await assert.rejects(scan('exact.example', { limits: { bytes: DOMAIN_FEED_LIMITS.bytes + 1 } }), /ceilings/u);
});

test('moderately large streaming input retains only 200 matches and awaits bounded provisional ingestion', async () => {
  const input = Array.from({ length: 30_000 }, (_, index) => `brand-${index}.example`).join('\n');
  let rows = 0, active = false;
  const result = await scanDomainFeed(chunks(encode(input), 256 * 1024), { feedId: 'entropy7', selection, importedAt: NOW,
    onDomains: async domains => { assert.equal(active, false); active = true; assert.ok(domains.length <= 256);
      await Promise.resolve(); rows += domains.length; active = false; } });
  assert.equal(rows, 30_000); assert.equal(result.rows, 30_000); assert.equal(result.matched, 30_000);
  assert.equal(result.matches.length, 200); assert.equal(result.omitted, 29_800); assert.equal(result.truncated, true);
  assert.equal(result.revision, `sha256:${createHash('sha256').update(encode(input)).digest('hex')}`);
});

test('aborted held streams close their iterator and never return a review', async () => {
  const abort = new AbortController(); let closed = false;
  const stream: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
    next: () => new Promise(() => {}), return: async () => { closed = true; return { done: true, value: undefined }; },
  }) };
  const running = scanDomainFeed(stream, { feedId: 'tif-mini', selection, importedAt: NOW, signal: abort.signal });
  abort.abort(); await assert.rejects(running, /cancelled/u); assert.equal(closed, true);
  let clock = 0;
  await assert.rejects(scan('exact.example', { now: () => clock++, limits: { durationMs: 2 } }), /deadline/u);
});

test('provisional ingestion never authorises a snapshot when a later row or callback fails', async () => {
  let provisionalRows = 0, closed = false;
  async function* input() {
    try { yield encode(`${Array.from({ length: 256 }, (_, index) => `candidate-${index}.example`).join('\n')}\nhttps://bad.example`); }
    finally { closed = true; }
  }
  await assert.rejects(scanDomainFeed(input(), { feedId: 'nrd7', selection: normalizeDomainFeedSelection({}), importedAt: NOW,
    onDomains: async domains => { provisionalRows += domains.length; } }), /plain domain/u);
  assert.equal(provisionalRows, 256); assert.equal(closed, true);
  await assert.rejects(scan('exact.example', { onDomains: async () => { throw new Error('Staging failed'); } }), /Staging failed/u);
  const repeated = await scan('exact.example\nexact.example');
  assert.equal(repeated.matched, 2); assert.equal(repeated.omitted, 1); assert.equal(repeated.truncated, false);
});

test('cached projection preserves full snapshot identity and unknown limited-query counts', async () => {
  const manual = await scan('exact.example\nmybrand.example');
  const cached = buildDomainFeedReview(manual, selection, ['exact.example'], { matched: null, omitted: null, truncated: true });
  assert.equal(cached.revision, manual.revision); assert.equal(cached.matched, null); assert.equal(cached.omitted, null);
  assert.deepEqual(projectDomainFeedMatch('mybrand.example', manual, selection), manual.matches[1]);
  for (const mutation of ['source', 'clock', 'term', 'extra'] as const) {
    const hostile = JSON.parse(JSON.stringify(cached));
    if (mutation === 'source') hostile.matches[0].candidate.sources[0].source = 'invented';
    if (mutation === 'clock') hostile.matches[0].candidate.sources[0].sourceFirstObservedAt = NOW;
    if (mutation === 'term') hostile.matches[0].terms = ['invented'];
    if (mutation === 'extra') hostile.futureVersion = 2;
    assert.equal(normalizeDomainFeedReview(hostile), null);
  }
});

test('feed review composes with existing candidate-watch input without changing scores, availability or baseline', async () => {
  const result = await scan('mybrand.example\nexact.example');
  const input = buildDomainFeedWatchInput(result, ['mybrand.example'], { name: 'Local review', brandProfileId: 'review-profile', priority: 'p3', reason: 'Review explicitly selected feed inclusion.' });
  const plan = reviewCandidateWatchInput(JSON.stringify(input), 'plan', NOW) as { additionalRequests: number; rows: { domain: string }[] };
  assert.equal(plan.additionalRequests, 0); assert.equal(plan.rows[0]!.domain, 'mybrand.example');
  const exported = reviewCandidateWatchInput(JSON.stringify(input), 'export', NOW) as { watchlists: Record<string, { results: unknown[]; baseline: unknown[]; domainMetadata: { candidate: unknown }[] }> };
  const watchlist = exported.watchlists['Local review']!;
  assert.deepEqual(watchlist.results, []); assert.deepEqual(watchlist.baseline, []);
  assert.equal(watchlist.domainMetadata.length, 1);
  assert.doesNotMatch(JSON.stringify(result.matches[0]!.candidate), /availability|riskScore|opportunityScore/u);
  assert.throws(() => buildDomainFeedWatchInput(result, ['unreviewed.example'], input.selection), /unreviewed/u);
});
