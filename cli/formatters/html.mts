import evidenceReportModule from './evidence-report.js';
import type { ComparisonField, LookupEvidenceReport, ReportField, ReportGroup } from './markdown.mts';

const { buildLookupEvidenceReport, cleanReportText } = evidenceReportModule;

function escapeHtml(value: unknown, fallback = 'Not reported'): string {
  return cleanReportText(value, fallback)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderFields(fields: ReportField[]): string {
  return `<dl class="fields">${fields.map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`).join('')}</dl>`;
}

function renderGroups(groups: ReportGroup[]): string {
  return `<div class="card-grid">${groups.map((group) => `<section class="card"><h3>${escapeHtml(group.title)}</h3>${renderFields(group.fields)}</section>`).join('')}</div>`;
}

function renderComparison(comparison: { fields: ComparisonField[]; omitted: number }): string {
  if (!comparison.fields.length) return '<p class="empty">No comparable normalized fields were published.</p>';
  const rows = comparison.fields.map((field) => `<tr><th scope="row">${escapeHtml(field.label)}</th><td><span class="status">${escapeHtml(field.status)}</span></td><td>${escapeHtml(field.rdap)}</td><td>${escapeHtml(field.whois)}</td></tr>`).join('');
  const omitted = comparison.omitted
    ? `<p class="omission">${escapeHtml(comparison.omitted)} additional comparison fields omitted.</p>`
    : '';
  return `<div class="table-scroll"><table><caption>Normalized registry publication comparison</caption><thead><tr><th scope="col">Field</th><th scope="col">Result</th><th scope="col">RDAP</th><th scope="col">WHOIS</th></tr></thead><tbody>${rows}</tbody></table></div>${omitted}`;
}

function formatLookupEvidenceHtml(document: unknown): string {
  const report = buildLookupEvidenceReport(document) as LookupEvidenceReport;
  const title = `Lookup evidence report — ${report.title}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:dark;--bg:#07110d;--panel:#0d1b15;--panel2:#10241b;--line:#254837;--text:#d8f5e4;--muted:#91b7a0;--accent:#6dff9d;--shadow:rgba(0,0,0,.28)}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}main{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:42px 0 64px}header{border:1px solid var(--line);background:linear-gradient(145deg,var(--panel2),var(--panel));padding:28px;box-shadow:0 18px 50px var(--shadow)}h1,h2,h3{line-height:1.2;margin:0;color:var(--accent)}h1{font-size:clamp(1.5rem,4vw,2.35rem);overflow-wrap:anywhere}h2{font-size:1.22rem;margin-bottom:16px}h3{font-size:1rem;margin-bottom:12px}.eyebrow{margin:0 0 10px;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}.notice{margin:18px 0 0;color:var(--muted);max-width:85ch}.block{margin-top:24px;border:1px solid var(--line);background:var(--panel);padding:22px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px;margin:0}.fields div{display:grid;grid-template-columns:minmax(130px,.8fr) minmax(0,1.6fr);gap:12px;border-top:1px solid var(--line);padding:9px 0}.fields div:first-child,.fields div:nth-child(2){border-top:0}.fields dt{color:var(--muted)}.fields dd{margin:0;overflow-wrap:anywhere}.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}.card{border:1px solid var(--line);background:var(--panel2);padding:18px}.card .fields{display:block}.card .fields div{grid-template-columns:minmax(120px,.8fr) minmax(0,1.4fr)}.card .fields div:nth-child(2){border-top:1px solid var(--line)}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:720px}caption{text-align:left;color:var(--muted);padding:0 0 10px}th,td{border:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:var(--panel2);color:var(--accent)}tbody th{color:var(--text)}.status{white-space:nowrap;color:var(--accent)}.empty,.omission{color:var(--muted)}ul{margin:0;padding-left:22px}li+li{margin-top:8px}footer{margin-top:24px;color:var(--muted);font-size:.88rem;text-align:center}
    @media(max-width:700px){main{width:min(100% - 20px,1120px);padding-top:16px}header,.block{padding:17px}.fields{display:block}.fields div,.card .fields div{grid-template-columns:1fr;gap:2px}.fields div:nth-child(2){border-top:1px solid var(--line)}}
    @media print{:root{color-scheme:light;--bg:#fff;--panel:#fff;--panel2:#f5f7f5;--line:#b9c5bd;--text:#17231b;--muted:#46564b;--accent:#155c2f;--shadow:transparent}body{font:10pt/1.42 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}main{width:100%;padding:0}header,.block,.card{box-shadow:none;break-inside:avoid}.block{margin-top:12px}}
  </style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow">WHOISleuth evidence</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="notice">${escapeHtml(report.notice)}</p>
    ${renderFields(report.metadata)}
  </header>
  <section class="block"><h2>Query</h2>${renderFields(report.query)}</section>
  <section class="block"><h2>Assessment</h2>${renderFields(report.assessment)}</section>
  <section class="block"><h2>Registry sources</h2>${renderGroups(report.registryGroups)}</section>
  <section class="block"><h2>Registry-source comparison</h2>${renderFields(report.comparison.health)}${renderComparison(report.comparison)}</section>
  <section class="block"><h2>Network evidence</h2>${renderGroups(report.networkGroups)}</section>
  <section class="block"><h2>Collection diagnostics</h2>${renderFields(report.diagnostics)}</section>
  <section class="block"><h2>Limitations</h2><ul>${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
  <footer>Offline, self-contained report. No scripts, forms, external resources, or active links are included.</footer>
</main>
</body>
</html>
`;
}

export { escapeHtml, formatLookupEvidenceHtml };
