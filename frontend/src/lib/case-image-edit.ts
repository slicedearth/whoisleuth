import { readCaseAttachment, type CaseAttachment } from '../../../packages/cases/case-attachment-model.mts';
import { MAX_SELECTED_FILE_BYTES } from '../../../packages/contracts/selected-file-limits.mts';
import { imageRegionPaintRectangles, readImageRegionPlan, type ImageRegionPlan } from '../../../packages/evidence/image-regions.mts';
import { verifyRetainedFile } from '../../../packages/evidence/retained-file.mts';
import { decodeArtifactPng } from './artifact-preview.ts';
import { prepareCaseAttachmentFiles, type SelectedCaseAttachment } from './case-attachments.ts';

// Native PNG encoding cannot be cancelled. Admit one preparation at a time;
// cancellation discards its result without queuing more native encoders.
let preparing = false;

async function renderDerivative(file: Blob, plan: ImageRegionPlan, signal: AbortSignal): Promise<Blob> {
  const bitmap = await decodeArtifactPng(file, signal);
  const canvas = document.createElement('canvas');
  try {
    signal.throwIfAborted();
    if (bitmap.width !== plan.width || bitmap.height !== plan.height) throw new TypeError('The selected region dimensions do not match the source image.');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0);
    const rectangles = imageRegionPaintRectangles(plan);
    for (let index = 0; index < rectangles.length; index++) {
      signal.throwIfAborted();
      const rectangle = rectangles[index]!;
      context.fillStyle = rectangle.colour;
      context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
      if ((index + 1) % 8 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value); else reject(new Error('The edited PNG could not be encoded.'));
    }, 'image/png'));
    signal.throwIfAborted();
    if (!output.size || output.size > MAX_SELECTED_FILE_BYTES) throw new Error('The derived PNG does not fit the retained-file byte limit. No file was changed.');
    return output;
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}

/** Re-encode only decoded pixels; no original metadata or reversible overlays are copied. */
export async function prepareCaseImageDerivative(
  sourceInput: CaseAttachment,
  fileInput: Blob,
  planInput: ImageRegionPlan,
  filename: string,
  signal: AbortSignal,
): Promise<SelectedCaseAttachment> {
  signal.throwIfAborted();
  if (preparing) throw new Error('An image is still being prepared. Wait for it to finish before preparing another.');
  const source = readCaseAttachment(sourceInput);
  const plan = readImageRegionPlan(planInput);
  if (source.mediaType !== 'image/png' || !(fileInput instanceof Blob) || fileInput.size !== source.byteLength) throw new TypeError('Select a retained PNG with matching original bytes.');
  // Validate the output name before reading or decoding the source.
  if (!/\.png$/iu.test(filename)) throw new TypeError('Use a .png filename for the derived image.');
  readCaseAttachment({ ...source, fileName: filename });
  const file = fileInput.slice();
  preparing = true;
  try {
    await verifyRetainedFile({ digestSha256: source.digestSha256, byteLength: source.byteLength }, file);
    signal.throwIfAborted();
    const output = await renderDerivative(file, plan, signal);
    const [prepared] = await prepareCaseAttachmentFiles([new File([output], filename, { type: 'image/png' })], source.source, source.observedAt);
    signal.throwIfAborted();
    if (!prepared) throw new Error('The derived PNG could not be prepared.');
    return { file: prepared.file, attachment: readCaseAttachment({ ...prepared.attachment, derivation: {
      method: 'png-regions-v1', sourceAttachmentId: source.id,
      source: { digestSha256: source.digestSha256, byteLength: source.byteLength }, plan,
    } }) };
  } finally { preparing = false; }
}
