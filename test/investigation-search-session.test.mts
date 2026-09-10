import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvestigationSearchSession } from '../frontend/src/lib/investigation-search-session.ts';
import {
  createInvestigationSearchWorkerHandler,
  type InvestigationSearchSummary, type SearchWorkerRequest, type SearchWorkerResponse,
} from '../frontend/src/lib/investigation-search-worker-model.ts';
import { buildInvestigationProjection } from '../frontend/src/lib/analysis/investigation-projection.ts';
import { buildInvestigationSearchIndex, searchInvestigationIndex } from '../frontend/src/lib/analysis/investigation-search.ts';
import { projectInvestigationContextPreview } from '../frontend/src/lib/analysis/investigation-context-preview.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';

const collections = {
  cases: { version: CASE_SCHEMA_VERSION, cases: Array.from({ length: 124 }, (_, position) => ({
    id: `retained-case-${position}`, domain: `target-${position}.example`, status: 'reviewing', disposition: 'unreviewed',
    source: 'lookup', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    evidenceHistory: [{ capturedAt: '2026-08-02T00:00:00.000Z', scanDepth: 'deep', source: 'lookup',
      inputHostname: null, availability: 'registered', nameservers: [] }],
  })) },
};

function summary(): InvestigationSearchSummary {
  const absent = { state: 'absent' as const, version: null, records: 0, truncated: false };
  return { state: 'ready', sources: { cases: absent, campaigns: absent, brandProfiles: absent,
    relationshipRows: absent, relationshipObservations: absent }, entityCount: 0, termCount: 0, truncated: false, limitations: [], recentResults: [] };
}
const idle = { state: 'idle' as const, query: '', results: [], totalMatches: 0, truncated: false, detail: '' };

class ControlledWorker {
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: SearchWorkerRequest[] = [];
  terminated = 0;
  failPost = false;
  postMessage(request: SearchWorkerRequest) {
    if (this.failPost) throw new Error('Untrusted clone detail must not escape.');
    this.messages.push(structuredClone(request));
  }
  terminate() { this.terminated += 1; }
  reply(response: SearchWorkerResponse) { this.onmessage?.(new MessageEvent('message', { data: response })); }
  factory = () => this as unknown as Worker;
}

async function prepared(worker = new ControlledWorker(), signal?: AbortSignal) {
  const promise = createInvestigationSearchSession({}, [], { createWorker: worker.factory, ...(signal ? { signal } : {}) });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0]?.kind, 'build');
  worker.reply({ id: 1, kind: 'build', summary: summary() });
  return { worker, session: await promise };
}

test('worker queries match the pure owner while transferring only summary and requested pages', () => {
  const before = structuredClone(collections);
  const replies: SearchWorkerResponse[] = [];
  const handle = createInvestigationSearchWorkerHandler((response) => replies.push(response));
  handle({ id: 1, kind: 'build', collections, unavailableStores: [] });
  const first = replies.shift();
  assert.equal(first?.kind, 'build');
  assert.ok(first && first.kind === 'build');
  assert.ok(first.summary.entityCount >= 124);
  assert.ok(first.summary.recentResults.length <= 6);
  assert.equal('entries' in first.summary, false);
  assert.equal('cases' in first.summary, false);
  const index = buildInvestigationSearchIndex(buildInvestigationProjection(collections));
  for (const page of [1, 2, 3, 999]) {
    handle({ id: page + 1, kind: 'search', query: 'target', page, pageSize: 50 });
    assert.deepEqual(replies.shift(), { id: page + 1, kind: 'search', result: searchInvestigationIndex(index, 'target', { page, pageSize: 50 }) });
    handle({ id: page + 2000, kind: 'preview', query: 'target', page });
    assert.deepEqual(replies.shift(), { id: page + 2000, kind: 'preview', result: projectInvestigationContextPreview(index, 'target', page) });
  }
  assert.deepEqual(collections, before);
});

test('worker preserves explicit unavailable-source coverage rather than treating it as empty', () => {
  const replies: SearchWorkerResponse[] = [];
  const handle = createInvestigationSearchWorkerHandler((response) => replies.push(response));
  handle({ id: 1, kind: 'build', collections, unavailableStores: ['campaigns'] });
  const built = replies.shift();
  assert.ok(built?.kind === 'build');
  assert.equal(built.summary.sources.campaigns?.state, 'unavailable');
  assert.equal(built.summary.truncated, true);
  handle({ id: 2, kind: 'preview', query: 'not-retained.example' });
  const preview = replies.shift();
  assert.ok(preview?.kind === 'preview');
  assert.equal(preview.result.state, 'partial');
  assert.match(preview.result.detail, /coverage is partial/u);
});

test('worker replacement removes the previous index and has no search-before-build fallback', () => {
  const replies: SearchWorkerResponse[] = [];
  const handle = createInvestigationSearchWorkerHandler((response) => replies.push(response));
  handle({ id: 1, kind: 'search', query: 'target' });
  assert.deepEqual(replies.shift(), { id: 1, kind: 'error', detail: 'Saved-work search has not been prepared.' });
  handle({ id: 2, kind: 'build', collections, unavailableStores: [] });
  replies.shift();
  handle({ id: 3, kind: 'build', collections: {}, unavailableStores: [] });
  replies.shift();
  handle({ id: 4, kind: 'search', query: 'target' });
  const result = replies.shift();
  assert.ok(result?.kind === 'search');
  assert.equal(result.result.totalMatches, 0);
});

test('browser worker bootstrap forwards native messages to the shared handler', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const replies: SearchWorkerResponse[] = [];
  const scope: { postMessage: (reply: SearchWorkerResponse) => void; onmessage?: (event: MessageEvent<SearchWorkerRequest>) => void } = {
    postMessage: (reply) => replies.push(reply),
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../frontend/src/lib/workers/investigation-search.worker.ts');
    assert.equal(typeof scope.onmessage, 'function');
    scope.onmessage?.(new MessageEvent<SearchWorkerRequest>('message', { data: { id: 1, kind: 'build', collections: {}, unavailableStores: [] } }));
    assert.equal(replies[0]?.kind, 'build');
    scope.onmessage?.(new MessageEvent<SearchWorkerRequest>('message', { data: { id: 2, kind: 'search', query: '' } }));
    assert.deepEqual(replies[1], { id: 2, kind: 'search', result: idle });
  } finally {
    if (original) Object.defineProperty(globalThis, 'self', original);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});

test('worker rejects invalid identities and exposes static processing errors without source contents', () => {
  const replies: SearchWorkerResponse[] = [];
  const handle = createInvestigationSearchWorkerHandler((response) => replies.push(response));
  handle({ id: -1, kind: 'build', collections: {}, unavailableStores: [] });
  assert.equal(replies.length, 0);
  handle({ id: 1, kind: 'build', collections: {}, unavailableStores: [] });
  replies.shift();
  handle({ id: 2, kind: 'unexpected' } as unknown as SearchWorkerRequest);
  assert.deepEqual(replies.shift(), { id: 2, kind: 'error', detail: 'Saved-work search received an unsupported operation.' });
  handle({ id: 3, kind: 'build', collections: { get cases() { throw new Error('private-value'); } }, unavailableStores: [] });
  assert.deepEqual(replies.shift(), { id: 3, kind: 'error', detail: 'Saved-work search could not process the retained data. No saved records were changed.' });
  handle({ id: 4, kind: 'search', query: 'target' });
  assert.equal(replies.shift()?.kind, 'error');
});

test('session does not become ready until its matching build reply and ignores stale identities', async () => {
  const worker = new ControlledWorker();
  let ready = false;
  const promise = createInvestigationSearchSession({}, [], { createWorker: worker.factory }).then((value) => { ready = true; return value; });
  worker.reply({ id: 99, kind: 'build', summary: summary() });
  await Promise.resolve();
  assert.equal(ready, false);
  worker.reply({ id: 1, kind: 'build', summary: summary() });
  const session = await promise;
  assert.equal(ready, true);
  assert.ok(Object.isFrozen(session));
  session.dispose();
  session.dispose();
  assert.equal(worker.terminated, 1);
  assert.equal(worker.onmessage, null);
});

test('session retains one active request and only the latest queued query', async () => {
  const { worker, session } = await prepared();
  try {
    const first = session.search('first', { page: 2 });
    const superseded = session.search('second');
    const rejected = assert.rejects(superseded, { name: 'AbortError' });
    const latest = session.search('third', { page: 3, pageSize: 3 });
    await rejected;
    assert.equal(worker.messages.length, 2);
    assert.deepEqual(worker.messages[1], { id: 2, kind: 'search', query: 'first', page: 2 });
    worker.reply({ id: 2, kind: 'search', result: { ...idle, query: 'first' } });
    assert.equal((await first).query, 'first');
    assert.deepEqual(worker.messages[2], { id: 4, kind: 'search', query: 'third', page: 3, pageSize: 3 });
    worker.reply({ id: 4, kind: 'search', result: { ...idle, query: 'third' } });
    assert.equal((await latest).query, 'third');
  } finally { session.dispose(); }
});

test('session transports preview operations without rerunning a main-thread index', async () => {
  const { worker, session } = await prepared();
  try {
    const preview = session.preview('target', 42);
    assert.deepEqual(worker.messages[1], { id: 2, kind: 'preview', query: 'target', page: 42 });
    const result = { state: 'no_matches' as const, query: 'target', results: [], totalMatches: 0, omittedMatches: 0, detail: 'No match.', limitations: [] };
    worker.reply({ id: 2, kind: 'preview', result });
    assert.deepEqual(await preview, result);
  } finally { session.dispose(); }
});

test('disposal rejects active and queued requests and refuses new work', async () => {
  const { worker, session } = await prepared();
  const active = assert.rejects(session.search('active'), { name: 'AbortError' });
  const queued = assert.rejects(session.search('queued'), { name: 'AbortError' });
  session.dispose();
  await Promise.all([active, queued, assert.rejects(session.preview('later'), { name: 'AbortError' })]);
  assert.equal(worker.terminated, 1);
  assert.equal(worker.messages.length, 2);
});

test('abort before creation starts no worker and abort during creation terminates before posting', async () => {
  const controller = new AbortController();
  controller.abort();
  let created = false;
  await assert.rejects(createInvestigationSearchSession({}, [], { signal: controller.signal,
    createWorker: () => { created = true; throw new Error('must not run'); } }), { name: 'AbortError' });
  assert.equal(created, false);
  const during = new AbortController();
  const worker = new ControlledWorker();
  await assert.rejects(createInvestigationSearchSession({}, [], { signal: during.signal,
    createWorker: () => { during.abort(); return worker.factory(); } }), { name: 'AbortError' });
  assert.equal(worker.terminated, 1);
  assert.equal(worker.messages.length, 0);
});

test('abort while building cancels the worker and its readiness promise', async () => {
  const controller = new AbortController();
  const worker = new ControlledWorker();
  const rejected = assert.rejects(createInvestigationSearchSession({}, [], { signal: controller.signal, createWorker: worker.factory }), { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(worker.terminated, 1);
});

test('worker failures terminate the session and do not expose browser error contents', async () => {
  const { worker, session } = await prepared();
  const rejected = assert.rejects(session.search('target'), /worker is unavailable/u);
  let prevented = false;
  worker.onerror?.({ message: 'private-value', preventDefault: () => { prevented = true; } } as ErrorEvent);
  await rejected;
  assert.equal(prevented, true);
  assert.equal(worker.terminated, 1);
  await assert.rejects(session.search('another target'), /worker is unavailable/u);
});

test('clone failures and unreadable replies reject requests and release resources', async () => {
  const worker = new ControlledWorker();
  worker.failPost = true;
  await assert.rejects(createInvestigationSearchSession({}, [], { createWorker: worker.factory }), /could not receive the retained data/u);
  assert.equal(worker.terminated, 1);
  const second = await prepared();
  const rejected = assert.rejects(second.session.search('target'), /unreadable data/u);
  second.worker.onmessageerror?.();
  await rejected;
  assert.equal(second.worker.terminated, 1);
});

test('incorrect reply kinds cannot satisfy readiness or a different query operation', async () => {
  const worker = new ControlledWorker();
  const rejected = assert.rejects(createInvestigationSearchSession({}, [], { createWorker: worker.factory }), /unexpected operation/u);
  worker.reply({ id: 1, kind: 'search', result: idle });
  await rejected;
  assert.equal(worker.terminated, 1);
  const second = await prepared();
  try {
    const query = assert.rejects(second.session.search('target'), /unexpected operation/u);
    second.worker.reply({ id: 2, kind: 'build', summary: summary() });
    await query;
    const next = assert.rejects(second.session.search('target'), /explicit failure/u);
    second.worker.reply({ id: 3, kind: 'error', detail: 'explicit failure' });
    await next;
  } finally { second.session.dispose(); }
});

test('an unresponsive worker has a bounded deadline rather than remaining pending indefinitely', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new ControlledWorker();
  const rejected = assert.rejects(createInvestigationSearchSession({}, [], { createWorker: worker.factory }), /did not respond/u);
  context.mock.timers.tick(60_000);
  await rejected;
  assert.equal(worker.terminated, 1);
});
