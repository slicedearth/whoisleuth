import { array, enumeration, exact, integer, text } from './artifact-structure.mts';
import { readRetainedFileReference, type RetainedFileReference } from './retained-file.mts';

// The decoded RGBA surface is bounded independently of compressed file bytes.
export const MAX_EVIDENCE_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_EVIDENCE_IMAGE_DIMENSION = 10_000;
// Each selected region emits at most four solid rectangles; no nested effects.
export const MAX_EVIDENCE_IMAGE_REGIONS = 64;

export type ImageDimensions = Readonly<{ width: number; height: number }>;
export type ImageRegion = Readonly<ImageDimensions & { x: number; y: number; kind: 'redact' | 'outline' }>;
export type ImageRegionPlan = Readonly<ImageDimensions & { regions: readonly ImageRegion[] }>;
export type ImageDerivation = Readonly<{
  method: 'png-regions-v1';
  sourceAttachmentId: string;
  source: RetainedFileReference;
  plan: ImageRegionPlan;
}>;

export function readEvidenceImageDimensions(width: unknown, height: unknown): ImageDimensions {
  const result = {
    width: integer(width, 'Image width', 1, MAX_EVIDENCE_IMAGE_DIMENSION),
    height: integer(height, 'Image height', 1, MAX_EVIDENCE_IMAGE_DIMENSION),
  };
  if (result.width * result.height > MAX_EVIDENCE_IMAGE_PIXELS) throw new TypeError('This image exceeds the decoded-image pixel bound. Its original bytes are unchanged.');
  return Object.freeze(result);
}

/** Pixel coordinates are integers, remain inside the source, and are never clipped silently. */
export function readImageRegionPlan(raw: unknown): ImageRegionPlan {
  const value = exact(raw, ['width', 'height', 'regions'], 'Image region plan');
  const dimensions = readEvidenceImageDimensions(value.width, value.height);
  const regions = Array.from(array(value.regions, 'Image regions', MAX_EVIDENCE_IMAGE_REGIONS, 1), candidate => {
    const region = exact(candidate, ['kind', 'x', 'y', 'width', 'height'], 'Image region');
    const kind = enumeration(region.kind, ['redact', 'outline'] as const, 'Image region kind');
    const x = integer(region.x, 'Region left coordinate', 0, dimensions.width - 1);
    const y = integer(region.y, 'Region top coordinate', 0, dimensions.height - 1);
    const width = integer(region.width, 'Region width', 1, dimensions.width - x);
    const height = integer(region.height, 'Region height', 1, dimensions.height - y);
    return Object.freeze({ kind, x, y, width, height });
  });
  return Object.freeze({ ...dimensions, regions: Object.freeze(regions) });
}

export function readImageDerivation(raw: unknown): ImageDerivation {
  const value = exact(raw, ['method', 'sourceAttachmentId', 'source', 'plan'], 'Image derivation');
  if (value.method !== 'png-regions-v1') throw new TypeError('This image derivation method is unsupported.');
  return Object.freeze({
    method: value.method,
    sourceAttachmentId: text(value.sourceAttachmentId, 'Source attachment ID', 128),
    source: readRetainedFileReference(value.source),
    plan: readImageRegionPlan(value.plan),
  });
}

export type ImagePaintRectangle = Readonly<ImageDimensions & { x: number; y: number; colour: '#ffbf00' | '#000000' }>;

/** Opaque redactions are always last, including where annotations overlap them. */
export function imageRegionPaintRectangles(raw: ImageRegionPlan): readonly ImagePaintRectangle[] {
  const plan = readImageRegionPlan(raw);
  const result: ImagePaintRectangle[] = [];
  for (const region of plan.regions.filter(region => region.kind === 'outline')) {
    const thickness = Math.min(3, region.width, region.height);
    const { x, y, width, height } = region;
    result.push(
      { x, y, width, height: thickness, colour: '#ffbf00' },
      { x, y: y + height - thickness, width, height: thickness, colour: '#ffbf00' },
      { x, y, width: thickness, height, colour: '#ffbf00' },
      { x: x + width - thickness, y, width: thickness, height, colour: '#ffbf00' },
    );
  }
  for (const region of plan.regions.filter(region => region.kind === 'redact')) {
    result.push({ x: region.x, y: region.y, width: region.width, height: region.height, colour: '#000000' });
  }
  return result;
}
