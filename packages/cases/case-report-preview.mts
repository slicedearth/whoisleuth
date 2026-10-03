import { buildCaseReport, caseReportFilename } from './case-report.mts';
import type { CaseRecord } from './case-record-contracts.mts';
import { markingFromText, TLP_MARKINGS, tlpLabel } from '../interchange/sharing-policy.mts';

export type CaseReportPreviewOptions = Readonly<{ includeNotes: boolean; includeAttribution: boolean; applicationVersion: string }>;
export type CaseReportPreview = ReturnType<typeof prepareCaseReportPreview>;

/** An exact, detached report snapshot; preview and download use the same bytes. */
export function prepareCaseReportPreview(record: CaseRecord, options: CaseReportPreviewOptions, generatedAt: string) {
  const sourceIdentity = JSON.stringify(record);
  const detached = structuredClone(record);
  const report = buildCaseReport(detached, { ...options, generatedAt });
  const json = JSON.stringify(report.json, null, 2);
  const markings = [...new Set(report.json.analystResponse.assertions.flatMap(assertion => assertion.provenance?.markings ?? []))];
  const recognised = markings.flatMap(value => { const marking = markingFromText(value); return marking ? [marking] : []; });
  const strictest = recognised.sort((left, right) => TLP_MARKINGS.indexOf(right) - TLP_MARKINGS.indexOf(left))[0] ?? null;
  return {
    sourceIdentity, options: { ...options }, report, markings,
    strictestMarking: strictest ? tlpLabel(strictest) : null,
    unknownMarkings: markings.filter(value => markingFromText(value) === null),
    files: {
      json: { content: json, mimeType: 'application/json', filename: caseReportFilename(record.domain, 'json', generatedAt), bytes: new TextEncoder().encode(json).byteLength },
      md: { content: report.markdown, mimeType: 'text/markdown', filename: caseReportFilename(record.domain, 'md', generatedAt), bytes: new TextEncoder().encode(report.markdown).byteLength },
    },
  };
}

export function caseReportPreviewIsCurrent(preview: CaseReportPreview, record: CaseRecord, options: CaseReportPreviewOptions): boolean {
  return preview.sourceIdentity === JSON.stringify(record)
    && preview.options.includeNotes === options.includeNotes
    && preview.options.includeAttribution === options.includeAttribution
    && preview.options.applicationVersion === options.applicationVersion;
}
