import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTIFACT_TEXT_PAGE_BYTES, MAX_ARTIFACT_PREVIEW_PIXELS, decodeArtifactPng, readArtifactPngDimensions, readArtifactTextPage } from '../frontend/src/lib/artifact-preview.ts';
import { captureReviewFixture } from './capture-review-fixture.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES } from '../packages/investigation/investigation-manifest.mts';

test('paged text preserves every UTF-8 character across byte boundaries without reading the entire file', async () => {
  for (const character of ['é', '界', '😀']) {
    for (const lead of [1, 2, 3]) {
      const text = 'x'.repeat(ARTIFACT_TEXT_PAGE_BYTES - lead) + character + 'z'.repeat(ARTIFACT_TEXT_PAGE_BYTES) + character;
      const file = new Blob([text]);
      Object.defineProperty(file, 'arrayBuffer', { value() { throw new Error('Whole-file reading is not needed for text review.'); } });
      let reconstructed = '';
      const pages = Math.ceil(file.size / ARTIFACT_TEXT_PAGE_BYTES);
      for (let index = 0; index < pages; index++) reconstructed += (await readArtifactTextPage(file, index)).text;
      assert.equal(reconstructed, text);
    }
  }
});

test('unsafe formatting is visible, invalid UTF-8 fails, and page/input bounds precede reading', async () => {
  const page = await readArtifactTextPage(new Blob(['{"text":"<script>example</script>\u202e"}']), 0);
  assert.equal(page.escapedControls, true);
  assert.equal(page.text, '{"text":"<script>example</script>\\u202e"}');
  await assert.rejects(() => readArtifactTextPage(new Blob([new Uint8Array([0xff])]), 0));
  for (const index of [-1, 0.1, 1, NaN]) await assert.rejects(() => readArtifactTextPage(new Blob(['x']), index), /page/u);
  const oversized = new Blob(['x']);
  Object.defineProperty(oversized, 'size', { value: MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES + 1 });
  Object.defineProperty(oversized, 'slice', { value() { assert.fail('Oversized files must not be read.'); } });
  await assert.rejects(() => readArtifactTextPage(oversized, 0), /size/u);
});

test('PNG dimensions bound decoded memory before native image decoding', async () => {
  const { screenshot } = captureReviewFixture();
  assert.deepEqual(await readArtifactPngDimensions(new Blob([screenshot])), { width: 32, height: 32 });
  for (const input of [new Blob(['<svg><script>example</script></svg>']), new Blob([screenshot.subarray(0, 32)])]) {
    await assert.rejects(() => readArtifactPngDimensions(input), /PNG header/u);
  }
  const modified = Buffer.from(screenshot);
  modified.writeUInt32BE(MAX_ARTIFACT_PREVIEW_PIXELS, 16);
  await assert.rejects(() => readArtifactPngDimensions(new Blob([modified])), /decoded-image bound/u);
  modified.writeUInt32BE(4096, 16); modified.writeUInt32BE(4097, 20);
  await assert.rejects(() => readArtifactPngDimensions(new Blob([modified])), /decoded-image bound/u);
});

test('image decoding is serial and cancelled native results are closed before the next decode', async () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let calls = 0, closed = 0;
  const firstStarted = deferred<void>(), secondStarted = deferred<void>();
  const firstImage = deferred<ImageBitmap>(), secondImage = deferred<ImageBitmap>();
  const image = () => ({ width: 32, height: 32, close() { closed++; } }) as ImageBitmap;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => {
    calls++;
    if (calls === 1) { firstStarted.resolve(); return firstImage.promise; }
    secondStarted.resolve(); return secondImage.promise;
  } });
  try {
    const file = new Blob([captureReviewFixture().screenshot]);
    const cancelled = new AbortController();
    const first = decodeArtifactPng(file, cancelled.signal);
    const rejection = assert.rejects(first, { name: 'AbortError' });
    await firstStarted.promise;
    const second = decodeArtifactPng(file, new AbortController().signal);
    cancelled.abort();
    assert.equal(calls, 1);
    firstImage.resolve(image());
    await rejection; await secondStarted.promise;
    assert.equal(closed, 1);
    secondImage.resolve(image());
    (await second).close();
    assert.equal(calls, 2); assert.equal(closed, 2);
  } finally {
    firstImage.resolve(image()); secondImage.resolve(image());
    if (descriptor) Object.defineProperty(globalThis, 'createImageBitmap', descriptor);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});
