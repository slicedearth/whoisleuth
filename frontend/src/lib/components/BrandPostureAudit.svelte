<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import type { DomainPostureHttpResponse } from '$lib/analysis/client-response-contracts';
  import { buildOwnedDomainPostureReview } from '$lib/analysis/owned-domain-posture-review.ts';
  type AuditResult = { domain: string; report: DomainPostureHttpResponse | null; error: string };
  let { active, disabledReason, auditing, results, audit, retainObservation }: {
    active: BrandProfile;
    disabledReason: string;
    auditing: boolean;
    results: AuditResult[];
    audit: () => void | Promise<void>;
    retainObservation: (report: DomainPostureHttpResponse) => void | Promise<void>;
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
            {@const review = buildOwnedDomainPostureReview(active, item.report)}
            <p class="counts">{item.report.summary.danger || 0} action · {item.report.summary.warning || 0} review · {item.report.summary.pass || 0} pass</p>
            <section class="desired-state" aria-label={`Desired posture for ${item.domain}`}>
              <header>
                <div><strong>{review.profileLabel}</strong><span>Desired-state review</span></div>
                <small>{review.attestationCounts.current} current private control attestation{review.attestationCounts.current === 1 ? '' : 's'} · {review.attestationCounts.expired} expired</small>
              </header>
              <div class="desired-groups">
                {#each review.desiredGroups as group}
                  <article class={`state-${group.state}`}>
                    <div><strong>{group.label}</strong><span>{group.state}</span></div>
                    <p>{group.purpose}</p>
                    <small>{group.checks.length ? group.checks.map((check) => `${check.label}: ${check.status}`).join(' · ') : 'No compatible check was returned.'}</small>
                  </article>
                {/each}
              </div>
              <p class="limitation">{review.limitations[0]}</p>
            </section>
            <section class="baseline-review" aria-label={`Baseline comparison for ${item.domain}`}>
              <header>
                <div>
                  <strong>Reviewed baseline comparison</strong>
                  <span>{review.baseline ? `${review.baselineComparisons.filter((entry) => entry.state === 'drift').length} drift · ${review.baselineComparisons.filter((entry) => entry.state === 'unknown' || entry.state === 'unsupported').length} incomplete` : 'Not configured'}</span>
                </div>
                {#if review.baseline}<button class="btn compact" onclick={() => retainObservation(item.report!)}>Retain this observation</button>{/if}
              </header>
              {#if review.baseline}
                <div class="comparison-grid">
                  {#each review.baselineComparisons as comparison}
                    <article class={`comparison-${comparison.state}`}>
                      <div><strong>{comparison.label}</strong><span>{comparison.state.replaceAll('_', ' ')}</span></div>
                      <p>{comparison.explanation}</p>
                      {#if comparison.desired.length}<small><b>Desired:</b> {comparison.desired.join(' · ')}</small>{/if}
                      {#if comparison.observed.length}<small><b>Observed:</b> {comparison.observed.join(' · ')}</small>{/if}
                      {#if comparison.suppressionReason}<small><b>Suppression:</b> {comparison.suppressionReason}</small>{/if}
                    </article>
                  {/each}
                </div>
                {#if review.previousChanges.length}
                  <details>
                    <summary>Changes since retained observation <strong>{review.previousChanges.filter((entry) => entry.state === 'changed').length}</strong></summary>
                    <ul>
                      {#each review.previousChanges as change}
                        <li><code>{change.checkId}</code> · {change.state}</li>
                      {/each}
                    </ul>
                  </details>
                {/if}
                <p class="limitation">Retaining an observation is explicit and local. Incomplete evidence remains unknown and does not replace the desired baseline.</p>
              {:else}
                <p>No desired posture has been configured for this domain. Use the baseline editor below to record reviewed expectations.</p>
              {/if}
            </section>
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
                <summary><span>DMARC reporting authorisation</span><strong>{item.report.dmarcAuthorizations.length}</strong></summary>
                <ul>
                  {#each item.report.dmarcAuthorizations as authorization}
                    <li><span class="wrap">{authorization.destination}</span> · {authorization.reportType} · {authorization.state}</li>
                  {/each}
                </ul>
              </details>
            {/if}
            {#if review.dependencies.length}
              <details class="analysis">
                <summary><span>External dependency review</span><strong>{review.dependencyCounts.unavailable} need evidence</strong></summary>
                <div class="dependency-grid">
                  {#each review.dependencies as dependency}
                    <article>
                      <strong class="wrap">{dependency.target}</strong>
                      <span>{dependency.kind.replaceAll('_', ' ')} · {dependency.scope.replaceAll('_', ' ')}</span>
                      <p>{dependency.source}</p>
                      <small class:needs-evidence={dependency.review === 'needs_evidence'}>{dependency.review.replaceAll('_', ' ')}</small>
                    </article>
                  {/each}
                </div>
                <p class="limitation">{review.limitations[1]}</p>
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
  .desired-state{display:grid;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .desired-state>header{display:flex;flex-wrap:wrap;align-items:start;justify-content:space-between;gap:8px}
  .desired-state>header div{display:grid;gap:2px}.desired-state>header span,.desired-state>header small{color:var(--muted);font-size:var(--text-2xs)}
  .desired-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .desired-groups article{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .desired-groups article>div{display:flex;justify-content:space-between;gap:8px}.desired-groups article>div span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .desired-groups article.state-action>div span{color:var(--danger)}.desired-groups article.state-review>div span{color:var(--warning)}.desired-groups article.state-aligned>div span{color:var(--accent2)}
  .desired-groups p,.desired-groups small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.desired-groups p{margin:5px 0}.desired-groups small{overflow-wrap:anywhere}
  .baseline-review{display:grid;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .baseline-review>header{display:flex;align-items:start;justify-content:space-between;gap:10px}
  .baseline-review>header>div{display:grid;gap:2px}.baseline-review>header span{color:var(--muted);font-size:var(--text-2xs)}
  .baseline-review>p,.baseline-review li{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .baseline-review details{font-size:var(--text-xs)}.baseline-review ul{margin-bottom:0;padding-left:20px}
  .comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .comparison-grid article{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .comparison-grid article>div{display:flex;justify-content:space-between;gap:8px}.comparison-grid article>div span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .comparison-grid article.comparison-drift>div span{color:var(--danger)}.comparison-grid article.comparison-suppressed>div span{color:var(--warning)}.comparison-grid article.comparison-aligned>div span{color:var(--accent2)}
  .comparison-grid p,.comparison-grid small{display:block;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}.comparison-grid p{margin:5px 0}
  .dependency-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
  .dependency-grid article{min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .dependency-grid article>span,.dependency-grid article>small{display:block;margin-top:3px;color:var(--muted);font:var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .dependency-grid article>p{margin:5px 0;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .dependency-grid article>small.needs-evidence{color:var(--warning)}
  @media(max-width:750px){.checks{grid-template-columns:1fr}.audit .section-head{display:block}.audit .section-head button{margin-top:12px}}
  @media(max-width:620px){.desired-groups,.dependency-grid,.comparison-grid{grid-template-columns:1fr}.baseline-review>header{display:grid}}
</style>
