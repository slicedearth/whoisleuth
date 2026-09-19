import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createInlineLibraryScanner } from '../lib/browser-library-worker.mts';
import { deferred } from './deferred.mts';

type Job = { id: number; value: string; control: SharedArrayBuffer; output: SharedArrayBuffer };
const limits = { maximumCharacters: 32, outputBytes: 64, deadlineMs: 750, pending: 2 };
class ControlledWorker extends EventEmitter {
  jobs: Job[] = []; refs = 0; unrefs = 0; terminations = 0; failPost = false;
  postMessage(job: Job) { if (this.failPost) throw new Error('private matcher transport detail'); this.jobs.push(job); }
  ref() { this.refs++; } unref() { this.unrefs++; }
  async terminate() { this.terminations++; return 0; }
  reply(index = 0, text = '[]', size = Buffer.byteLength(text)) {
    const job = this.jobs[index]!;
    new Uint8Array(job.output).set(Buffer.from(text));
    Atomics.store(new Int32Array(job.control), 0, size);
    this.emit('message', { id: job.id });
  }
}
const unavailable = { timedOut: false, unavailable: true, output: null };
const complete = { timedOut: false, unavailable: false, output: '[]' };

test('matching is asynchronous, ordered and bounded without a device timing threshold', async () => {
  const worker = new ControlledWorker(); let created = 0; let settled = false;
  const scan = createInlineLibraryScanner(() => { created++; return worker; }, limits);
  assert.deepEqual(await scan(''), complete); assert.equal(created, 0);
  const first = scan('first').then(result => { settled = true; return result; });
  const second = scan('second');
  assert.deepEqual(await scan('overflow'), unavailable);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(worker.jobs.length, 1);
  worker.emit('message', { id: -1 }); await Promise.resolve(); assert.equal(settled, false);
  worker.reply(); assert.deepEqual(await first, complete);
  await Promise.resolve(); assert.equal(worker.jobs.length, 2);
  worker.emit('message', { id: worker.jobs[0]!.id });
  worker.reply(1); assert.deepEqual(await second, complete);
  await Promise.resolve(); assert.equal(worker.listenerCount('message'), 0); assert.ok(worker.unrefs > 0);
  assert.deepEqual(await scan('x'.repeat(33)), unavailable); assert.equal(worker.jobs.length, 2);
  assert.equal(created, 1); assert.equal(worker.terminations, 0);
});

test('cancelling a queued caller does not stop the active caller', async () => {
  const worker = new ControlledWorker(); const scan = createInlineLibraryScanner(() => worker, limits);
  const active = scan('active'); const controller = new AbortController();
  const queued = assert.rejects(scan('cancelled', controller.signal), { name: 'AbortError' });
  controller.abort(); await queued;
  assert.equal(worker.terminations, 0); assert.equal(worker.jobs.length, 1);
  worker.reply(); assert.deepEqual(await active, complete);
});

test('active cancellation waits for retirement before starting an independent queued caller', async () => {
  const old = new ControlledWorker(), next = new ControlledWorker(); const retired = deferred<number>(); let created = 0;
  old.terminate = async () => { old.terminations++; return retired.promise; };
  const scan = createInlineLibraryScanner(() => ++created === 1 ? old : next, limits);
  const controller = new AbortController();
  const cancelled = assert.rejects(scan('active', controller.signal), { name: 'AbortError' });
  const queued = scan('independent'); controller.abort(); await cancelled;
  assert.equal(created, 1); assert.equal(old.terminations, 1);
  retired.resolve(0); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(created, 2); assert.equal(next.jobs[0]?.value, 'independent');
  old.reply(); next.reply(); assert.deepEqual(await queued, complete);
});

test('cancellation before and during worker creation prevents posting', async () => {
  for (const phase of ['before', 'creation'] as const) {
    const controller = new AbortController(); const worker = new ControlledWorker(); let created = 0;
    const scan = createInlineLibraryScanner(() => { created++; controller.abort(); return worker; }, limits);
    if (phase === 'before') controller.abort();
    await assert.rejects(async () => scan('input', controller.signal), { name: 'AbortError' });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(created, phase === 'before' ? 0 : 1);
    assert.equal(worker.jobs.length, 0); assert.equal(worker.terminations, created);
  }
});

test('queue deadlines include waiting and retire stalled work without leaking internal errors', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new ControlledWorker(); const scan = createInlineLibraryScanner(() => worker, limits);
  const first = scan('first'), second = scan('second');
  context.mock.timers.tick(750);
  for (const result of await Promise.all([first, second])) assert.deepEqual(result, { timedOut: true, unavailable: false, output: null });
  await Promise.resolve(); assert.equal(worker.terminations, 1); assert.equal(worker.jobs.length, 1);
  assert.equal(worker.listenerCount('message'), 0);
});

test('worker construction, transport, exit and malformed output fail explicitly and recover', async () => {
  for (const failure of ['create', 'post', 'error', 'exit', 'negative', 'oversize'] as const) {
    const broken = new ControlledWorker(), replacement = new ControlledWorker(); let created = 0;
    broken.failPost = failure === 'post';
    const scan = createInlineLibraryScanner(() => {
      if (++created > 1) return replacement;
      if (failure === 'create') throw new Error('private matcher transport detail');
      return broken;
    }, limits);
    const result = scan('input');
    if (failure === 'error') broken.emit('error', new Error('private matcher transport detail'));
    if (failure === 'exit') broken.emit('exit', 1);
    if (failure === 'negative' || failure === 'oversize') broken.reply(0, '[]', failure === 'negative' ? -1 : 65);
    assert.deepEqual(await result, unavailable);
    await new Promise<void>(resolve => setImmediate(resolve));
    const recovered = scan('next'); replacement.reply(); assert.deepEqual(await recovered, complete);
  }
});

test('a native worker can remain held while the caller event loop runs', async () => {
  const gate = new Int32Array(new SharedArrayBuffer(4)); let worker: Worker | undefined;
  const scan = createInlineLibraryScanner(() => worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.on('message', job => {
      Atomics.wait(new Int32Array(workerData), 0, 0);
      new Uint8Array(job.output).set(Buffer.from('[]'));
      Atomics.store(new Int32Array(job.control), 0, 2);
      parentPort.postMessage({ id: job.id });
    });`, { eval: true, workerData: gate.buffer }), { ...limits, deadlineMs: 10_000 });
  try {
    let settled = false;
    const result = scan('held').then(value => { settled = true; return value; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
    assert.deepEqual(await result, complete);
  } finally { await worker?.terminate(); }
});
