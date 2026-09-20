import { runRetainedReviewOperation, type RetainedReviewRequest, type RetainedReviewResponse } from '../retained-review-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: RetainedReviewResponse) => void;
  onmessage: ((event: MessageEvent<RetainedReviewRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  worker.postMessage(runRetainedReviewOperation(event.data));
};
