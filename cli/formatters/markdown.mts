import evidenceReportModule from './evidence-report.js';

const {
  MAX_REPORT_LIST_ITEMS,
  MAX_REPORT_VALUE_LENGTH,
  buildLookupEvidenceReport,
  cleanReportText,
} = evidenceReportModule;

type ReportField = { label: string; value: string };
type ReportGroup = { title: string; fields: ReportField[] };
type ComparisonField = { label: string; status: string; rdap: string; whois: string };
type LookupEvidenceReport = {
  title: string;
  notice: string;
  metadata: ReportField[];
  query: ReportField[];
  assessment: ReportField[];
  registryGroups: ReportGroup[];
  comparison: { health: ReportField[]; fields: ComparisonField[]; omitted: number };
  networkGroups: ReportGroup[];
  diagnostics: ReportField[];
  limitations: string[];
};

function escapeMarkdownValue(value: unknown, fallback = 'Not reported'): string {
  return cleanReportText(value, fallback)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+\-.!|=~])/g, '\\$1')
    .replace(/:/g, '\\:')
    .replace(/@/g, '\\@');
}

function appendFields(lines: string[], fields: ReportField[]): void {
  for (const field of fields) lines.push(`- **${field.label}:** ${escapeMarkdownValue(field.value)}`);
}

function appendGroups(lines: string[], groups: ReportGroup[]): void {
  for (const group of groups) {
    lines.push('', `### ${group.title}`);
    appendFields(lines, group.fields);
  }
}

function formatLookupEvidenceMarkdown(document: unknown): string {
  const report = buildLookupEvidenceReport(document) as LookupEvidenceReport;
  const lines = [
    `# Lookup evidence report — ${escapeMarkdownValue(report.title)}`,
    '', `> ${report.notice}`, '',
  ];
  appendFields(lines, report.metadata);
  lines.push('', '## Query');
  appendFields(lines, report.query);
  lines.push('', '## Assessment');
  appendFields(lines, report.assessment);
  lines.push('', '## Registry sources');
  appendGroups(lines, report.registryGroups);
  lines.push('', '## Registry-source comparison');
  appendFields(lines, report.comparison.health);
  if (!report.comparison.fields.length) {
    lines.push('- No comparable normalized fields were published.');
  } else {
    for (const field of report.comparison.fields) {
      lines.push(`- **${escapeMarkdownValue(field.label)} — ${escapeMarkdownValue(field.status)}:** RDAP ${escapeMarkdownValue(field.rdap)}; WHOIS ${escapeMarkdownValue(field.whois)}`);
    }
    if (report.comparison.omitted) lines.push(`- ${report.comparison.omitted} additional comparison fields omitted.`);
  }
  lines.push('', '## Network evidence');
  appendGroups(lines, report.networkGroups);
  lines.push('', '## Collection diagnostics');
  appendFields(lines, report.diagnostics);
  lines.push('', '## Limitations', '');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push('');
  return lines.join('\n');
}

const MAX_MARKDOWN_LIST_ITEMS = MAX_REPORT_LIST_ITEMS;
const MAX_MARKDOWN_VALUE_LENGTH = MAX_REPORT_VALUE_LENGTH;

export {
  MAX_MARKDOWN_LIST_ITEMS,
  MAX_MARKDOWN_VALUE_LENGTH,
  escapeMarkdownValue,
  formatLookupEvidenceMarkdown,
};
export type { ComparisonField, LookupEvidenceReport, ReportField, ReportGroup };
