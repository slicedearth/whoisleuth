import { runInvestigationPackageOperation, type InvestigationPackageRequest, type InvestigationPackageResponse } from '../investigation-package-worker-model.ts';

const worker = self as unknown as { postMessage(response: InvestigationPackageResponse): void; onmessage: ((event: MessageEvent<InvestigationPackageRequest>) => void) | null };
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void runInvestigationPackageOperation(event.data).then(result => worker.postMessage(result));
};
