import { runMessageIntakeOperation, type MessageIntakeRequest, type MessageIntakeResponse } from '../message-intake-worker-model.ts';

const worker = self as unknown as { postMessage(response: MessageIntakeResponse): void; onmessage: ((event: MessageEvent<MessageIntakeRequest>) => void) | null };
let started = false;
worker.onmessage = event => {
  if (started) return;
  started = true;
  void runMessageIntakeOperation(event.data).then(result => worker.postMessage(result));
};
