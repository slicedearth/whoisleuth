<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  type AuditResult = { domain: string; report: any | null; error: string };
  let { active, disabledReason, auditing, results, audit }: {
    active: BrandProfile;
    disabledReason: string;
    auditing: boolean;
    results: AuditResult[];
    audit: () => void | Promise<void>;
  } = $props();
</script>

<section class="audit card"><header class="section-head"><div><p class="eyebrow">Prevention</p><h2>Official-domain security posture</h2><p>Audit SPF, DMARC, MTA-STS, TLS-RPT, BIMI, CAA, DNSSEC, and supplied DKIM selectors.</p></div><button class="primary" onclick={audit} disabled={auditing || !active.officialDomains.length || Boolean(disabledReason)}>{auditing ? 'Auditing…' : 'Audit official domains'}</button></header>{#if disabledReason}<p class="feature-disabled" role="note">{disabledReason}</p>{/if}{#if results.length}<div class="audit-results">{#each results as item}<article><h3>{item.domain}</h3>{#if item.error}<p class="error">{item.error}</p>{:else}<p class="counts">{item.report.summary.danger || 0} action · {item.report.summary.warning || 0} review · {item.report.summary.pass || 0} pass</p><div class="checks">{#each item.report.checks as check}<details class={check.status}><summary><span>{check.label}</span><strong>{check.status}</strong></summary><p>{check.summary}</p>{#if check.detail}<p>{check.detail}</p>{/if}{#if check.remediation}<p><b>Next:</b> {check.remediation}</p>{/if}{#if check.records?.length}<pre>{check.records.join('\n')}</pre>{/if}</details>{/each}</div>{/if}</article>{/each}</div>{/if}</section>

<style>
  .audit{margin-top:16px;padding:var(--card-pad)}
  .audit h2{margin:0}
  .audit .section-head p:not(.eyebrow),.counts{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .audit .section-head>button{align-self:start}
  .audit-results{display:grid;gap:12px;margin-top:18px}
  .audit-results>article{padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .audit-results h3{margin:0 0 4px;font:700 var(--text-md) var(--mono);overflow-wrap:anywhere}
  .checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
  .checks details{min-width:0;padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--border);border-radius:var(--radius-sm)}
  .checks details.danger{border-left-color:var(--danger)}.checks details.warning{border-left-color:var(--amber)}.checks details.pass{border-left-color:var(--accent2)}
  .checks summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;font-size:var(--text-xs)}
  .checks summary strong{text-transform:capitalize}.checks details.danger summary strong{color:var(--danger)}.checks details.warning summary strong{color:var(--amber)}.checks details.pass summary strong{color:var(--accent2)}
  .checks p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.checks pre{overflow:auto;font-size:var(--text-2xs)}
  @media(max-width:750px){.checks{grid-template-columns:1fr}.audit .section-head{display:block}.audit .section-head button{margin-top:12px}}
</style>
