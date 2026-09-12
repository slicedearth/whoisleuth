import { crc32, deflateSync } from 'node:zlib';
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { createCase, openCasesView } from './case-test-fixtures';
import { openRetainedFiles } from './case-attachment-fixtures';

export const IMAGE_NAME = 'selected-image.png';
export const IMAGE_SIZE = { width: 640, height: 360 };

/** Fixed independently specified pixels, with ancillary text that must not enter an edited PNG. */
export function sourceImage(size = IMAGE_SIZE) {
  if (![IMAGE_SIZE, { width: 4096, height: 4096 }].some(item => item.width === size.width && item.height === size.height)) throw new Error('Unexpected image fixture size.');
  function chunk(type: string, body: Buffer) {
    const header = Buffer.alloc(8), checksum = Buffer.alloc(4);
    header.writeUInt32BE(body.length); header.write(type, 4, 'ascii');
    checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])));
    return Buffer.concat([header, body, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size.width); header.writeUInt32BE(size.height, 4); header[8] = 8; header[9] = 6;
  const stride = size.width * 4 + 1, samples = Buffer.alloc(stride * size.height), row = Buffer.alloc(stride);
  for (let x = 0; x < size.width; x++) row.set([64, 160, 224, 255], 1 + x * 4);
  for (let y = 0; y < size.height; y++) {
    samples.set(row, y * stride);
    if (y < 8) samples.fill(0, y * stride + 1, y * stride + 1 + 8 * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Description\0Private fixture metadata')), chunk('IDAT', deflateSync(samples)), chunk('IEND', Buffer.alloc(0))]);
}

export async function openImageReview(page: Page, copies = 1, size = IMAGE_SIZE) {
  await openCasesView(page); await createCase(page, 'image-review.example');
  const files = await openRetainedFiles(page), bytes = sourceImage(size);
  await files.getByLabel('Choose original files', { exact: true }).setInputFiles(Array.from({ length: copies }, (_, index) => ({
    name: index === 0 ? IMAGE_NAME : 'another-observation.png', mimeType: 'image/png', buffer: bytes,
  })));
  await expect(files.getByRole('heading', { name: `${copies} selected · not saved`, exact: true })).toBeVisible();
  await files.getByLabel('Source', { exact: true }).fill('Independent selected observation');
  await files.getByLabel('Observed at (UTC)', { exact: true }).fill('2026-08-01T12:30');
  await files.getByRole('button', { name: 'Retain selected files', exact: true }).click();
  await files.getByRole('button', { name: `Preview ${IMAGE_NAME}`, exact: true }).click();
  const review = files.getByRole('region', { name: `Image review: ${IMAGE_NAME}`, exact: true });
  await expect(review.getByRole('button', { name: 'Create edited PNG', exact: true })).toBeEnabled();
  return { files, review, bytes };
}

export async function addImageRegion(review: Locator, kind: 'redact' | 'outline', rectangle = { x: 64, y: 40, width: 160, height: 80 }) {
  await review.getByRole('combobox', { name: 'Action', exact: true }).selectOption(kind);
  for (const [name, value] of Object.entries({ Left: rectangle.x, Top: rectangle.y, Width: rectangle.width, Height: rectangle.height })) {
    await review.getByRole('spinbutton', { name, exact: true }).fill(String(value));
  }
  await review.getByRole('button', { name: 'Add region', exact: true }).click();
}

/** Check every output pixel without consulting the production paint instructions. */
export async function expectEditedPixels(review: Locator) {
  const canvas = review.getByRole('region', { name: 'Prepared edited image', exact: true }).locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate(element => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('An actual output canvas is required.');
    return { width: element.width, height: element.height };
  })).toEqual(IMAGE_SIZE);
  const result = await canvas.evaluate(element => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('An actual output canvas is required.');
    const rgba = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let mismatches = 0;
    for (let y = 0; y < element.height; y++) for (let x = 0; x < element.width; x++) {
      let expected = x < 8 && y < 8 ? [0, 0, 0, 0] : [64, 160, 224, 255];
      if (x >= 60 && x < 240 && y >= 40 && y < 120 && (x < 63 || x >= 237 || y < 43 || y >= 117)) expected = [255, 191, 0, 255];
      if (x >= 64 && x < 224 && y >= 40 && y < 120) expected = [0, 0, 0, 255];
      const offset = (y * element.width + x) * 4;
      if (expected.some((value, channel) => rgba[offset + channel] !== value)) mismatches++;
    }
    return { pixels: element.width * element.height, mismatches };
  });
  expect(result).toEqual({ pixels: IMAGE_SIZE.width * IMAGE_SIZE.height, mismatches: 0 });
}
