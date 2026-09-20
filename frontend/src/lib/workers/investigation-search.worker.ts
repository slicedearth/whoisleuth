import { createInvestigationSearchWorkerHandler, type SearchWorkerRequest, type SearchWorkerResponse } from '../investigation-search-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: SearchWorkerResponse) => void;
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null;
};
const handle = createInvestigationSearchWorkerHandler((response) => worker.postMessage(response));
worker.onmessage = (event) => handle(event.data);
