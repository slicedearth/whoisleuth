<script lang="ts">
  import { tick } from 'svelte';
  import Pagination from './Pagination.svelte';
  import type { ParsedMailReport } from '$lib/analysis/mail-report-workbench.ts';

  let { report, position }: { report: ParsedMailReport; position: number } = $props();
  let open = $state(false);
  let query = $state('');
  let page = $state(1);
  let resultList = $state<HTMLDivElement>();
  const pageSize = 50;
  const identity = $derived(report.source.digestSha256);
  const label = $derived(`${report.kind === 'dmarc' ? 'DMARC' : 'TLS-RPT'} report ${position}`);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const records = $derived(report.kind === 'dmarc' ? [...report.records].sort((a, b) => b.count - a.count) : []);
  const filteredRecords = $derived(records.filter((row) => !normalizedQuery || [row.sourceIp, row.headerFrom, row.dkim, row.spf, row.disposition].some((value) => value?.toLowerCase().includes(normalizedQuery))));
  const filteredPolicies = $derived(report.kind === 'tls-rpt' ? report.policies.filter((policy) => !normalizedQuery
    || [policy.policyDomain, policy.policyType, ...policy.mxHosts].some((value) => value?.toLowerCase().includes(normalizedQuery))
    || policy.failureTypes.some((failure) => failure.type.toLowerCase().includes(normalizedQuery))) : []);
  const count = $derived(report.kind === 'dmarc' ? filteredRecords.length : filteredPolicies.length);
  const pageCount = $derived(Math.max(1, Math.ceil(count / pageSize)));
  const currentPage = $derived(Math.min(page, pageCount));
  const offset = $derived((currentPage - 1) * pageSize);
  $effect(() => { identity; page = 1; query = ''; });

  const number = (value: number) => value.toLocaleString();
  const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : 'unknown';

  async function setPage(value: number) {
    const expectedIdentity = identity;
    const expectedQuery = query;
    page = Math.max(1, Math.min(pageCount, value));
    await tick();
    if (identity !== expectedIdentity || query !== expectedQuery || !open) return;
    resultList?.focus({ preventScroll: true });
    resultList?.scrollIntoView({ block: 'start' });
  }
</script>

<details bind:open>
  <summary>
    <strong>{report.kind === 'dmarc' ? 'DMARC' : 'TLS-RPT'}</strong> {report.kind === 'dmarc' ? report.domain || 'Domain unavailable' : report.organization || 'Reporter unavailable'}
    <span>{report.kind === 'dmarc' ? `${number(report.totalMessages)} messages in retained rows` : `${number(report.failedSessions)} reported failures`}</span>
  </summary>
  {#if open}
    <div class="body">
      <div class="report-meta">
        <span>Reporter: {report.organization || 'Not supplied'}</span>
        <span>Report identifier: {report.reportId || 'Not supplied'}</span>
        <span>Period: {timestamp(report.periodStart)} to {timestamp(report.periodEnd)}</span>
        <span>Source: {report.source.name} · {report.source.digestSha256}</span>
        {#if report.source.container.format === 'zip'}<span>Archive selection: {report.source.container.entries.retained} report entries from {report.source.container.entries.inspected} inspected entries; {report.source.container.entries.inspected - report.source.container.entries.retained} non-report entries were not parsed.</span>{/if}
      </div>
      {#if report.kind === 'dmarc' && report.recordCoverage.supplied > report.recordCoverage.inspected}
        <p class="limitation">Parsed {number(report.recordCoverage.retained)} of {number(report.recordCoverage.supplied)} supplied rows. {number(report.recordCoverage.supplied - report.recordCoverage.inspected)} rows were not inspected; totals cover retained rows only.</p>
      {:else if report.kind === 'tls-rpt' && report.policyCoverage.supplied > report.policyCoverage.inspected}
        <p class="limitation">Parsed {number(report.policyCoverage.retained)} of {number(report.policyCoverage.supplied)} supplied policies. {number(report.policyCoverage.supplied - report.policyCoverage.inspected)} policies were not inspected; totals cover retained policies only.</p>
      {/if}
      <label class="field">Search {report.kind === 'dmarc' ? 'rows' : 'policies'}<input type="search" aria-label={`Search ${label}`} bind:value={query} oninput={() => page = 1} maxlength="200"></label>
      <p class="coverage" role="status">{count ? `Showing ${number(offset + 1)}–${number(Math.min(count, offset + pageSize))} of ${number(count)} matching ${report.kind === 'dmarc' ? 'rows' : 'policies'}` : 'No retained result matches this search.'}</p>
      <div class="paged-results" tabindex="-1" role="group" aria-label={`${label} results`} bind:this={resultList}>
        {#if report.kind === 'dmarc'}
          <div class="table-wrap">
            <table aria-label={`${label} rows`}>
              <thead><tr><th>Source IP</th><th>Header domain</th><th>Messages</th><th>DKIM</th><th>SPF</th><th>Disposition</th></tr></thead>
              <tbody>{#each filteredRecords.slice(offset, offset + pageSize) as row}
                <tr><td data-label="Source IP">{row.sourceIp || 'Unavailable'}</td><td data-label="Header domain">{row.headerFrom || 'Unavailable'}</td><td data-label="Messages">{number(row.count)}</td><td data-label="DKIM">{row.dkim || 'Unknown'}</td><td data-label="SPF">{row.spf || 'Unknown'}</td><td data-label="Disposition">{row.disposition || 'Unknown'}</td></tr>
              {/each}</tbody>
            </table>
          </div>
        {:else}
          <div class="policy-grid independent-grid">
            {#each filteredPolicies.slice(offset, offset + pageSize) as policy}
              <article>
                <strong>{policy.policyDomain || 'Policy domain unavailable'}</strong>
                <span>{policy.policyType || 'Unknown policy'} · {number(policy.successfulSessions)} successful · {number(policy.failedSessions)} failed</span>
                <details><summary>{number(policy.mxHosts.length)} retained MX host{policy.mxHosts.length === 1 ? '' : 's'}</summary><p>{policy.mxHosts.join(', ') || 'No MX host retained'}</p></details>
                <details><summary>{number(policy.failureTypes.length)} failure type{policy.failureTypes.length === 1 ? '' : 's'} from {number(policy.failureDetailCoverage.inspected)} inspected detail{policy.failureDetailCoverage.inspected === 1 ? '' : 's'}</summary><p>Failures: {policy.failureTypes.map((item) => `${item.type} (${number(item.count)})`).join(', ') || 'No failure detail retained'}</p></details>
                {#if policy.mxHostCoverage.supplied > policy.mxHostCoverage.inspected || policy.mxHostCoverage.rejected}<p class="limitation">MX input: {number(policy.mxHostCoverage.inspected)} of {number(policy.mxHostCoverage.supplied)} values inspected; {number(policy.mxHostCoverage.retained)} unique values retained and {number(policy.mxHostCoverage.rejected)} invalid values rejected.</p>{/if}
                {#if policy.failureDetailCoverage.supplied > policy.failureDetailCoverage.inspected}<p class="limitation">Failure detail input: {number(policy.failureDetailCoverage.inspected)} of {number(policy.failureDetailCoverage.supplied)} records inspected. The policy summary remains separately reported.</p>{/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
      <Pagination {currentPage} {pageCount} setPage={(value) => void setPage(value)} ariaLabel={`${label} pages`} pageInputLabel={`${label} page`} />
    </div>
  {/if}
</details>

<style>
  details{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  summary{padding:13px;cursor:pointer;overflow-wrap:anywhere;color:var(--text);font:650 var(--text-xs) var(--mono)}
  summary>span{display:block;margin:4px 0 0 1rem;color:var(--muted);font-size:var(--text-2xs)}
  .body{padding:0 13px 13px;min-width:0}
  .report-meta{display:grid;gap:5px;padding-bottom:12px;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .coverage,.limitation{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .table-wrap{border:1px solid var(--border);border-radius:var(--radius-sm)}
  th,td{min-width:0;overflow-wrap:anywhere;font-size:var(--text-2xs)}
  .policy-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{display:grid;gap:4px;min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
  article strong,article span,article p{overflow-wrap:anywhere}article strong{font:650 var(--text-xs) var(--mono)}article span,article p{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article details{border:0;background:none}article summary{padding:6px 0;font-size:var(--text-2xs)}article p{margin:0}
  @media(max-width:700px){
    .policy-grid{grid-template-columns:1fr}.table-wrap{overflow:visible;border:0}
    table,tbody{display:block}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    tbody{display:grid;gap:8px}tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
    td{display:block;padding:0;border:0}td::before{content:attr(data-label);display:block;margin-bottom:3px;color:var(--muted);font:600 .6rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
  }
  @media(max-width:390px){tr{grid-template-columns:1fr}}
</style>
