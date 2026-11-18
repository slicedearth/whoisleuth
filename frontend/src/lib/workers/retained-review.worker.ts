import { runRetainedReviewOperation, runSelectedProofOperation, type RetainedReviewRequest, type RetainedReviewResponse, type SelectedProofRequest, type SelectedProofResponse } from '../retained-review-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: RetainedReviewResponse | SelectedProofResponse) => void;
  onmessage: ((event: MessageEvent<RetainedReviewRequest | SelectedProofRequest>) => void) | null;
};
let started = false;
worker.onmessage = async (event) => {
  if (started) return;
  started = true;
  worker.postMessage(event.data.kind === 'proof' ? await runSelectedProofOperation(event.data) : runRetainedReviewOperation(event.data));
};
