import { runDomainFeedWorkerOperation, type DomainFeedWorkerRequest, type DomainFeedWorkerResponse } from '../domain-feed-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: DomainFeedWorkerResponse) => void;
  onmessage: ((event: MessageEvent<DomainFeedWorkerRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void runDomainFeedWorkerOperation(event.data).then((response) => worker.postMessage(response));
};
