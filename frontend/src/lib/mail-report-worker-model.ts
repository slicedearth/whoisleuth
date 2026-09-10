import {
  buildMailReportReview, importMailReportReview,
  type MailReportInputFile, type MailReportImportResult, type MailReportReview, type ParsedMailReport,
} from './analysis/mail-report-workbench.ts';

export type MailReportWorkerRequest =
  | { kind: 'import'; files: readonly MailReportInputFile[]; retained: readonly ParsedMailReport[]; officialDomains: readonly string[] }
  | { kind: 'review'; reports: readonly ParsedMailReport[]; officialDomains: readonly string[] };
export type MailReportWorkerResponse =
  | { kind: 'import'; result: MailReportImportResult }
  | { kind: 'review'; result: MailReportReview }
  | { kind: 'error'; detail: string };

export async function runMailReportWorkerOperation(request: MailReportWorkerRequest): Promise<MailReportWorkerResponse> {
  try {
    if (request.kind === 'import') return { kind: 'import', result: await importMailReportReview(request.files, request.retained, request.officialDomains) };
    if (request.kind === 'review') return { kind: 'review', result: await buildMailReportReview(request.reports, request.officialDomains) };
    throw new TypeError('The mail report operation is unsupported.');
  } catch (error) {
    return { kind: 'error', detail: error instanceof Error ? error.message : 'The mail reports could not be processed.' };
  }
}
