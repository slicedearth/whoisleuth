import { runPopularityListWorkerOperation, type PopularityListWorkerRequest, type PopularityListWorkerResponse } from '../popularity-list-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: PopularityListWorkerResponse) => void;
  onmessage: ((event: MessageEvent<PopularityListWorkerRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void runPopularityListWorkerOperation(event.data).then((response) => worker.postMessage(response));
};
