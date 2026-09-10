import { decodeLocalDataWorkerRequest, type LocalDataDecodeRequest, type LocalDataDecodeResponse } from '../browser-local-data-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: LocalDataDecodeResponse) => void;
  onmessage: ((event: MessageEvent<LocalDataDecodeRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void decodeLocalDataWorkerRequest(event.data).then((response) => worker.postMessage(response));
};
