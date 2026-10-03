import type { MessageIntakeKind, MessageIntakeResult } from '../contracts/message-intake.mts';
import type { PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One format dispatch for browser and CLI; parsers load only when selected. */
export async function reviewSelectedInput(bytes: Uint8Array, kind: MessageIntakeKind, reviewedAt: string, pdfWorker?: PDFWorker): Promise<MessageIntakeResult> {
  switch (kind) {
    case 'text': case 'email': case 'calendar': return (await import('./message-intake.mts')).reviewMessageInput(bytes, kind, reviewedAt);
    case 'qr': return (await import('./qr-intake.mts')).reviewQrInput(bytes, reviewedAt);
    case 'docx': return (await import('./docx-intake.mts')).reviewDocxInput(bytes, reviewedAt);
    case 'pdf': return (await import('./pdf-intake.mts')).reviewPdfInput(bytes, reviewedAt, pdfWorker);
    case 'har': return (await import('./har-intake.mts')).reviewHarInput(bytes, reviewedAt);
    case 'identity': return (await import('./identity-event-intake.mts')).reviewIdentityEventInput(bytes, reviewedAt);
    default: { const unsupported: never = kind; throw new TypeError(`Unsupported selected input: ${String(unsupported)}`); }
  }
}
