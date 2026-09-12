import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLookupProgressBody, LOOKUP_PROGRESS_CONTENT_TYPE } from '../lib/lookup-progress-http.mts';
import { requestLookup } from '../lib/lookup-request.mts';
import { createLookupProgressStart, createLookupProgressSource, createLookupProgressFinal, encodeLookupProgressEvent, MAX_LOOKUP_PROGRESS_STREAM_BYTES } from '../lib/lookup-progress.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';

const RESULT = { query: 'example.test', type: 'domain', registrableDomain: 'example.test', rdap: {}, whois: {},
  availability: { applicable: true, state: 'unknown' }, diagnostics: { version: 8, rdap: { status: 'unsupported' }, whois: { status: 'partial' }, availability: { status: 'complete' } } };
const SOURCES = ['rdap', 'whois'] as const;
const headers = { 'Content-Type': LOOKUP_PROGRESS_CONTENT_TYPE };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function frames() {
  return [createLookupProgressStart('deep', SOURCES),
    createLookupProgressSource(1, 'rdap', 'unsupported', { status: 'unsupported' }),
    createLookupProgressSource(2, 'whois', 'partial', { status: 'partial' }),
    createLookupProgressFinal(3, SOURCES, RESULT)];
}

test('source frames arrive while collection is held, and only the validated final result completes the request', async () => {
  const release = deferred<void>();
  const sourceSeen = deferred<void>();
  let finished = false;
  const updates: unknown[] = [];
  const stream = createLookupProgressBody({ sources: SOURCES, run: async settled => {
    settled({ source: 'rdap', state: 'unsupported', complete: false, truncated: false, fragment: { status: 'unsupported' } });
    await release.promise;
    settled({ source: 'whois', state: 'partial', complete: false, truncated: false, fragment: { status: 'partial' } });
    return RESULT;
  } });
  const request = requestLookup('/api/lookup?q=example.test', { fetchImpl: async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('accept'), `${LOOKUP_PROGRESS_CONTENT_TYPE}, application/json`);
    return new Response(stream.body, { headers });
  }, onProgress: update => {
    updates.push(update); assert.equal(update.snapshot?.persistable, false);
    if (update.snapshot?.settledSources.length === 1) sourceSeen.resolve();
  } }).then(result => { finished = true; return result; });
  await sourceSeen.promise;
  assert.equal(finished, false);
  assert.equal(updates.length, 2);
  release.resolve();
  const result = await request;
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, RESULT);
  await stream.completion;
  assert.equal(updates.length, 4);
});

test('cancellation closes the reader, aborts the producer and never returns a partial result', async () => {
  const controller = new AbortController();
  const seen = deferred<void>();
  const drained = deferred<void>();
  let producerSignal: AbortSignal | undefined;
  const stream = createLookupProgressBody({ sources: SOURCES, run: async (settled, signal) => {
    producerSignal = signal;
    settled({ source: 'rdap', state: 'partial', complete: false, truncated: true, fragment: { status: 'partial' } });
    await drained.promise;
    return RESULT;
  } });
  const request = requestLookup('/api/lookup?q=example.test', { signal: controller.signal, fetchImpl: async () => new Response(stream.body, { headers }),
    onProgress: update => { if (update.snapshot?.settledSources.length) seen.resolve(); },
  });
  await seen.promise; controller.abort();
  const result = await request;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'cancelled');
  assert.equal(producerSignal?.aborted, true);
  let finished = false;
  void stream.completion.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'the operation lease must outlive cancelled delivery');
  drained.resolve();
  await stream.completion;
});

test('buffered adapters are accepted without a second request and selected-page disclosure stays in the body', async () => {
  let calls = 0;
  const updates: unknown[] = [];
  const result = await requestLookup('/api/lookup?q=example.test', {
    selectedUrl: 'https://example.test/review?case=example#private-fragment',
    onProgress: update => { updates.push(update); },
    fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
      assert.equal(init?.body, JSON.stringify({ url: 'https://example.test/review?case=example' }));
      return Response.json(RESULT);
    },
  });
  assert.equal(result.ok, true); assert.equal(calls, 1);
  assert.deepEqual(updates, [{ transport: 'buffered', snapshot: null }]);
});

test('malformed, duplicate, future, premature, incomplete and over-bound frames cannot complete a Lookup', async () => {
  const valid = frames().map(encodeLookupProgressEvent);
  const examples = [
    valid.slice(0, -1).join(''),
    [valid[0], valid[3]].join(''),
    [valid[0], valid[1], valid[1], valid[2], valid[3]].join(''),
    valid.join('').replace('"version":1', '"version":999'),
    valid.join('').replace('"version":1', '"version":1,"version":1'),
    valid.join('').replace('"type":"domain"', '"type":"unsupported"'),
    '{"schema":' + '['.repeat(MAX_BOUNDED_JSON_DEPTH + 2) + '0' + ']'.repeat(MAX_BOUNDED_JSON_DEPTH + 2) + '}\n',
  ];
  for (const text of examples) {
    const result = await requestLookup('/api/lookup?q=example.test', { fetchImpl: async () => new Response(text, { headers }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, 'invalid_response');
  }
  const excessive = await requestLookup('/api/lookup?q=example.test', { fetchImpl: async () => new Response('', { headers: { ...headers, 'Content-Length': String(MAX_LOOKUP_PROGRESS_STREAM_BYTES + 1) } }) });
  assert.equal(excessive.ok, false);
});

test('a failed producer and an invalid final result never emit a final response', async () => {
  for (const run of [async () => { throw new Error('private transport detail'); }, async () => ({ invalid: true })]) {
    const stream = createLookupProgressBody({ sources: SOURCES, run });
    const result = await requestLookup('/api/lookup?q=example.test', { fetchImpl: async () => new Response(stream.body, { headers }) });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private transport detail/u);
    await stream.completion;
  }
});

test('a presentation callback cannot invalidate a valid stream', async () => {
  const result = await requestLookup('/api/lookup?q=example.test', {
    fetchImpl: async () => new Response(frames().map(encodeLookupProgressEvent).join(''), { headers }),
    onProgress: () => { throw new Error('Presentation failure'); },
  });
  assert.equal(result.ok, true);
});

test('the progress envelope preserves the exact ordinary response depth boundary', async () => {
  let nested: unknown = 'leaf';
  for (let index = 2; index < MAX_BOUNDED_JSON_DEPTH; index++) nested = { value: nested };
  const exact = { ...RESULT, rdap: { nested } };
  const buffered = await requestLookup('/api/lookup', { fetchImpl: async () => Response.json(exact) });
  assert.equal(buffered.ok, true, 'the independent buffered boundary must admit the fixture');
  const content = [...frames().slice(0, -1), createLookupProgressFinal(3, SOURCES, exact)].map(encodeLookupProgressEvent).join('');
  const streamed = await requestLookup('/api/lookup', { fetchImpl: async () => new Response(content, { headers }) });
  assert.deepEqual(streamed, buffered);
  const excess = { ...exact, rdap: { nested: { value: nested } } };
  const rejected = [...frames().slice(0, -1), createLookupProgressFinal(3, SOURCES, excess)].map(encodeLookupProgressEvent).join('');
  const outcome = await requestLookup('/api/lookup', { fetchImpl: async () => new Response(rejected, { headers }) });
  assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.kind, 'invalid_response');
});

test('a stalled stream respects the existing browser deadline and cancels its body', async () => {
  let cancelled = false;
  const result = await requestLookup('/api/lookup', { timeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(encodeLookupProgressEvent(createLookupProgressStart('deep', SOURCES)))); },
      cancel() { cancelled = true; },
    }), { headers }),
  });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.kind, 'timeout');
  assert.equal(cancelled, true);
});
