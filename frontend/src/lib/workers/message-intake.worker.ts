import { runMessageIntakeOperation, type MessageIntakeRequest, type MessageIntakeResponse } from '../message-intake-worker-model.ts';

const worker = self as unknown as { postMessage(response: MessageIntakeResponse): void; onmessage: ((event: MessageEvent<MessageIntakeRequest>) => void) | null };
let started = false;
worker.onmessage = event => {
  if (started) return;
  started = true;
  void (event.data.kind === 'pdf'
    ? import('../pdf-intake-worker.ts').then(module => module.runPdfIntakeOperation(event.data))
    : runMessageIntakeOperation(event.data)).then(result => worker.postMessage(result), () => worker.postMessage({ kind: 'error' }));
};
