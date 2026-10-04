import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDomainFeedReview, normalizeDomainFeedSelection, scanDomainFeed } from '../packages/monitoring/domain-feed.mts';
import { loadDomainFeedServiceStatus, queryDomainFeedService } from '../frontend/src/lib/domain-feed-client.ts';

const importedAt = '2000-01-01T00:00:00.000Z';
const selection = normalizeDomainFeedSelection({ hosts: ['login.target.example'], brandProfileId: 'local-example-profile' })!;
async function review() {
  return scanDomainFeed((async function* () { yield new TextEncoder().encode('login.target.example\n'); })(), { feedId: 'tif-mini', selection: normalizeDomainFeedSelection({ hosts: selection.hosts })!, importedAt });
}

test('service status uses an explicit same-origin request with no matching inputs or Brand identity', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => { calls.push({ url: String(input), init }); return Response.json({ enabled: false, feeds: [] }); };
  assert.equal(calls.length, 0);
  assert.deepEqual(await loadDomainFeedServiceStatus(new AbortController().signal, fetchImpl), { enabled: false, feeds: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, '/api/domain-feed');
  assert.equal(calls[0]!.init!.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { operation: 'status' });
});

test('explicit service query reconstructs exact Brand attribution locally and preserves stale caveats', async () => {
  let sent: unknown;
  const result = await queryDomainFeedService('tif-mini', selection, new AbortController().signal, async (_input, init) => {
    sent = JSON.parse(init!.body as string);
    return Response.json({ enabled: true, feeds: [{ feedId: 'tif-mini', stale: true, review: await review(), error: null }], limitations: ['Cache lookup is not target collection.'] });
  }, '2000-01-02T00:00:00.000Z');
  assert.deepEqual(sent, { operation: 'query', feedIds: ['tif-mini'], selection: { hosts: ['login.target.example'], terms: [] } });
  assert.equal(JSON.stringify(sent).includes('local-example-profile'), false);
  assert.equal(result[0]!.candidates[0]!.candidate.matches[0]!.brandProfileId, 'local-example-profile');
  assert.equal(result[0]!.candidates[0]!.candidate.sources[0]!.observedHostname, 'login.target.example');
  assert.equal(result[0]!.candidates[0]!.candidate.sources[0]!.sourceLastObservedAt, null);
  assert.equal(result[0]!.review.importedAt, importedAt);
  assert.equal(result[0]!.candidates[0]!.candidate.sources[0]!.firstLocalObservedAt, '2000-01-02T00:00:00.000Z');
  assert.ok(result[0]!.warnings.some((value) => value.includes('stale')));
  assert.deepEqual(normalizeDomainFeedReview(result[0]!.review), await review());
  assert.equal(result[0]!.review.selection.brandProfileId, null);
});

test('failed refresh does not discard a valid last-good snapshot or forward private error text', async () => {
  const result = await queryDomainFeedService('tif-mini', selection, new AbortController().signal, async () => Response.json({
    enabled: true, feeds: [{ feedId: 'tif-mini', stale: false, review: await review(), error: 'private upstream detail' }], limitations: [],
  }));
  assert.equal(result[0]!.candidates.length, 1);
  assert.deepEqual(result[0]!.warnings, ['The latest refresh could not be confirmed. These candidates come from the retained snapshot.']);
  assert.doesNotMatch(JSON.stringify(result), /private upstream detail/u);
});

test('client rejects unsafe or ambiguous status and query envelopes instead of inferring absence', async () => {
  const signal = new AbortController().signal;
  for (const value of [null, { enabled: true, feeds: [{}] }, { enabled: false, feeds: Array.from({ length: 12 }, () => ({})) }]) {
    await assert.rejects(loadDomainFeedServiceStatus(signal, async () => Response.json(value)), /unreadable status/u);
  }
  await assert.rejects(queryDomainFeedService('tif-mini', selection, signal, async () => Response.json({ enabled: true, feeds: [{ feedId: 'tif-mini', stale: false, review: null, error: 'unknown' }], limitations: [] })), /No absence/u);
  const good = await review();
  await assert.rejects(queryDomainFeedService('tif-full', selection, signal, async () => Response.json({ enabled: true, feeds: [{ feedId: 'tif-full', stale: false, review: good, error: null }], limitations: [] })), /unexpected feed/u);
  const wrongSelection = normalizeDomainFeedSelection({ hosts: ['different.example'], brandProfileId: 'local-example-profile' })!;
  await assert.rejects(queryDomainFeedService('tif-mini', wrongSelection, signal, async () => Response.json({ enabled: true, feeds: [{ feedId: 'tif-mini', stale: false, review: good, error: null }], limitations: [] })), /outside the explicit selection/u);
  const overlappingSelection = normalizeDomainFeedSelection({ hosts: selection.hosts, terms: ['target'], brandProfileId: selection.brandProfileId });
  await assert.rejects(queryDomainFeedService('tif-mini', overlappingSelection, signal, async () => Response.json({ enabled: true, feeds: [{ feedId: 'tif-mini', stale: false, review: good, error: null }], limitations: [] })), /outside the explicit selection/u);
  await assert.rejects(loadDomainFeedServiceStatus(signal, async () => Response.json({ privateDetail: 'not copied' }, { status: 503 })), /unavailable/u);
});

test('cancelled service requests never fetch and response byte ceilings precede parsing', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  let fetched = false;
  await assert.rejects(loadDomainFeedServiceStatus(cancelled.signal, async () => { fetched = true; return Response.json({ enabled: false, feeds: [] }); }), /cancelled/u);
  assert.equal(fetched, false);
  await assert.rejects(loadDomainFeedServiceStatus(new AbortController().signal, async () => new Response('x', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(3 * 1024 * 1024) } })), /exceeded.*bytes/u);
});

test('negative selectors are explicitly sent without Brand identity and must round-trip exactly', async () => {
  const selected = normalizeDomainFeedSelection({ terms: ['launch'], negativeTerms: ['excluded'], brandProfileId: 'local-example-profile' });
  const remote = await scanDomainFeed((async function* () { yield new TextEncoder().encode('launch.example\nexcluded-launch.example\n'); })(), {
    feedId: 'nrd7', selection: normalizeDomainFeedSelection({ terms: ['launch'], negativeTerms: ['excluded'] }), importedAt,
  });
  let sent: unknown;
  const result = await queryDomainFeedService('nrd7', selected, new AbortController().signal, async (_input, init) => {
    sent = JSON.parse(init!.body as string);
    return Response.json({ enabled: true, feeds: [{ feedId: 'nrd7', stale: false, error: null, review: remote }], limitations: [] });
  });
  assert.deepEqual(sent, { operation: 'query', feedIds: ['nrd7'], selection: { hosts: [], terms: ['launch'], negativeTerms: ['excluded'] } });
  assert.equal(result[0]!.candidates.length, 1);
  const mismatch = normalizeDomainFeedSelection({ ...selected, negativeTerms: ['different'] });
  await assert.rejects(queryDomainFeedService('nrd7', mismatch, new AbortController().signal, async () => Response.json({
    enabled: true, feeds: [{ feedId: 'nrd7', stale: false, error: null, review: remote }], limitations: [],
  })), /outside the explicit selection/u);
});
