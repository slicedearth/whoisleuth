<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import {
    MAX_MAIL_REPORT_ARCHIVE_ENTRIES,
    MAX_MAIL_REPORT_INPUT_BYTES,
    MAX_MAIL_REPORT_INPUT_FILES,
    buildMailReportReview,
    parseMailReportFiles,
    type DmarcAggregateReport,
    type MailReportReview,
    type ParsedMailReport,
    type TlsAggregateReport,
  } from '$lib/analysis/mail-report-workbench.ts';

  let { active }: { active: BrandProfile } = $props();

  let reports = $state<ParsedMailReport[]>([]);
  let review = $state<MailReportReview | null>(null);
  let busy = $state(false);
  let message = $state('');
  let profileId = $state('');
  let profileSignature = $state('');
  let reviewGeneration = 0;

  const dmarcReports = $derived(reports.filter((report): report is DmarcAggregateReport => report.kind === 'dmarc'));
  const tlsReports = $derived(reports.filter((report): report is TlsAggregateReport => report.kind === 'tls-rpt'));

  function formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  function formatPeriod(start: string | null, end: string | null): string {
    const render = (value: string | null) => {
      if (!value) return 'unknown';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
    };
    return `${render(start)} to ${render(end)}`;
  }

  function safeFilename(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'mail-reports';
  }

  async function rebuild(
    next: readonly ParsedMailReport[],
    generation: number,
    expectedProfileId: string,
    officialDomains: readonly string[],
  ): Promise<boolean> {
    const nextReview = next.length ? await buildMailReportReview(next, officialDomains) : null;
    if (generation !== reviewGeneration || active.id !== expectedProfileId) return false;
    reports = [...next];
    review = nextReview;
    return true;
  }

  async function importReports(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const selected = [...(input.files || [])];
    input.value = '';
    if (!selected.length || busy) return;
    const expectedProfileId = active.id;
    const officialDomains = [...active.officialDomains];
    const retainedReports = [...reports];
    const generation = ++reviewGeneration;
    busy = true;
    message = '';
    try {
      if (selected.length > MAX_MAIL_REPORT_INPUT_FILES) {
        throw new Error(`Select no more than ${MAX_MAIL_REPORT_INPUT_FILES} files at once.`);
      }
      const totalBytes = selected.reduce((total, file) => total + file.size, 0);
      if (totalBytes > MAX_MAIL_REPORT_INPUT_BYTES) {
        throw new Error(`Selected files are limited to ${MAX_MAIL_REPORT_INPUT_BYTES / (1024 * 1024)} MB in total.`);
      }
      const parsed: ParsedMailReport[] = [];
      for (const file of selected) {
        parsed.push(...await parseMailReportFiles(file.name, new Uint8Array(await file.arrayBuffer())));
        if (retainedReports.length + parsed.length > MAX_MAIL_REPORT_ARCHIVE_ENTRIES) {
          throw new Error(`The review is limited to ${MAX_MAIL_REPORT_ARCHIVE_ENTRIES} aggregate reports.`);
        }
      }
      const seen = new Set<string>();
      const next = [...retainedReports, ...parsed].filter((report) => {
        const key = `${report.kind}:${report.source.digestSha256}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!await rebuild(next, generation, expectedProfileId, officialDomains)) return;
      message = `Loaded ${parsed.length} report${parsed.length === 1 ? '' : 's'} locally; ${next.length} unique report${next.length === 1 ? '' : 's'} in this review.`;
    } catch (cause) {
      if (generation !== reviewGeneration || active.id !== expectedProfileId) return;
      message = cause instanceof Error ? cause.message : 'The selected mail reports could not be reviewed.';
    } finally {
      if (generation === reviewGeneration) busy = false;
    }
  }

  function clear(): void {
    reviewGeneration += 1;
    reports = [];
    review = null;
    busy = false;
    message = 'Cleared imported mail reports from this tab.';
  }

  function download(): void {
    if (!review) return;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(review, null, 2)}\n`], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(active.name)}-mail-report-review.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  $effect(() => {
    const nextSignature = `${active.id}\u0000${active.officialDomains.join('\u0000')}`;
    if (nextSignature === profileSignature) return;
    profileSignature = nextSignature;
    const generation = ++reviewGeneration;
    busy = false;
    if (active.id !== profileId) {
      profileId = active.id;
      reports = [];
      review = null;
      message = '';
      busy = false;
    } else if (reports.length) {
      const expectedProfileId = active.id;
      const retainedReports = [...reports];
      const officialDomains = [...active.officialDomains];
      review = null;
      busy = true;
      message = 'Reconciling the retained reports with the updated active profile…';
      void buildMailReportReview(retainedReports, officialDomains).then((next) => {
        if (generation === reviewGeneration && active.id === expectedProfileId) {
          review = next;
          message = 'Reconciled the retained reports with the updated active profile.';
        }
      }).catch(() => {
        if (generation === reviewGeneration && active.id === expectedProfileId) {
          review = null;
          message = 'The imported mail reports could not be reconciled with the active profile.';
        }
      }).finally(() => {
        if (generation === reviewGeneration && active.id === expectedProfileId) busy = false;
      });
    }
  });
</script>

<section class="mail-workbench card" aria-labelledby="mail-workbench-title">
  <header>
    <div>
      <p class="eyebrow">Local report review</p>
      <h2 id="mail-workbench-title">DMARC and SMTP TLS reports</h2>
      <p>Review aggregate DMARC XML and TLS-RPT JSON without uploading the files. Gzip and ZIP containers are expanded locally within fixed byte and entry limits.</p>
    </div>
    <div class="actions">
      <label class="btn file-btn">
        {busy ? 'Reading…' : 'Choose reports'}
        <input type="file" multiple disabled={busy} accept=".xml,.json,.gz,.zip,application/xml,application/json,application/gzip,application/zip" onchange={importReports}>
      </label>
      <button class="btn" type="button" disabled={!review || busy} onclick={download}>Export review</button>
      <button class="btn" type="button" disabled={!reports.length || busy} onclick={clear}>Clear</button>
    </div>
  </header>

  <p class="privacy-note">Files and parsed values stay in this tab until cleared or the page is left. They are not uploaded or saved to the Brand Profile.</p>
  {#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

  {#if review}
    <div class="summary" role="group" aria-label="Imported mail report summary">
      <article><strong>{review.summary.dmarcReports}</strong><span>DMARC reports</span></article>
      <article><strong>{formatNumber(review.summary.dmarcMessages)}</strong><span>Messages observed</span></article>
      <article><strong>{formatNumber(review.summary.dmarcBothFailed)}</strong><span>Both checks failed</span></article>
      <article><strong>{review.summary.tlsReports}</strong><span>TLS reports</span></article>
      <article><strong>{formatNumber(review.summary.tlsFailedSessions)}</strong><span>TLS failures</span></article>
    </div>

    {#if review.profileScope.outsideScopeDomains.length}
      <p class="scope-warning"><strong>Outside active profile:</strong> {review.profileScope.outsideScopeDomains.join(', ')}</p>
    {/if}

    <div class="reports">
      {#each dmarcReports as report (report.source.digestSha256)}
        <details>
          <summary>
            <span><strong>DMARC</strong> {report.domain || 'Domain unavailable'}</span>
            <span>{formatNumber(report.totalMessages)} messages</span>
          </summary>
          <div class="report-meta">
            <span>Reporter: {report.organization || 'Not supplied'}</span>
            <span>Period: {formatPeriod(report.periodStart, report.periodEnd)}</span>
            <span>Source: {report.source.name} · {report.source.digestSha256}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Source IP</th><th>Header domain</th><th>Messages</th><th>DKIM</th><th>SPF</th><th>Disposition</th></tr></thead>
              <tbody>
                {#each [...report.records].sort((left, right) => right.count - left.count).slice(0, 50) as row}
                  <tr><td data-label="Source IP">{row.sourceIp || 'Unavailable'}</td><td data-label="Header domain">{row.headerFrom || 'Unavailable'}</td><td data-label="Messages">{formatNumber(row.count)}</td><td data-label="DKIM">{row.dkim || 'Unknown'}</td><td data-label="SPF">{row.spf || 'Unknown'}</td><td data-label="Disposition">{row.disposition || 'Unknown'}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if report.records.length > 50}<p class="limitation">Showing 50 of {formatNumber(report.records.length)} bounded rows. The export retains every parsed row within the report limit.</p>{/if}
          {#if report.truncated}<p class="limitation">This report exceeded the record limit and is explicitly truncated.</p>{/if}
        </details>
      {/each}

      {#each tlsReports as report (report.source.digestSha256)}
        <details>
          <summary>
            <span><strong>TLS-RPT</strong> {report.organization || 'Reporter unavailable'}</span>
            <span>{formatNumber(report.failedSessions)} failures</span>
          </summary>
          <div class="report-meta">
            <span>Period: {formatPeriod(report.periodStart, report.periodEnd)}</span>
            <span>Successful sessions: {formatNumber(report.successfulSessions)}</span>
            <span>Source: {report.source.name} · {report.source.digestSha256}</span>
          </div>
          <div class="policy-grid">
            {#each report.policies.slice(0, 50) as policy}
              <article>
                <strong>{policy.policyDomain || 'Policy domain unavailable'}</strong>
                <span>{policy.policyType || 'Unknown policy'} · {formatNumber(policy.successfulSessions)} successful · {formatNumber(policy.failedSessions)} failed</span>
                <span>MX: {policy.mxHosts.join(', ') || 'Not supplied'}</span>
                <span>Failures: {policy.failureTypes.map((item) => `${item.type} (${formatNumber(item.count)})`).join(', ') || 'No failure detail supplied'}</span>
              </article>
            {/each}
          </div>
          {#if report.policies.length > 50}<p class="limitation">Showing 50 of {formatNumber(report.policies.length)} bounded policies. The export retains every parsed policy within the report limit.</p>{/if}
          {#if report.truncated}<p class="limitation">This report exceeded a policy or failure-detail limit and is explicitly truncated.</p>{/if}
        </details>
      {/each}
    </div>

    <ul class="limitations">{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  {:else}
    <p class="empty">Choose one or more aggregate report files to begin a transient review.</p>
  {/if}
</section>

<style>
  .mail-workbench{margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  h2{margin:4px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow),.privacy-note,.empty,.limitation,.limitations{color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  header p:not(.eyebrow){max-width:760px;margin:7px 0 0}
  .actions{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:8px}
  .privacy-note{margin:14px 0 0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .message{margin:12px 0 0;color:var(--accent);font-size:var(--text-sm)}
  .summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:14px}
  .summary article{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .summary strong,.summary span{display:block}.summary strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}.summary span{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  .scope-warning{overflow-wrap:anywhere;margin:12px 0 0;padding:10px;border:1px solid color-mix(in srgb,var(--amber) 45%,var(--border));border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs)}
  .scope-warning strong{color:var(--amber)}
  .reports{display:grid;gap:10px;margin-top:14px}
  details{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px;cursor:pointer;color:var(--text);font:650 var(--text-xs) var(--mono)}
  summary span{min-width:0;overflow-wrap:anywhere}summary span:last-child{color:var(--muted);text-align:right}
  .report-meta{display:grid;gap:5px;padding:0 13px 12px;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .table-wrap{margin:0 12px 12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  th,td{min-width:0;overflow-wrap:anywhere;font-size:var(--text-2xs)}
  .policy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 12px 12px}
  .policy-grid article{display:grid;gap:4px;min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
  .policy-grid strong,.policy-grid span{overflow-wrap:anywhere}.policy-grid strong{font:650 var(--text-xs) var(--mono)}.policy-grid span{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .limitation{margin:0;padding:0 13px 12px}
  .limitations{margin:14px 0 0;padding-left:18px}
  .empty{margin-bottom:0}
  @media(max-width:900px){.summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}.actions{display:grid;grid-template-columns:1fr;justify-content:stretch}.actions .btn{width:100%}
    .summary{grid-template-columns:repeat(2,minmax(0,1fr))}.policy-grid{grid-template-columns:1fr}
    summary{align-items:flex-start;flex-direction:column;gap:4px}summary span:last-child{text-align:left}
    .table-wrap{overflow:visible;border:0}
    table,tbody{display:block}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    tbody{display:grid;gap:8px}tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
    td{display:block;padding:0;border:0}td::before{content:attr(data-label);display:block;margin-bottom:3px;color:var(--muted);font:600 .6rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
  }
  @media(max-width:390px){.summary,tr{grid-template-columns:1fr}}
</style>
