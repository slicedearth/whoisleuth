import { readEvidenceImageDimensions, readImageRegionPlan, type ImageDimensions, type ImageRegion } from '../evidence/image-regions.mts';

export type PixelImage = ImageDimensions & Readonly<{ pixels: Uint8Array | Uint8ClampedArray }>;
export const IMAGE_CHANGE_GRID_AXIS = 32;
export type ImageChangeTile = ImageDimensions & Readonly<{ x: number; y: number; changedPixels: number; comparedPixels: number }>;

function admit(image: PixelImage): ImageDimensions {
  const size = readEvidenceImageDimensions(image.width, image.height);
  if (!(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray)
    || !(image.pixels.buffer instanceof ArrayBuffer) || image.pixels.byteLength !== size.width * size.height * 4) throw new TypeError('Image comparison requires bounded, non-shared RGBA pixels.');
  return size;
}

/** Every pixel is compared; the bounded grid groups results, it does not downsample evidence. */
export function compareImagePixels(left: PixelImage, right: PixelImage, exclusions: readonly ImageRegion[] = []) {
  const dimensions = admit(left), other = admit(right);
  if (!Array.isArray(exclusions)) throw new TypeError('Image exclusions must be a bounded region list.');
  const masks = exclusions.length ? readImageRegionPlan({ ...dimensions, regions: exclusions }).regions : [];
  if (masks.some(region => region.kind !== 'redact')) throw new TypeError('Comparison masks must be explicit excluded rectangles.');
  const base = { method: 'rgba-white-pixel-grid-v1' as const, left: dimensions, right: other, masks,
    limitations: ['Pixels are compared after compositing onto white. The grid groups every changed pixel without resampling. Excluded pixels do not contribute to agreement.',
      'Pixel differences do not identify their cause, prove copying or establish maliciousness. Equal pixels are not proof of equal page behaviour.'] };
  if (dimensions.width !== other.width || dimensions.height !== other.height) return { ...base,
    state: 'dimensions_differ' as const, comparedPixels: 0, excludedPixels: 0, changedPixels: 0, changedPercent: null, tiles: [] as ImageChangeTile[] };
  const width = dimensions.width, height = dimensions.height;
  const tileWidth = Math.ceil(width / IMAGE_CHANGE_GRID_AXIS), tileHeight = Math.ceil(height / IMAGE_CHANGE_GRID_AXIS);
  const columns = Math.ceil(width / tileWidth), rows = Math.ceil(height / tileHeight);
  const changed = new Uint32Array(columns * rows), compared = new Uint32Array(columns * rows);
  let excludedPixels = 0, changedPixels = 0;
  const channel = (pixels: PixelImage['pixels'], offset: number, colour: number) => Math.round((pixels[offset + colour]! * pixels[offset + 3]! + 255 * (255 - pixels[offset + 3]!)) / 255);
  for (let y = 0; y < height; y++) {
    // Merge at most 64 row intervals. Overlapping masks are counted once.
    const intervals = masks.filter(mask => y >= mask.y && y < mask.y + mask.height).map(mask => [mask.x, mask.x + mask.width] as [number, number]).sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const interval of intervals) {
      const prior = merged.at(-1);
      if (prior && interval[0] <= prior[1]) prior[1] = Math.max(prior[1], interval[1]); else merged.push(interval);
    }
    let maskIndex = 0;
    for (let x = 0; x < width; x++) {
      while (merged[maskIndex] && x >= merged[maskIndex]![1]) maskIndex++;
      if (merged[maskIndex] && x >= merged[maskIndex]![0]) { excludedPixels++; continue; }
      const tile = Math.floor(y / tileHeight) * columns + Math.floor(x / tileWidth), offset = (y * width + x) * 4;
      compared[tile]!++;
      if (channel(left.pixels, offset, 0) !== channel(right.pixels, offset, 0)
        || channel(left.pixels, offset, 1) !== channel(right.pixels, offset, 1)
        || channel(left.pixels, offset, 2) !== channel(right.pixels, offset, 2)) { changed[tile]!++; changedPixels++; }
    }
  }
  const tiles: ImageChangeTile[] = [];
  for (let index = 0; index < changed.length; index++) if (changed[index]) {
    const x = (index % columns) * tileWidth, y = Math.floor(index / columns) * tileHeight;
    tiles.push({ x, y, width: Math.min(tileWidth, width - x), height: Math.min(tileHeight, height - y), changedPixels: changed[index]!, comparedPixels: compared[index]! });
  }
  const comparedPixels = width * height - excludedPixels;
  return { ...base, state: comparedPixels === 0 ? 'all_excluded' as const : changedPixels ? 'different' as const : 'same_pixels' as const,
    comparedPixels, excludedPixels, changedPixels, changedPercent: comparedPixels ? changedPixels * 100 / comparedPixels : null, tiles };
}

export type ImageChange = ReturnType<typeof compareImagePixels>;
