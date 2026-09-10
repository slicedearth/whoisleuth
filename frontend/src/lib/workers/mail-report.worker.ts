import { runMailReportWorkerOperation, type MailReportWorkerRequest, type MailReportWorkerResponse } from '../mail-report-worker-model.ts';

const worker = self as unknown as {
  postMessage: (response: MailReportWorkerResponse) => void;
  onmessage: ((event: MessageEvent<MailReportWorkerRequest>) => void) | null;
};
let started = false;
worker.onmessage = (event) => {
  if (started) return;
  started = true;
  void runMailReportWorkerOperation(event.data).then((response) => worker.postMessage(response));
};
