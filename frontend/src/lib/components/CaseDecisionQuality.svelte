<script lang="ts">
  import type { CaseDecisionQualityReport } from '$lib/analysis/case-decision-quality.ts';
  let { report }: { report: CaseDecisionQualityReport } = $props();
</script>

<section class="quality card" aria-labelledby="case-quality-title">
  <header>
    <div><p class="eyebrow">Decision quality</p><h2 id="case-quality-title">Case consistency audit</h2><p>Review evidence linkage and inconsistent treatment across browser-local cases.</p></div>
    <span><strong>{report.findingCount}</strong> finding{report.findingCount === 1 ? '' : 's'}</span>
  </header>
  {#if report.findings.length}
    <ul>
      {#each report.findings.slice(0, 24) as finding (finding.id)}
        <li class:high={finding.severity === 'high'}>
          <div><strong>{finding.title}</strong><span>{finding.severity} priority</span></div>
          <p>{finding.detail}</p>
          {#if finding.domains.length > 1}<small>{finding.domains.join(' · ')}</small>{/if}
          <a href={finding.href}>Open case record</a>
        </li>
      {/each}
    </ul>
    {#if report.findings.length > 24}<p>{report.findings.length - 24} additional bounded finding{report.findings.length - 24 === 1 ? '' : 's'} omitted from this view.</p>{/if}
  {:else}
    <p class="empty">No record-consistency issue was found in the current bounded case collection.</p>
  {/if}
  <p class="limit">{report.limitation}</p>
</section>

<style>
  .quality{min-width:0;margin-top:16px;padding:var(--card-pad)}header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}h2{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}header p:not(.eyebrow),.empty,.limit,.quality>p{max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}header>span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font:var(--text-2xs) var(--mono)}header>span strong{color:var(--text);font-size:var(--text-sm)}ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}li{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}li.high{border-color:color-mix(in srgb,var(--amber) 42%,var(--border))}li>div{display:flex;justify-content:space-between;gap:8px}li strong{font-size:var(--text-xs);line-height:1.4}li span,li p,li small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}li span{flex:0 0 auto;text-transform:capitalize}li p{margin:5px 0}li small{display:block;margin-bottom:6px;overflow-wrap:anywhere}li a{font:650 var(--text-2xs) var(--mono)}.limit{padding-top:10px;border-top:1px solid var(--border)}@media(max-width:760px){header{display:grid}ul{grid-template-columns:1fr}}
</style>
