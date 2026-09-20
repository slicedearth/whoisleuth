import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { prepareCaseImageDerivative } from '../frontend/src/lib/case-image-edit.ts';
import { captureReviewFixture } from './capture-review-fixture.mts';
import type { ImageRegionPlan } from '../packages/evidence/image-regions.mts';
import type { CaseAttachment } from '../packages/cases/case-attachment-model.mts';

const PLAN: ImageRegionPlan = { width: 32, height: 32, regions: [
  { kind: 'outline', x: 0, y: 0, width: 20, height: 20 },
  { kind: 'redact', x: 4, y: 5, width: 6, height: 7 },
] };

function fixture(t: TestContext) {
  const bytes = captureReviewFixture().screenshot;
  const file = new Blob([bytes], { type: 'image/png' });
  const source: CaseAttachment = { id: 'original-image', fileName: 'original.png', mediaType: 'image/png',
    source: 'Selected capture', observedAt: null, retainedAt: '2026-09-01T00:00:00.000Z', byteLength: file.size,
    digestSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  const state = { decoded: 0, closed: 0, drawn: 0, contextAvailable: true, output: file as Blob | null,
    encode: null as ((callback: BlobCallback) => void) | null, paint: [] as unknown[][] };
  const context = {
    fillStyle: '',
    drawImage: (_image: unknown, x: number, y: number) => { assert.deepEqual([x, y], [0, 0]); state.drawn++; },
    fillRect(x: number, y: number, width: number, height: number) { state.paint.push([this.fillStyle, x, y, width, height]); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: (kind: string) => { assert.equal(kind, '2d'); return state.contextAvailable ? context : null; },
    toBlob: (callback: BlobCallback, type: string) => {
      assert.equal(type, 'image/png');
      if (state.encode) state.encode(callback); else callback(state.output);
    },
  };
  for (const [name, value] of Object.entries({
    createImageBitmap: async () => { state.decoded++; return { width: 32, height: 32, close: () => { state.closed++; } }; },
    document: { createElement: (name: string) => { assert.equal(name, 'canvas'); return canvas; } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  return { bytes, file, source, state, canvas };
}

test('image preparation paints opaque redactions last and keeps independent original provenance', async t => {
  const { bytes, file, source, state, canvas } = fixture(t);
  const result = await prepareCaseImageDerivative(source, file, PLAN, 'reviewed.png', new AbortController().signal);
  assert.equal(state.drawn, 1); assert.equal(state.paint.length, 5);
  assert.deepEqual(state.paint.at(-1), ['#000000', 4, 5, 6, 7]);
  assert.ok(state.paint.slice(0, 4).every(rectangle => rectangle[0] === '#ffbf00'));
  assert.equal(result.attachment.fileName, 'reviewed.png');
  assert.notEqual(result.attachment.id, source.id);
  assert.equal(result.attachment.source, source.source);
  assert.equal(result.attachment.observedAt, null);
  assert.deepEqual(result.attachment.derivation, { method: 'png-regions-v1', sourceAttachmentId: source.id,
    source: { digestSha256: source.digestSha256, byteLength: source.byteLength }, plan: PLAN });
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal(source.derivation, undefined);
  assert.equal(state.closed, 1); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('image admission rejects mismatched evidence, names and cancellation before native decoding', async t => {
  const { file, source, state } = fixture(t);
  const signal = new AbortController().signal;
  await assert.rejects(prepareCaseImageDerivative({ ...source, mediaType: 'application/json' }, file, PLAN, 'result.png', signal), /retained PNG/u);
  await assert.rejects(prepareCaseImageDerivative(source, new Blob(['different']), PLAN, 'result.png', signal), /matching original bytes/u);
  await assert.rejects(prepareCaseImageDerivative(source, file, PLAN, 'result.jpg', signal), /\.png filename/u);
  await assert.rejects(prepareCaseImageDerivative(source, file, PLAN, '../result.png', signal));
  await assert.rejects(prepareCaseImageDerivative({ ...source, digestSha256: `sha256:${'0'.repeat(64)}` }, file, PLAN, 'result.png', signal), /digest/u);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(prepareCaseImageDerivative(source, file, PLAN, 'result.png', aborted.signal), { name: 'AbortError' });
  assert.equal(state.decoded, 0);
});

test('failed image rendering closes native resources and permits a deliberate new attempt', async t => {
  const { file, source, state, canvas } = fixture(t);
  const prepare = (plan = PLAN) => prepareCaseImageDerivative(source, file, plan, 'result.png', new AbortController().signal);
  await assert.rejects(prepare({ ...PLAN, width: 31 }), /dimensions do not match/u);
  state.contextAvailable = false;
  await assert.rejects(prepare(), /unavailable in this browser/u);
  state.contextAvailable = true; state.output = null;
  await assert.rejects(prepare(), /could not be encoded/u);
  state.output = new Blob([]);
  await assert.rejects(prepare(), /byte limit/u);
  state.output = file;
  assert.equal((await prepare()).attachment.fileName, 'result.png');
  assert.equal(state.closed, 5); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('cancellation discards an in-flight encoder result without queuing another image', async t => {
  const { file, source, state } = fixture(t);
  let ready!: () => void;
  const encoding = new Promise<void>(resolve => { ready = resolve; });
  let finish!: BlobCallback;
  state.encode = callback => { finish = callback; ready(); };
  const controller = new AbortController();
  const pending = prepareCaseImageDerivative(source, file, PLAN, 'cancelled.png', controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await encoding;
  await assert.rejects(prepareCaseImageDerivative(source, file, PLAN, 'second.png', new AbortController().signal), /still being prepared/u);
  assert.equal(state.decoded, 1);
  controller.abort(); finish(file); await rejected;
  assert.equal(state.closed, 1);
  state.encode = null;
  assert.equal((await prepareCaseImageDerivative(source, file, PLAN, 'retry.png', new AbortController().signal)).attachment.fileName, 'retry.png');
  assert.equal(state.decoded, 2);
});
