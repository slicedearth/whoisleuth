<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import type { DomainPostureHttpResponse } from '$lib/analysis/client-response-contracts';
  type AuditResult = { domain: string; report: DomainPostureHttpResponse | null; error: string };
  let { active, disabledReason, auditing, results, audit }: {
    active: BrandProfile;
    disabledReason: string;
    auditing: boolean;
    results: AuditResult[];
    audit: () => void | Promise<void>;
  } = $props();
</script>

<section class="audit card">
  <header class="section-head">
    <div>
      <p class="eyebrow">Prevention</p>
      <h2>Official-domain security posture</h2>
      <p>Audit registration controls, delegation, SPF, DMARC, MTA-STS, TLS-RPT, BIMI, CAA, DNSSEC, and supplied DKIM selectors.</p>
    </div>
    <button class="primary" onclick={audit} disabled={auditing || !active.officialDomains.length || Boolean(disabledReason)}>
      {auditing ? 'Auditing…' : 'Audit official domains'}
    </button>
  </header>
  {#if disabledReason}<p class="feature-disabled" role="note">{disabledReason}</p>{/if}
  {#if results.length}
    <div class="audit-results">
      {#each results as item}
        <article>
          <h3>{item.domain}</h3>
          {#if item.error}
            <p class="error">{item.error}</p>
          {:else if item.report}
            <p class="counts">{item.report.summary.danger || 0} action · {item.report.summary.warning || 0} review · {item.report.summary.pass || 0} pass</p>
            <div class="checks">
              {#each item.report.checks as check}
                <details class={check.status}>
                  <summary><span>{check.label}</span><strong>{check.status}</strong></summary>
                  <p>{check.summary}</p>
                  {#if check.detail}<p>{check.detail}</p>{/if}
                  {#if check.remediation}<p><b>Next:</b> {check.remediation}</p>{/if}
                  {#if check.records.length}<pre>{check.records.join('\n')}</pre>{/if}
                </details>
              {/each}
            </div>
            <details class="analysis">
              <summary>
                <span>SPF expansion</span>
                <strong>{item.report.spfExpansion.state}</strong>
              </summary>
              <p>
                {item.report.spfExpansion.lookupsUsed}/{item.report.spfExpansion.lookupLimit} bounded policy queries ·
                {item.report.spfExpansion.dnsLookupTerms} DNS-querying terms ·
                {item.report.spfExpansion.voidLookups}/{item.report.spfExpansion.voidLookupLimit} void answers
              </p>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Branch</th><th>Relation</th><th>State</th><th>Terms</th></tr></thead>
                  <tbody>
                    {#each item.report.spfExpansion.branches as branch}
                      <tr>
                        <td class="wrap">{branch.domain}</td>
                        <td>{branch.relation}</td>
                        <td>{branch.state}</td>
                        <td>{branch.dnsLookupTerms}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="limitation">Only literal include and redirect targets are expanded. Resolver errors, cycles, macros, and exhausted bounds remain incomplete.</p>
            </details>
            {#if item.report.dmarcAuthorizations.length}
              <details class="analysis">
                <summary><span>DMARC reporting authorization</span><strong>{item.report.dmarcAuthorizations.length}</strong></summary>
                <ul>
                  {#each item.report.dmarcAuthorizations as authorization}
                    <li><span class="wrap">{authorization.destination}</span> · {authorization.reportType} · {authorization.state}</li>
                  {/each}
                </ul>
              </details>
            {/if}
            {#if item.report.externalDependencies.length}
              <details class="analysis">
                <summary><span>External dependencies</span><strong>{item.report.externalDependencies.length}</strong></summary>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Target</th><th>Source</th><th>Scope</th><th>State</th></tr></thead>
                    <tbody>
                      {#each item.report.externalDependencies as dependency}
                        <tr>
                          <td class="wrap">{dependency.target}</td>
                          <td>{dependency.source}</td>
                          <td>{dependency.scope.replaceAll('_', ' ')}</td>
                          <td>{dependency.state}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
                <p class="limitation">External or shared infrastructure is an operational review lead, not evidence of common ownership, insecurity, or exploitability.</p>
              </details>
            {/if}
          {:else}
            <p class="error">Official-domain audit returned an invalid response.</p>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

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
  .analysis{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .analysis>summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer;font-size:var(--text-xs);font-weight:700}
  .analysis>summary strong{color:var(--accent2);text-transform:capitalize}
  .analysis p,.analysis li,.analysis table{font-size:var(--text-xs);line-height:1.5}
  .analysis p,.analysis li{color:var(--muted)}
  .analysis ul{padding-left:20px}
  .table-wrap{max-width:100%;overflow:auto;margin-top:10px}
  .analysis table{width:100%;border-collapse:collapse}
  .analysis th,.analysis td{padding:7px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
  .analysis th{color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.08em}
  .limitation{margin-bottom:0}
  .wrap{overflow-wrap:anywhere}
  @media(max-width:750px){.checks{grid-template-columns:1fr}.audit .section-head{display:block}.audit .section-head button{margin-top:12px}}
</style>
