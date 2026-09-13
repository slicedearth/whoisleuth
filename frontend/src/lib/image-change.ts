import { decodeArtifactPng, readArtifactPngDimensions } from './artifact-preview.ts';
import { compareImagePixels, type PixelImage } from '../../../packages/comparison/image-change.mts';
import { readImageRegionPlan, type ImageRegion } from '../../../packages/evidence/image-regions.mts';

/** Called in the one-shot package worker; decoded surfaces never enter a store. */
export async function compareLocalPngs(left: Blob, right: Blob, masks: readonly ImageRegion[]) {
  if (!Array.isArray(masks)) throw new TypeError('Image exclusions require bounded rectangles.');
  const dimensions = await readArtifactPngDimensions(left);
  if (masks.length && readImageRegionPlan({ ...dimensions, regions: masks }).regions.some(region => region.kind !== 'redact')) {
    throw new TypeError('Image exclusions must be rectangular masks.');
  }
  await readArtifactPngDimensions(right);
  const signal = new AbortController().signal;
  async function pixels(file: Blob): Promise<PixelImage> {
    const bitmap = await decodeArtifactPng(file, signal);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!context) throw new TypeError('Local pixel comparison is unavailable.');
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    } finally { bitmap.close(); canvas.width = 1; canvas.height = 1; }
  }
  return compareImagePixels(await pixels(left), await pixels(right), masks);
}
