import { MESSAGE_INTAKE_KINDS, MAX_MESSAGE_INTAKE_BYTES, type MessageIntakeKind, type MessageIntakeResult } from '../../../packages/contracts/message-intake.mts';
import { reviewSelectedInput } from '../../../packages/investigation/selected-input-review.mts';
import type { PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type MessageIntakeRequest = Readonly<{ kind: MessageIntakeKind; file: Blob; reviewedAt: string }>;
export type MessageIntakeResponse = Readonly<{ kind: 'review'; result: MessageIntakeResult }> | Readonly<{ kind: 'error' }>;

export async function runMessageIntakeOperation(request: MessageIntakeRequest, pdfWorker?: PDFWorker): Promise<MessageIntakeResponse> {
  let bytes: Uint8Array | null = null;
  try {
    if (!request || !MESSAGE_INTAKE_KINDS.includes(request.kind) || !(request.file instanceof Blob) || request.file.size < 1 || request.file.size > MAX_MESSAGE_INTAKE_BYTES) return { kind: 'error' };
    bytes = new Uint8Array(await request.file.arrayBuffer());
    const result = await reviewSelectedInput(bytes, request.kind, request.reviewedAt, pdfWorker);
    return { kind: 'review', result };
  } catch { return { kind: 'error' }; }
  finally { bytes?.fill(0); }
}
