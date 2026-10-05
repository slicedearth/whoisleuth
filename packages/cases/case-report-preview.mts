import { buildCaseReport, caseReportFilename } from './case-report.mts';
import type { CaseRecord } from './case-record-contracts.mts';
import { markingFromText, TLP_MARKINGS, tlpLabel } from '../interchange/sharing-policy.mts';

export type CaseReportPreviewOptions = Readonly<{ includeNotes: boolean; includeAttribution: boolean; applicationVersion: string }>;
export type CaseReportPreview = ReturnType<typeof prepareCaseReportPreview>;

function freezePreview<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezePreview(item);
    Object.freeze(value);
  }
  return value;
}

/** An exact, detached report snapshot; preview and download use the same bytes. */
export function prepareCaseReportPreview(record: CaseRecord, options: CaseReportPreviewOptions, generatedAt: string) {
  const sourceIdentity = JSON.stringify(record);
  const detached = structuredClone(record);
  const report = buildCaseReport(detached, { ...options, generatedAt });
  const json = JSON.stringify(report.json, null, 2);
  const markings = [...new Set(report.json.analystResponse.assertions.flatMap(assertion => assertion.provenance?.markings ?? []))];
  const recognised = markings.flatMap(value => { const marking = markingFromText(value); return marking ? [marking] : []; });
  const strictest = recognised.sort((left, right) => TLP_MARKINGS.indexOf(right) - TLP_MARKINGS.indexOf(left))[0] ?? null;
  return freezePreview({
    sourceIdentity, options: { ...options }, report, markings,
    strictestMarking: strictest ? tlpLabel(strictest) : null,
    unknownMarkings: markings.filter(value => markingFromText(value) === null),
    files: {
      json: { content: json, mimeType: 'application/json', filename: caseReportFilename(record.domain, 'json', generatedAt), bytes: new TextEncoder().encode(json).byteLength },
      md: { content: report.markdown, mimeType: 'text/markdown', filename: caseReportFilename(record.domain, 'md', generatedAt), bytes: new TextEncoder().encode(report.markdown).byteLength },
    },
  });
}

export type CaseReportPrintBlock =
  | Readonly<{ kind: 'heading'; level: number; text: string }>
  | Readonly<{ kind: 'paragraph' | 'quote' | 'item'; text: string; depth: number }>
  | Readonly<{ kind: 'table'; headers: readonly string[]; rows: readonly (readonly string[])[] }>;

/** Format only the existing owner's exact Markdown; no second data projection,
 * HTML evaluation, autolinks or general-purpose Markdown runtime. */
export function caseReportPrintBlocks(preview: CaseReportPreview): readonly CaseReportPrintBlock[] {
  const plain = (value: string) => value.replace(/\*\*/gu, '').replace(/\\(.)/gu, '$1');
  const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/u).map(cell => plain(cell.trim()));
  const lines = preview.files.md.content.split('\n');
  const blocks: CaseReportPrintBlock[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim() || line === '---') continue;
    const heading = /^(#{1,6}) (.+)$/u.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: plain(heading[2]!) }); continue; }
    if (line.startsWith('|') && /^\|[\s|:-]+\|$/u.test(lines[index + 1] ?? '')) {
      const headers = cells(line), rows: string[][] = []; index++;
      while (lines[index + 1]?.startsWith('|')) rows.push(cells(lines[++index]!));
      blocks.push({ kind: 'table', headers, rows }); continue;
    }
    const item = /^(\s*)- (.*)$/u.exec(line);
    if (item) { blocks.push({ kind: 'item', depth: Math.floor(item[1]!.length / 2), text: plain(item[2]!) }); continue; }
    const quote = /^> ?(.*)$/u.exec(line);
    blocks.push({ kind: quote ? 'quote' : 'paragraph', depth: Math.floor((/^\s*/u.exec(line)?.[0].length ?? 0) / 2),
      text: plain(quote ? quote[1]! : line.trim()) });
  }
  return freezePreview(blocks);
}

export function caseReportPreviewIsCurrent(preview: CaseReportPreview, record: CaseRecord, options: CaseReportPreviewOptions): boolean {
  return preview.sourceIdentity === JSON.stringify(record)
    && preview.options.includeNotes === options.includeNotes
    && preview.options.includeAttribution === options.includeAttribution
    && preview.options.applicationVersion === options.applicationVersion;
}
