import { PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfParserWorker from './workers/pdf-parser.worker.ts?worker';
import { runMessageIntakeOperation, type MessageIntakeRequest } from './message-intake-worker-model.ts';

/** Use the public worker-port API; no remote worker URL or document fetch. */
export async function runPdfIntakeOperation(request: MessageIntakeRequest) {
  const port = new PdfParserWorker({ name: 'pdf-parser' });
  const worker = PDFWorker.create({ port, verbosity: 0 });
  try { return await runMessageIntakeOperation(request, worker); }
  finally { worker.destroy(); port.terminate(); }
}
