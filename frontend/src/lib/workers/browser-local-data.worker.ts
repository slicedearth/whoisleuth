import { runLocalDataWorkerRequest, type LocalDataWorkerRequest, type LocalDataWorkerResponse } from '../browser-local-data-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: LocalDataWorkerResponse) => void;
  onmessage: ((event: MessageEvent<LocalDataWorkerRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void runLocalDataWorkerRequest(event.data).then((response) => worker.postMessage(response));
};
